import { auth } from '../firebase';

const BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Express REST API 호출. 로그인 상태면 Authorization: Bearer {Firebase ID 토큰} 삽입. 토큰 만료 시 SDK가 자동 갱신.
export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const user = auth.currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const debugToday = import.meta.env.DEV ? sessionStorage.getItem('jcm.debugToday') : null;
  if (debugToday) headers['X-Debug-Today'] = debugToday;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', '서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.code || 'ERROR', data?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', data?.details);
  }
  return data;
}

/** 확인이 필요한 요청(409 CONFIRM_*, PLAN_EXISTS)을 사용자 확인 후 다시 보낸다 */
export async function apiWithConfirm(path, { method = 'POST', body = {}, confirmKey }) {
  try {
    return await api(path, { method, body });
  } catch (e) {
    if (e.status === 409 && window.confirm(e.message)) {
      return api(path, { method, body: { ...body, [confirmKey]: true } });
    }
    throw e;
  }
}
