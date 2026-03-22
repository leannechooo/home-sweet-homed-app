import { Bot, InlineKeyboard } from "grammy";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import http from "http";
import dotenv from "dotenv";
dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);

// ── Keep Render happy — must bind port FIRST before anything else ──────────
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("HomeSweetHomedBot is running! 🏠");
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Web server listening on port ${PORT}`);
});

// ── Firebase Admin init ────────────────────────────────────────────────────
initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = getDatabase();

// ── Firebase helpers ───────────────────────────────────────────────────────
async function getPoll(chatId) {
  const snap = await db.ref(`polls/${chatId}`).get();
  return snap.exists() ? snap.val() : null;
}

async function savePoll(chatId, data) {
  await db.ref(`polls/${chatId}`).set(data);
}

async function updateVote(chatId, userId, name, status) {
  await db.ref(`polls/${chatId}/votes/${userId}`).set({ name, status });
}

async function closePollInDB(chatId) {
  await db.ref(`polls/${chatId}/closed`).set(true);
}

async function deletePoll(chatId) {
  await db.ref(`polls/${chatId}`).remove();
}

async function isSetup(userId) {
  const snap = await db.ref(`setupUsers/${userId}`).get();
  return snap.exists();
}

async function markSetup(userId) {
  await db.ref(`setupUsers/${userId}`).set(true);
}

async function getPendingSOS(userId) {
  const snap = await db.ref(`pendingSOS/${userId}`).get();
  return snap.exists() ? snap.val() : null;
}

async function setPendingSOS(userId, chatId) {
  await db.ref(`pendingSOS/${userId}`).set(chatId);
}

async function clearPendingSOS(userId) {
  await db.ref(`pendingSOS/${userId}`).remove();
}

// ── In-memory SOS timers (these don't need to survive restarts) ────────────
const sosTimers = {};

function clearSOSTimers(userId) {
  if (sosTimers[userId]) {
    clearTimeout(sosTimers[userId].first);
    clearTimeout(sosTimers[userId].second);
    delete sosTimers[userId];
  }
}

function startSOSTimers(userId, chatId, name) {
  clearSOSTimers(userId);
  const firstTimer = setTimeout(async () => {
    if (sosTimers[userId]) {
      await bot.api.sendMessage(chatId,
        `⚠️ *${name}* hasn't responded yet — can someone reach out?`,
        { parse_mode: "Markdown" }
      );
    }
  }, 10 * 60 * 1000);

  const secondTimer = setTimeout(async () => {
    if (sosTimers[userId]) {
      await bot.api.sendMessage(chatId,
        `🚨 *${name}* still hasn't responded — please check in on them urgently!`,
        { parse_mode: "Markdown" }
      );
      delete sosTimers[userId];
    }
  }, 20 * 60 * 1000);

  sosTimers[userId] = { first: firstTimer, second: secondTimer };
}

// ── Helper: build poll message text ───────────────────────────────────────
function buildPollText(poll) {
  const statusEmoji = { yes: "🏠", otw: "🚶", check: "🫂" };
  const statusLabel = { yes: "I'm Home!", otw: "On the Way", check: "Check in on Me" };
  const votes = poll.votes ?? {};
  const homeCount = Object.values(votes).filter((v) => v.status === "yes").length;
  const total = poll.totalMembers;
  const voted = Object.values(votes)
    .map((v) => `${statusEmoji[v.status]} ${v.name} — ${statusLabel[v.status]}`)
    .join("\n");
  const notVotedCount = total - Object.keys(votes).length;
  const waiting = notVotedCount > 0
    ? "\n" + [...Array(notVotedCount)].map(() => "⏳ Waiting...").join("\n")
    : "";
  return `🏡 *Are You Home Yet?*\n\n${voted}${waiting}\n\n🏠 *${homeCount}/${total} are home*`;
}

// ── Helper: build main vote keyboard ──────────────────────────────────────
function buildKeyboard() {
  return new InlineKeyboard()
    .text("🏠 I'm Home!", "vote_yes")
    .text("🚶 On the Way", "vote_otw")
    .row()
    .text("🫂 Check in on Me", "vote_check");
}

