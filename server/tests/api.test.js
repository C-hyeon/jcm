'use strict';
// 통합 테스트(인증·검증·오류 형식)
const request = require('supertest');
const { createApp } = require('../src/app');

const app = createApp();

describe('API 공통 규칙', () => {
  test('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  test.each([
    ['get', '/api/today'],
    ['get', '/api/me'],
    ['delete', '/api/me'],
    ['get', '/api/admin/materials'],
    ['post', '/api/recommendations'],
    ['get', '/api/wrong-notes'],
  ])('%s %s — 토큰 없으면 401 {code, message}', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'UNAUTHENTICATED', message: expect.any(String) });
  });

  test('잘못된 토큰은 401 INVALID_TOKEN 또는 UNAUTHENTICATED (내부 정보 미노출)', async () => {
    const res = await request(app).get('/api/today').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/);
  });

  test('요청 본문 100KB 초과 → 400 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app).post('/api/plans/preview').send({ big: 'x'.repeat(110 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('학습 조건 경곗값: 0.5시간 미만·12시간 초과·30분 단위 아님 → 400', async () => {
    const base = { examType: 'written', examDate: '2027-02-13', studyDays: [1], stage: 'intro' };
    for (const dailyHours of [0.4, 12.5, 1.2]) {
      const res = await request(app).post('/api/plans/preview').send({ ...base, dailyHours });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  test('학습 요일 미선택 → 400 안내 메시지', async () => {
    const res = await request(app).post('/api/plans/preview').send({ examType: 'written', examDate: '2027-02-13', dailyHours: 2, studyDays: [], stage: 'intro' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('학습 요일');
  });

  test('허용되지 않은 Origin에는 CORS 헤더를 주지 않는다', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
