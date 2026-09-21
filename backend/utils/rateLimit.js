// backend/utils/rateLimit.js

// 轻量内存限流（与旧版 Express 实现一致，按 Worker isolate 粒度粗略限流）
const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const item = buckets.get(key);
  if (!item || now - item.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  item.count += 1;
  return item.count <= max;
}
