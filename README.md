# 🏠 Are You Home Yet? Bot

A Telegram group bot that lets everyone check in safely after a night out, trip, or event.

---

## What it does

Type `/checkin` in a group chat and the bot starts a live poll. Everyone taps their status, the bot tracks it in real time, and when the last person gets home safely — it closes automatically.

If someone needs help, the group gets an instant alert with options to confirm they're safe or reach out directly.

---

## Commands

| Command | What it does |
|---|---|
| `/checkin` | Start a check-in for the group |
| `/allhomed` | Force close the current check-in |
| `/help` | Show commands in chat |

## Vote Options

| Button | Meaning |
|---|---|
| 🏠 I'm Home! | You're safe — group gets notified |
| 🚶 On the Way | Still travelling — no notification |
| 🫂 Check in on Me | Alerts group, anyone can confirm you're safe |

---

## Tech Stack

- **Bot framework** — [Grammy](https://grammy.dev) (Node.js)
- **Language** — JavaScript (ESM)
- **Hosting** — [Render](https://render.com) (free tier)
- **Uptime** — [UptimeRobot](https://uptimerobot.com) (keeps bot awake)
- **Bot platform** — Telegram Bot API

---

## Setup

### 1. Clone the repo
```bash
git clone https://github.com/leannechooo/home-sweet-homed-app.git
cd home-sweet-homed-app
npm install
```

### 2. Create your `.env` file
```
BOT_TOKEN=your_telegram_bot_token_here
PORT=3000
```

### 3. Run locally
```bash
node bot.js
```

### 4. Deploy
- Push to GitHub
- Connect repo to [Render](https://render.com) as a **Web Service**
- Add `BOT_TOKEN` as an environment variable
- Set start command to `node bot.js`
- Add your Render URL to UptimeRobot to prevent spin-down

---

## Notes

- Polls are stored in memory — they reset if the server restarts
- Render free tier may take 30-60 seconds to wake up after inactivity
- UptimeRobot pings every 5 minutes to keep the bot awake
- Bot must be added to a group chat before `/checkin` works

---

## Contact

Bot issues or feedback? Contact [@leannechoo](https://t.me/leannechoo) on Telegram.

---

*Built with 🧡 by Leanne — first-time builder, zero coding experience.*
