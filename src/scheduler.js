
const { loadUser, saveUser } = require('./firestore');
const { scrapePageVideos, buildVideosUrl } = require('./scraper');
const { parseViewCount } = require('./viewParser');

async function checkOnePage(bot, chatId, pageIndex) {
  const data = await loadUser(chatId);
  if (pageIndex >= data.pages.length) return false;

  const p = data.pages[pageIndex];
  console.log(
    `🤖 [${new Date().toLocaleTimeString()}] Check page ${pageIndex + 1}/${data.pages.length}: ${p.url}`
  );

  try {
    const videosUrl = buildVideosUrl(p.url);
    const videos = await scrapePageVideos(videosUrl, data.settings.maxVideos);

    let notifiedCount = 0;

    for (const v of videos) {
      if (!v.link) continue;

      const views = parseViewCount(v.view);
      if (views === null) {
        console.log(`⚠️ Không parse được view: "${v.view}" | ${v.link}`);
        continue;
      }

      const key = v.id || v.link;
      const seen = data.seenVideos[key] || { lastViews: 0, notified: false };
      const shouldNotify = views >= data.settings.viewThreshold && !seen.notified;

      if (shouldNotify) {
        const viewDisplay = v.view || views.toLocaleString('vi-VN');
        const dateDisplay = v.date || 'không rõ';

        await bot.sendMessage(
          chatId,
          `🔥 VIDEO VƯỢT NGƯỠNG 🔥\n\n` +
            `👁 View: ${viewDisplay} (${views.toLocaleString('vi-VN')})\n` +
            `🕒 ${dateDisplay}\n` +
            `🆔 ${v.id || '—'}\n` +
            `🔗 ${v.link}`
        );
        seen.notified = true;
        notifiedCount++;
      }

      seen.lastViews = views;
      seen.lastChecked = new Date().toISOString();
      seen.link = v.link;
      data.seenVideos[key] = seen;
    }

    await saveUser(chatId, data);
    console.log(`✅ Page ${pageIndex + 1} xong - Thông báo mới: ${notifiedCount}`);
    return true;
  } catch (err) {
    console.error(`❌ Lỗi check page ${p.url}:`, err.message);
    return false;
  }
}

async function checkAllPagesForUser(bot, chatId) {
  const data = await loadUser(chatId);
  for (let i = 0; i < data.pages.length; i++) {
    await checkOnePage(bot, chatId, i);
    if (i < data.pages.length - 1) {
      await new Promise((r) => setTimeout(r, 10 * 1000));
    }
  }
}

module.exports = { checkOnePage, checkAllPagesForUser };