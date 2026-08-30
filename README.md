# FB View Bot - Cloud Version (Render + Firestore + GitHub Actions)

Bot Telegram theo dõi lượt xem video Facebook Page, báo khi vượt ngưỡng.

## Kiến trúc

- **Render Free**: Nhận lệnh Telegram qua Webhook (cho phép ngủ).
- **Firestore**: Lưu pages, settings, seenVideos.
- **GitHub Actions**: Mỗi 15 phút tự động check view và gửi thông báo.

## Cài đặt nhanh

### 1. Chuẩn bị local

```bash
npm install
npx playwright install chromium
```

### 2. Đăng nhập Facebook (chỉ 1 lần)

```bash
npm run login
```

Đăng nhập trong cửa sổ Chrome → nhấn Enter → file `fb-storage.json` được tạo.

### 3. Cấu hình Firebase

- Tạo Firestore (region **asia-southeast1** khuyến nghị).
- Tải Service Account key → đặt tên `serviceAccountKey.json` (để cùng thư mục gốc).

### 4. Biến môi trường local (file `.env`)

```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

### 5. Đẩy lên GitHub

Tạo repo mới, push code lên (nhớ **không** commit `serviceAccountKey.json` và `fb-storage.json`).

### 6. Thêm GitHub Secrets

Vào repo → Settings → Secrets and variables → Actions → New repository secret:

| Tên Secret                  | Giá trị |
|----------------------------|--------|
| `TELEGRAM_BOT_TOKEN`       | Token bot |
| `FIREBASE_SERVICE_ACCOUNT` | Toàn bộ nội dung file `serviceAccountKey.json` (copy nguyên) |
| `FB_STORAGE_STATE`         | Toàn bộ nội dung file `fb-storage.json` (copy nguyên) |

### 7. Deploy lên Render

1. New → Web Service → Connect repo GitHub.
2. Settings:
   - **Region**: Singapore (khuyến nghị)
   - **Runtime**: Node
   - **Build Command**: `npm install && npx playwright install chromium`
   - **Start Command**: `node src/server.js`
3. Environment Variables:
   - `TELEGRAM_BOT_TOKEN` = token bot
   - `FIREBASE_SERVICE_ACCOUNT` = nội dung file serviceAccountKey.json
4. Deploy.

### 8. Set Webhook Telegram

Sau khi Render xong, lấy URL (ví dụ `https://fb-view-bot-xxxx.onrender.com`), mở trình duyệt:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://fb-view-bot-xxxx.onrender.com/bot<TOKEN>
```

Thay `<TOKEN>` bằng token bot của bạn.

### 9. Kiểm tra

Gửi `/start` cho bot trên Telegram. Nếu trả lời là thành công.

## Lưu ý quan trọng

- Render Free sẽ **ngủ sau 15 phút không có request**. Lệnh đầu tiên sau khi ngủ có thể mất 30-60 giây.
- GitHub Actions tự chạy mỗi 15 phút, không phụ thuộc Render.
- Session Facebook (`fb-storage.json`) có thể hết hạn sau vài tuần → chạy lại `npm run login` và cập nhật Secret `FB_STORAGE_STATE`.
- Class selector Facebook hay đổi → nếu không lấy được view nữa thì cần sửa `src/scraper.js`.

## Lệnh bot

| Lệnh | Mô tả |
|------|-------|
| /start | Khởi động |
| /addpage &lt;link&gt; | Thêm 1 page |
| /addpages | Thêm nhiều page |
| /listpages | Xem danh sách |
| /removepage &lt;số hoặc link&gt; | Xóa page |
| /checknow | Check ngay |
| /status | Xem cấu hình |
| /setinterval &lt;phút&gt; | Đổi tần suất |
| /setthreshold &lt;số hoặc 10k&gt; | Đổi ngưỡng |
| /setlimit &lt;số&gt; | Số video mỗi page |
| /clearpages | Xóa tất cả page |
| /resetnotified | Reset lịch sử thông báo |