// ── Helper: build SOS keyboard ─────────────────────────────────────────────
function buildSOSKeyboard(userId, name, username) {
  const profileUrl = username ? `https://t.me/${username}` : `tg://user?id=${userId}`;
  return new InlineKeyboard()
    .text(`✅ ${name} is Safe`, `sos_safe_${userId}`)
    .url(`📞 Call ${name}`, profileUrl);
}

// ── Helper: close poll cleanly ─────────────────────────────────────────────
async function closePoll(chatId, poll, closedBy) {
  const statusEmoji = { yes: "🏠", otw: "🚶", check: "🫂" };
  const statusLabel = { yes: "I'm Home!", otw: "On the Way", check: "Check in on Me" };
  const votes = poll.votes ?? {};
  const homeCount = Object.values(votes).filter((v) => v.status === "yes").length;
  const summary = Object.keys(votes).length > 0
    ? Object.values(votes)
        .map((v) => `${statusEmoji[v.status]} ${v.name} — ${statusLabel[v.status]}`)
        .join("\n")
    : "No one voted.";
  const closeReason = closedBy ? `Force closed by ${closedBy}.` : "Check-in closed!";
  try {
    await bot.api.editMessageText(
      chatId, poll.messageId,
      `🏡 *Are You Home Yet?*\n\n${summary}\n\n🏠 *${homeCount}/${poll.totalMembers} home*\n✅ ${closeReason}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) { /* already edited — ignore */ }
  await deletePoll(chatId);
}

// ── /start command (private chat) ─────────────────────────────────────────
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;
  const param = ctx.match;

  if (!param || param === "setup") {
    await markSetup(userId);
    await ctx.reply(
      "✅ You're all set!\n\nIf you ever tap 🫂 Check in on Me during a check-in, " +
      "I'll ask for your location here privately and share it with your group automatically. 💚"
    );
    return;
  }

  if (param.startsWith("sos_")) {
    const targetUserId = parseInt(param.replace("sos_", ""));
    if (userId !== targetUserId) {
      await ctx.reply("This link is meant for someone else! 😊");
      return;
    }

    await markSetup(userId);
    const chatId = await getPendingSOS(userId);
    const poll = chatId ? await getPoll(chatId) : null;
    const groupName = poll?.groupName ?? "your group";

    await ctx.reply(
      `Hi ${ctx.from.first_name}! 💛\n\n` +
      `Tap the button below to share your current location with *${groupName}* 👇\n\n` +
      `_(Your location will only be shared once)_`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "📍 Share My Current Location", request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      }
    );
    return;
  }

  await markSetup(userId);
  await ctx.reply(
    "🏠 *Are You Home Yet? Bot*\n\n" +
    "You're all set up! Add me to a group chat and use /checkin to start a check-in.\n\n" +
    "If you ever need help getting home, I can share your location with your group privately. 💚",
    { parse_mode: "Markdown" }
  );
});

// ── Handle incoming location in private chat ───────────────────────────────
bot.on("message:location", async (ctx) => {
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  if (ctx.chat.type !== "private") return;

  const chatId = await getPendingSOS(userId);
  if (!chatId) {
    await ctx.reply("Thanks for sharing! No active SOS found — you're all good. 🏠");
    return;
  }

  clearSOSTimers(userId);
  await clearPendingSOS(userId);

  const poll = await getPoll(chatId);
  const groupName = poll?.groupName ?? "your group";

  await ctx.reply(
    `✅ Got it! Sharing your location with *${groupName}* now. Stay safe! 💚`,
    { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
  );

  await bot.api.sendLocation(chatId, ctx.message.location.latitude, ctx.message.location.longitude);
  await bot.api.sendMessage(chatId,
    `📍 *${name}*'s location has been shared with *${groupName}*. Go help them! 💚`,
    { parse_mode: "Markdown" }
  );

  if (poll?.votes?.[userId]) {
    await updateVote(chatId, userId, name, "otw");
    const updatedPoll = await getPoll(chatId);
    try {
      await bot.api.editMessageText(
        chatId, poll.messageId,
        buildPollText(updatedPoll),
        { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
      );
    } catch (e) { /* ignore */ }
  }
});

// ── /checkin command ───────────────────────────────────────────────────────
bot.command("checkin", async (ctx) => {
  const chatId = ctx.chat.id;
  if (ctx.chat.type === "private") {
    await ctx.reply("Please add me to a group chat and use /checkin there! 🏠");
    return;
  }

  const existing = await getPoll(chatId);
  if (existing) await closePoll(chatId, existing, null);

  const rawCount = await ctx.api.getChatMemberCount(chatId);
  const totalMembers = rawCount - 1;
  const groupName = ctx.chat.title ?? "your group";

  const msg = await ctx.reply(
    `🏡 *Are You Home Yet?*\n\n⏳ Waiting for everyone...\n\n🏠 *0/${totalMembers} are home*`,
    { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
  );

  await savePoll(chatId, {
    votes: {},
    totalMembers,
    groupName,
    messageId: msg.message_id,
    closed: false,
  });

  const setupLink = `https://t.me/${ctx.me.username}?start=setup`;
  await ctx.reply(
    `📍 *Enable location sharing for emergencies*

New here? Start a private chat with me so I can share your location with ${groupName} if you ever need help getting home.

Already set up? You can ignore this 😊`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().url("💬 Set Up Now (first time only)", setupLink),
    }
  );
});

// ── /allhomed command ──────────────────────────────────────────────────────
bot.command("allhomed", async (ctx) => {
  const chatId = ctx.chat.id;
  const name = ctx.from.first_name;
  const poll = await getPoll(chatId);
  if (!poll) {
    await ctx.reply("There is no active check-in right now! Use /checkin to start one. 🏠");
    return;
  }
  await closePoll(chatId, poll, name);
  await ctx.reply(`✅ Check-in has been closed by ${name}. 🏠`);
});

// ── Handle vote buttons ────────────────────────────────────────────────────
bot.callbackQuery(/^vote_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const action = ctx.callbackQuery.data;

  const poll = await getPoll(chatId);
  if (!poll || poll.closed) {
    await ctx.answerCallbackQuery("This check-in has expired. Ask someone to type /checkin! 🏠");
    return;
  }

  const votes = poll.votes ?? {};
  const prevStatus = votes[userId]?.status;
  const statusMap = { vote_yes: "yes", vote_otw: "otw", vote_check: "check" };
  const status = statusMap[action];

  if (prevStatus === status) {
    await ctx.answerCallbackQuery("You already selected this! 😊");
    return;
  }

  // Answer callback INSTANTLY so button stops spinning right away
  const confirmMap = {
    yes: "🏠 Got it, glad you're home!",
    otw: "🚶 Got it, safe travels!",
    check: "🫂 Got it, we'll keep an eye out for you!",
  };
  await ctx.answerCallbackQuery(confirmMap[status]);

  // Save vote to Firebase
  await updateVote(chatId, userId, name, status);

  // Clear SOS if changed away from check
  if (prevStatus === "check" && status !== "check") {
    clearSOSTimers(userId);
    await clearPendingSOS(userId);
  }

  // Notifications
  if (status === "yes" && prevStatus !== "yes") {
    await ctx.reply(`🏠 *${name}* is home safe!`, { parse_mode: "Markdown" });
  } else if (status === "check" && prevStatus !== "check") {
    await ctx.reply(`🚨 *${name}* may need help getting home!`, { parse_mode: "Markdown" });

    await setPendingSOS(userId, chatId);
    const username = ctx.from.username ?? null;
    const userSetup = await isSetup(userId);

    if (userSetup) {
      const sosLink = `https://t.me/${ctx.me.username}?start=sos_${userId}`;
      await ctx.reply(
        `${name}, share your location with *${poll.groupName}* privately 👇\n_(Tap the button below)_`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .url("📍 Share My Location", sosLink)
            .row()
            .text(`✅ ${name} is Safe`, `sos_safe_${userId}`)
            .url(`📞 Call ${name}`, username ? `https://t.me/${username}` : `tg://user?id=${userId}`),
        }
      );
    } else {
      const setupLink = `https://t.me/${ctx.me.username}?start=setup`;
      await ctx.reply(
        `${name} hasn't set up location sharing yet.\n\n` +
        `*${name}*, tap below to set up, then tap 🫂 again to share your location 👇`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .url("💬 Set Up Location Sharing", setupLink)
            .row()
            .text(`✅ ${name} is Safe`, `sos_safe_${userId}`)
            .url(`📞 Call ${name}`, username ? `https://t.me/${username}` : `tg://user?id=${userId}`),
        }
      );
    }

    startSOSTimers(userId, chatId, name);
  }

  // Get updated poll and check if everyone is home
  const updatedPoll = await getPoll(chatId);
  const updatedVotes = updatedPoll?.votes ?? {};
  const homeCount = Object.values(updatedVotes).filter((v) => v.status === "yes").length;
  const allHome = homeCount === poll.totalMembers;

  if (allHome) {
    await closePoll(chatId, updatedPoll, null);
    await ctx.reply("🎉 *Everyone's home safe! Check-in closed.* 💚", { parse_mode: "Markdown" });
  } else {
    try {
      await bot.api.editMessageText(
        chatId, poll.messageId,
        buildPollText(updatedPoll),
        { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
      );
    } catch (e) { /* ignore */ }
  }
});

