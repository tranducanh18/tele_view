const { loadUser, saveUser } = require('./firestore');
const { scrapePageVideos, buildVideosUrl } = require('./scraper');
const { parseViewCount } = require('./viewParser');

function countUnseen(data) {
  return Object.values(data.seenVideos || {}).filter((v) => v.notified && !v.userSeen).length;
}

async function checkOnePage(bot, chatId, pageIndex) {
  const data = await loadUser(chatId);
  if (pageIndex >= data.pages.length) return 0;

  const p = data.pages[pageIndex];
  console.log(
    `🤖 [${new Date().toLocaleTimeString()}] Check page ${pageIndex + 1}/${data.pages.length}: ${p.url}`
  );

  try {
    const videosUrl = buildVideosUrl(p.url);
    const videos = await scrapePageVideos(videosUrl, data.settings.maxVideos);

    const fresh = await loadUser(chatId);
    let notifiedCount = 0;

    for (const v of videos) {
      if (!v.link) continue;

      const views = parseViewCount(v.view);
      if (views === null) {
        console.log(`⚠️ Không parse được view: "${v.view}" | ${v.link}`);
        continue;
      }

      const key = v.id || v.link;
      const seen = fresh.seenVideos[key] || {
        lastViews: 0,
        notified: false,
        userSeen: false,
      };
      const shouldNotify = views >= fresh.settings.viewThreshold && !seen.notified;

      if (shouldNotify) {
        const viewDisplay = v.view || views.toLocaleString('vi-VN');
        const dateDisplay = v.date || 'không rõ';

        await bot.sendMessage(
          chatId,
          `🔥 VIDEO VƯỢT NGƯỠNG 🔥\n\n` +
            `👁 View: ${viewDisplay} (${views.toLocaleString('vi-VN')})\n` +
            `🕒 ${dateDisplay}\n` +
            `🆔 ${v.id || '—'}\n` +
            `🔗 ${v.link}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Đã xem', callback_data: `seen:${key}` },
                  { text: '▶️ Mở video', url: v.link },
                ],
              ],
            },
          }
        );
        seen.notified = true;
        seen.userSeen = false;
        notifiedCount++;
      }

      seen.lastViews = views;
      seen.lastChecked = new Date().toISOString();
      seen.link = v.link;
      if (seen.userSeen === undefined) seen.userSeen = false;
      fresh.seenVideos[key] = seen;
    }

    await saveUser(chatId, fresh);
    console.log(`✅ Page ${pageIndex + 1} xong - Thông báo mới: ${notifiedCount}`);
    return notifiedCount;
  } catch (err) {
    console.error(`❌ Lỗi check page ${p.url}:`, err.message);
    return 0;
  }
}

/**
 * Check tất cả page song song + gửi tin tóm tắt + nhắc unseen nếu đến giờ
 */
async function checkAllPagesForUser(bot, chatId, options = {}) {
  const { sendSummary = true } = options;
  const data = await loadUser(chatId);
  if (!data.pages || data.pages.length === 0) {
    console.log('Không có page nào để check');
    return { newNotified: 0, unseen: 0 };
  }

  const counts = await Promise.all(
    data.pages.map((_, i) => checkOnePage(bot, chatId, i))
  );
  const newNotified = counts.reduce((a, b) => a + b, 0);

  const after = await loadUser(chatId);
  const unseen = countUnseen(after);

  if (sendSummary) {
    let text = `📬 Check xong\n• Video mới vượt ngưỡng: ${newNotified}\n• Tổng chưa xem: ${unseen}`;
    if (unseen > 0) text += `\n→ /unseen để xem danh sách`;
    await bot.sendMessage(chatId, text).catch(() => {});
  }

  // Nhắc lại video chưa xem theo mốc remindMinutes
  await maybeSendRemind(bot, chatId);

  return { newNotified, unseen };
}

/**
 * Nếu user bật remind (remindMinutes > 0) và còn video chưa xem
 * và đã đủ thời gian từ lần nhắc trước → gửi danh sách unseen
 */
async function maybeSendRemind(bot, chatId) {
  const data = await loadUser(chatId);
  const minutes = Number(data.settings.remindMinutes) || 0;
  if (minutes <= 0) return;

  const unseenEntries = Object.entries(data.seenVideos || {}).filter(
    ([, v]) => v.notified && !v.userSeen
  );
  if (unseenEntries.length === 0) return;

  const last = data.settings.lastRemindAt ? new Date(data.settings.lastRemindAt).getTime() : 0;
  const now = Date.now();
  if (now - last < minutes * 60 * 1000) return;

  // Gửi nhắc
  const sorted = unseenEntries.sort((a, b) => (b[1].lastViews || 0) - (a[1].lastViews || 0));
  let chunk = `⏰ Nhắc: còn ${sorted.length} video chưa xem\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    const [key, v] = sorted[i];
    const views = (v.lastViews || 0).toLocaleString('vi-VN');
    const link = v.link || `https://www.facebook.com/reel/${key}`;
    const line = `${i + 1}. 👁 ${views}\n${link}\n\n`;
    if ((chunk + line).length > 3800) {
      await bot.sendMessage(chatId, chunk.trim()).catch(() => {});
      chunk = '';
    }
    chunk += line;
  }
  if (chunk.trim()) await bot.sendMessage(chatId, chunk.trim()).catch(() => {});

  data.settings.lastRemindAt = new Date().toISOString();
  await saveUser(chatId, data);
  console.log(`⏰ Đã nhắc user ${chatId}: ${sorted.length} unseen`);
}

module.exports = { checkOnePage, checkAllPagesForUser, maybeSendRemind, countUnseen };
