'use strict';
/**
 * UC-05 진도 / 취약 주제(벤치마킹: 정처랩) / 학습 경로(벤치마킹: EBS 단추) / UC-10 학습 현황 시각화
 */
const express = require('express');
const { FieldValue } = require('../config/firebase');
const { ah, HttpError } = require('../lib/httpError');
const { validate } = require('../middleware/common');
const { userRef, userCol, metaRef } = require('../lib/refs');
const { ProgressPutSchema, z } = require('../lib/schemas');
const { getLearningSummary } = require('../services/summary');
const { getUnitIndex, getMaterials, materialCard } = require('../services/masters');
const { adjustFutureTasksForUnit } = require('../services/planService');
const { expectedRate, round1 } = require('../services/progressCalc');
const { buildLearningPath, pickFocusSubject, STAGE_LABEL } = require('../services/materialLogic');
const { statsFromNotes } = require('../services/weakness');
const { addDays, weekStart } = require('../lib/dates');

const router = express.Router();
const pct = (v) => round1(v * 100);

/* ---------- 진도 ---------- */
router.get(
  '/progress',
  ah(async (req, res) => {
    const s = await getLearningSummary(req.user.uid, { today: req.today, withPlan: true });
    const expected = s.plan ? expectedRate(s.plan.baseOverallRate, s.plan.studyMinutes, req.today) : null;
    const gap = expected == null ? null : round1(s.overall - expected);
    res.json({
      examType: s.examType,
      overall: s.overall,
      remainingMinutes: s.remainingMinutes,
      expected: expected == null ? null : round1(expected),
      gap,
      // 스케줄과 진도 차이가 20%p 이상이면 재생성 제안
      suggestRegenerate: gap != null && Math.abs(gap) >= 20,
      subjects: s.subjects,
    });
  }),
);

// 진도 입력 = 선택 학습 결과 저장(명세 3.5: 별도 기능 없이 진도 입력 API로 반영)
router.put(
  '/progress',
  validate(ProgressPutSchema),
  ah(async (req, res) => {
    const uid = req.user.uid;
    const { unitId, rate, confirmDecrease } = req.valid;
    const entry = (await getUnitIndex()).get(unitId);
    if (!entry) throw new HttpError(400, 'VALIDATION_ERROR', '단원을 찾을 수 없습니다.');
    const [userSnap, progSnap] = await Promise.all([userRef(uid).get(), userCol(uid, 'progress').doc(unitId).get()]);
    const user = userSnap.data() || {};
    const old = typeof progSnap.data()?.rate === 'number' ? progSnap.data().rate : user.profile?.subjectProgress?.[entry.subject.id] ?? 0;
    if (rate < old && !confirmDecrease) {
      throw new HttpError(409, 'CONFIRM_DECREASE', `진도율을 ${round1(old)}%에서 ${rate}%로 낮춥니다. 계속할까요?`);
    }
    await userCol(uid, 'progress').doc(unitId).set(
      { rate, subjectId: entry.subject.id, updatedAt: FieldValue.serverTimestamp(), ...(rate === 100 ? { needsReview: false } : {}) },
      { merge: true },
    );
    let adjustment = { adjusted: 0, deleted: 0 };
    if (user.activePlanId) adjustment = await adjustFutureTasksForUnit(uid, user.activePlanId, unitId, old, rate, req.today);
    res.json({ unitId, rate, previous: round1(old), adjustment });
  }),
);

/* ---------- 취약 주제: 과목별 진도와 취약 항목을 연결 ---------- */
router.get(
  '/weakness',
  ah(async (req, res) => {
    const s = await getLearningSummary(req.user.uid, { today: req.today });
    const topTypes = s.weak.top3.map((r) => ({ subjectId: r.subjectId, subjectName: r.subjectName, typeTag: r.typeTag, score: pct(r.score), count: r.count }));
    const subjects = s.subjects.map((sub) => ({
      id: sub.id,
      name: sub.name,
      rate: sub.rate,
      weakShare: pct(s.weak.bySubject[sub.id] || 0),
      reviewUnits: sub.units.filter((u) => u.needsReview || u.understanding === 1).map((u) => ({ id: u.id, name: u.name, rate: u.rate })),
    }));
    // 다음에 무엇을 복습할지: 취약 유형 → 복습 필요 단원 → 취약 비중 높고 진도 낮은 과목
    const nextReview = [];
    topTypes.forEach((t) =>
      nextReview.push({ kind: 'type', subjectId: t.subjectId, label: `${t.subjectName} · ${t.typeTag}`, reason: `오답 취약도 ${t.score}% (${t.count}건)` }),
    );
    subjects.forEach((sub) =>
      sub.reviewUnits.forEach((u) => nextReview.push({ kind: 'unit', subjectId: sub.id, unitId: u.id, label: `${sub.name} · ${u.name}`, reason: '학습 기록에서 복습 필요로 표시' })),
    );
    const focus = pickFocusSubject(s.subjects, s.weak.bySubject);
    if (focus && !nextReview.some((n) => n.subjectId === focus.id)) {
      nextReview.push({ kind: 'subject', subjectId: focus.id, label: focus.name, reason: `진도율 ${focus.rate}%로 보강이 필요` });
    }
    res.json({
      topTypes,
      allTypes: s.weak.rows.slice(0, 10).map((r) => ({ subjectId: r.subjectId, subjectName: r.subjectName, typeTag: r.typeTag, score: pct(r.score), count: r.count })),
      subjects,
      nextReview: nextReview.slice(0, 5),
    });
  }),
);

