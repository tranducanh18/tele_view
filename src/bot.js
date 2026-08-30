const TelegramBot = require('node-telegram-bot-api');
const { loadUser, saveUser } = require('./firestore');
const { checkAllPagesForUser } = require('./scheduler');

function formatStatus(data) {
  return (
    `📊 Cấu hình của bạn:\n` +
    `• Số page: ${data.pages.length}\n` +
    `• Tần suất check: ${data.settings.intervalMinutes} phút\n` +
    `• Số video/page: ${data.settings.maxVideos}\n` +
    `• Ngưỡng báo: ${data.settings.viewThreshold.toLocaleString('vi-VN')} view`
  );
}

function createBot(token) {
  // Webhook mode (không dùng polling)
  const bot = new TelegramBot(token, { webHook: false, polling: false });

  bot.setMyCommands([
    { command: 'start', description: '🚀 Khởi động bot' },
    { command: 'addpage', description: '➕ Thêm 1 page' },
    { command: 'addpages', description: '📚 Thêm nhiều page' },
    { command: 'listpages', description: '📋 Danh sách Page' },
    { command: 'checknow', description: '🔍 Check ngay' },
    { command: 'status', description: '📊 Xem cấu hình' },
    { command: 'setinterval', description: '⏰ Đổi tần suất (phút)' },
    { command: 'setthreshold', description: '⚡ Đổi ngưỡng view' },
    { command: 'setlimit', description: '📹 Số video mỗi page' },
    { command: 'removepage', description: '🗑️ Xóa 1 page' },
    { command: 'clearpages', description: '🗑️🗑️ Xóa TẤT CẢ page' },
    { command: 'resetnotified', description: '🔄 Reset thông báo' },
  ]).catch((err) => console.error('Lỗi set menu:', err.message));

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadUser(chatId);
    bot.sendMessage(
      chatId,
      '✅ Bot theo dõi view video Facebook đã sẵn sàng!\n\n' +
        'Mỗi người dùng có cấu hình riêng biệt.\n\n' +
        formatStatus(data)
    );
  });

  bot.onText(/\/addpage (.+)/, async (msg, match) => {
    const url = match[1].trim();
    const chatId = msg.chat.id;
    const data = await loadUser(chatId);

    if (!/^https?:\/\/(www\.)?facebook\.com\//i.test(url)) {
      return bot.sendMessage(chatId, '❌ Link không hợp lệ');
    }
    if (data.pages.some((p) => p.url === url)) {
      return bot.sendMessage(chatId, '⏭️ Page này đã tồn tại');
    }
    data.pages.push({ id: Date.now().toString(), url, name: null });
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `✅ Đã thêm: ${url}`);
  });

  bot.onText(/\/addpages/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      '📚 Gửi danh sách link page, mỗi link một dòng.\nSau khi gửi xong, bot sẽ tự thêm.'
    );
    bot.once('message', async (m) => {
      if (m.chat.id !== chatId) return;
      const lines = (m.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const data = await loadUser(chatId);
      let added = 0;
      for (const url of lines) {
        if (!/^https?:\/\/(www\.)?facebook\.com\//i.test(url)) continue;
        if (data.pages.some((p) => p.url === url)) continue;
        data.pages.push({ id: Date.now().toString() + added, url, name: null });
        added++;
      }
      await saveUser(chatId, data);
      bot.sendMessage(chatId, `✅ Đã thêm ${added} page mới.`);
    });
  });

  bot.onText(/\/listpages/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadUser(chatId);
    if (data.pages.length === 0) {
      return bot.sendMessage(chatId, '📭 Chưa có page nào.');
    }
    const list = data.pages
      .map((p, i) => `${i + 1}. ${p.url}`)
      .join('\n');
    bot.sendMessage(chatId, `📋 Danh sách page:\n\n${list}`);
  });

  bot.onText(/\/removepage (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = match[1].trim();
    const data = await loadUser(chatId);

    let index = -1;
    if (/^\d+$/.test(arg)) {
      index = parseInt(arg, 10) - 1;
    } else {
      index = data.pages.findIndex((p) => p.url === arg);
    }

    if (index < 0 || index >= data.pages.length) {
      return bot.sendMessage(chatId, '❌ Không tìm thấy page.');
    }
    const removed = data.pages.splice(index, 1)[0];
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `🗑️ Đã xóa: ${removed.url}`);
  });

  bot.onText(/\/setinterval (\d+(\.\d+)?)/, async (msg, match) => {
    const minutes = parseFloat(match[1]);
    const chatId = msg.chat.id;
    if (minutes < 5) {
      return bot.sendMessage(chatId, '❌ Tối thiểu 5 phút.');
    }
    const data = await loadUser(chatId);
    data.settings.intervalMinutes = minutes;
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `⏰ Tần suất check: ${minutes} phút`);
  });

  bot.onText(/\/setlimit (\d+)/, async (msg, match) => {
    const limit = parseInt(match[1], 10);
    const chatId = msg.chat.id;
    const data = await loadUser(chatId);
    data.settings.maxVideos = limit;
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `📹 Số video mỗi page: ${limit}`);
  });

  bot.onText(/\/setthreshold (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    let threshold;
    const kMatch = raw.match(/^([\d.,]+)\s*k$/i);
    if (kMatch) {
      threshold = Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
    } else {
      threshold = parseInt(raw.replace(/[.,]/g, ''), 10);
    }
    const chatId = msg.chat.id;
    if (!threshold || isNaN(threshold)) {
      return bot.sendMessage(chatId, 'Số không hợp lệ. Ví dụ: 10000 hoặc 10k');
    }
    const data = await loadUser(chatId);
    data.settings.viewThreshold = threshold;
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `⚡ Ngưỡng báo: ${threshold.toLocaleString('vi-VN')} view`);
  });

  bot.onText(/\/status/, async (msg) => {
    const data = await loadUser(msg.chat.id);
    bot.sendMessage(msg.chat.id, formatStatus(data));
  });

  bot.onText(/\/checknow/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 Đang check ngay... (có thể mất 30-90 giây nếu server vừa ngủ)');
    try {
      await checkAllPagesForUser(bot, chatId);
      bot.sendMessage(chatId, '✅ Check xong.');
    } catch (err) {
      console.error('Lỗi /checknow:', err.message);
      bot.sendMessage(chatId, `❌ Lỗi khi check: ${err.message}`);
    }
  });

  bot.onText(/\/clearpages/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadUser(chatId);
    const count = data.pages.length;
    data.pages = [];
    data.seenVideos = {};
    await saveUser(chatId, data);
    bot.sendMessage(
      chatId,
      `🗑️ **Đã xóa tất cả page**\n\nĐã xóa ${count} page và reset lịch sử thông báo.`
    );
  });

  bot.onText(/\/resetnotified/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadUser(chatId);
    const count = Object.keys(data.seenVideos || {}).length;
    data.seenVideos = {};
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `🔄 Đã reset ${count} video.`);
  });

  return bot;
}

module.exports = { createBot };
