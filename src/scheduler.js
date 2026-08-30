const { loadUser, saveUser } = require('./firestore');
const { scrapePageVideos, buildVideosUrl } = require('./scraper');
const { parseViewCount } = require('./viewParser');

async function checkOnePage(bot, chatId, pageIndex) {
  const data = await loadUser(chatId);
  if (pageIndex >= data.pages.length) return false;

  const p = data.pages[pageIndex];
  console.log(`🤖 [${new Date().toLocaleTimeString()}] Check page ${pageIndex + 1}/${data.pages.length}: ${p.url}`);

  try {
    const videosUrl = buildVideosUrl(p.url);
    const videos = await scrapePageVideos(videosUrl, data.settings.maxVideos);

    let notifiedCount = 0;

    for (const v of videos) {
      if (!v.link) continue;
      const views = parseViewCount(v.view);
      if (views === null) continue;

      const seen = data.seenVideos[v.link] || { lastViews: 0, notified: false };
      const shouldNotify = views >= data.settings.viewThreshold && !seen.notified;

      if (shouldNotify) {
        await bot.sendMessage(
          chatId,
          `🔥 VIDEO VƯỢT NGƯỠNG 🔥\n\n` +
            `👁 View: ${v.view}\n` +
            `🕒 ${v.date || 'không rõ'}\n` +
            `🔗 ${v.link}`
        );
        seen.notified = true;
        notifiedCount++;
      }

      seen.lastViews = views;
      seen.lastChecked = new Date().toISOString();
      data.seenVideos[v.link] = seen;
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
    // Nghỉ 10 giây giữa các page để tránh bị Facebook flag
    if (i < data.pages.length - 1) {
      await new Promise((r) => setTimeout(r, 10 * 1000));
    }
  }
}

module.exports = { checkOnePage, checkAllPagesForUser };
