import { Bot, InlineKeyboard } from "grammy";
import http from "http";
import dotenv from "dotenv";
dotenv.config();

// ── Keep Render happy with a tiny web server ───────────────────────────────
const server = http.createServer((req, res) => res.end("HomeSweetHomedBot is running! 🏠"));
server.listen(process.env.PORT || 3000);

const bot = new Bot(process.env.BOT_TOKEN);

// ── In-memory storage ──────────────────────────────────────────────────────
const activePolls = {};  // { chatId: { votes, totalMembers, messageId } }
const sosTimers = {};    // { userId: { first, second } } — ping timers

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

// ── Helper: build SOS response keyboard ───────────────────────────────────
function buildSOSKeyboard(userId) {
  return new InlineKeyboard()
    .text("✅ I'm Fine", `sos_fine_${userId}`)
    .row()
    .text("📍 Share My Current Location", `sos_location_${userId}`);
}

// ── Helper: clear SOS timers for a user ───────────────────────────────────
function clearSOSTimers(userId) {
  if (sosTimers[userId]) {
    clearTimeout(sosTimers[userId].first);
    clearTimeout(sosTimers[userId].second);
    delete sosTimers[userId];
  }
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

// ── /checkin command ───────────────────────────────────────────────────────
bot.command("checkin", async (ctx) => {
  const chatId = ctx.chat.id;
  if (ctx.chat.type === "private") {
    await ctx.reply("Please add me to a group chat and use /checkin there! 🏠");
    return;
  }
  if (activePolls[chatId]) {
    await closePoll(chatId, activePolls[chatId], null);
  }
  const rawCount = await ctx.api.getChatMemberCount(chatId);
  const totalMembers = rawCount - 1;
  activePolls[chatId] = { votes: {}, totalMembers };
  const msg = await ctx.reply(
    `🏡 *Are You Home Yet?*\n\n⏳ Waiting for everyone...\n\n🏠 *0/${totalMembers} are home*`,
    { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
  );
  activePolls[chatId].messageId = msg.message_id;
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

  // Clear any existing SOS timers if they changed their vote away from check
  if (prevStatus === "check" && status !== "check") {
    clearSOSTimers(userId);
  }

  // Group notifications
  if (status === "yes" && prevStatus !== "yes") {
    await ctx.reply(`🏠 *${name}* is home safe!`, { parse_mode: "Markdown" });
  } else if (status === "check" && prevStatus !== "check") {
    // Send SOS notification
    await ctx.reply(`🫂 *${name}* may need help getting home!`, { parse_mode: "Markdown" });

    // Send SOS response message with buttons
    const sosMsg = await ctx.reply(
      `${name}, are you okay? Let us know or share your current location 👇`,
      { reply_markup: buildSOSKeyboard(userId) }
    );

    // Set up ping timers — 10 mins then 20 mins
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
        delete sosTimers[userId]; // stop after second ping
      }
    }, 20 * 60 * 1000);

    sosTimers[userId] = { first: firstTimer, second: secondTimer, chatId, name };
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

// ── Handle SOS response buttons ────────────────────────────────────────────
bot.callbackQuery(/^sos_fine_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const targetUserId = parseInt(ctx.callbackQuery.data.replace("sos_fine_", ""));

  // Only the person themselves can tap I'm Fine
  if (userId !== targetUserId) {
    await ctx.answerCallbackQuery("Only the person who needs help can respond to this! 😊");
    return;
  }

  const name = ctx.from.first_name;
  clearSOSTimers(userId);

  await ctx.answerCallbackQuery("Glad you're okay! 💚");

  // Remove SOS buttons
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  } catch (e) { /* ignore */ }

  // Switch their vote to On the Way
  if (activePolls[chatId]) {
    activePolls[chatId].votes[userId] = { name, status: "otw" };
    await ctx.api.editMessageText(
      chatId,
      activePolls[chatId].messageId,
      buildPollText(activePolls[chatId]),
      { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
    );
  }

  await ctx.reply(`✅ *${name}* is okay and on the way home! 🚶`, { parse_mode: "Markdown" });
});

bot.callbackQuery(/^sos_location_/, async (ctx) => {
  const userId = ctx.from.id;
  const targetUserId = parseInt(ctx.callbackQuery.data.replace("sos_location_", ""));

  // Only the person themselves can share location
  if (userId !== targetUserId) {
    await ctx.answerCallbackQuery("Only the person who needs help can share their location! 😊");
    return;
  }

  await ctx.answerCallbackQuery(
    "Open the attachment menu in this chat (📎) → Location → Send Current Location 📍",
    { show_alert: true }
  );
});

// ── Handle incoming live location ──────────────────────────────────────────
bot.on("message:location", async (ctx) => {
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const chatId = ctx.chat.id;
  const location = ctx.message.location;

  // If this user had an SOS active, any location counts
  if (sosTimers[userId]) {
    clearSOSTimers(userId);
    await ctx.reply(
      `📍 *${name}* has shared their current location. Someone go help them! 💚`,
      { parse_mode: "Markdown" }
    );
  }
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
    "🫂 Check in on Me — need help, share your current location\n\n" +
    "The check-in auto-closes when everyone is home! 💚",
    { parse_mode: "Markdown" }
  );
});

// ── Start bot ──────────────────────────────────────────────────────────────
bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
