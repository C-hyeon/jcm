// 비회원 체험 데이터
const KEY = 'jcm.guest.v1';

export function loadGuest() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
export function saveGuest(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
  } catch {}
}
export function clearGuest() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
