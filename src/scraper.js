const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GUEST_VIDEO_LIMIT = 35;

function buildVideosUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    url.searchParams.delete('sk');

    if (url.pathname.includes('/videos') || url.pathname.includes('/reels')) {
      url.pathname = url.pathname.replace(/\/reels.*/, '/videos');
      return url.toString();
    }

    if (url.pathname.replace(/\/+$/, '').toLowerCase() === '/profile.php') {
      url.searchParams.set('sk', 'videos');
      return url.toString();
    }

    if (/^\/people\//i.test(url.pathname)) {
      url.searchParams.set('sk', 'videos');
      return url.toString();
    }

    let pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/videos')) {
      pathname = pathname + '/videos';
    }
    url.pathname = pathname;
    return url.toString();
  } catch (e) {
    console.error('Lỗi convert URL:', pageUrl);
    return pageUrl.replace(/&sk=reels_tab.*/, '/videos');
  }
}

async function dismissAccountSwitcherPopup(page) {
  try {
    const closeBtn = page.locator('[aria-label="Close"], [aria-label="Đóng"]').first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (e) {}
}

/**
 * Lấy storageState từ:
 * 1. Biến môi trường FB_STORAGE_STATE (GitHub Actions / Render)
 * 2. File fb-storage.json (local)
 */
function getStorageState() {
  if (process.env.FB_STORAGE_STATE) {
    try {
      return JSON.parse(process.env.FB_STORAGE_STATE);
    } catch (e) {
      console.error('Lỗi parse FB_STORAGE_STATE:', e.message);
    }
  }
  const localPath = path.join(__dirname, '..', 'fb-storage.json');
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
  }
  return null;
}

async function scrapePageVideos(pageUrl, maxVideos = 30, options = {}) {
  const { headless = true } = options;
  const storageState = getStorageState();
  const hasSession = !!storageState;

  console.log('Có session Facebook:', hasSession);

  if (!hasSession && maxVideos > GUEST_VIDEO_LIMIT) {
    throw new Error(
      `Chưa có session Facebook. Chạy "npm run login" để tạo fb-storage.json, ` +
        `hoặc giảm /setlimit xuống ≤ ${GUEST_VIDEO_LIMIT}.`
    );
  }

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    storageState: storageState || undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    const videosUrl = buildVideosUrl(pageUrl);
    console.log('Đang mở:', videosUrl);
    await page.goto(videosUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await dismissAccountSwitcherPopup(page);

    // Cuộn trang để load thêm video
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(1500);
    }

    // Lấy dữ liệu video (class có thể thay đổi theo thời gian)
    const videos = await page.evaluate((limit) => {
      const results = [];
      // Thử nhiều selector phổ biến của Facebook
      const items = document.querySelectorAll('a[href*="/videos/"], a[href*="/reel/"]');
      const seen = new Set();

      for (const a of items) {
        if (results.length >= limit) break;
        const href = a.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);

        // Tìm text view gần link
        let viewText = '';
        let dateText = '';
        let parent = a.closest('div');
        for (let i = 0; i < 6 && parent; i++) {
          const text = parent.innerText || '';
          const viewMatch = text.match(/([\d.,]+)\s*(N|K|Tr|M|lượt xem|views?)/i);
          if (viewMatch && !viewText) viewText = viewMatch[0];
          const dateMatch = text.match(/(\d+\s*(giờ|phút|ngày|tuần|tháng|năm)|hôm qua|yesterday)/i);
          if (dateMatch && !dateText) dateText = dateMatch[0];
          parent = parent.parentElement;
        }

        results.push({
          link: href.split('?')[0],
          view: viewText || '0',
          date: dateText || '',
        });
      }
      return results;
    }, maxVideos);

    console.log(`Tìm thấy ${videos.length} video`);
    return videos;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapePageVideos, buildVideosUrl };
