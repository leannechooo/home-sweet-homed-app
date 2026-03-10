import { Bot, InlineKeyboard } from "grammy";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import dotenv from "dotenv";
dotenv.config();

// ── Init Telegram Bot ──────────────────────────────────────────────────────
const bot = new Bot(process.env.BOT_TOKEN);

// ── Init Firebase Admin ────────────────────────────────────────────────────
initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = getDatabase();

// ── Notification messages ──────────────────────────────────────────────────
const NOTIFY_ON = ["yes", "check"]; // only notify for these two votes

const MESSAGE = {
  yes:   (name) => `🏠 *${name}* is home safe!`,
  check: (name) => `🫂 *${name}* needs help getting home — can someone check in?`,
};

// ── Track which polls are already being watched ────────────────────────────
const watchedPolls = new Set();

// ── /checkin command ───────────────────────────────────────────────────────
bot.command("checkin", async (ctx) => {
  const chatId = ctx.chat.id;
  const pollId = `poll_${chatId}`;

  // Reset the poll in Firebase
  await db.ref(`polls/${pollId}`).set({
    chatId,
    closed: false,
    votes: {},
    createdAt: Date.now(),
  });

  // Send the Mini App button into the group
  const keyboard = new InlineKeyboard().webApp(
    "🏠 Open Check-in",
    process.env.MINI_APP_URL
  );

  await ctx.reply(
    "🏡 *Are You Home Yet?*\nTap below to let everyone know you're safe!",
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );

  // Start watching this poll for votes
  watchPoll(pollId, chatId);
});

// ── Watch a poll for vote changes ──────────────────────────────────────────
function watchPoll(pollId, chatId) {
  if (watchedPolls.has(pollId)) return;
  watchedPolls.add(pollId);

  // Track previous votes so we only notify on NEW relevant votes
  const previousVotes = {};

  const votesRef = db.ref(`polls/${pollId}/votes`);

  votesRef.on("child_added", async (snap) => {
    const userId = snap.key;
    const { name, status } = snap.val();
    previousVotes[userId] = status;

    if (NOTIFY_ON.includes(status)) {
      await bot.api.sendMessage(chatId, MESSAGE[status](name), {
        parse_mode: "Markdown",
      });
    }

    await checkAllHome(pollId, chatId);
  });

  votesRef.on("child_changed", async (snap) => {
    const userId = snap.key;
    const { name, status } = snap.val();
    const prev = previousVotes[userId];

    // Only notify if this is a NEW vote for "yes" or "check"
    // and they weren't already in that state
    if (NOTIFY_ON.includes(status) && prev !== status) {
      await bot.api.sendMessage(chatId, MESSAGE[status](name), {
        parse_mode: "Markdown",
      });
    }

    previousVotes[userId] = status;
    await checkAllHome(pollId, chatId);
  });
}

// ── Check if everyone is home ──────────────────────────────────────────────
async function checkAllHome(pollId, chatId) {
  const snap = await db.ref(`polls/${pollId}`).get();
  const data = snap.val();

  if (!data || data.closed) return;

  const votes = data.votes ?? {};
  const ids = Object.keys(votes);
  if (ids.length === 0) return;

  const allHome = ids.every((id) => votes[id].status === "yes");

  if (allHome) {
    // Close the poll
    await db.ref(`polls/${pollId}/closed`).set(true);

    // Stop watching
    db.ref(`polls/${pollId}/votes`).off();
    watchedPolls.delete(pollId);

    // Send the final group message
    await bot.api.sendMessage(
      chatId,
      "🎉 *Everyone's home safe! Check\\-in closed\\.* 💚",
      { parse_mode: "MarkdownV2" }
    );
  }
}

// ── Start bot ──────────────────────────────────────────────────────────────
bot.start();
console.log("🏠 HomeSweetHomedBot is running!");
