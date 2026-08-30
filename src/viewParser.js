/**
 * Chuyển text lượt xem Facebook (VD: "1,2 N lượt xem", "15 N", "2,3 Tr lượt xem", "856")
 * thành số nguyên thật để so sánh với ngưỡng.
 *
 * Quy ước đang giả định (kiểu VN phổ biến trên Facebook):
 *   - "N" hoặc "K" = nghìn (x1.000)
 *   - "Tr" hoặc "M" = triệu (x1.000.000)
 *   - dấu "," trong số như "1,2" = dấu thập phân
 *   - dấu "." trong số như "1.234" = dấu phân cách nghìn (bỏ đi khi tính)
 *
 * Nếu chạy thực tế thấy parse sai (VD Facebook hiển thị định dạng khác),
 * gửi lại vài dòng mẫu thật từ console.table để chỉnh lại regex này cho đúng.
 */
function parseViewCount(text) {
  if (!text) return null;

  const cleaned = text
    .replace(/lượt xem|lượt|views?/gi, '')
    .trim();

  const match = cleaned.match(/^([\d.,]+)\s*(N|K|Tr|M)?$/i);
  if (!match) return null;

  const rawNumber = match[1]
    .replace(/\./g, '') // bỏ dấu chấm phân cách nghìn
    .replace(',', '.'); // đổi dấu phẩy thập phân VN -> dấu chấm chuẩn JS

  let num = parseFloat(rawNumber);
  if (isNaN(num)) return null;

  const unit = (match[2] || '').toUpperCase();
  if (unit === 'N' || unit === 'K') num *= 1000;
  if (unit === 'TR' || unit === 'M') num *= 1000000;

  return Math.round(num);
}

module.exports = { parseViewCount };
