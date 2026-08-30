/**
 * Chuyển text lượt xem Facebook → số nguyên.
 *
 * Hỗ trợ: "5,7 K" | "1,4K" | "78,5 K" | "2 m" | "9 tr" | "15 N" | "856" | "1.2M"
 *
 * N/K = nghìn, Tr/M = triệu, B = tỷ
 */
function parseViewCount(text) {
  if (!text) return null;

  let cleaned = String(text)
    .replace(/lượt xem|lượt|views?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const match = cleaned.match(/^([\d.,]+)\s*(N|K|Tr|M|B)?$/i);
  if (!match) return null;

  let raw = match[1];
  const unit = (match[2] || '').toUpperCase();

  let num;
  if (raw.includes('.') && raw.includes(',')) {
    // 1.234,5
    raw = raw.replace(/\./g, '').replace(',', '.');
    num = parseFloat(raw);
  } else if (raw.includes(',')) {
    const parts = raw.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // 5,7 → 5.7
      num = parseFloat(parts[0] + '.' + parts[1]);
    } else {
      num = parseFloat(raw.replace(/,/g, ''));
    }
  } else if (raw.includes('.')) {
    const parts = raw.split('.');
    if (parts.length === 2 && parts[1].length <= 2 && unit) {
      // 1.2M → 1.2
      num = parseFloat(raw);
    } else {
      num = parseFloat(raw.replace(/\./g, ''));
    }
  } else {
    num = parseFloat(raw);
  }

  if (isNaN(num)) return null;

  if (unit === 'N' || unit === 'K') num *= 1000;
  else if (unit === 'TR' || unit === 'M') num *= 1_000_000;
  else if (unit === 'B') num *= 1_000_000_000;

  return Math.round(num);
}

module.exports = { parseViewCount };