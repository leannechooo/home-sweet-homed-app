import { Bot, InlineKeyboard } from "grammy";
import http from "http";
import dotenv from "dotenv";
dotenv.config();

// ── Keep Render happy with a tiny web server ───────────────────────────────
const server = http.createServer((req, res) => res.end("HomeSweetHomedBot is running! 🏠"));
server.listen(process.env.PORT || 3000);

const bot = new Bot(process.env.BOT_TOKEN);

// ── Store active polls in memory ───────────────────────────────────────────
// Polls are cleared when Render restarts — this is intentional
const activePolls = {};

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

// ── Helper: build keyboard ─────────────────────────────────────────────────
function buildKeyboard() {
  return new InlineKeyboard()
    .text("🏠 I'm Home!", "vote_yes")
    .text("🚶 On the Way", "vote_otw")
    .row()
    .text("🫂 Check in on Me", "vote_check");
}

// ── Helper: close a poll cleanly ───────────────────────────────────────────
async function closePoll(chatId, poll, closedBy) {
  const statusEmoji = { yes: "🏠", otw: "🚶", check: "🫂" };
  const statusLabel = { yes: "I'm Home!", otw: "On the Way", check: "Check in on Me" };
  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;

  const summary = Object.keys(poll.votes).length > 0
    ? Object.values(poll.votes)
        .map((v) => `${statusEmoji[v.status]} ${v.name} — ${statusLabel[v.status]}`)
        .join("\n")
    : "⏳ No one voted.";

  const closeReason = closedBy
    ? `Force closed by ${closedBy}.`
    : "Check\\-in closed\\!";

  try {
    await bot.api.editMessageText(
      chatId,
      poll.messageId,
      `🏡 *Are You Home Yet?*\n\n${summary}\n\n🏠 *${homeCount}/${poll.totalMembers} home*\n✅ ${closeReason}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    // Message may already be edited — ignore silently
  }

  delete activePolls[chatId];
}

// ── /checkin command ───────────────────────────────────────────────────────
bot.command("checkin", async (ctx) => {
  const chatId = ctx.chat.id;

  if (ctx.chat.type === "private") {
    await ctx.reply("Please add me to a group chat and use /checkin there! 🏠");
    return;
  }

  // If there's already an active poll, close it silently first
  if (activePolls[chatId]) {
    await closePoll(chatId, activePolls[chatId], null);
  }

  const rawCount = await ctx.api.getChatMemberCount(chatId);
  const totalMembers = rawCount - 1; // subtract the bot itself

  activePolls[chatId] = { votes: {}, totalMembers };

  const msg = await ctx.reply(
    `🏡 *Are You Home Yet?*\n\n⏳ Waiting for everyone...\n\n🏠 *0/${totalMembers} are home*`,
    { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
  );

  activePolls[chatId].messageId = msg.message_id;
});

// ── /allhomed command — anyone can force close ─────────────────────────────
bot.command("allhomed", async (ctx) => {
  const chatId = ctx.chat.id;
  const name = ctx.from.first_name;

  if (!activePolls[chatId]) {
    await ctx.reply("There's no active check\\-in right now\\! Use /checkin to start one\\. 🏠", {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const poll = activePolls[chatId];
  await closePoll(chatId, poll, name);

  await ctx.reply(`✅ *Check\\-in has been closed by ${name}\\.* 🏠`, {
    parse_mode: "MarkdownV2",
  });
});

// ── Handle button taps ─────────────────────────────────────────────────────
bot.callbackQuery(/^vote_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const action = ctx.callbackQuery.data;

  // Poll expired (Render restarted) — tell user gracefully
  if (!activePolls[chatId]) {
    await ctx.answerCallbackQuery("This check-in has expired 😔 Ask someone to type /checkin to start a new one!");
    return;
  }

  const poll = activePolls[chatId];
  const prevStatus = poll.votes[userId]?.status;
  const statusMap = { vote_yes: "yes", vote_otw: "otw", vote_check: "check" };
  const status = statusMap[action];

  // Tapped same button again
  if (prevStatus === status) {
    await ctx.answerCallbackQuery("You already selected this! 😊");
    return;
  }

  // Save vote
  poll.votes[userId] = { name, status };

  // Confirm to the tapper
  const confirmMap = {
    yes: "🏠 Got it, glad you're home!",
    otw: "🚶 Got it, safe travels!",
    check: "🫂 Got it, someone will check in on you!",
  };
  await ctx.answerCallbackQuery(confirmMap[status]);

  // Group notifications for yes and check only, and only on change
  if (status === "yes" && prevStatus !== "yes") {
    await ctx.reply(`🏠 *${name}* is home safe!`, { parse_mode: "Markdown" });
  } else if (status === "check" && prevStatus !== "check") {
    await ctx.reply(`🫂 *${name}* needs help getting home — can someone check in?`, {
      parse_mode: "Markdown",
    });
  }

  // Check if everyone is home
  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;
  const allHome = homeCount === poll.totalMembers;

  if (allHome) {
    await closePoll(chatId, poll, null);
    await ctx.reply("🎉 *Everyone's home safe! Check-in closed.* 💚", {
      parse_mode: "Markdown",
    });
  } else {
    // Update poll message with live status
    await ctx.api.editMessageText(
      chatId,
      poll.messageId,
      buildPollText(poll),
      { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
    );
  }
});

// ── /help command ──────────────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.reply(
    "🏠 *Are You Home Yet? Bot*\n\n" +
    "Use these commands in your group chat:\n\n" +
    "/checkin — Start a check\\-in for the group\n" +
    "/allhomed — Force close the current check\\-in\n" +
    "/help — Show this message\n\n" +
    "Tap a button to respond:\n" +
    "🏠 I'm Home — you're safe\n" +
    "🚶 On the Way — still travelling\n" +
    "🫂 Check in on Me — someone should check on you\n\n" +
    "The check\\-in auto\\-closes when everyone is home\\! 💚",
    { parse_mode: "MarkdownV2" }
  );
});

// ── Start bot ──────────────────────────────────────────────────────────────
bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
