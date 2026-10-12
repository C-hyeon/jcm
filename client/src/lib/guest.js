// 비회원 체험 데이터(시험 정보·스케줄 미리보기)를 이 브라우저에만 보관한다.
// 가입하면 서버로 옮기고 지운다.
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
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 무시 */
  }
}
export function clearGuest() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
