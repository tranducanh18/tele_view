require('dotenv').config();
const express = require('express');
const { createBot } = require('./bot');
const { getAllUsers, loadUser, saveUser } = require('./firestore');
const { checkAllPagesForUser } = require('./scheduler');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const CRON_SECRET = process.env.CRON_SECRET || ''; // tùy chọn bảo mật

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

/**
 * Endpoint cho cron-job.org gọi mỗi 15 phút.
 * Trả lời ngay 200 OK, việc check chạy ngầm phía sau.
 * Tôn trọng settings.intervalMinutes của từng user.
 */
app.get('/cron-check', async (req, res) => {
  // Bảo mật nhẹ (nếu bạn set CRON_SECRET trên Render)
  if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
    return res.status(403).send('Forbidden');
  }

  // Trả lời ngay để cron-job.org không bị timeout 30s
  res.status(200).send('OK - check started');

  // Chạy ngầm
  runDueChecks().catch((err) => {
    console.error('Lỗi cron-check:', err.message);
  });
});

async function runDueChecks() {
  console.log('⏰ Cron-check bắt đầu lúc', new Date().toISOString());

  const users = await getAllUsers();
  const chatIds = Object.keys(users);
  console.log(`📋 Có ${chatIds.length} user`);

  const now = Date.now();

  for (const chatId of chatIds) {
    try {
      const data = users[chatId];
      if (!data.pages || data.pages.length === 0) {
        console.log(`⏭️ User ${chatId} không có page`);
        continue;
      }

      const intervalMs = (Number(data.settings.intervalMinutes) || 60) * 60 * 1000;
      const lastChecked = data.settings.lastCheckedAt
        ? new Date(data.settings.lastCheckedAt).getTime()
        : 0;

      if (now - lastChecked < intervalMs) {
        const remainMin = Math.ceil((intervalMs - (now - lastChecked)) / 60000);
        console.log(`⏳ User ${chatId} chưa đến giờ (còn ~${remainMin} phút)`);
        continue;
      }

      console.log(`▶️ User ${chatId} đến giờ check (${data.pages.length} page, interval ${data.settings.intervalMinutes}p)`);

      // Chạy check (có gửi summary)
      await checkAllPagesForUser(bot, chatId, { sendSummary: true });

      // Cập nhật thời gian check gần nhất
      const fresh = await loadUser(chatId);
      fresh.settings.lastCheckedAt = new Date().toISOString();
      await saveUser(chatId, fresh);

      console.log(`✅ User ${chatId} check xong`);
    } catch (err) {
      console.error(`❌ Lỗi user ${chatId}:`, err.message);
    }
  }

  console.log('⏰ Cron-check hoàn tất');
}

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên port ${PORT}`);
  console.log(`Webhook path: /bot${TOKEN}`);
  console.log(`Cron endpoint: /cron-check`);
});
