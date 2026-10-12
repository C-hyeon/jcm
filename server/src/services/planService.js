'use strict';
/**
 * 스케줄 생성·재생성·재배분·조정 (UC-03, UC-04, UC-05 대안) — Firestore 연동부
 */
const { db, FieldValue } = require('../config/firebase');
const { userRef, userCol, metaRef, commitInChunks } = require('../lib/refs');
const { HttpError } = require('../lib/httpError');
const { getSubjects, getMaterials } = require('./masters');
const { buildPlan, redistribute, listStudyDates, floorStep, MIN_CHUNK } = require('./scheduler');
const { scoresFromStats } = require('./weakness');
const { pickForTask } = require('./materialLogic');
const { subjectRate } = require('./progressCalc');
const { dayOfWeek } = require('../lib/dates');

/** buildPlan 결과의 과제를 저장용 레코드로 */
function taskRecord(t, planId, materials, stage) {
  return {
    planId,
    date: t.date,
    type: t.type,
    subjectId: t.subjectId,
    subjectName: t.subjectName,
    unitId: t.unitId || null,
    unitName: t.unitName || null,
    title: t.title,
    minutes: t.minutes,
    unitPlanMinutes: t.unitPlanMinutes ?? null,
    baseRate: t.baseRate ?? null,
    checklist: t.checklist,
    materialIds: pickForTask(t, materials, stage),
    done: false,
    doneAt: null,
    actualMinutes: null,
    understanding: null,
    needsReview: false,
    carriedOver: false,
  };
}

function addTo(map, key, v) {
  map[key] = (map[key] || 0) + v;
  if (map[key] <= 0) delete map[key];
}

/** 비회원 미리보기 / 회원 생성 공통 계산 */
async function computePlan({ profile, today, unitRates = {}, weakShareBySubject = {} }) {
  const [subjects, materials] = await Promise.all([getSubjects(profile.examType), getMaterials()]);
  if (!subjects.length) throw new HttpError(500, 'MASTER_MISSING', '과목 마스터 데이터가 없습니다. 관리자에게 문의해 주세요.');
  const result = buildPlan({
    today,
    examDate: profile.examDate,
    dailyHours: profile.dailyHours,
    studyDays: profile.studyDays,
    subjects,
    unitRates,
    subjectProgress: profile.subjectProgress,
    subjectConfidence: profile.subjectConfidence,
    weakShareBySubject,
  });
  if (result.error) {
    throw new HttpError(400, 'NO_STUDY_DAYS', '시험일 전까지 선택한 학습 요일이 없습니다. 학습 요일을 다시 선택해 주세요.');
  }
  const rateOf = (u) => (typeof unitRates[u.id] === 'number' ? unitRates[u.id] : profile.subjectProgress?.[u.subjectId] ?? 0);
  const baseOverallRate = Math.round(subjectRate(subjects.flatMap((s) => s.units), rateOf) * 10) / 10;
  return { result, subjects, materials, baseOverallRate };
}

