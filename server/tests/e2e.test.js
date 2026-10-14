'use strict';
// 주요 학습 관리 시나리오 통합 테스트
process.env.ALLOW_DEBUG_TODAY = 'true';
process.env.AI_PROVIDER = 'mock';
jest.mock('../src/config/firebase', () => require('./fakeFirebase'));

const request = require('supertest');
const fake = require('./fakeFirebase');
const { createApp } = require('../src/app');
const { todayKST, addDays, dayOfWeek } = require('../src/lib/dates');
const { invalidate } = require('../src/services/masters');

const app = createApp();
const db = fake.db();
const TODAY = todayKST();
const A = 'Bearer test:alice';
const B = 'Bearer test:bob';
const ADMIN = 'Bearer test:admin1:admin';

beforeAll(async () => {
  const batch = db.batch();
  require('../seed/exams.json').forEach(({ id, ...e }) => batch.set(db.collection('exams').doc(id), e));
  require('../seed/subjects.json').forEach(({ id, units, ...s }) => {
    batch.set(db.collection('subjects').doc(id), s);
    units.forEach(({ id: uid, ...u }) => batch.set(db.collection('subjects').doc(id).collection('units').doc(uid), u));
  });
  require('../seed/materials.json').forEach(({ id, ...m }) => batch.set(db.collection('materials').doc(id), { ...m, visible: true, linkStatus: 'ok', createdAt: new Date() }));
  await batch.commit();
  invalidate();
});

const profile = (days, extra = {}) => ({
  examType: 'written',
  examDate: addDays(TODAY, days),
  dailyHours: 2,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  stage: 'concept',
  subjectProgress: { w1: 0, w2: 0, w3: 0, w4: 0, w5: 0 },
  subjectConfidence: { w3: 1 },
  ...extra,
});

