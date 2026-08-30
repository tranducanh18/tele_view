/**
 * Script chạy trên GitHub Actions mỗi 15 phút.
 * Quét tất cả user trong Firestore, check view, gửi thông báo nếu đạt ngưỡng.
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { getAllUsers } = require('../src/firestore');
const { checkAllPagesForUser } = require('../src/scheduler');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('❌ Thiếu TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

async function main() {
  console.log('🚀 Bắt đầu check views lúc', new Date().toISOString());

  const bot = new TelegramBot(TOKEN, { polling: false });
  const users = await getAllUsers();
  const chatIds = Object.keys(users);

  console.log(`📋 Có ${chatIds.length} user`);

  for (const chatId of chatIds) {
    const data = users[chatId];
    if (!data.pages || data.pages.length === 0) {
      console.log(`⏭️ User ${chatId} không có page, bỏ qua`);
      continue;
    }
    console.log(`\n👤 User ${chatId} - ${data.pages.length} page`);
    try {
      await checkAllPagesForUser(bot, chatId);
    } catch (err) {
      console.error(`❌ Lỗi user ${chatId}:`, err.message);
    }
  }

  console.log('\n✅ Hoàn tất check views');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
