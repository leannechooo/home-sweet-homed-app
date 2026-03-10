import { Bot, InlineKeyboard } from "grammy";
import dotenv from "dotenv";
dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);

// ── Store active polls in memory ───────────────────────────────────────────
// { chatId: { messageId, votes: { userId: { name, status } } } }
const activePolls = {};

// ── /checkin command ───────────────────────────────────────────────────────
bot.command("checkin", async (ctx) => {
  const chatId = ctx.chat.id;

  // Only works in group chats
  if (ctx.chat.type === "private") {
    await ctx.reply("Please add me to a group chat and use /checkin there! 🏠");
    return;
  }

  // Reset poll for this chat
  activePolls[chatId] = { votes: {} };

  const keyboard = new InlineKeyboard()
    .text("🏠 I'm Home!", "vote_yes")
    .text("🚶 On the Way", "vote_otw")
    .row()
    .text("🫂 Check in on Me", "vote_check");

  const msg = await ctx.reply(
    "🏡 *Are You Home Yet?*\n\nLet everyone know how you're doing!",
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );

  // Store the message ID so we can edit it later
  activePolls[chatId].messageId = msg.message_id;
});

// ── Handle button taps ─────────────────────────────────────────────────────
bot.callbackQuery(/^vote_/, async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const action = ctx.callbackQuery.data; // vote_yes / vote_otw / vote_check

  // No active poll
  if (!activePolls[chatId]) {
    await ctx.answerCallbackQuery("No active check-in! Ask the host to start one.");
    return;
  }

  const poll = activePolls[chatId];
  const prevStatus = poll.votes[userId]?.status;

  const statusMap = {
    vote_yes: "yes",
    vote_otw: "otw",
    vote_check: "check",
  };

  const status = statusMap[action];

  // Don't do anything if they tapped the same button again
  if (prevStatus === status) {
    await ctx.answerCallbackQuery("You already selected this! 😊");
    return;
  }

  // Save their vote
  poll.votes[userId] = { name, status };

  // Confirm to the user who tapped
  const confirmMap = {
    yes: "🏠 Got it, glad you're home!",
    otw: "🚶 Got it, safe travels!",
    check: "🫂 Got it, someone will check in on you!",
  };
  await ctx.answerCallbackQuery(confirmMap[status]);

  // Send group notification for "yes" and "check" only
  if (status === "yes" && prevStatus !== "yes") {
    await ctx.reply(`🏠 *${name}* is home safe!`, { parse_mode: "Markdown" });
  } else if (status === "check" && prevStatus !== "check") {
    await ctx.reply(`🫂 *${name}* needs help getting home — can someone check in?`, {
      parse_mode: "Markdown",
    });
  }

  // Check if everyone is home
  const allVotes = Object.values(poll.votes);
  const allHome = allVotes.length > 0 && allVotes.every((v) => v.status === "yes");

  if (allHome) {
    // Close the poll — remove the buttons
    await ctx.api.editMessageReplyMarkup(chatId, poll.messageId, {
      reply_markup: new InlineKeyboard(),
    });

    delete activePolls[chatId];

    await ctx.reply("🎉 *Everyone's home safe! Check-in closed.* 💚", {
      parse_mode: "Markdown",
    });
  } else {
    // Update the poll message to show current status
    const statusEmoji = { yes: "🏠", otw: "🚶", check: "🫂" };
    const lines = Object.values(poll.votes)
      .map((v) => `${statusEmoji[v.status]} ${v.name}`)
      .join("\n");

    await ctx.api.editMessageText(
      chatId,
      poll.messageId,
      `🏡 *Are You Home Yet?*\n\n${lines}\n\nLet everyone know how you're doing!`,
      {
        reply_markup: new InlineKeyboard()
          .text("🏠 I'm Home!", "vote_yes")
          .text("🚶 On the Way", "vote_otw")
          .row()
          .text("🫂 Check in on Me", "vote_check"),
        parse_mode: "Markdown",
      }
    );
  }
});

// ── /help command ──────────────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.reply(
    "🏠 *Are You Home Yet? Bot*\n\n" +
    "Add me to a group chat and use:\n\n" +
    "/checkin — Start a check-in for the group\n\n" +
    "Everyone can then tap:\n" +
    "🏠 I'm Home — when they're safe\n" +
    "🚶 On the Way — still travelling\n" +
    "🫂 Check in on Me — needs someone to check in\n\n" +
    "The check-in auto-closes when everyone is home! 💚",
    { parse_mode: "Markdown" }
  );
});

// ── Start bot ──────────────────────────────────────────────────────────────
bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
