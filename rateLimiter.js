import { config } from './config.js';

// Simple fixed-window counters, in memory. This protects the server's own
// CPU/bandwidth/disk from a single sender hammering it -- it's independent
// of the sender's own Gemini quota, which is their concern since they
// supply their own API key.
//
// Note: counts reset on process restart. That's an acceptable trade-off for
// an abuse guard on a free-tier box; swap in a persisted store if you need
// limits to survive restarts.
const buckets = new Map();

function getBucket(key) {
  let b = buckets.get(key);
  const now = Date.now();
  if (!b) {
    b = { minuteWindowStart: now, minuteCount: 0, dayWindowStart: now, dayCount: 0 };
    buckets.set(key, b);
  }
  if (now - b.minuteWindowStart > 60_000) {
    b.minuteWindowStart = now;
    b.minuteCount = 0;
  }
  if (now - b.dayWindowStart > 86_400_000) {
    b.dayWindowStart = now;
    b.dayCount = 0;
  }
  return b;
}

export function checkAndConsume(key) {
  const b = getBucket(key);
  if (b.minuteCount >= config.rateLimitPerMinute) {
    return { allowed: false, reason: 'minute' };
  }
  if (b.dayCount >= config.rateLimitPerDay) {
    return { allowed: false, reason: 'day' };
  }
  b.minuteCount += 1;
  b.dayCount += 1;
  return { allowed: true };
}