// ── Handle SOS safe button ─────────────────────────────────────────────────
bot.callbackQuery(/^sos_safe_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const confirmedBy = ctx.from.first_name;
  const targetUserId = parseInt(ctx.callbackQuery.data.replace("sos_safe_", ""));

  const poll = await getPoll(chatId);
  if (!poll) {
    await ctx.answerCallbackQuery("This check-in has expired! 🏠");
    return;
  }

  const targetName = poll.votes?.[targetUserId]?.name ?? "They";
  clearSOSTimers(targetUserId);
  await clearPendingSOS(targetUserId);

  await ctx.answerCallbackQuery("💚 Thanks for confirming!");
  try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }); } catch (e) {}

  await updateVote(chatId, targetUserId, targetName, "otw");
  const updatedPoll = await getPoll(chatId);

  try {
    await bot.api.editMessageText(
      chatId, poll.messageId,
      buildPollText(updatedPoll),
      { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
    );
  } catch (e) {}

  await ctx.reply(
    `💚 *${targetName}* has been confirmed safe by ${confirmedBy}! They are on the way home 🚶`,
    { parse_mode: "Markdown" }
  );
});

// ── /setup command ────────────────────────────────────────────────────────
bot.command("setup", async (ctx) => {
  const setupLink = `https://t.me/${ctx.me.username}?start=setup`;
  const msg = "📍 *Enable location sharing*

Tap below to start a private chat with me. This lets me share your location with your group if you ever tap 🫂 Check in on Me.

_(One time setup only!)_";
  await ctx.reply(msg, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().url("💬 Set Up Now", setupLink),
  });
});

// ── /help command ──────────────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.reply(
    "🏠 *Are You Home Yet? Bot*\n\n" +
    "Use these commands in your group chat:\n\n" +
    "/checkin — Start a check-in for the group\n" +
    "/allhomed — Force close the current check-in\n" +
    "/setup — Enable location sharing for emergencies\n" +
    "/help — Show this message\n\n" +
    "Tap a button to respond:\n" +
    "🏠 I'm Home — you're safe\n" +
    "🚶 On the Way — still travelling\n" +
    "🫂 Check in on Me — alerts group + share location option\n" +
    "_(Use /setup first to enable location sharing)_\n\n" +
    "The check-in auto-closes when everyone is home! 💚\n\n" +
    "🛠 Bot issues? Contact @leannechoo on Telegram.",
    { parse_mode: "Markdown" }
  );
});

// ── Start bot ──────────────────────────────────────────────────────────────
bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
