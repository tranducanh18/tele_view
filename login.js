/**
 * Chạy 1 lần trên máy local để lấy session Facebook.
 * Sau khi đăng nhập xong, file fb-storage.json sẽ được tạo.
 * File này dùng cho cả Render và GitHub Actions.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('🚀 Đang mở trình duyệt để đăng nhập Facebook...\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome', // dùng Chrome thật nếu có
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('https://www.facebook.com/login');

  console.log('>>> Đăng nhập Facebook trong cửa sổ vừa mở.');
  console.log('>>> Sau khi thấy trang chủ Facebook, quay lại đây và nhấn Enter...\n');

  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  const storage = await context.storageState();
  const outPath = path.join(__dirname, 'fb-storage.json');
  fs.writeFileSync(outPath, JSON.stringify(storage, null, 2));

  console.log('✅ Đã lưu session vào:', outPath);
  console.log('⚠️  Nhớ thêm fb-storage.json vào .gitignore (đã có sẵn).');
  console.log('⚠️  Khi deploy, copy nội dung file này vào GitHub Secret: FB_STORAGE_STATE');

  await browser.close();
  process.exit(0);
})();
