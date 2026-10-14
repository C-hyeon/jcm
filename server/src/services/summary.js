'use strict';

const { userRef, userCol, metaRef } = require('../lib/refs');
const { getSubjects } = require('./masters');
const { scoresFromStats } = require('./weakness');
const { subjectRate, remainingMinutes, round1 } = require('./progressCalc');
const { diffDays } = require('../lib/dates');

async function getLearningSummary(uid, { today, examType: examTypeArg, withPlan = false } = {}) {
  const userSnap = await userRef(uid).get();
  const user = userSnap.exists ? userSnap.data() : {};
  const profile = user.profile || null;
  const examType = examTypeArg || profile?.examType || 'written';

  const [subjects, progSnap, statsSnap, planSnap] = await Promise.all([
    getSubjects(examType),
    userCol(uid, 'progress').get(),
    metaRef(uid, 'wrongStats').get(),
    withPlan && user.activePlanId ? userCol(uid, 'plans').doc(user.activePlanId).get() : Promise.resolve(null),
  ]);

  const progress = {};
  progSnap.forEach((d) => (progress[d.id] = d.data()));
  const rateOf = (u) => (typeof progress[u.id]?.rate === 'number' ? progress[u.id].rate : profile?.subjectProgress?.[u.subjectId] ?? 0);

  const subjectsOut = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    order: s.order,
    tags: s.tags || [],
    rate: round1(subjectRate(s.units, rateOf)),
    remainingMinutes: Math.round(remainingMinutes(s.units, rateOf)),
    units: s.units.map((u) => ({
      id: u.id,
      name: u.name,
      standardHours: u.standardHours,
      core: !!u.core,
      rate: round1(rateOf(u)),
      needsReview: !!progress[u.id]?.needsReview,
      understanding: progress[u.id]?.understanding ?? null,
    })),
  }));
  const allUnits = subjects.flatMap((s) => s.units);
  const weak = scoresFromStats(statsSnap.exists ? statsSnap.data().tags : {}, today);
  const nameOf = (id) => subjects.find((s) => s.id === id)?.name || id;
  weak.rows.forEach((r) => (r.subjectName = nameOf(r.subjectId)));

  return {
    user,
    profile,
    examType,
    dday: profile?.examDate ? diffDays(today, profile.examDate) : null,
    subjects: subjectsOut,
    overall: round1(subjectRate(allUnits, rateOf)),
    remainingMinutes: Math.round(remainingMinutes(allUnits, rateOf)),
    weak,
    plan: planSnap?.exists ? { id: planSnap.id, ...planSnap.data() } : null,
  };
}

module.exports = { getLearningSummary };
