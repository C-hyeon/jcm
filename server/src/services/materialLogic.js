'use strict';
/**
 * 자료 선택·학습 경로·규칙 기반 추천 — 순수 로직
 * 추천 결과는 항상 허브에 등록된 자료 ID로만 구성된다.
 */
const STAGE_ORDER = ['intro', 'concept', 'practice', 'final'];
const STAGE_LABEL = { intro: '입문', concept: '개념 학습', practice: '문제 풀이', final: '총정리' };

const usable = (m) => m.visible !== false && m.linkStatus !== 'broken';
const stageDist = (a, b) => {
  const i = STAGE_ORDER.indexOf(a);
  const j = STAGE_ORDER.indexOf(b);
  return i < 0 || j < 0 ? 1 : Math.abs(i - j);
};

/** 오늘 할 일 카드에 붙일 자료 1~3개 */
function pickForTask(task, materials, userStage = 'concept', max = 3) {
  const scored = materials.filter(usable).map((m) => {
    let s = 0;
    if (task.unitId && m.unitIds?.includes(task.unitId)) s += 5;
    if (m.subjectId && m.subjectId === task.subjectId) s += 3;
    if (task.type === 'review' && (m.type === 'cbt' || m.type === 'official')) s += 3;
    if (task.type === 'study' && m.tags?.some((t) => task.tags?.includes(t))) s += 2;
    if (!m.subjectId && task.type === 'review' && m.type === 'cbt') s += 1;
    s -= stageDist(m.stage, task.type === 'review' ? 'final' : userStage) * 0.5;
    return [m, s];
  });
  return scored
    .filter(([, s]) => s >= 2.5)
    .sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title))
    .slice(0, max)
    .map(([m]) => m.id);
}

/** AI에 넘길 후보 자료(최대 20건): 취약 과목·진도 낮은 과목·기출 자료 우선 */
function selectCandidates({ materials, weakTop = [], subjects = [], max = 20 }) {
  const subjectIds = new Set(subjects.map((s) => s.id));
  const weakSubjects = new Map(weakTop.map((w, i) => [w.subjectId, 3 - i]));
  const weakTags = new Set(weakTop.map((w) => w.typeTag));
  const rateBySubject = new Map(subjects.map((s) => [s.id, s.rate]));
  return materials
    .filter(usable)
    .filter((m) => !m.subjectId || subjectIds.has(m.subjectId))
    .map((m) => {
      let s = 0;
      if (m.subjectId && weakSubjects.has(m.subjectId)) s += 2 + weakSubjects.get(m.subjectId);
      if (m.tags?.some((t) => weakTags.has(t))) s += 3;
      if (m.subjectId && rateBySubject.has(m.subjectId)) s += (100 - rateBySubject.get(m.subjectId)) / 25;
      if (m.type === 'cbt' || m.type === 'official') s += 1;
      return [m, s];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([m]) => m);
}

/**
 * 규칙 기반 대체 추천(UC-09 대안): 취약도 상위 유형 + 진도 낮은 과목의 자료
 * @param subjects [{id,name,rate,units:[{id,name,rate,needsReview,understanding}]}]
 */
function ruleBasedRecommend({ weakTop = [], subjects = [], materials = [] }) {
  const pool = materials.filter(usable);
  const used = new Set();
  const subjectName = (id) => subjects.find((s) => s.id === id)?.name || '';
  const take = (pred, n = 2) => {
    const out = pool.filter((m) => !used.has(m.id) && pred(m)).slice(0, n);
    out.forEach((m) => used.add(m.id));
    return out.map((m) => m.id);
  };
  const forSubject = (sid, tag, stages) =>
    take((m) => m.subjectId === sid && (!tag || m.tags?.includes(tag)) && (!stages || stages.includes(m.stage))).concat();
  const topics = [];
  const pct = (v) => `${Math.round(v * 100)}%`;

  // 1) 가장 취약한 유형
  weakTop.slice(0, 2).forEach((w) => {
    if (topics.length >= 3) return;
    let ids = forSubject(w.subjectId, w.typeTag);
    if (!ids.length) ids = forSubject(w.subjectId, null, ['practice', 'concept']);
    topics.push({
      title: `${w.typeTag} 유형 집중 복습`,
      reason: `오답 기록에서 '${w.typeTag}' 유형의 취약도가 ${pct(w.score)}로 높습니다. 개념을 다시 보고 같은 유형 문제를 풀어 보세요.`,
      subjectId: w.subjectId,
      materialIds: ids,
    });
  });

  // 2) 복습 필요로 표시한 단원
  const reviewUnit = subjects.flatMap((s) => s.units.filter((u) => u.needsReview || u.understanding === 1).map((u) => ({ s, u })))[0];
  if (reviewUnit && topics.length < 3) {
    topics.push({
      title: `${reviewUnit.u.name} 다시 보기`,
      reason: `학습 기록에서 '${reviewUnit.u.name}' 단원을 복습 필요로 표시했습니다.`,
      subjectId: reviewUnit.s.id,
      materialIds: take((m) => m.unitIds?.includes(reviewUnit.u.id)).concat(forSubject(reviewUnit.s.id, null, ['concept'])).slice(0, 2),
    });
  }

  // 3) 진도가 가장 낮은 과목의 다음 단원
  const lowest = subjects.slice().sort((a, b) => a.rate - b.rate)[0];
  if (lowest && topics.length < 3) {
    const nextUnit = lowest.units.slice().sort((a, b) => a.rate - b.rate)[0];
    topics.push({
      title: `${lowest.name}${nextUnit ? ` · ${nextUnit.name}` : ''} 진도 올리기`,
      reason: `${lowest.name} 과목 진도율이 ${Math.round(lowest.rate)}%로 가장 낮습니다.`,
      subjectId: lowest.id,
      materialIds: (nextUnit ? take((m) => m.unitIds?.includes(nextUnit.id)) : []).concat(forSubject(lowest.id, null, ['intro', 'concept'])).slice(0, 2),
    });
  }

  // 4) 공개 기출·CBT 회독
  if (topics.length < 3) {
    const sid = weakTop[0]?.subjectId || lowest?.id || null;
    topics.push({
      title: '공개 기출 회독',
      reason: `${sid ? `${subjectName(sid)} 중심으로 ` : ''}공개된 기출을 풀어 실전 감각을 점검해 보세요.`,
      subjectId: sid,
      materialIds: take((m) => m.type === 'cbt' || m.type === 'official', 2),
    });
  }
  return { topics: topics.slice(0, 3) };
}

/** 학습 경로(벤치마킹: EBS 단추) — 취약 과목의 자료를 학습 단계 순서로 안내 */
function buildLearningPath(subject, materials) {
  const list = materials.filter(usable).filter((m) => m.subjectId === subject.id || (!m.subjectId && m.type === 'cbt'));
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    materials: list.filter((m) => m.stage === stage).sort((a, b) => a.title.localeCompare(b.title)),
  }))
    .filter((s) => s.materials.length)
    .map((s, i) => ({ step: i + 1, ...s }));
}

/** 학습 경로 기본 과목: 취약 비중·낮은 진도를 함께 고려 */
function pickFocusSubject(subjects, weakBySubject = {}) {
  return subjects
    .map((s) => ({ s, score: (weakBySubject[s.id] || 0) * 60 + (100 - s.rate) * 0.4 }))
    .sort((a, b) => b.score - a.score)[0]?.s;
}

module.exports = { STAGE_ORDER, STAGE_LABEL, pickForTask, selectCandidates, ruleBasedRecommend, buildLearningPath, pickFocusSubject };
