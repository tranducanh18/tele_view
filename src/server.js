require('dotenv').config();
const express = require('express');
const { createBot } = require('./bot');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
  console.error('❌ Thiếu TELEGRAM_BOT_TOKEN trong biến môi trường');
  process.exit(1);
}

const bot = createBot(TOKEN);
const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.status(200).send('FB View Bot is running ✅');
});

// Telegram Webhook
app.post(`/bot${TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên port ${PORT}`);
  console.log(`Webhook path: /bot${TOKEN}`);
});
