'use strict';
// UC-02 시험 정보·학습 조건 / UC-03 스케줄 / UC-04 오늘 할 일·완료 체크·학습 기록
const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { ah, HttpError } = require('../lib/httpError');
const { validate } = require('../middleware/common');
const { userRef, userCol } = require('../lib/refs');
const { StudyProfileSchema, TaskPatchSchema, z } = require('../lib/schemas');
const { getExams, getMaterialMap, materialCard } = require('../services/masters');
const { generatePlan, claimRedistribution, redistributeOverdue, nextStudyDate, isStudyDay } = require('../services/planService');
const { completionDelta, clampRate } = require('../services/progressCalc');
const { diffDays, isValidDate } = require('../lib/dates');

const router = express.Router();

router.get(
  '/study-profile',
  ah(async (req, res) => {
    const snap = await userRef(req.user.uid).get();
    const profile = snap.data()?.profile || null;
    res.json({ profile, dday: profile ? diffDays(req.today, profile.examDate) : null });
  }),
);

router.put(
  '/study-profile',
  validate(StudyProfileSchema),
  ah(async (req, res) => {
    const profile = { ...req.valid };
    if (profile.examId) {
      const exam = (await getExams()).find((e) => e.id === profile.examId);
      if (!exam) throw new HttpError(400, 'VALIDATION_ERROR', '선택한 시험 회차를 찾을 수 없습니다. 시험일을 직접 입력해 주세요.');
      if (exam.type !== profile.examType) throw new HttpError(400, 'VALIDATION_ERROR', '시험 구분과 회차가 맞지 않습니다.');
      profile.examDate = exam.examDate;
    }
    if (profile.examDate <= req.today) {
      throw new HttpError(400, 'EXAM_DATE_PAST', '시험일은 내일 이후 날짜여야 합니다. 다음 회차를 선택하거나 날짜를 다시 입력해 주세요.');
    }
    const dday = diffDays(req.today, profile.examDate);
    await userRef(req.user.uid).set(
      { profile: { ...profile, updatedAt: new Date().toISOString() }, targetExamId: profile.examId || null },
      { merge: true },
    );
    const notices = dday < 7 ? [{ code: 'SHORT_PERIOD', message: `시험까지 ${dday}일 남았습니다. 총정리 모드로 스케줄을 만드는 것을 권장합니다.` }] : [];
    res.json({ profile, dday, notices });
  }),
);

router.post(
  '/plans',
  validate(z.object({ confirmOverwrite: z.boolean().optional() })),
  ah(async (req, res) => {
    const out = await generatePlan(req.user.uid, { today: req.today, confirmOverwrite: !!req.valid.confirmOverwrite });
    res.status(201).json({ planId: out.planId, taskCount: out.taskCount, plan: planView(out.plan, req.today) });
  }),
);

function planView(p, today) {
  return {
    examType: p.examType,
    examDate: p.examDate,
    dday: diffDays(today, p.examDate),
    capacityMinutes: p.capacityMinutes,
    studyDays: p.studyDays,
    totalHours: p.totalHours,
    reviewStartDate: p.reviewStartDate,
    createdDate: p.createdDate,
    warnings: p.warnings || [],
    stats: p.stats || null,
  };
}

router.get(
  '/plans/current',
  ah(async (req, res) => {
    const user = (await userRef(req.user.uid).get()).data() || {};
    if (!user.activePlanId) return res.json({ plan: null, hasProfile: !!user.profile });
    const snap = await userCol(req.user.uid, 'plans').doc(user.activePlanId).get();
    res.json({ plan: snap.exists ? { id: snap.id, ...planView(snap.data(), req.today) } : null, hasProfile: !!user.profile });
  }),
);

function taskView(id, t, matMap) {
  return {
    id,
    date: t.date,
    type: t.type,
    subjectId: t.subjectId,
    subjectName: t.subjectName,
    unitId: t.unitId,
    unitName: t.unitName,
    title: t.title,
    minutes: t.minutes,
    checklist: t.checklist || [],
    done: !!t.done,
    actualMinutes: t.actualMinutes ?? null,
    understanding: t.understanding ?? null,
    needsReview: !!t.needsReview,
    carriedOver: !!t.carriedOver,
    originalDate: t.originalDate || null,
    materials: (t.materialIds || []).map((mid) => materialCard(matMap.get(mid))).filter(Boolean),
  };
}

