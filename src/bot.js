const TelegramBot = require('node-telegram-bot-api');
const { loadUser, saveUser } = require('./firestore');
const { checkAllPagesForUser } = require('./scheduler');

// Lưu trạng thái chờ nhập (chatId → { type, ... })
const pendingInput = new Map();

function formatStatus(data) {
  const seenVideos = data.seenVideos || {};
  const notified = Object.values(seenVideos).filter((v) => v.notified).length;
  const unseen = Object.values(seenVideos).filter((v) => v.notified && !v.userSeen).length;
  const remind = data.settings.remindMinutes || 0;

  return (
    `📊 Cấu hình của bạn:\n` +
    `• Số page: ${data.pages.length}\n` +
    `• Tần suất check: ${data.settings.intervalMinutes} phút\n` +
    `• Số video/page: ${data.settings.maxVideos}\n` +
    `• Ngưỡng báo: ${data.settings.viewThreshold.toLocaleString('vi-VN')} view\n` +
    `• Nhắc chưa xem: ${remind > 0 ? `mỗi ${remind} phút` : 'tắt'}\n` +
    `• Đã báo / Chưa xem: ${notified} / ${unseen}`
  );
}

function createBot(token) {
  const bot = new TelegramBot(token, { webHook: false, polling: false });

  bot.setMyCommands([
    { command: 'start', description: '🚀 Khởi động bot' },
    { command: 'addpage', description: '➕ Thêm 1 page (bot sẽ hỏi link)' },
    { command: 'addpages', description: '📚 Thêm nhiều page' },
    { command: 'listpages', description: '📋 Danh sách Page' },
    { command: 'checknow', description: '🔍 Check ngay' },
    { command: 'unseen', description: '👀 Video chưa xem' },
    { command: 'remind', description: '⏰ Nhắc chưa xem (vd: 30 phút)' },
    { command: 'markallseen', description: '✅ Đánh dấu tất cả đã xem' },
    { command: 'status', description: '📊 Xem cấu hình' },
    { command: 'setinterval', description: '⏰ Đổi tần suất check' },
    { command: 'setthreshold', description: '⚡ Đổi ngưỡng view' },
    { command: 'setlimit', description: '📹 Số video mỗi page' },
    { command: 'removepage', description: '🗑️ Xóa 1 page' },
    { command: 'clearpages', description: '🗑️🗑️ Xóa TẤT CẢ page' },
    { command: 'resetnotified', description: '🔄 Reset thông báo' },
  ]).catch((err) => console.error('Lỗi set menu:', err.message));

  // ===== Callback: nút "Đã xem" =====
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat?.id;
    const data = query.data || '';
    if (!chatId || !data.startsWith('seen:')) {
      return bot.answerCallbackQuery(query.id).catch(() => {});
    }

    const key = data.slice(5);
    try {
      const user = await loadUser(chatId);
      if (!user.seenVideos) user.seenVideos = {};
      if (!user.seenVideos[key]) {
        user.seenVideos[key] = { notified: true, userSeen: true, lastViews: 0 };
      } else {
        user.seenVideos[key].userSeen = true;
      }
      await saveUser(chatId, user);

      const oldText = query.message.text || '';
      const newText = oldText.includes('✅ ĐÃ XEM') ? oldText : oldText + '\n\n✅ ĐÃ XEM';

      await bot
        .editMessageText(newText, {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '▶️ Mở video',
                  url: user.seenVideos[key].link || `https://www.facebook.com/reel/${key}`,
                },
              ],
            ],
          },
        })
        .catch(() => {});

      await bot.answerCallbackQuery(query.id, { text: 'Đã đánh dấu đã xem ✓' });
    } catch (err) {
      console.error('callback seen error:', err.message);
      await bot.answerCallbackQuery(query.id, { text: 'Lỗi, thử lại' }).catch(() => {});
    }
  });

  // ===== Xử lý tin nhắn thường (nhập số sau khi bot hỏi) =====
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // lệnh xử lý ở onText

    const pending = pendingInput.get(chatId);
    if (!pending) return;

    pendingInput.delete(chatId);

    try {
      if (pending.type === 'threshold') {
        let threshold;
        const kMatch = text.match(/^([\d.,]+)\s*k$/i);
        if (kMatch) {
          threshold = Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
        } else {
          threshold = parseInt(text.replace(/[.,]/g, ''), 10);
        }
        if (!threshold || isNaN(threshold)) {
          return bot.sendMessage(chatId, '❌ Số không hợp lệ. Ví dụ: 10000 hoặc 10k\nGõ /setthreshold để thử lại.');
        }
        const data = await loadUser(chatId);
        data.settings.viewThreshold = threshold;
        await saveUser(chatId, data);
        return bot.sendMessage(chatId, `⚡ Ngưỡng báo: ${threshold.toLocaleString('vi-VN')} view`);
      }

      if (pending.type === 'interval') {
        const minutes = parseFloat(text);
        if (isNaN(minutes) || minutes < 5) {
          return bot.sendMessage(chatId, '❌ Tối thiểu 5 phút. Gõ /setinterval để thử lại.');
        }
        const data = await loadUser(chatId);
        data.settings.intervalMinutes = minutes;
        await saveUser(chatId, data);
        return bot.sendMessage(chatId, `⏰ Tần suất check: ${minutes} phút`);
      }

      if (pending.type === 'limit') {
        const limit = parseInt(text, 10);
        if (isNaN(limit) || limit < 1) {
          return bot.sendMessage(chatId, '❌ Số không hợp lệ. Gõ /setlimit để thử lại.');
        }
        const data = await loadUser(chatId);
        data.settings.maxVideos = limit;
        await saveUser(chatId, data);
        return bot.sendMessage(chatId, `📹 Số video mỗi page: ${limit}`);
      }

      if (pending.type === 'remind') {
        const minutes = parseInt(text, 10);
        if (isNaN(minutes) || minutes < 0) {
          return bot.sendMessage(chatId, '❌ Nhập số phút (0 = tắt). Gõ /remind để thử lại.');
        }
        const data = await loadUser(chatId);
        data.settings.remindMinutes = minutes;
        data.settings.lastRemindAt = null;
        await saveUser(chatId, data);
        if (minutes === 0) {
          return bot.sendMessage(chatId, '🔕 Đã tắt nhắc video chưa xem.');
        }
        return bot.sendMessage(
          chatId,
          `⏰ Sẽ nhắc video chưa xem mỗi ${minutes} phút (khi có video chưa xem).\n` +
            `Nhắc chạy cùng lịch check (GitHub Actions).`
        );
      }

      if (pending.type === 'addpage') {
        const url = text;
        if (!/^https?:\/\/(www\.)?facebook\.com\//i.test(url)) {
          return bot.sendMessage(chatId, '❌ Link không hợp lệ. Gõ /addpage để thử lại.');
        }
        const data = await loadUser(chatId);
        if (data.pages.some((p) => p.url === url)) {
          return bot.sendMessage(chatId, '⏭️ Page này đã tồn tại');
        }
        data.pages.push({ id: Date.now().toString(), url, name: null });
        await saveUser(chatId, data);
        return bot.sendMessage(chatId, `✅ Đã thêm: ${url}`);
      }

      if (pending.type === 'removepage') {
        const data = await loadUser(chatId);
        let index = -1;
        if (/^\d+$/.test(text)) {
          index = parseInt(text, 10) - 1;
        } else {
          index = data.pages.findIndex((p) => p.url === text);
        }
        if (index < 0 || index >= data.pages.length) {
          return bot.sendMessage(chatId, '❌ Không tìm thấy page. Gõ /removepage để thử lại.');
        }
        const removed = data.pages.splice(index, 1)[0];
        await saveUser(chatId, data);
        return bot.sendMessage(chatId, `🗑️ Đã xóa: ${removed.url}`);
      }
    } catch (err) {
      console.error('pending input error:', err.message);
      bot.sendMessage(chatId, '❌ Lỗi xử lý. Thử lại lệnh.');
    }
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    const data = await loadUser(chatId);
    bot.sendMessage(
      chatId,
      '✅ Bot theo dõi view video Facebook đã sẵn sàng!\n\n' +
        formatStatus(data) +
        '\n\n💡 Bấm ✅ Đã xem trên từng tin để đánh dấu.\n' +
        '• /unseen — video chưa xem\n' +
        '• /remind — hẹn nhắc (vd nhập 30 = mỗi 30 phút)'
    );
  });

  // /addpage  hoặc  /addpage <url>
  bot.onText(/\/addpage(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = (match[1] || '').trim();
    if (url) {
      if (!/^https?:\/\/(www\.)?facebook\.com\//i.test(url)) {
        return bot.sendMessage(chatId, '❌ Link không hợp lệ');
      }
      const data = await loadUser(chatId);
      if (data.pages.some((p) => p.url === url)) {
        return bot.sendMessage(chatId, '⏭️ Page này đã tồn tại');
      }
      data.pages.push({ id: Date.now().toString(), url, name: null });
      await saveUser(chatId, data);
      return bot.sendMessage(chatId, `✅ Đã thêm: ${url}`);
    }
    pendingInput.set(chatId, { type: 'addpage' });
    bot.sendMessage(chatId, '➕ Gửi link page Facebook cần theo dõi:');
  });

  bot.onText(/\/addpages/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    bot.sendMessage(
      chatId,
      '📚 Gửi danh sách link page, mỗi link một dòng.\nSau khi gửi xong, bot sẽ tự thêm.'
    );
    bot.once('message', async (m) => {
      if (m.chat.id !== chatId) return;
      if ((m.text || '').startsWith('/')) return;
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
    const list = data.pages.map((p, i) => `${i + 1}. ${p.url}`).join('\n');
    bot.sendMessage(chatId, `📋 Danh sách page:\n\n${list}`);
  });

  bot.onText(/\/removepage(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = (match[1] || '').trim();
    if (arg) {
      const data = await loadUser(chatId);
      let index = -1;
      if (/^\d+$/.test(arg)) index = parseInt(arg, 10) - 1;
      else index = data.pages.findIndex((p) => p.url === arg);
      if (index < 0 || index >= data.pages.length) {
        return bot.sendMessage(chatId, '❌ Không tìm thấy page.');
      }
      const removed = data.pages.splice(index, 1)[0];
      await saveUser(chatId, data);
      return bot.sendMessage(chatId, `🗑️ Đã xóa: ${removed.url}`);
    }
    const data = await loadUser(chatId);
    if (data.pages.length === 0) {
      return bot.sendMessage(chatId, '📭 Chưa có page nào.');
    }
    const list = data.pages.map((p, i) => `${i + 1}. ${p.url}`).join('\n');
    pendingInput.set(chatId, { type: 'removepage' });
    bot.sendMessage(chatId, `🗑️ Gửi số thứ tự hoặc link page cần xóa:\n\n${list}`);
  });

  // /setinterval  hoặc hỏi nhập
  bot.onText(/\/setinterval(?:\s+([\d.]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match[1];
    if (raw) {
      const minutes = parseFloat(raw);
      if (isNaN(minutes) || minutes < 5) {
        return bot.sendMessage(chatId, '❌ Tối thiểu 5 phút.');
      }
      const data = await loadUser(chatId);
      data.settings.intervalMinutes = minutes;
      await saveUser(chatId, data);
      return bot.sendMessage(chatId, `⏰ Tần suất check: ${minutes} phút`);
    }
    pendingInput.set(chatId, { type: 'interval' });
    bot.sendMessage(chatId, '⏰ Nhập số phút giữa mỗi lần check (tối thiểu 5):\nVí dụ: 15');
  });

  bot.onText(/\/setlimit(?:\s+(\d+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match[1];
    if (raw) {
      const limit = parseInt(raw, 10);
      const data = await loadUser(chatId);
      data.settings.maxVideos = limit;
      await saveUser(chatId, data);
      return bot.sendMessage(chatId, `📹 Số video mỗi page: ${limit}`);
    }
    pendingInput.set(chatId, { type: 'limit' });
    bot.sendMessage(chatId, '📹 Nhập số video tối đa mỗi page:\nVí dụ: 30');
  });

  bot.onText(/\/setthreshold(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = (match[1] || '').trim();
    if (raw) {
      let threshold;
      const kMatch = raw.match(/^([\d.,]+)\s*k$/i);
      if (kMatch) {
        threshold = Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
      } else {
        threshold = parseInt(raw.replace(/[.,]/g, ''), 10);
      }
      if (!threshold || isNaN(threshold)) {
        return bot.sendMessage(chatId, 'Số không hợp lệ. Ví dụ: 10000 hoặc 10k');
      }
      const data = await loadUser(chatId);
      data.settings.viewThreshold = threshold;
      await saveUser(chatId, data);
      return bot.sendMessage(chatId, `⚡ Ngưỡng báo: ${threshold.toLocaleString('vi-VN')} view`);
    }
    pendingInput.set(chatId, { type: 'threshold' });
    bot.sendMessage(chatId, '⚡ Nhập ngưỡng view:\nVí dụ: 5000 hoặc 10k');
  });

  // /remind  hoặc  /remind 30
  bot.onText(/\/remind(?:\s+(\d+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match[1];
    if (raw !== undefined) {
      const minutes = parseInt(raw, 10);
      const data = await loadUser(chatId);
      data.settings.remindMinutes = minutes;
      data.settings.lastRemindAt = null;
      await saveUser(chatId, data);
      if (minutes === 0) {
        return bot.sendMessage(chatId, '🔕 Đã tắt nhắc video chưa xem.');
      }
      return bot.sendMessage(
        chatId,
        `⏰ Sẽ nhắc video chưa xem mỗi ${minutes} phút.\n` +
          `(Chạy cùng lịch check trên GitHub Actions)`
      );
    }
    const data = await loadUser(chatId);
    const current = data.settings.remindMinutes || 0;
    pendingInput.set(chatId, { type: 'remind' });
    bot.sendMessage(
      chatId,
      `⏰ Nhắc video chưa xem\n` +
        `Hiện tại: ${current > 0 ? `mỗi ${current} phút` : 'tắt'}\n\n` +
        `Nhập số phút (0 = tắt):\nVí dụ: 30`
    );
  });

  bot.onText(/\/status/, async (msg) => {
    pendingInput.delete(msg.chat.id);
    const data = await loadUser(msg.chat.id);
    bot.sendMessage(msg.chat.id, formatStatus(data));
  });

  bot.onText(/\/checknow/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    bot.sendMessage(chatId, '🔄 Đang check ngay...');
    try {
      await checkAllPagesForUser(bot, chatId, { sendSummary: true });
    } catch (err) {
      console.error('Lỗi /checknow:', err.message);
      bot.sendMessage(chatId, `❌ Lỗi khi check: ${err.message}`);
    }
  });

  bot.onText(/\/unseen/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    const data = await loadUser(chatId);
    const unseen = Object.entries(data.seenVideos || {})
      .filter(([, v]) => v.notified && !v.userSeen)
      .sort((a, b) => (b[1].lastViews || 0) - (a[1].lastViews || 0));

    if (unseen.length === 0) {
      return bot.sendMessage(chatId, '✨ Không còn video chưa xem.');
    }

    const lines = unseen.map(([key, v], i) => {
      const views = (v.lastViews || 0).toLocaleString('vi-VN');
      const link = v.link || `https://www.facebook.com/reel/${key}`;
      return `${i + 1}. 👁 ${views}\n${link}`;
    });

    let chunk = `👀 Có ${unseen.length} video chưa xem:\n\n`;
    for (const line of lines) {
      if ((chunk + line + '\n\n').length > 3800) {
        await bot.sendMessage(chatId, chunk.trim());
        chunk = '';
      }
      chunk += line + '\n\n';
    }
    if (chunk.trim()) await bot.sendMessage(chatId, chunk.trim());
  });

  bot.onText(/\/markallseen/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    const data = await loadUser(chatId);
    let count = 0;
    for (const key of Object.keys(data.seenVideos || {})) {
      if (data.seenVideos[key].notified && !data.seenVideos[key].userSeen) {
        data.seenVideos[key].userSeen = true;
        count++;
      }
    }
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `✅ Đã đánh dấu ${count} video là đã xem.`);
  });

  bot.onText(/\/clearpages/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    const data = await loadUser(chatId);
    const count = data.pages.length;
    data.pages = [];
    data.seenVideos = {};
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `🗑️ Đã xóa ${count} page và reset lịch sử thông báo.`);
  });

  bot.onText(/\/resetnotified/, async (msg) => {
    const chatId = msg.chat.id;
    pendingInput.delete(chatId);
    const data = await loadUser(chatId);
    const count = Object.keys(data.seenVideos || {}).length;
    data.seenVideos = {};
    await saveUser(chatId, data);
    bot.sendMessage(chatId, `🔄 Đã reset ${count} video.`);
  });

  return bot;
}

module.exports = { createBot };