/** 회원 스케줄 생성/재생성. 기존 스케줄이 있으면 오늘 이후 미완료 과제만 교체 */
async function generatePlan(uid, { today, confirmOverwrite = false }) {
  const userSnap = await userRef(uid).get();
  const user = userSnap.exists ? userSnap.data() : {};
  const profile = user.profile;
  if (!profile) throw new HttpError(400, 'PROFILE_REQUIRED', '먼저 시험 정보와 학습 조건을 입력해 주세요.');
  if (profile.examDate <= today) throw new HttpError(400, 'EXAM_PASSED', '시험일이 지났습니다. 다음 회차 시험 정보를 입력해 주세요.');
  if (user.activePlanId && !confirmOverwrite) {
    throw new HttpError(409, 'PLAN_EXISTS', '이미 만든 스케줄이 있습니다. 오늘 이후 일정을 새로 만들까요? (완료한 과제는 유지됩니다)');
  }

  const [progSnap, statsSnap] = await Promise.all([userCol(uid, 'progress').get(), metaRef(uid, 'wrongStats').get()]);
  const unitRates = {};
  progSnap.forEach((d) => {
    if (typeof d.data().rate === 'number') unitRates[d.id] = d.data().rate;
  });
  const weak = scoresFromStats(statsSnap.exists ? statsSnap.data().tags : {}, today);
  const { result, materials, baseOverallRate } = await computePlan({ profile, today, unitRates, weakShareBySubject: weak.bySubject });

  const ops = [];
  if (user.activePlanId) {
    const oldRef = userCol(uid, 'plans').doc(user.activePlanId);
    const old = await userCol(uid, 'tasks').where('planId', '==', user.activePlanId).where('date', '>=', today).get();
    old.docs.filter((d) => !d.data().done).forEach((d) => ops.push((b) => b.delete(d.ref)));
    ops.push((b) => b.update(oldRef, { status: 'archived', archivedAt: FieldValue.serverTimestamp() }));
  }

  const planRef = userCol(uid, 'plans').doc();
  const usage = {};
  const studyMinutes = {};
  result.tasks.forEach((t) => {
    addTo(usage, t.date, t.minutes);
    if (t.type === 'study') addTo(studyMinutes, t.date, t.minutes);
  });
  const plan = {
    createdDate: today,
    examType: profile.examType,
    examDate: profile.examDate,
    capacityMinutes: result.capacity,
    studyDays: profile.studyDays,
    totalHours: result.stats.totalHours,
    reviewStartDate: result.reviewStartDate,
    status: 'active',
    usage,
    studyMinutes,
    baseOverallRate,
    warnings: result.warnings,
    stats: result.stats,
    redistributedOn: today,
  };
  ops.push((b) => b.set(planRef, { ...plan, createdAt: FieldValue.serverTimestamp() }));
  result.tasks.forEach((t) => {
    const ref = userCol(uid, 'tasks').doc();
    ops.push((b) => b.set(ref, { ...taskRecord(t, planRef.id, materials, profile.stage), createdAt: FieldValue.serverTimestamp() }));
  });
  ops.push((b) => b.set(userRef(uid), { activePlanId: planRef.id }, { merge: true }));
  await commitInChunks(ops);

  return { planId: planRef.id, plan, taskCount: result.tasks.length };
}

/** 하루 한 번만 재배분하도록 날짜 잠금 */
async function claimRedistribution(planRef, today) {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    if (!snap.exists || snap.data().redistributedOn === today) return false;
    tx.update(planRef, { redistributedOn: today });
    return true;
  });
}