router.get(
  '/plans/tasks',
  validate(z.object({ from: z.string().refine(isValidDate), to: z.string().refine(isValidDate) }), 'query'),
  ah(async (req, res) => {
    const { from, to } = req.valid;
    if (from > to || diffDays(from, to) > 62) throw new HttpError(400, 'VALIDATION_ERROR', '조회 기간은 최대 62일입니다.');
    const user = (await userRef(req.user.uid).get()).data() || {};
    if (!user.activePlanId) return res.json({ items: [] });
    const [snap, matMap] = await Promise.all([
      userCol(req.user.uid, 'tasks').where('planId', '==', user.activePlanId).where('date', '>=', from).where('date', '<=', to).get(),
      getMaterialMap(),
    ]);
    const items = snap.docs.map((d) => taskView(d.id, d.data(), matMap)).sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) * -1);
    res.json({ items });
  }),
);

router.get(
  '/today',
  ah(async (req, res) => {
    const uid = req.user.uid;
    const today = req.today;
    const user = (await userRef(uid).get()).data() || {};
    const profile = user.profile;
    if (!profile) return res.json({ today, needsOnboarding: true });
    const exam = { type: profile.examType, date: profile.examDate, dday: diffDays(today, profile.examDate) };
    if (!user.activePlanId) return res.json({ today, needsPlan: true, exam });

    const planRef = userCol(uid, 'plans').doc(user.activePlanId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) return res.json({ today, needsPlan: true, exam });
    const plan = planSnap.data();

    let redistribution = null;
    if (plan.redistributedOn !== today && (await claimRedistribution(planRef, today))) {
      redistribution = await redistributeOverdue(uid, user.activePlanId, plan, today);
    }

    const [snap, matMap] = await Promise.all([
      userCol(uid, 'tasks').where('planId', '==', user.activePlanId).where('date', '==', today).get(),
      getMaterialMap(),
    ]);
    const tasks = snap.docs.map((d) => taskView(d.id, d.data(), matMap)).sort((a, b) => (a.type === b.type ? 0 : a.type === 'study' ? -1 : 1));
    res.json({
      today,
      exam,
      isStudyDay: isStudyDay(plan, today),
      nextStudyDate: nextStudyDate(plan, today),
      inReviewPeriod: !!plan.reviewStartDate && today >= plan.reviewStartDate,
      capacityMinutes: plan.capacityMinutes,
      tasks,
      redistribution,
    });
  }),
);

// 완료 체크 + 학습 기록
router.patch(
  '/tasks/:id',
  validate(TaskPatchSchema),
  ah(async (req, res) => {
    const uid = req.user.uid;
    const body = req.valid;
    const taskRef = userCol(uid, 'tasks').doc(req.params.id);

    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(taskRef);
      if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', '과제를 찾을 수 없습니다.');
      const t = snap.data();
      if (t.date < req.today) throw new HttpError(400, 'PAST_TASK', '지난 날짜의 과제는 수정할 수 없습니다. 미완료 과제는 다음 접속 시 자동으로 재배분됩니다.');

      const progRef = t.unitId ? userCol(uid, 'progress').doc(t.unitId) : null;
      const progSnap = progRef ? await tx.get(progRef) : null;

      const update = {};
      if (body.checklist) update.checklist = body.checklist;
      if (body.actualMinutes !== undefined) update.actualMinutes = body.actualMinutes;
      if (body.understanding !== undefined) update.understanding = body.understanding;
      if (body.needsReview !== undefined) update.needsReview = body.needsReview;

      let progressUpdate = null;
      if (body.done !== undefined && body.done !== !!t.done) {
        update.done = body.done;
        update.doneAt = body.done ? req.today : null;
        if (progRef) {
          const prev = typeof progSnap.data()?.rate === 'number' ? progSnap.data().rate : t.baseRate ?? 0;
          const delta = completionDelta(t.baseRate, t.minutes, t.unitPlanMinutes);
          progressUpdate = { rate: clampRate(prev + (body.done ? delta : -delta)) };
        }
      }
      if (progRef && (body.understanding !== undefined || body.needsReview !== undefined)) {
        progressUpdate = progressUpdate || {};
        if (body.understanding !== undefined) progressUpdate.understanding = body.understanding;
        const needsReview = body.needsReview !== undefined ? body.needsReview : body.understanding === 1 ? true : undefined;
        if (needsReview !== undefined) progressUpdate.needsReview = needsReview;
      }

      tx.update(taskRef, { ...update, updatedAt: FieldValue.serverTimestamp() });
      if (progressUpdate) {
        tx.set(progRef, { ...progressUpdate, subjectId: t.subjectId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return { task: { ...t, ...update }, progress: progressUpdate };
    });

    const matMap = await getMaterialMap();
    res.json({ task: taskView(req.params.id, result.task, matMap), progress: result.progress });
  }),
);

module.exports = router;
