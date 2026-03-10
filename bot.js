import { Bot, InlineKeyboard } from "grammy";
import http from "http";
import dotenv from "dotenv";
dotenv.config();

// ── Keep Render happy with a tiny web server ───────────────────────────────
const server = http.createServer((req, res) => res.end("HomeSweetHomedBot is running! 🏠"));
server.listen(process.env.PORT || 3000);

const bot = new Bot(process.env.BOT_TOKEN);

// ── Store active polls in memory ───────────────────────────────────────────
const activePolls = {};

// ── Helper: build the poll message text ───────────────────────────────────
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

  return (
    `🏡 *Are You Home Yet?*\n\n` +
    `${voted}${waiting}\n\n` +
    `🏠 *${homeCount}/${total} are home*`
  );
}

// ── Helper: build the keyboard ─────────────────────────────────────────────
function buildKeyboard() {
  return new InlineKeyboard()
    .text("🏠 I'm Home!", "vote_yes")
    .text("🚶 On the Way", "vote_otw")
    .row()
    .text("🫂 Check in on Me", "vote_check");
}

// ── /checkin command ───────────────────────────────────────────────────────
bot.command("checkin", async (ctx) => {
  const chatId = ctx.chat.id;

  if (ctx.chat.type === "private") {
    await ctx.reply("Please add me to a group chat and use /checkin there! 🏠");
    return;
  }

  const rawCount = await ctx.api.getChatMemberCount(chatId);
  const totalMembers = rawCount - 1;

  activePolls[chatId] = { votes: {}, totalMembers, hostId: ctx.from.id };

  const msg = await ctx.reply(
    `🏡 *Are You Home Yet?*\n\n⏳ Waiting for everyone...\n\n🏠 *0/${totalMembers} are home*`,
    { reply_markup: buildKeyboard(), parse_mode: "Markdown" }
  );

  activePolls[chatId].messageId = msg.message_id;
});

// ── /allhomed command — force close the poll ───────────────────────────────
bot.command("allhomed", async (ctx) => {
  const chatId = ctx.chat.id;

  if (!activePolls[chatId]) {
    await ctx.reply("No active check-in to close! 🏠");
    return;
  }

  // Only the host who started the poll can force close it
  if (ctx.from.id !== activePolls[chatId].hostId) {
    await ctx.reply("Only the person who started the check-in can force close it! 👑");
    return;
  }

  const poll = activePolls[chatId];
  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;

  // Edit the poll message to show it's closed
  await ctx.api.editMessageText(
    chatId,
    poll.messageId,
    `🏡 *Are You Home Yet?*\n\n` +
    (Object.keys(poll.votes).length > 0
      ? Object.values(poll.votes)
          .map((v) => {
            const emoji = { yes: "🏠", otw: "🚶", check: "🫂" };
            const label = { yes: "I'm Home!", otw: "On the Way", check: "Check in on Me" };
            return `${emoji[v.status]} ${v.name} — ${label[v.status]}`;
          })
          .join("\n")
      : "⏳ No one voted.") +
    `\n\n🏠 *${homeCount}/${poll.totalMembers} were home*\n✅ Check-in force closed by host.`,
    { parse_mode: "Markdown" }
  );

  delete activePolls[chatId];

  await ctx.reply("✅ *Check-in has been force closed by the host.* 🏠", {
    parse_mode: "Markdown",
  });
});

// ── Handle button taps ─────────────────────────────────────────────────────
bot.callbackQuery(/^vote_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const action = ctx.callbackQuery.data;

  if (!activePolls[chatId]) {
    await ctx.answerCallbackQuery("No active check-in! Ask the host to start one.");
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
    check: "🫂 Got it, someone will check in on you!",
  };
  await ctx.answerCallbackQuery(confirmMap[status]);

  if (status === "yes" && prevStatus !== "yes") {
    await ctx.reply(`🏠 *${name}* is home safe!`, { parse_mode: "Markdown" });
  } else if (status === "check" && prevStatus !== "check") {
    await ctx.reply(`🫂 *${name}* needs help getting home — can someone check in?`, {
      parse_mode: "Markdown",
    });
  }

  const homeCount = Object.values(poll.votes).filter((v) => v.status === "yes").length;
  const allHome = homeCount === poll.totalMembers;

  if (allHome) {
    await ctx.api.editMessageText(
      chatId,
      poll.messageId,
      `🏡 *Are You Home Yet?*\n\n` +
      Object.values(poll.votes).map((v) => `🏠 ${v.name} — I'm Home!`).join("\n") +
      `\n\n🏠 *${poll.totalMembers}/${poll.totalMembers} are home*\n✅ Check-in closed!`,
      { parse_mode: "Markdown" }
    );

    delete activePolls[chatId];

    await ctx.reply("🎉 *Everyone's home safe! Check-in closed.* 💚", {
      parse_mode: "Markdown",
    });
  } else {
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
    "Add me to a group chat and use:\n\n" +
    "/checkin — Start a check-in for the group\n" +
    "/allhomed — Force close the check-in (host only)\n\n" +
    "Everyone can then tap:\n" +
    "🏠 I'm Home — when they're safe\n" +
    "🚶 On the Way — still travelling\n" +
    "🫂 Check in on Me — needs someone to check in\n\n" +
    "The check-in auto-closes when everyone is home! 💚",
    { parse_mode: "Markdown" }
  );
});

bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