describe('시나리오: 수험생 A', () => {
  test('비회원 스케줄 미리보기(저장 안 함)', async () => {
    const res = await request(app).post('/api/plans/preview').send(profile(30));
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBeGreaterThan(10);
    expect(res.body.tasks[0].materials).toEqual(expect.any(Array));
    expect([...fake._store.keys()].some((k) => k.startsWith('users/'))).toBe(false);
  });

  test('로그인 → users 문서 생성', async () => {
    const res = await request(app).get('/api/me').set('Authorization', A);
    expect(res.status).toBe(200);
    expect(res.body.hasProfile).toBe(false);
    expect(fake._store.has('users/alice')).toBe(true);
  });

  test('시험일이 오늘 이전이면 저장 거부', async () => {
    const res = await request(app).put('/api/study-profile').set('Authorization', A).send({ ...profile(0), examDate: addDays(TODAY, -1) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EXAM_DATE_PAST');
  });

  test('남은 기간 7일 미만이면 총정리 모드 안내', async () => {
    const res = await request(app).put('/api/study-profile').set('Authorization', A).send(profile(5));
    expect(res.status).toBe(200);
    expect(res.body.notices[0].code).toBe('SHORT_PERIOD');
  });

  test('학습 조건 저장 → 스케줄 생성 → 중복 생성 시 덮어쓰기 확인(409)', async () => {
    await request(app).put('/api/study-profile').set('Authorization', A).send(profile(60)).expect(200);
    const created = await request(app).post('/api/plans').set('Authorization', A).send({});
    expect(created.status).toBe(201);
    expect(created.body.taskCount).toBeGreaterThan(30);
    const again = await request(app).post('/api/plans').set('Authorization', A).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PLAN_EXISTS');
  });

  let todayTasks;
  test('오늘 할 일: D-day, 과제, 자료 링크(출처 포함)', async () => {
    const res = await request(app).get('/api/today').set('Authorization', A);
    expect(res.status).toBe(200);
    expect(res.body.exam.dday).toBe(60);
    expect(res.body.tasks.length).toBeGreaterThan(0);
    todayTasks = res.body.tasks;
    const total = todayTasks.reduce((a, t) => a + t.minutes, 0);
    expect(total).toBeLessThanOrEqual(120);
    const withMat = todayTasks.find((t) => t.materials.length);
    expect(withMat.materials[0]).toEqual(expect.objectContaining({ url: expect.stringMatching(/^https:/), sourceName: expect.any(String) }));
  });

  test('완료 체크 + 이해도·복습 필요 기록 → 진도율 반영', async () => {
    const t = todayTasks.find((x) => x.type === 'study');
    const res = await request(app).patch(`/api/tasks/${t.id}`).set('Authorization', A).send({ done: true, actualMinutes: 50, understanding: 1, needsReview: true });
    expect(res.status).toBe(200);
    expect(res.body.task.done).toBe(true);
    expect(res.body.progress.rate).toBeGreaterThan(0);
    const prog = await request(app).get('/api/progress').set('Authorization', A);
    const unit = prog.body.subjects.flatMap((s) => s.units).find((u) => u.id === t.unitId);
    expect(unit.rate).toBeGreaterThan(0);
    expect(unit.needsReview).toBe(true);
    const weak = await request(app).get('/api/weakness').set('Authorization', A);
    expect(weak.body.nextReview.some((n) => n.unitId === t.unitId)).toBe(true);
  });

  test('오답 기록 CRUD + 취약 유형 상위 3개', async () => {
    const notes = [
      ['w3', 'SQL'], ['w3', 'SQL'], ['w3', 'SQL'], ['w4', '코드 실행 결과'], ['w4', '코드 실행 결과'], ['w1', 'UML'],
    ];
    const ids = [];
    for (const [subjectId, typeTag] of notes) {
      const r = await request(app).post('/api/wrong-notes').set('Authorization', A).send({ subjectId, typeTag, difficulty: 'mid', sourceRef: { round: '2025년 1회', number: '12' }, memo: '조인 조건' });
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    const bad = await request(app).post('/api/wrong-notes').set('Authorization', A).send({ subjectId: 'w3', difficulty: 'mid' });
    expect(bad.status).toBe(400);
    const wrongTag = await request(app).post('/api/wrong-notes').set('Authorization', A).send({ subjectId: 'w3', typeTag: 'UML', difficulty: 'mid' });
    expect(wrongTag.status).toBe(400);
    const longMemo = await request(app).post('/api/wrong-notes').set('Authorization', A).send({ subjectId: 'w3', typeTag: 'SQL', difficulty: 'mid', memo: 'x'.repeat(1001) });
    expect(longMemo.status).toBe(400);

    let w = await request(app).get('/api/weakness').set('Authorization', A);
    expect(w.body.topTypes.map((t) => t.typeTag)).toEqual(['SQL', '코드 실행 결과', 'UML']);
    expect(w.body.topTypes[0].score).toBe(50); // 3×1.5 / 6×1.5

    await request(app).patch(`/api/wrong-notes/${ids[0]}`).set('Authorization', A).send({ reviewed: true }).expect(200);
    await request(app).delete(`/api/wrong-notes/${ids[5]}`).set('Authorization', A).expect(200);
    w = await request(app).get('/api/weakness').set('Authorization', A);
    expect(w.body.topTypes[0].score).toBeCloseTo(53.8, 1);
    expect(w.body.topTypes).toHaveLength(2);

    await request(app).post('/api/weakness/rebuild').set('Authorization', A).expect(200);
    const w2 = await request(app).get('/api/weakness').set('Authorization', A);
    expect(w2.body.topTypes).toEqual(w.body.topTypes);

    const list = await request(app).get('/api/wrong-notes?subjectId=w3&typeTag=SQL&reviewed=false').set('Authorization', A);
    expect(list.body.items).toHaveLength(2);
  });

  test('미완료 과제 재배분: 3일 뒤 접속 → 지난 미완료 0건, 일별 가용 시간 초과 없음', async () => {
    const later = addDays(TODAY, 3);
    const res = await request(app).get('/api/today').set('Authorization', A).set('X-Debug-Today', later);
    expect(res.status).toBe(200);
    expect(res.body.redistribution.movedCount).toBeGreaterThan(0);

    const tasks = [...fake._store.entries()].filter(([k]) => k.startsWith('users/alice/tasks/')).map(([, v]) => v);
    const active = fake._store.get('users/alice').activePlanId;
    const mine = tasks.filter((t) => t.planId === active);
    expect(mine.filter((t) => !t.done && t.date < later)).toHaveLength(0);
    const byDate = {};
    mine.filter((t) => !t.done).forEach((t) => (byDate[t.date] = (byDate[t.date] || 0) + t.minutes));
    Object.entries(byDate).filter(([d]) => d >= later).forEach(([, m]) => expect(m).toBeLessThanOrEqual(120));
    expect(mine.some((t) => t.carriedOver)).toBe(true);

    const again = await request(app).get('/api/today').set('Authorization', A).set('X-Debug-Today', later);
    expect(again.body.redistribution).toBeNull();
  });

  test('지난 날짜 과제는 수정 불가', async () => {
    const past = todayTasks.find((t) => !t.done);
    if (!past) return;
    const snap = fake._store.get(`users/alice/tasks/${past.id}`);
    const res = await request(app).patch(`/api/tasks/${past.id}`).set('Authorization', A).set('X-Debug-Today', addDays(snap.date, 1)).send({ done: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAST_TASK');
  });

  test('선행 학습(진도 100%) → 오늘 이후 해당 단원 과제 삭제, 진도 낮추기는 확인 필요', async () => {
    const active = fake._store.get('users/alice').activePlanId;
    const futureUnit = [...fake._store.values()].find((t) => t.planId === active && t.type === 'study' && !t.done && t.date > addDays(TODAY, 10))?.unitId;
    const res = await request(app).put('/api/progress').set('Authorization', A).send({ unitId: futureUnit, rate: 100 });
    expect(res.status).toBe(200);
    expect(res.body.adjustment.deleted).toBeGreaterThan(0);
    const left = [...fake._store.values()].filter((t) => t.planId === active && t.unitId === futureUnit && !t.done && t.date >= TODAY);
    expect(left).toHaveLength(0);

    const down = await request(app).put('/api/progress').set('Authorization', A).send({ unitId: futureUnit, rate: 50 });
    expect(down.status).toBe(409);
    expect(down.body.code).toBe('CONFIRM_DECREASE');
    await request(app).put('/api/progress').set('Authorization', A).send({ unitId: futureUnit, rate: 50, confirmDecrease: true }).expect(200);
  });

  test('스케줄 재생성: 오늘 이후만 교체, 완료 과제 유지', async () => {
    const doneBefore = [...fake._store.values()].filter((t) => t.done).length;
    const res = await request(app).post('/api/plans').set('Authorization', A).send({ confirmOverwrite: true });
    expect(res.status).toBe(201);
    expect([...fake._store.values()].filter((t) => t.done).length).toBe(doneBefore);
  });

  test('AI 추천: 추천 3개, 자료는 모두 허브 등록 자료, 취약 유형 반영 / 피드백', async () => {
    const res = await request(app).post('/api/recommendations').set('Authorization', A);
    expect(res.status).toBe(201);
    expect(res.body.engine).toBe('ai');
    expect(res.body.topics).toHaveLength(3);
    const hub = new Set(require('../seed/materials.json').map((m) => m.id));
    res.body.topics.flatMap((t) => t.materials).forEach((m) => expect(hub.has(m.id)).toBe(true));
    expect(res.body.topics[0].title).toContain('SQL');
    const fb = await request(app).patch(`/api/recommendations/${res.body.id}`).set('Authorization', A).send({ feedback: 'helpful' });
    expect(fb.status).toBe(200);
    const hist = await request(app).get('/api/recommendations?limit=5').set('Authorization', A);
    expect(hist.body.items[0].feedback).toBe('helpful');
  });

  test('AI 차단 시 규칙 기반 대체 추천', async () => {
    process.env.AI_MOCK_FAIL = 'true';
    const res = await request(app).post('/api/recommendations').set('Authorization', A);
    process.env.AI_MOCK_FAIL = 'false';
    expect(res.status).toBe(201);
    expect(res.body.engine).toBe('rule');
    expect(res.body.topics.length).toBeGreaterThan(0);
    expect(res.body.topics[0].materials.length).toBeGreaterThan(0);
  });

  test('AI 추천 일 10회 초과 시 429', async () => {
    let last;
    for (let i = 0; i < 9; i++) last = await request(app).post('/api/recommendations').set('Authorization', A);
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('AI_DAILY_LIMIT');
  });

  test('대시보드·학습 경로·자료 검색·북마크', async () => {
    const stats = await request(app).get('/api/stats?period=4w').set('Authorization', A);
    expect(stats.status).toBe(200);
    expect(stats.body.subjects).toHaveLength(5);
    expect(stats.body.weekly.length).toBeGreaterThan(0);
    const path = await request(app).get('/api/learning-path').set('Authorization', A);
    expect(path.status).toBe(200);
    expect(path.body.subject.id).toBe('w3'); // 취약 비중이 가장 큰 과목
    const order = path.body.steps.map((s) => s.step);
    expect(order).toEqual([...order].sort());

    const search = await request(app).get('/api/materials?q=sql');
    expect(search.body.items.length).toBeGreaterThan(0);
    await request(app).post('/api/bookmarks').set('Authorization', A).send({ materialId: 'sqlbolt' }).expect(201);
    const marked = await request(app).get('/api/materials?bookmarked=1').set('Authorization', A);
    expect(marked.body.items.map((m) => m.id)).toEqual(['sqlbolt']);
  });
});

describe('보안', () => {
  test('다른 사용자 B는 A의 과제·오답에 접근할 수 없다', async () => {
    await request(app).get('/api/me').set('Authorization', B).expect(200);
    const aTask = [...fake._store.keys()].find((k) => k.startsWith('users/alice/tasks/')).split('/').pop();
    const res = await request(app).patch(`/api/tasks/${aTask}`).set('Authorization', B).send({ done: true });
    expect(res.status).toBe(404);
    const notes = await request(app).get('/api/wrong-notes').set('Authorization', B);
    expect(notes.body.items).toHaveLength(0);
  });

  test('일반 사용자의 관리자 API 접근 → 403', async () => {
    const res = await request(app).get('/api/admin/materials').set('Authorization', A);
    expect(res.status).toBe(403);
  });

  test('관리자 자료 등록: http·중복 URL 거부, 본문 필드는 저장 안 됨', async () => {
    const base = { title: '테스트 자료', sourceName: '테스트', author: '작성자', subjectId: 'w3', type: 'doc', stage: 'concept', reason: '테스트용 추천 이유입니다.' };
    expect((await request(app).post('/api/admin/materials').set('Authorization', ADMIN).send({ ...base, url: 'http://example.com' })).status).toBe(400);
    expect((await request(app).post('/api/admin/materials').set('Authorization', ADMIN).send({ ...base, url: 'https://localhost/x' })).status).toBe(400);
    const dup = await request(app).post('/api/admin/materials').set('Authorization', ADMIN).send({ ...base, url: 'https://sqlbolt.com/' });
    expect(dup.body.code).toBe('DUPLICATE_URL');
    const ok = await request(app).post('/api/admin/materials').set('Authorization', ADMIN).send({ ...base, url: 'https://example.com/a', content: '본문 복제' });
    expect(ok.status).toBe(201);
    expect(fake._store.get(`materials/${ok.body.id}`).content).toBeUndefined();
  });

  test('탈퇴: 재인증 없으면 거부, 재인증 후 하위 데이터 0건', async () => {
    const stale = await request(app).delete('/api/me').set('Authorization', 'Bearer test:alice:stale');
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('REAUTH_REQUIRED');
    const res = await request(app).delete('/api/me').set('Authorization', A);
    expect(res.status).toBe(200);
    expect([...fake._store.keys()].filter((k) => k.startsWith('users/alice'))).toHaveLength(0);
    expect((await request(app).get('/api/me').set('Authorization', A)).status).toBe(401);
  });
});

describe('실기·짧은 기간 계정', () => {
  test('실기 21일, 주 4일, 하루 1시간: 스케줄 생성 성공', async () => {
    const C = 'Bearer test:carol';
    await request(app).get('/api/me').set('Authorization', C);
    const p = { examType: 'practical', examDate: addDays(TODAY, 21), dailyHours: 1, studyDays: [1, 3, 5, 6], stage: 'final', subjectProgress: {}, subjectConfidence: {} };
    await request(app).put('/api/study-profile').set('Authorization', C).send(p).expect(200);
    const res = await request(app).post('/api/plans').set('Authorization', C).send({});
    expect(res.status).toBe(201);
    expect(res.body.plan.warnings.map((w) => w.code)).toContain('TIME_SHORTAGE');
    const tasks = [...fake._store.values()].filter((t) => t.planId === res.body.planId);
    tasks.forEach((t) => expect(p.studyDays).toContain(dayOfWeek(t.date)));
  });
});