/** 전날까지의 미완료 과제를 남은 학습일에 재배분 (UC-04 ⑤) */
async function redistributeOverdue(uid, planId, plan, today) {
  const tasksCol = userCol(uid, 'tasks');
  const overdueSnap = await tasksCol.where('planId', '==', planId).where('done', '==', false).where('date', '<', today).get();
  if (overdueSnap.empty) return null;

  const overdue = overdueSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const study = overdue.filter((t) => t.type === 'study');
  const pastReview = overdue.filter((t) => t.type === 'review');
  const studyDates = listStudyDates(today, plan.examDate, plan.studyDays);

  const reviewTasksByDate = {};
  if (study.length && plan.reviewStartDate) {
    const rs = await tasksCol.where('planId', '==', planId).where('type', '==', 'review').where('date', '>=', today).get();
    rs.docs
      .filter((d) => !d.data().done)
      .forEach((d) => (reviewTasksByDate[d.data().date] ||= []).push({ id: d.id, minutes: d.data().minutes }));
  }

  const usage = { ...(plan.usage || {}) };
  const studyMinutes = { ...(plan.studyMinutes || {}) };
  overdue.forEach((t) => {
    addTo(usage, t.date, -t.minutes);
    if (t.type === 'study') addTo(studyMinutes, t.date, -t.minutes);
  });

  const res = redistribute({
    overdue: study,
    today,
    studyDates,
    reviewStartDate: plan.reviewStartDate,
    capacity: plan.capacityMinutes,
    usage,
    reviewTasksByDate,
  });

  const byId = new Map(study.map((t) => [t.id, t]));
  const ops = [];
  res.moves.forEach((mv) => {
    const t = byId.get(mv.id);
    ops.push((b) => b.update(t.ref, { date: mv.date, minutes: mv.minutes, carriedOver: true, originalDate: t.originalDate || t.date }));
    addTo(studyMinutes, mv.date, mv.minutes);
  });
  res.creates.forEach((c) => {
    const t = byId.get(c.fromId);
    const { id: _id, ref: _ref, ...rest } = t;
    const ref = tasksCol.doc();
    ops.push((b) => b.set(ref, { ...rest, date: c.date, minutes: c.minutes, carriedOver: true, originalDate: t.originalDate || t.date, createdAt: FieldValue.serverTimestamp() }));
    addTo(studyMinutes, c.date, c.minutes);
  });
  res.reviewUpdates.forEach((r) => ops.push((b) => b.update(tasksCol.doc(r.id), { minutes: r.minutes })));
  res.reviewDeletes.forEach((id) => ops.push((b) => b.delete(tasksCol.doc(id))));
  // 지난 총정리 과제는 남은 총정리 일정에 통합(삭제)
  pastReview.forEach((t) => ops.push((b) => b.delete(t.ref)));
  // 재배분 결과의 usage에는 재배분 대상이 아닌 과거 날짜 값도 그대로 들어 있다
  ops.push((b) => b.update(userCol(uid, 'plans').doc(planId), { usage: res.usage, studyMinutes }));
  await commitInChunks(ops);

  return {
    movedCount: res.moves.length,
    splitCount: res.creates.length,
    mergedReviewCount: pastReview.length,
    replacedReviewCount: res.reviewUpdates.length + res.reviewDeletes.length,
    unplacedCount: res.unplaced.length,
  };
}

/**
 * 진도 화면에서 단원 진도를 올렸을 때 오늘 이후 해당 단원 과제를 줄이거나 삭제(UC-03 대안: 선행 학습 반영)
 */
async function adjustFutureTasksForUnit(uid, planId, unitId, oldRate, newRate, today) {
  if (newRate <= oldRate) return { adjusted: 0, deleted: 0 };
  const planRef = userCol(uid, 'plans').doc(planId);
  const [planSnap, snap] = await Promise.all([
    planRef.get(),
    userCol(uid, 'tasks').where('planId', '==', planId).where('unitId', '==', unitId).where('date', '>=', today).get(),
  ]);
  if (!planSnap.exists) return { adjusted: 0, deleted: 0 };
  const plan = planSnap.data();
  const usage = { ...(plan.usage || {}) };
  const studyMinutes = { ...(plan.studyMinutes || {}) };
  const factor = oldRate >= 100 ? 0 : (100 - newRate) / (100 - oldRate);
  let adjusted = 0;
  let deleted = 0;
  const ops = [];
  snap.docs
    .filter((d) => !d.data().done)
    .forEach((d) => {
      const t = d.data();
      const next = floorStep(t.minutes * factor);
      const diff = t.minutes - (next < MIN_CHUNK ? 0 : next);
      addTo(usage, t.date, -diff);
      addTo(studyMinutes, t.date, -diff);
      if (next < MIN_CHUNK) {
        ops.push((b) => b.delete(d.ref));
        deleted++;
      } else if (next !== t.minutes) {
        ops.push((b) => b.update(d.ref, { minutes: next }));
        adjusted++;
      }
    });
  if (ops.length) {
    ops.push((b) => b.update(planRef, { usage, studyMinutes }));
    await commitInChunks(ops);
  }
  return { adjusted, deleted };
}

function nextStudyDate(plan, today) {
  return listStudyDates(today, plan.examDate, plan.studyDays).find((d) => d > today) || null;
}
function isStudyDay(plan, today) {
  return plan.studyDays.includes(dayOfWeek(today));
}

module.exports = { computePlan, generatePlan, claimRedistribution, redistributeOverdue, adjustFutureTasksForUnit, nextStudyDate, isStudyDay, taskRecord };
