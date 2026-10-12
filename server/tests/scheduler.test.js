'use strict';
const { buildPlan, redistribute, allocate, listStudyDates, subjectWeight } = require('../src/services/scheduler');
const { addDays } = require('../src/lib/dates');
const { subjects } = require('./helpers');

const TODAY = '2026-10-12'; // 월요일
const WEEKDAYS = [1, 2, 3, 4, 5];

function sumByDate(tasks) {
  const m = {};
  tasks.forEach((t) => (m[t.date] = (m[t.date] || 0) + t.minutes));
  return m;
}

describe('UC-03 스케줄 생성 — 시험일까지 30·90·180일 예시 데이터', () => {
  test.each([30, 90, 180])('%i일: 일별 배정 ≤ 가용시간, 시험 전날까지 종료, 미학습 단원 누락 0건', (days) => {
    const examDate = addDays(TODAY, days);
    const subs = subjects('written');
    const plan = buildPlan({ today: TODAY, examDate, dailyHours: 2, studyDays: WEEKDAYS, subjects: subs, subjectProgress: { w1: 50 } });
    expect(plan.error).toBeUndefined();

    const byDate = sumByDate(plan.tasks);
    Object.values(byDate).forEach((m) => expect(m).toBeLessThanOrEqual(120));
    const lastDate = plan.tasks.map((t) => t.date).sort().pop();
    expect(lastDate <= addDays(examDate, -1)).toBe(true);
    plan.tasks.forEach((t) => expect(WEEKDAYS).toContain(new Date(`${t.date}T00:00:00Z`).getUTCDay()));

    const scheduledUnits = new Set(plan.tasks.filter((t) => t.type === 'study').map((t) => t.unitId));
    subs.flatMap((s) => s.units).forEach((u) => expect(scheduledUnits.has(u.id)).toBe(true));
    expect(plan.warnings.find((w) => w.code === 'UNSCHEDULED_UNITS')).toBeUndefined();

    // 마지막 15% 학습일은 총정리
    plan.tasks.filter((t) => t.date >= plan.reviewStartDate && t.type === 'review').forEach((t) => expect(t.title).toMatch('총정리'));
    expect(plan.tasks.some((t) => t.type === 'review')).toBe(true);
  });

  test('완료(100%) 단원은 다시 배정하지 않는다(선행 학습 중복 배정 방지)', () => {
    const plan = buildPlan({
      today: TODAY,
      examDate: addDays(TODAY, 90),
      dailyHours: 2,
      studyDays: WEEKDAYS,
      subjects: subjects('written'),
      unitRates: { 'w3-u1': 100, 'w3-u2': 100 },
    });
    expect(plan.tasks.some((t) => t.unitId === 'w3-u1' || t.unitId === 'w3-u2')).toBe(false);
  });

  test('가용 시간이 60% 미만이면 부족 경고와 핵심 단원 우선 배분', () => {
    const plan = buildPlan({ today: TODAY, examDate: addDays(TODAY, 14), dailyHours: 1, studyDays: WEEKDAYS, subjects: subjects('written') });
    expect(plan.warnings.map((w) => w.code)).toContain('TIME_SHORTAGE');
    const minutesOf = (id) => plan.tasks.filter((t) => t.unitId === id).reduce((a, t) => a + t.minutes, 0);
    // 같은 표준시간(6h)이라도 core 단원이 더 많이 배정
    expect(minutesOf('w1-u1')).toBeGreaterThan(minutesOf('w2-u4') * 0.9);
  });

  test('남은 기간 7일 미만이면 총정리 안내', () => {
    const plan = buildPlan({ today: TODAY, examDate: addDays(TODAY, 5), dailyHours: 3, studyDays: [0, 1, 2, 3, 4, 5, 6], subjects: subjects('practical') });
    expect(plan.warnings.map((w) => w.code)).toContain('SHORT_PERIOD');
  });

  test('학습 요일이 없으면 오류', () => {
    const plan = buildPlan({ today: TODAY, examDate: addDays(TODAY, 3), dailyHours: 2, studyDays: [6], subjects: subjects('written') });
    // 10/12(월)~10/14(수) 사이에 토요일 없음
    expect(plan.error).toBe('NO_STUDY_DAYS');
  });

  test('allocate: 공식 T_i = T × need_i / Σneed (60%~100% 구간)', () => {
    const needs = [
      { unitId: 'a', need: 300, core: false },
      { unitId: 'b', need: 100, core: false },
    ];
    const { minutes, level } = allocate(needs, 320); // ratio 0.8
    expect(level).toBe('tight');
    expect(minutes.get('a')).toBe(240);
    expect(minutes.get('b')).toBe(80);
  });

  test('subjectWeight는 1.0~1.5 범위', () => {
    expect(subjectWeight(3, 0)).toBe(1);
    expect(subjectWeight(1, 1)).toBe(1.5);
    expect(subjectWeight(2, 0.2)).toBeCloseTo(1.2);
  });

  test('listStudyDates: 시험 당일은 제외', () => {
    const d = listStudyDates('2026-10-12', '2026-10-15', [0, 1, 2, 3, 4, 5, 6]);
    expect(d).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });
});

