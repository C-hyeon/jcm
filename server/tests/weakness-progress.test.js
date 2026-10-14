'use strict';
const { scoresFromNotes, noteWeight, statsFromNotes, scoresFromStats } = require('../src/services/weakness');
const { subjectRate, completionDelta, clampRate, expectedRate } = require('../src/services/progressCalc');
const { ruleBasedRecommend, selectCandidates, pickForTask, buildLearningPath } = require('../src/services/materialLogic');
const { addDays } = require('../src/lib/dates');
const { subjects, materials } = require('./helpers');

const TODAY = '2026-10-12';

function makeNotes() {
  const spec = [
    ['w3', 'SQL', 0, false], ['w3', 'SQL', 1, false], ['w3', 'SQL', 3, false], ['w3', 'SQL', 20, false], ['w3', 'SQL', 30, true],
    ['w3', '정규화', 2, false], ['w3', '정규화', 40, false], ['w3', '정규화', 5, true],
    ['w4', '코드 실행 결과', 0, false], ['w4', '코드 실행 결과', 4, false], ['w4', '코드 실행 결과', 13, false], ['w4', '코드 실행 결과', 14, false],
    ['w4', 'C언어', 50, false], ['w4', 'C언어', 1, true],
    ['w1', '디자인 패턴', 6, false], ['w1', '디자인 패턴', 60, true], ['w1', 'UML', 2, false],
    ['w5', '서비스 공격', 25, false], ['w5', '보안 취약점', 3, false], ['w2', '테스트 기법', 9, true],
  ];
  return spec.map(([subjectId, typeTag, ago, reviewed]) => ({ subjectId, typeTag, createdDate: addDays(TODAY, -ago), reviewed }));
}

describe('UC-06 취약도 계산', () => {
  const notes = makeNotes();

  test('가중치 r: 최근 14일 1.5 / 그 외 1.0 / 복습 완료 0.5', () => {
    expect(noteWeight({ reviewed: false, createdDate: addDays(TODAY, -13) }, TODAY)).toBe(1.5);
    expect(noteWeight({ reviewed: false, createdDate: addDays(TODAY, -14) }, TODAY)).toBe(1.0);
    expect(noteWeight({ reviewed: true, createdDate: TODAY }, TODAY)).toBe(0.5);
  });

  test('상위 3개 취약 유형이 수작업 계산과 일치', () => {
    // 수작업: 전체 합
    const total = notes.reduce((a, n) => a + noteWeight(n, TODAY), 0);
    const manual = {};
    notes.forEach((n) => (manual[`${n.subjectId}|${n.typeTag}`] = (manual[`${n.subjectId}|${n.typeTag}`] || 0) + noteWeight(n, TODAY)));
    const manualTop = Object.entries(manual).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => [k, v / total]);

    const { top3 } = scoresFromNotes(notes, TODAY);
    expect(top3.map((r) => r.key)).toEqual(manualTop.map(([k]) => k));
    top3.forEach((r, i) => expect(r.score).toBeCloseTo(manualTop[i][1], 10));
    // SQL: 1.5×3 + 1.0 + 0.5 = 6.0 / 코드 실행 결과: 1.5×3 + 1.0 = 5.5
    expect(top3[0].key).toBe('w3|SQL');
    expect(top3[1].key).toBe('w4|코드 실행 결과');
  });

  test('누적 집계(wrongStats)와 원본 계산 결과가 같다', () => {
    const a = scoresFromStats(statsFromNotes(notes), TODAY);
    const b = scoresFromNotes(notes, TODAY);
    expect(a.rows).toEqual(b.rows);
  });
});

describe('UC-05 진도율', () => {
  test('과목 진도율은 표준시간 가중 평균, 소수 첫째 자리 오차 0', () => {
    const units = [
      { id: 'a', standardHours: 6 },
      { id: 'b', standardHours: 2 },
    ];
    const rates = { a: 50, b: 25 };
    expect(Math.round(subjectRate(units, (u) => rates[u.id]) * 10) / 10).toBe(43.8); // (300+50)/8
  });
  test('과제 완료 증가분: 3분할 단원을 모두 끝내면 100%', () => {
    let rate = 0;
    [40, 40, 40].forEach((m) => (rate = clampRate(rate + completionDelta(0, m, 120))));
    expect(rate).toBe(100);
  });
  test('스케줄 기대 진도율', () => {
    expect(expectedRate(0, { '2026-10-10': 60, '2026-10-11': 60, '2026-10-12': 120 }, TODAY)).toBe(50);
  });
});

describe('UC-09 규칙 기반 대체 추천', () => {
  const subs = subjects('written').map((s) => ({ ...s, rate: s.id === 'w5' ? 10 : 60, units: s.units.map((u) => ({ ...u, rate: 50, needsReview: u.id === 'w1-u3' })) }));
  const weak = scoresFromNotes(makeNotes(), TODAY).top3;
  const mats = materials();

  test('추천 주제 3개, 자료는 모두 허브 등록 자료', () => {
    const { topics } = ruleBasedRecommend({ weakTop: weak, subjects: subs, materials: mats });
    expect(topics).toHaveLength(3);
    const ids = new Set(mats.map((m) => m.id));
    topics.flatMap((t) => t.materialIds).forEach((id) => expect(ids.has(id)).toBe(true));
    expect(topics[0].title).toContain(weak[0].typeTag); // 취약 유형 반영
  });
  test('후보 자료는 최대 20건, 숨김·깨진 링크 제외', () => {
    const broken = mats.map((m, i) => (i === 0 ? { ...m, linkStatus: 'broken' } : m));
    const c = selectCandidates({ materials: broken, weakTop: weak, subjects: subs });
    expect(c.length).toBeLessThanOrEqual(20);
    expect(c.find((m) => m.id === broken[0].id)).toBeUndefined();
  });
  test('과제 자료 연결: SQL 단원에는 SQL 자료', () => {
    const ids = pickForTask({ type: 'study', unitId: 'w3-u1', subjectId: 'w3', tags: ['SQL'] }, mats, 'concept');
    expect(ids).toContain('w3schools-sql');
    expect(ids.length).toBeLessThanOrEqual(3);
  });
  test('학습 경로는 학습 단계 순서', () => {
    const steps = buildLearningPath({ id: 'p10' }, mats);
    expect(steps.map((s) => s.step)).toEqual(steps.map((_, i) => i + 1));
    const stageIdx = steps.map((s) => ['intro', 'concept', 'practice', 'final'].indexOf(s.stage));
    expect(stageIdx).toEqual([...stageIdx].sort((a, b) => a - b));
  });
});
