// 표시용 상수·포맷 (날짜는 Asia/Seoul 기준 YYYY-MM-DD)
export const EXAM_TYPE = { written: '필기', practical: '실기' };
export const STAGE = { intro: '입문', concept: '개념 학습', practice: '문제 풀이', final: '총정리' };
export const STAGE_DESC = {
  intro: '범위가 낯설고 무엇부터 할지 모름',
  concept: '과목별 개념을 처음부터 정리하는 중',
  practice: '개념은 봤고 기출·문제를 푸는 중',
  final: '시험 직전, 기출 회독과 오답 정리',
};
export const MATERIAL_TYPE = { video: '영상', blog: '블로그', cbt: 'CBT', official: '공식 자료', doc: '문서·실습' };
export const DIFFICULTY = { high: '상', mid: '중', low: '하' };
export const UNDERSTANDING = { 1: '어려움', 2: '보통', 3: '잘 이해함' };
export const CONFIDENCE = { 1: '낮음', 2: '보통', 3: '높음' };
export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
export function todayKST() {
  const debug = import.meta.env.DEV ? sessionStorage.getItem('jcm.debugToday') : null;
  return debug || fmt.format(new Date());
}
const parse = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};
const toStr = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => toStr(parse(d) + n * 86400000);
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const dayOfWeek = (d) => new Date(parse(d)).getUTCDay();

export function formatDate(d, withDay = true) {
  if (!d) return '';
  const [, m, dd] = d.split('-').map(Number);
  return `${m}월 ${dd}일${withDay ? ` (${DAYS[dayOfWeek(d)]})` : ''}`;
}
export function ddayLabel(n) {
  if (n == null) return '';
  if (n === 0) return 'D-Day';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}
export function minutesLabel(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (!h) return `${r}분`;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}
export const pct = (v) => (v == null ? '-' : `${Number(v).toFixed(1)}%`);

/** 월간 달력(일요일 시작) 날짜 배열 */
export function monthGrid(anchor) {
  const [y, m] = anchor.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = toStr(Date.UTC(y, m, 0));
  const start = addDays(first, -dayOfWeek(first));
  const end = addDays(last, 6 - dayOfWeek(last));
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return { days, from: start, to: end, month: m, year: y };
}
export function weekRange(anchor) {
  const from = addDays(anchor, -dayOfWeek(anchor));
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { days, from, to: days[6] };
}