describe('UC-04 미완료 과제 재배분', () => {
  const plan = buildPlan({ today: TODAY, examDate: addDays(TODAY, 60), dailyHours: 2, studyDays: WEEKDAYS, subjects: subjects('written') });
  const tasks = plan.tasks.map((t, i) => ({ ...t, id: `t${i}` }));
  const later = addDays(TODAY, 3); // 3일 뒤 접속했다고 가정

  test('미완료 3건을 남은 학습일에 재배분: 누락 0건, 일별 가용시간 초과 없음', () => {
    const overdue = tasks.filter((t) => t.date < later && t.type === 'study').slice(0, 3);
    expect(overdue).toHaveLength(3);
    const future = tasks.filter((t) => t.date >= later);
    const usage = {};
    future.forEach((t) => (usage[t.date] = (usage[t.date] || 0) + t.minutes));
    const reviewTasksByDate = {};
    future.filter((t) => t.type === 'review').forEach((t) => (reviewTasksByDate[t.date] ||= []).push({ id: t.id, minutes: t.minutes }));

    const res = redistribute({ overdue, today: later, studyDates: plan.studyDates, reviewStartDate: plan.reviewStartDate, capacity: 120, usage, reviewTasksByDate });
    expect(res.unplaced).toHaveLength(0);
    expect(res.moves.map((m) => m.id).sort()).toEqual(overdue.map((t) => t.id).sort());
    res.moves.forEach((m) => expect(m.date >= later).toBe(true));
    Object.values(res.usage).forEach((m) => expect(m).toBeLessThanOrEqual(120));
    const placed = res.moves.reduce((a, m) => a + m.minutes, 0) + res.creates.reduce((a, c) => a + c.minutes, 0);
    expect(placed + res.lostMinutes).toBe(overdue.reduce((a, t) => a + t.minutes, 0));
  });

  test('학습 기간이 가득 차면 총정리 기간 일부를 대체', () => {
    const reviewDates = plan.studyDates.filter((d) => d >= plan.reviewStartDate);
    const usage = {};
    plan.studyDates.forEach((d) => (usage[d] = 120)); // 모든 날 가득
    const reviewTasksByDate = {};
    reviewDates.forEach((d, i) => (reviewTasksByDate[d] = [{ id: `r${i}`, minutes: 120 }]));
    const overdue = [{ id: 'x', date: addDays(TODAY, -1), minutes: 60 }];
    const res = redistribute({ overdue, today: TODAY, studyDates: plan.studyDates, reviewStartDate: plan.reviewStartDate, capacity: 120, usage, reviewTasksByDate });
    expect(res.moves[0].date).toBe(reviewDates[0]);
    expect(res.reviewUpdates[0]).toEqual({ id: 'r0', minutes: 60 });
  });
});
