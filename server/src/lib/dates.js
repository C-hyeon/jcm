'use strict';

const TZ = 'Asia/Seoul';
const DAY_MS = 86400000;
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function todayKST(now = new Date()) {
  return fmt.format(now);
}
function parse(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
}
function toStr(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && toStr(parse(d)) === d;
}
function addDays(d, n) {
  return toStr(parse(d) + n * DAY_MS);
}
function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}
function dayOfWeek(d) {
  return new Date(parse(d)).getUTCDay();
}
function weekStart(d) {
  return addDays(d, -((dayOfWeek(d) + 6) % 7));
}

function requestToday(req) {
  const h = req.headers['x-debug-today'];
  if (h && process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEBUG_TODAY === 'true' && isValidDate(h)) return h;
  return todayKST();
}

module.exports = { TZ, todayKST, isValidDate, addDays, diffDays, dayOfWeek, weekStart, requestToday };
