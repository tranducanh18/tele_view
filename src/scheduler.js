const { loadUser, saveUser } = require('./firestore');
const { scrapePageVideos, buildVideosUrl } = require('./scraper');
const { parseViewCount } = require('./viewParser');

function countUnseen(data) {
  return Object.values(data.seenVideos || {}).filter((v) => v.notified && !v.userSeen).length;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseThresholdInput(text) {
  const raw = String(text || '').trim();
  const kMatch = raw.match(/^([\d.,]+)\s*k$/i);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
  }
  const n = parseInt(raw.replace(/[.,]/g, ''), 10);
  return isNaN(n) ? null : n;
}

async function sendVideoNotify(bot, chatId, v, views, key, tier) {
  const viewDisplay = v.view || views.toLocaleString('vi-VN');
  const dateDisplay = v.date || 'không rõ';
  const title =
    tier === 2
      ? `🚀 VIDEO VƯỢT MỐC 2 🚀`
      : `🔥 VIDEO VƯỢT NGƯỠNG 🔥`;
  const tierLabel = tier === 2 ? 'Mốc 2' : 'Mốc 1';

  await bot.sendMessage(
    chatId,
    `${title}\n\n` +
      `📌 ${tierLabel}\n` +
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
    const th1 = Number(fresh.settings.viewThreshold) || 0;
    const th2 = Number(fresh.settings.viewThreshold2) || 0;
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
        notified2: false,
        userSeen: false,
      };

      // Mốc 1
      if (th1 > 0 && views >= th1 && !seen.notified) {
        await sendVideoNotify(bot, chatId, v, views, key, 1);
        seen.notified = true;
        seen.userSeen = false;
        notifiedCount++;
      }

      // Mốc 2 (chỉ khi bật và cao hơn mốc 1)
      if (th2 > 0 && views >= th2 && !seen.notified2) {
        await sendVideoNotify(bot, chatId, v, views, key, 2);
        seen.notified2 = true;
        // Báo lại lần 2 → coi như chưa xem lại (để /unseen hiện)
        seen.userSeen = false;
        if (!seen.notified) seen.notified = true;
        notifiedCount++;
      }

      seen.lastViews = views;
      seen.lastChecked = new Date().toISOString();
      seen.link = v.link;
      if (seen.userSeen === undefined) seen.userSeen = false;
      if (seen.notified2 === undefined) seen.notified2 = false;
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
 * Check tuần tự: 1 page xong → nghỉ 1s → page tiếp
 */
async function checkAllPagesForUser(bot, chatId, options = {}) {
  const { sendSummary = true } = options;
  const data = await loadUser(chatId);
  if (!data.pages || data.pages.length === 0) {
    console.log('Không có page nào để check');
    return { newNotified: 0, unseen: 0 };
  }

  let newNotified = 0;
  for (let i = 0; i < data.pages.length; i++) {
    newNotified += await checkOnePage(bot, chatId, i);
    if (i < data.pages.length - 1) {
      await sleep(1000);
    }
  }

  const after = await loadUser(chatId);
  const unseen = countUnseen(after);

  if (sendSummary) {
    let text = `📬 Check xong\n• Video mới vượt ngưỡng: ${newNotified}\n• Tổng chưa xem: ${unseen}`;
    if (unseen > 0) text += `\n→ /unseen để xem danh sách`;
    await bot.sendMessage(chatId, text).catch(() => {});
  }

  await maybeSendRemind(bot, chatId);

  return { newNotified, unseen };
}

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

module.exports = {
  checkOnePage,
  checkAllPagesForUser,
  maybeSendRemind,
  countUnseen,
  parseThresholdInput,
};