// 집계 문서가 어긋났을 때 오답 원본으로 다시 계산
router.post(
  '/weakness/rebuild',
  ah(async (req, res) => {
    const snap = await userCol(req.user.uid, 'wrongNotes').get();
    const tags = statsFromNotes(snap.docs.map((d) => d.data()));
    await metaRef(req.user.uid, 'wrongStats').set({ tags });
    res.json({ ok: true, count: snap.size });
  }),
);

/* ---------- 학습 경로 ---------- */
router.get(
  '/learning-path',
  validate(z.object({ subjectId: z.string().max(60).optional() }), 'query'),
  ah(async (req, res) => {
    const s = await getLearningSummary(req.user.uid, { today: req.today });
    const subject = req.valid.subjectId ? s.subjects.find((x) => x.id === req.valid.subjectId) : pickFocusSubject(s.subjects, s.weak.bySubject);
    if (!subject) throw new HttpError(404, 'NOT_FOUND', '과목을 찾을 수 없습니다.');
    const materials = await getMaterials();
    const weakShare = pct(s.weak.bySubject[subject.id] || 0);
    const weakTypes = s.weak.rows.filter((r) => r.subjectId === subject.id).slice(0, 3).map((r) => r.typeTag);
    const focusUnits = subject.units
      .filter((u) => u.rate < 100 || u.needsReview)
      .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || a.rate - b.rate)
      .slice(0, 5);
    res.json({
      subjects: s.subjects.map((x) => ({ id: x.id, name: x.name, rate: x.rate, weakShare: pct(s.weak.bySubject[x.id] || 0) })),
      subject: { id: subject.id, name: subject.name, rate: subject.rate, weakShare },
      reason:
        weakShare > 0
          ? `오답 취약 비중 ${weakShare}%, 진도율 ${subject.rate}%인 과목입니다.${weakTypes.length ? ` 취약 유형: ${weakTypes.join(', ')}` : ''}`
          : `진도율 ${subject.rate}%로 보강이 필요한 과목입니다.`,
      focusUnits,
      steps: buildLearningPath(subject, materials).map((st) => ({
        ...st,
        materials: st.materials.map((m) => ({ ...materialCard(m), reason: m.reason, highlight: m.tags.some((t) => weakTypes.includes(t)) })),
      })),
      stageLabels: STAGE_LABEL,
    });
  }),
);

/* ---------- UC-10 대시보드 ---------- */
const statsCache = new Map();
router.get(
  '/stats',
  validate(z.object({ period: z.enum(['4w', 'all']).default('4w') }), 'query'),
  ah(async (req, res) => {
    const uid = req.user.uid;
    const { period } = req.valid;
    const key = `${uid}:${period}:${req.today}`;
    const hit = statsCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return res.json(hit.value);

    const s = await getLearningSummary(uid, { today: req.today, withPlan: true });
    // 스케줄을 만들기 전 주는 표시하지 않는다
    const planStart = s.plan?.createdDate ? weekStart(s.plan.createdDate) : null;
    let from = period === '4w' ? weekStart(addDays(req.today, -21)) : planStart || weekStart(addDays(req.today, -21));
    if (planStart && planStart > from) from = planStart;
    const snap = await userCol(uid, 'tasks').where('date', '>=', from).where('date', '<=', req.today).get();
    const tasks = snap.docs.map((d) => d.data());

    const weeks = [];
    for (let w = from; w <= req.today; w = addDays(w, 7)) weeks.push(w);
    const weekly = weeks.map((w) => {
      const inWeek = tasks.filter((t) => t.date >= w && t.date < addDays(w, 7));
      const done = inWeek.filter((t) => t.done).length;
      return { week: w, scheduled: inWeek.length, done, rate: inWeek.length ? round1((done / inWeek.length) * 100) : null };
    });

    // 잔여 학습량 추이: 활성 스케줄의 계획 대비 실제
    let remaining = [];
    if (s.plan) {
      const planTasks = tasks.filter((t) => t.planId === s.plan.id && t.type === 'study');
      const total = Object.values(s.plan.studyMinutes || {}).reduce((a, b) => a + b, 0);
      remaining = weeks.map((w) => {
        const end = addDays(w, 6) > req.today ? req.today : addDays(w, 6);
        const doneMin = planTasks.filter((t) => t.done && t.doneAt && t.doneAt <= end).reduce((a, t) => a + t.minutes, 0);
        const plannedMin = Object.entries(s.plan.studyMinutes || {}).filter(([d]) => d <= end).reduce((a, [, m]) => a + m, 0);
        return { week: w, actualHours: round1(Math.max(0, total - doneMin) / 60), plannedHours: round1(Math.max(0, total - plannedMin) / 60) };
      });
    }
    const value = {
      period,
      summary: {
        overall: s.overall,
        remainingHours: round1(s.remainingMinutes / 60),
        dday: s.dday,
        doneTasks: tasks.filter((t) => t.done).length,
        scheduledTasks: tasks.length,
      },
      subjects: s.subjects.map((x) => ({ id: x.id, name: x.name, rate: x.rate, remainingHours: round1(x.remainingMinutes / 60) })),
      weakness: s.weak.rows.slice(0, 8).map((r) => ({ label: `${r.typeTag}`, subjectName: r.subjectName, score: pct(r.score), count: r.count })),
      weekly,
      remaining,
      empty: !tasks.length && !s.weak.rows.length && s.overall === 0,
    };
    statsCache.set(key, { at: Date.now(), value });
    if (statsCache.size > 500) statsCache.clear();
    res.json(value);
  }),
);

module.exports = router;
