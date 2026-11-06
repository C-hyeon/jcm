'use strict';
// 최소 준비 기간·하루 필요 시간 추천·가입 직후 레벨테스트
process.env.ALLOW_DEBUG_TODAY = 'true';
jest.mock('../src/config/firebase', () => require('./fakeFirebase'));

const request = require('supertest');
const fake = require('./fakeFirebase');
const { createApp } = require('../src/app');
const { estimateLoad, listStudyDates, reviewDayCount } = require('../src/services/scheduler');
const { QUESTIONS, gradeLevelTest } = require('../src/services/levelTest');
const { invalidate } = require('../src/services/masters');
const { todayKST, addDays } = require('../src/lib/dates');
const { subjects } = require('./helpers');

const app = createApp();
const db = fake.db();
const TODAY = todayKST();
const WEEKDAYS = [1, 2, 3, 4, 5];

beforeAll(async () => {
  const batch = db.batch();
  require('../seed/subjects.json').forEach(({ id, units, ...s }) => {
    batch.set(db.collection('subjects').doc(id), s);
    units.forEach(({ id: uid, ...u }) => batch.set(db.collection('subjects').doc(id).collection('units').doc(uid), u));
  });
  await batch.commit();
  invalidate();
});

// 표준 시간 합이 정확히 원하는 값이 되도록 만든 단일 과목
const oneSubject = (hours) => [{ id: 's1', name: '테스트', units: [{ id: 'u1', name: '단원', standardHours: hours, core: true }] }];

describe('하루 필요 학습 시간 추천 (scheduler.estimateLoad)', () => {
  test('예시: 복습 포함 60시간 ÷ 학습일 20일 = 하루 3시간', () => {
    // 월~금 4주 = 20일, 개념 학습 단계 → 총정리 3일, 학습 17일
    const monday = '2026-11-09';
    const examDate = addDays(monday, 28);
    expect(listStudyDates(monday, examDate, WEEKDAYS)).toHaveLength(20);
    const reviewDays = reviewDayCount(20, 'concept');
    const learnHours = (60 * (20 - reviewDays)) / 20; // 복습 포함 60시간이 되는 단원 학습량
    const e = estimateLoad({ today: monday, examDate, studyDays: WEEKDAYS, dailyHours: 3, stage: 'concept', subjects: oneSubject(learnHours) });
    expect(e.studyDayCount).toBe(20);
    expect(e.totalMinutes).toBe(60 * 60);
    expect(e.requiredDailyMinutes).toBe(180);
    expect(e.recommendedDailyHours).toBe(3);
    expect(e.enough).toBe(true);
    expect(e.shortage).toBeNull();
  });

  test('2시간만 가능하면 부족한 시간과 조정 방법(시간·요일)을 안내', () => {
    const monday = '2026-11-09';
    const examDate = addDays(monday, 28);
    const learnHours = (60 * (20 - reviewDayCount(20, 'concept'))) / 20;
    const e = estimateLoad({ today: monday, examDate, studyDays: WEEKDAYS, dailyHours: 2, stage: 'concept', subjects: oneSubject(learnHours) });
    expect(e.enough).toBe(false);
    expect(e.shortage.dailyMinutes).toBe(60);
    expect(e.shortage.totalMinutes).toBe(20 * 60);
    expect(e.shortage.byHours).toBe(3);
    // 주말을 모두 더해도(28일, 총정리 5일) 하루 약 133분이 필요 → 요일만으로는 부족, 매일 2.5시간 안내
    expect(e.shortage.byDays).toBeNull();
    expect(e.shortage.everyDay).toBe(2.5);

    // 2.5시간 가능: 토요일만으로는 부족(153분), 주말 이틀을 더하면 충분(133분)
    const e2 = estimateLoad({ today: monday, examDate, studyDays: WEEKDAYS, dailyHours: 2.5, stage: 'concept', subjects: oneSubject(learnHours) });
    expect(e2.shortage.byDays.addedDays).toEqual([0, 6]);
    expect(e2.shortage.byDays.studyDayCount).toBe(28);
  });

  test('요일을 모두 더해도 부족하면 매일 공부할 때 권장 시간을 안내', () => {
    const e = estimateLoad({ today: '2026-11-09', examDate: '2026-12-09', studyDays: [1], dailyHours: 0.5, stage: 'concept', subjects: oneSubject(80) });
    expect(e.shortage.byDays).toBeNull();
    expect(e.shortage.everyDay).toBeGreaterThan(0.5);
  });

  test('12시간을 넘게 필요하면 권장 시간 없이(null) 요일 추가를 안내', () => {
    const e = estimateLoad({ today: '2026-11-09', examDate: '2026-12-09', studyDays: [1], dailyHours: 12, stage: 'concept', subjects: oneSubject(500) });
    expect(e.recommendedDailyHours).toBeNull();
    expect(e.enough).toBe(false);
  });

  test('진도·자신감·학습 단계가 남은 학습량에 반영된다', () => {
    const base = { today: TODAY, examDate: addDays(TODAY, 60), studyDays: WEEKDAYS, dailyHours: 2, subjects: subjects('written') };
    const fresh = estimateLoad({ ...base, stage: 'concept' });
    const half = estimateLoad({ ...base, stage: 'concept', subjectProgress: { w1: 50, w2: 50, w3: 50, w4: 50, w5: 50 } });
    const unsure = estimateLoad({ ...base, stage: 'concept', subjectConfidence: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 } });
    const practice = estimateLoad({ ...base, stage: 'practice' });
    expect(half.learnMinutes).toBeCloseTo(fresh.learnMinutes / 2, -1);
    expect(unsure.learnMinutes).toBeGreaterThan(fresh.learnMinutes);
    expect(practice.learnMinutes).toBeLessThan(fresh.learnMinutes);
  });

  test('모든 단원 완료면 추가로 필요한 시간 0', () => {
    const e = estimateLoad({ today: TODAY, examDate: addDays(TODAY, 40), studyDays: WEEKDAYS, dailyHours: 1, subjects: oneSubject(10), unitRates: { u1: 100 } });
    expect(e.recommendedDailyHours).toBe(0);
    expect(e.enough).toBe(true);
  });
});

