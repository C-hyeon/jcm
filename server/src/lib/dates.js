'use strict';
// 날짜는 Asia/Seoul 기준 'YYYY-MM-DD' 문자열로 다룬다(명세 3.6 데이터 관리).
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
/** b - a (일) */
function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}
/** 0=일 ~ 6=토 */
function dayOfWeek(d) {
  return new Date(parse(d)).getUTCDay();
}
/** 해당 주의 월요일 */
function weekStart(d) {
  return addDays(d, -((dayOfWeek(d) + 6) % 7));
}

/**
 * 요청 기준 '오늘'. 개발/테스트에서만 X-Debug-Today 헤더로 날짜를 바꿔
 * 미완료 과제 재배분(UC-04)을 검증할 수 있다.
 */
function requestToday(req) {
  const h = req.headers['x-debug-today'];
  if (h && process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEBUG_TODAY === 'true' && isValidDate(h)) return h;
  return todayKST();
}

module.exports = { TZ, todayKST, isValidDate, addDays, diffDays, dayOfWeek, weekStart, requestToday };
