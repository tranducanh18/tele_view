const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GUEST_VIDEO_LIMIT = 35;

/**
 * Chuyển URL page → trang /videos của page đó
 */
function buildVideosUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    url.searchParams.delete('sk');
    url.hash = '';

    if (url.pathname.includes('/videos') || url.pathname.includes('/reels')) {
      url.pathname = url.pathname
        .replace(/\/reels.*/, '/videos')
        .replace(/\/videos.*/, '/videos');
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

/**
 * Mọi dạng href Facebook → https://www.facebook.com/reel/{id}
 */
function normalizeVideoLink(href) {
  if (!href) return null;
  try {
    let m = href.match(/[?&]v=(\d{8,})/i);
    if (m) return `https://www.facebook.com/reel/${m[1]}`;

    const clean = href.split('?')[0].split('#')[0];

    m = clean.match(/\/reels?\/(\d{8,})/i);
    if (m) return `https://www.facebook.com/reel/${m[1]}`;

    m = clean.match(/\/videos\/(?:[^/]+\/)?(\d{8,})/i);
    if (m) return `https://www.facebook.com/reel/${m[1]}`;

    m = clean.match(/(\d{10,})\/?$/);
    if (m) return `https://www.facebook.com/reel/${m[1]}`;

    return null;
  } catch {
    return null;
  }
}

async function dismissAccountSwitcherPopup(page) {
  try {
    const closeBtn = page.locator('[aria-label="Close"], [aria-label="Đóng"]').first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(800);
    }
  } catch (e) {}
}

/**
 * Lấy storageState:
 * 1. Env FB_STORAGE_STATE (Render / GitHub Actions)
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

/**
 * Scrape video từ trang /videos.
 * Local: hiện Chrome. Cloud: headless.
 */
async function scrapePageVideos(pageUrl, maxVideos = 30, options = {}) {
  // Mặc định ẩn Chrome. Muốn hiện: scrapePageVideos(url, limit, { headless: false })
  const { headless = true } = options;

  const storageState = getStorageState();
  const hasSession = !!storageState;

  console.log('Có session Facebook:', hasSession);
  console.log('Headless:', headless);

  if (!hasSession && maxVideos > GUEST_VIDEO_LIMIT) {
    throw new Error(
      `Chưa có session Facebook. Chạy "npm run login" để tạo fb-storage.json, ` +
        `hoặc giảm /setlimit xuống ≤ ${GUEST_VIDEO_LIMIT}.`
    );
  }

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 40,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    storageState: storageState || undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'vi-VN',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    const videosUrl = buildVideosUrl(pageUrl);
    console.log('Đang mở:', videosUrl);
    await page.goto(videosUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    await dismissAccountSwitcherPopup(page);

    // Zoom nhỏ + cuộn để load nhiều video hơn (trước khi hiện khung login)
    try {
      await page.evaluate(() => {
        document.body.style.zoom = '0.5';
      });
      await page.waitForTimeout(500);
    } catch (e) {}

    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.scrollBy(0, 1600));
      await page.waitForTimeout(1100);
    }

    // Logic extract đã test trên console thật
    const rawItems = await page.evaluate((limit) => {
      const results = [];
      const seen = new Set();

      const anchors = Array.from(
        document.querySelectorAll(
          'a[href*="/videos/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="watch"]'
        )
      );

      for (const a of anchors) {
        if (results.length >= limit * 3) break;

        let href = a.href || a.getAttribute('href') || '';
        if (!href || href.startsWith('javascript')) continue;
        if (href.startsWith('/')) href = location.origin + href;

        let id = null;
        const idMatch =
          href.match(/[?&]v=(\d{8,})/i) ||
          href.match(/\/reels?\/(\d{8,})/i) ||
          href.match(/\/videos\/(?:[^/]+\/)?(\d{8,})/i) ||
          href.match(/(\d{10,})/);
        if (idMatch) id = idMatch[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // Lấy block text quanh video
        let blockText = '';
        let el = a;
        for (let d = 0; d < 8 && el; d++) {
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.length > blockText.length && t.length < 800) blockText = t;
          el = el.parentElement;
        }

        // Bỏ follower / header page
        blockText = blockText
          .replace(/\d[\d.,]*\s*người theo dõi/gi, '')
          .replace(/\d[\d.,]*\s*đang theo dõi/gi, '');

        // ===== VIEW =====
        // Không bắt "n" trong "ngày"/"người"
        let viewText = '';
        let m = blockText.match(/([\d.,]+)\s*(K|N|Tr|M|B)?\s*(lượt xem|views?)/i);
        if (m) {
          viewText = (m[1] + (m[2] ? ' ' + m[2] : '')).trim();
        } else {
          m = blockText.match(/([\d.,]+)\s*(K|N|Tr|M|B)\b/i);
          if (m) {
            const pos = blockText.indexOf(m[0]);
            const after = blockText.slice(pos + m[0].length, pos + m[0].length + 15);
            // Không lấy nếu sau đó là đơn vị thời gian
            if (!/^\s*(giờ|ngày|phút|tuần|tháng|năm|trước)/i.test(after)) {
              viewText = (m[1] + ' ' + m[2]).trim();
            }
          }
        }

        // ===== DATE =====
        let dateText = '';
        const dm = blockText.match(
          /(\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)\s*(trước)?|hôm qua|vừa xong)/i
        );
        if (dm) dateText = dm[0].replace(/\s*trước\s*$/i, '').trim();

        // Bỏ video không có view (vd: "Phổ biến nhất")
        if (!viewText) continue;

        results.push({
          id,
          rawHref: href.split('?')[0],
          view: viewText,
          date: dateText || '',
        });
      }

      return results.slice(0, limit * 2);
    }, maxVideos);

    // Chuẩn hóa link → https://www.facebook.com/reel/{id}
    const videos = [];
    const seenIds = new Set();

    for (const item of rawItems) {
      const link =
        normalizeVideoLink(item.rawHref) ||
        (item.id ? `https://www.facebook.com/reel/${item.id}` : null);
      if (!link) continue;

      const id = item.id || link.match(/\/reel\/(\d+)/)?.[1];
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      videos.push({
        link,
        id,
        view: item.view || '0',
        date: item.date || '',
      });

      if (videos.length >= maxVideos) break;
    }

    console.log(`Tìm thấy ${videos.length} video (đã chuẩn hóa link reel)`);
    if (videos.length > 0) {
      console.table(
        videos.slice(0, 12).map((v) => ({
          id: v.id,
          view: v.view,
          date: v.date || '(không rõ)',
          link: v.link,
        }))
      );
    }

    return videos;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapePageVideos, buildVideosUrl, normalizeVideoLink };
