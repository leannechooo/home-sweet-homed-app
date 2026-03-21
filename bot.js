import { Bot, InlineKeyboard } from "grammy";
import http from "http";
import dotenv from "dotenv";
dotenv.config();

// ── Keep Render happy ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => res.end("HomeSweetHomedBot is running! 🏠"));
server.listen(process.env.PORT || 3000);

const bot = new Bot(process.env.BOT_TOKEN);

// ── In-memory storage ──────────────────────────────────────────────────────
const activePolls = {};   // { chatId: { votes, totalMembers, messageId, groupName } }
const sosTimers = {};     // { userId: { first, second } }
const setupUsers = new Set(); // userIds who have done private chat setup
const pendingSOS = {};    // { userId: chatId } — who triggered SOS and which group

// ── Helper: build poll message text ───────────────────────────────────────
function buildPollText(poll) {
  const statusEmoji = { yes: "🏠", otw: "🚶", check: "🫂" };
  const statusLabel = { yes: "I'm Home!", otw: "On the Way", check: "Check in on Me" };
  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;
  const total = poll.totalMembers;
  const voted = Object.values(poll.votes)
    .map((v) => `${statusEmoji[v.status]} ${v.name} — ${statusLabel[v.status]}`)
    .join("\n");
  const notVotedCount = total - Object.keys(poll.votes).length;
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

// ── Helper: build SOS group keyboard ──────────────────────────────────────
function buildSOSKeyboard(userId, name, username) {
  const profileUrl = username ? `https://t.me/${username}` : `tg://user?id=${userId}`;
  return new InlineKeyboard()
    .text(`✅ ${name} is Safe`, `sos_safe_${userId}`)
    .url(`📞 Call ${name}`, profileUrl);
}

// ── Helper: clear SOS timers ───────────────────────────────────────────────
function clearSOSTimers(userId) {
  if (sosTimers[userId]) {
    clearTimeout(sosTimers[userId].first);
    clearTimeout(sosTimers[userId].second);
    delete sosTimers[userId];
  }
}

// ── Helper: start SOS ping timers ─────────────────────────────────────────
function startSOSTimers(userId, chatId, name) {
  clearSOSTimers(userId); // clear any existing timers first

  const firstTimer = setTimeout(async () => {
    if (sosTimers[userId]) {
      await bot.api.sendMessage(
        chatId,
        `⚠️ *${name}* hasn't responded yet — can someone reach out?`,
        { parse_mode: "Markdown" }
      );
    }
  }, 10 * 60 * 1000);

  const secondTimer = setTimeout(async () => {
    if (sosTimers[userId]) {
      await bot.api.sendMessage(
        chatId,
        `🚨 *${name}* still hasn't responded — please check in on them urgently!`,
        { parse_mode: "Markdown" }
      );
      delete sosTimers[userId];
    }
  }, 20 * 60 * 1000);

  sosTimers[userId] = { first: firstTimer, second: secondTimer, chatId, name };
}

// ── Helper: close a poll cleanly ──────────────────────────────────────────
async function closePoll(chatId, poll, closedBy) {
  const statusEmoji = { yes: "🏠", otw: "🚶", check: "🫂" };
  const statusLabel = { yes: "I'm Home!", otw: "On the Way", check: "Check in on Me" };
  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;
  const summary = Object.keys(poll.votes).length > 0
    ? Object.values(poll.votes)
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
  delete activePolls[chatId];
}

// ── /start command (private chat) ─────────────────────────────────────────
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;
  const param = ctx.match; // text after /start

  // ── Setup flow ──────────────────────────────────────────────────────────
  if (!param || param === "setup") {
    setupUsers.add(userId);
    await ctx.reply(
      "✅ You're all set!\n\nIf you ever tap 🫂 Check in on Me during a check-in, " +
      "I'll ask for your location here privately and share it with your group automatically. 💚"
    );
    return;
  }

  // ── SOS location request flow ───────────────────────────────────────────
  if (param.startsWith("sos_")) {
    const targetUserId = parseInt(param.replace("sos_", ""));

    // Make sure it's the right person opening this link
    if (userId !== targetUserId) {
      await ctx.reply("This link is meant for someone else! 😊");
      return;
    }

    // Mark as setup since they opened the private chat
    setupUsers.add(userId);

    const chatId = pendingSOS[userId];
    const groupName = chatId && activePolls[chatId]?.groupName
      ? activePolls[chatId].groupName
      : "your group";

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

  // Default /start (no param)
  setupUsers.add(userId);
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

  // Only handle in private chat
  if (ctx.chat.type !== "private") return;

  const chatId = pendingSOS[userId];
  if (!chatId) {
    await ctx.reply("Thanks for sharing! No active SOS found — you're all good. 🏠");
    return;
  }

  // Clear SOS timers — location received, no need to ping
  clearSOSTimers(userId);
  delete pendingSOS[userId];

  const groupName = activePolls[chatId]?.groupName ?? "your group";

  // Remove the location keyboard
  await ctx.reply(
    `✅ Got it! Sharing your location with *${groupName}* now. Stay safe! 💚`,
    { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
  );

  // Forward location pin to the group
  await bot.api.sendLocation(chatId, ctx.message.location.latitude, ctx.message.location.longitude);

  // Send a message to the group explaining the pin
  await bot.api.sendMessage(
    chatId,
    `📍 *${name}*'s location has been shared with *${groupName}*\\. Go help them! 💚`,
    { parse_mode: "Markdown" }
  );

  // Update their vote to On the Way
  if (activePolls[chatId]?.votes[userId]) {
    activePolls[chatId].votes[userId].status = "otw";
    try {
      await bot.api.editMessageText(
        chatId,
        activePolls[chatId].messageId,
        buildPollText(activePolls[chatId]),
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

  // Close any existing poll
  if (activePolls[chatId]) {
    await closePoll(chatId, activePolls[chatId], null);
  }

  const rawCount = await ctx.api.getChatMemberCount(chatId);
  const totalMembers = rawCount - 1;
  const groupName = ctx.chat.title ?? "your group";

  activePolls[chatId] = { votes: {}, totalMembers, groupName };

  const msg = await ctx.reply(
    `🏡 *Are You Home Yet?*\n\n⏳ Waiting for everyone...\n\n🏠 *0/${totalMembers} are home*`,
    { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
  );

  activePolls[chatId].messageId = msg.message_id;

  // Remind everyone to set up private chat for location sharing
  const setupLink = `https://t.me/${ctx.me.username}?start=setup`;
  await ctx.reply(
    `📍 *Enable location sharing for emergencies*\n\n` +
    `If you ever need help getting home, I can share your location with *${groupName}* privately.\n\n` +
    `Tap below to set up \\(one time only\\) 👇`,
    {
      parse_mode: "MarkdownV2",
      reply_markup: new InlineKeyboard().url("💬 Set Up Now", setupLink),
    }
  );
});

// ── /allhomed command ──────────────────────────────────────────────────────
bot.command("allhomed", async (ctx) => {
  const chatId = ctx.chat.id;
  const name = ctx.from.first_name;
  if (!activePolls[chatId]) {
    await ctx.reply("There is no active check-in right now! Use /checkin to start one. 🏠");
    return;
  }
  const poll = activePolls[chatId];
  await closePoll(chatId, poll, name);
  await ctx.reply(`✅ Check-in has been closed by ${name}. 🏠`);
});

// ── Handle vote buttons ────────────────────────────────────────────────────
bot.callbackQuery(/^vote_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const action = ctx.callbackQuery.data;

  if (!activePolls[chatId]) {
    await ctx.answerCallbackQuery("This check-in has expired. Ask someone to type /checkin! 🏠");
    return;
  }

  const poll = activePolls[chatId];
  const prevStatus = poll.votes[userId]?.status;
  const statusMap = { vote_yes: "yes", vote_otw: "otw", vote_check: "check" };
  const status = statusMap[action];

  if (prevStatus === status) {
    await ctx.answerCallbackQuery("You already selected this! 😊");
    return;
  }

  poll.votes[userId] = { name, status };

  const confirmMap = {
    yes: "🏠 Got it, glad you're home!",
    otw: "🚶 Got it, safe travels!",
    check: "🫂 Got it, we'll keep an eye out for you!",
  };
  await ctx.answerCallbackQuery(confirmMap[status]);

  // Clear SOS timers if they changed away from check
  if (prevStatus === "check" && status !== "check") {
    clearSOSTimers(userId);
    delete pendingSOS[userId];
  }

  // Notifications
  if (status === "yes" && prevStatus !== "yes") {
    await ctx.reply(`🏠 *${name}* is home safe!`, { parse_mode: "Markdown" });
  } else if (status === "check" && prevStatus !== "check") {
    // Send distress alert
    await ctx.reply(`🚨 *${name}* may need help getting home!`, { parse_mode: "Markdown" });

    // Store pending SOS so private chat knows which group to forward to
    pendingSOS[userId] = chatId;

    const username = ctx.from.username ?? null;

    // Check if user has done private setup
    if (setupUsers.has(userId)) {
      // User has set up — send deep link to open private chat for location
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
      // User hasn't set up — show setup reminder + safe/call buttons
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

    // Start SOS timers as backup regardless of setup status
    startSOSTimers(userId, chatId, name);
  }

  // Check if everyone is home
  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;
  const allHome = homeCount === poll.totalMembers;

  if (allHome) {
    await closePoll(chatId, poll, null);
    await ctx.reply("🎉 *Everyone's home safe! Check-in closed.* 💚", { parse_mode: "Markdown" });
  } else {
    await ctx.api.editMessageText(
      chatId, poll.messageId,
      buildPollText(poll),
      { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
    );
  }
});

// ── Handle SOS safe button ─────────────────────────────────────────────────
bot.callbackQuery(/^sos_safe_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const confirmedBy = ctx.from.first_name;
  const targetUserId = parseInt(ctx.callbackQuery.data.replace("sos_safe_", ""));

  const poll = activePolls[chatId];
  if (!poll) {
    await ctx.answerCallbackQuery("This check-in has expired! 🏠");
    return;
  }

  const targetVote = poll.votes[targetUserId];
  const targetName = targetVote?.name ?? "They";

  clearSOSTimers(targetUserId);
  delete pendingSOS[targetUserId];

  await ctx.answerCallbackQuery(`💚 Thanks for confirming!`);

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  } catch (e) { /* ignore */ }

  // Switch vote to On the Way
  poll.votes[targetUserId] = { name: targetName, status: "otw" };

  await ctx.api.editMessageText(
    chatId, poll.messageId,
    buildPollText(poll),
    { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
  );

  await ctx.reply(
    `💚 *${targetName}* has been confirmed safe by ${confirmedBy}! They are on the way home 🚶`,
    { parse_mode: "Markdown" }
  );
});

// ── /help command ──────────────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.reply(
    "🏠 *Are You Home Yet? Bot*\n\n" +
    "Use these commands in your group chat:\n\n" +
    "/checkin — Start a check-in for the group\n" +
    "/allhomed — Force close the current check-in\n" +
    "/help — Show this message\n\n" +
    "Tap a button to respond:\n" +
    "🏠 I'm Home — you're safe\n" +
    "🚶 On the Way — still travelling\n" +
    "🫂 Check in on Me — alerts group + share location option\n\n" +
    "The check-in auto-closes when everyone is home! 💚\n\n" +
    "🛠 Bot issues? Contact @leannechoo on Telegram.",
    { parse_mode: "Markdown" }
  );
});

// ── Start bot ──────────────────────────────────────────────────────────────
bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