describe('POST /api/plans/estimate', () => {
  const body = (days, extra = {}) => ({ examType: 'written', examDate: addDays(TODAY, days), dailyHours: 1, studyDays: WEEKDAYS, stage: 'intro', subjectProgress: {}, subjectConfidence: {}, ...extra });

  test('비회원: 입력 조건으로 하루 필요 시간과 부족분 계산', async () => {
    const res = await request(app).post('/api/plans/estimate').send(body(60));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ minPrepDays: 30, meetsMinPrep: true, enough: false });
    expect(res.body.recommendedDailyHours).toBeGreaterThan(1);
    expect(res.body.shortage.byHours).toBe(res.body.recommendedDailyHours);
  });

  test('30일 미만도 계산은 하되 최소 준비 기간 미달을 표시', async () => {
    const res = await request(app).post('/api/plans/estimate').send(body(20));
    expect(res.status).toBe(200);
    expect(res.body.meetsMinPrep).toBe(false);
  });

  test('회원: 저장된 단원 진도를 반영', async () => {
    const D = 'Bearer test:dave';
    await request(app).get('/api/me').set('Authorization', D);
    const before = (await request(app).post('/api/plans/estimate').set('Authorization', D).send(body(60))).body;
    await request(app).put('/api/progress').set('Authorization', D).send({ unitId: subjects('written')[0].units[0].id, rate: 100 }).expect(200);
    const after = (await request(app).post('/api/plans/estimate').set('Authorization', D).send(body(60))).body;
    expect(after.learnMinutes).toBeLessThan(before.learnMinutes);
  });

  test('검증 미들웨어 재사용: 학습 요일이 없으면 400', async () => {
    const res = await request(app).post('/api/plans/estimate').send(body(60, { studyDays: [] }));
    expect(res.status).toBe(400);
  });
});

describe('가입 직후 레벨테스트', () => {
  const E = 'Bearer test:erin';
  const allCorrect = () => Object.fromEntries(QUESTIONS.map((q) => [q.id, q.answer]));

  test('신규 가입자는 레벨테스트 대기 상태', async () => {
    const me = await request(app).get('/api/me').set('Authorization', E);
    expect(me.body).toMatchObject({ levelTestPending: true, levelTest: null });
  });

  test('문항에는 정답·해설이 포함되지 않는다', async () => {
    const res = await request(app).get('/api/level-test').set('Authorization', E);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(QUESTIONS.length);
    res.body.questions.forEach((q) => {
      expect(q).not.toHaveProperty('answer');
      expect(q).not.toHaveProperty('explain');
      expect(q.choices).toHaveLength(4);
    });
  });

  test('일부 문항을 비우면 400', async () => {
    const { lt01, ...rest } = allCorrect();
    const res = await request(app).post('/api/level-test').set('Authorization', E).send({ answers: rest });
    expect(res.status).toBe(400);
  });

  test('제출 → 서버 채점·저장, 대기 상태 해제', async () => {
    const answers = { ...allCorrect(), lt13: null, lt14: 0, lt15: 0 }; // 정보시스템 구축관리 0/3
    const res = await request(app).post('/api/level-test').set('Authorization', E).send({ answers });
    expect(res.status).toBe(201);
    expect(res.body.result).toMatchObject({ correct: 12, total: 15, level: 'advanced', recommendedStage: 'practice' });
    expect(res.body.result.subjectConfidence).toMatchObject({ w1: 3, w5: 1, p09: 1, p10: 3 });
    expect(res.body.review.find((r) => r.id === 'lt13')).toMatchObject({ chosen: null, correct: false });
    const me = await request(app).get('/api/me').set('Authorization', E);
    expect(me.body.levelTestPending).toBe(false);
    expect(me.body.levelTest).toMatchObject({ level: 'advanced', takenAt: expect.any(String) });
  });

  test('건너뛰기도 대기 상태 해제', async () => {
    const F = 'Bearer test:frank';
    await request(app).get('/api/me').set('Authorization', F);
    await request(app).post('/api/level-test/skip').set('Authorization', F).expect(200);
    const me = await request(app).get('/api/me').set('Authorization', F);
    expect(me.body).toMatchObject({ levelTestPending: false, levelTest: null });
  });

  test('레벨테스트는 로그인 필요', async () => {
    expect((await request(app).get('/api/level-test')).status).toBe(401);
  });

  test('채점 기준: 정답률 40% 미만 기초, 70% 이상 상급', () => {
    const none = Object.fromEntries(QUESTIONS.map((q) => [q.id, null]));
    expect(gradeLevelTest(none).result).toMatchObject({ level: 'beginner', recommendedStage: 'intro', rate: 0 });
    const some = { ...none };
    QUESTIONS.slice(0, 7).forEach((q) => (some[q.id] = q.answer)); // 7/15 = 46.7%
    expect(gradeLevelTest(some).result).toMatchObject({ level: 'intermediate', recommendedStage: 'concept' });
  });
});
