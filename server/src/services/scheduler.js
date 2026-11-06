'use strict';
// 학습 스케줄 생성·재배분 (UC-03, UC-04)
const { addDays, dayOfWeek, diffDays } = require('../lib/dates');

const REVIEW_RATIO = 0.15; // 기본(개념 학습 단계) 총정리 비율
const MIN_CHUNK = 10; // 과제 최소 단위(분)
const STEP = 5; // 분 단위 반올림
const SLACK_MAX = 1.3; // 시간이 남을 때 단원별 최대 여유 배율(나머지는 재배분용 버퍼)
const SHORTAGE_RATIO = 0.6;
const MIN_PREP_DAYS = 30; // 시험일 입력 시 최소 준비 기간(일)
const HOUR_STEP_MIN = 30; // 하루 학습 시간 입력 단위(분)
const MAX_DAILY_MIN = 12 * 60; // 하루 학습 시간 상한(분)

// 현재 학습 단계별 배분 방식
// - reviewRatio: 학습일 중 마지막 총정리·기출 회독 기간 비율
// - studyFactor: 단원별 필요 학습량 배율 (입문은 처음 보는 내용이라 더, 문제 풀이·총정리는 개념을 이미 봤으므로 덜)
// - corePriority: 시간이 빠듯(60~100%)할 때부터 핵심 단원을 우선 배분하고 핵심 단원을 앞에 배치
const STAGE_PLAN = {
  intro: {
    label: '입문',
    reviewRatio: 0.1,
    studyFactor: 1.2,
    corePriority: false,
    note: '처음 보는 내용이 많아 단원별 개념 학습 시간을 20% 늘리고',
    checklist: (t) => [`${t.unitName} 기본 용어·개념 훑어보기`, `${t.unitName} 핵심 개념 정리`],
  },
  concept: {
    label: '개념 학습',
    reviewRatio: REVIEW_RATIO,
    studyFactor: 1,
    corePriority: false,
    note: '단원별 개념 학습을 순서대로 배치하고',
    checklist: (t) => [`${t.unitName} 핵심 개념 정리`],
  },
  practice: {
    label: '문제 풀이',
    reviewRatio: 0.25,
    studyFactor: 0.8,
    corePriority: false,
    note: '개념을 이미 본 상태라 단원 학습 시간을 20% 줄이고',
    checklist: (t) => [`${t.unitName} 기출·예상 문제 풀이`, '틀린 문제 개념 다시 보기'],
  },
  final: {
    label: '총정리',
    reviewRatio: 0.4,
    studyFactor: 0.6,
    corePriority: true,
    note: '핵심 단원 위주로 요약 회독 시간을 잡고',
    checklist: (t) => [`${t.unitName} 핵심 요약 회독`, '오답노트 유형 다시 풀기'],
  },
};
const stagePlan = (stage) => STAGE_PLAN[stage] || STAGE_PLAN.concept;
const normalizeStage = (stage) => (STAGE_PLAN[stage] ? stage : 'concept');

// 학습일 중 마지막 총정리 기간 일수 (학습 단계별 비율)
function reviewDayCount(dateCount, stage) {
  return dateCount >= 3 ? Math.ceil(dateCount * stagePlan(stage).reviewRatio) : 0;
}

// 하루 필요 분 → 30분 단위로 올린 권장 시간(시간). 12시간을 넘으면 null
function roundUpHours(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const rounded = Math.max(HOUR_STEP_MIN, Math.ceil(minutes / HOUR_STEP_MIN) * HOUR_STEP_MIN);
  return rounded > MAX_DAILY_MIN ? null : rounded / 60;
}

const sum = (arr, f = (x) => x) => arr.reduce((acc, x) => acc + f(x), 0);
const floorStep = (v) => Math.floor(v / STEP) * STEP;
const round1 = (v) => Math.round(v * 10) / 10;

function listStudyDates(from, examDate, studyDays) {
  const days = new Set(studyDays);
  const last = addDays(examDate, -1);
  const out = [];
  for (let d = from; d <= last; d = addDays(d, 1)) if (days.has(dayOfWeek(d))) out.push(d);
  return out;
}

// 취약 가중치 w (1.0~1.5)
function subjectWeight(confidence, weakShare = 0) {
  const bonus = confidence === 1 ? 0.3 : confidence === 2 ? 0.1 : 0;
  return Math.min(1.5, Math.max(1.0, 1 + bonus + 0.5 * (weakShare || 0)));
}

function effectiveRate(unit, ctx) {
  const r = ctx.unitRates?.[unit.id];
  if (typeof r === 'number') return r;
  return ctx.subjectProgress?.[unit.subjectId] ?? 0;
}

// 단원별 필요 학습량(분)
function computeNeeds(subjects, ctx) {
  const factor = stagePlan(ctx.stage).studyFactor;
  const needs = [];
  subjects.forEach((s, si) => {
    const w = subjectWeight(ctx.subjectConfidence?.[s.id], ctx.weakShareBySubject?.[s.id]);
    s.units.forEach((u, ui) => {
      const rate = effectiveRate({ ...u, subjectId: s.id }, ctx);
      if (rate >= 100) return;
      needs.push({
        unitId: u.id,
        subjectId: s.id,
        unitName: u.name,
        subjectName: s.name,
        core: !!u.core,
        tags: u.tags || [],
        rate,
        w,
        need: u.standardHours * 60 * (1 - rate / 100) * w * factor,
        order: si * 1000 + ui,
      });
    });
  });
  return needs;
}

function allocate(needs, T, { corePriority = false } = {}) {
  const N = sum(needs, (n) => n.need);
  const minutes = new Map();
  if (!needs.length || N <= 0) return { minutes, ratio: Infinity, level: 'ok', required: 0 };
  const ratio = T / N;
  const level = ratio >= 1 ? 'ok' : ratio >= SHORTAGE_RATIO ? 'tight' : 'shortage';

  if (ratio >= 1) {
    const f = Math.min(ratio, SLACK_MAX);
    needs.forEach((n) => minutes.set(n.unitId, n.need * f));
  } else {
    const boostCore = level === 'shortage' || corePriority;
    const pri = (n) => n.need * (boostCore && n.core ? 2 : 1);
    let remaining = T;
    let active = needs.slice();
    while (active.length) {
      const P = sum(active, pri);
      const capped = active.filter((n) => (remaining * pri(n)) / P >= n.need);
      if (!capped.length) {
        active.forEach((n) => minutes.set(n.unitId, (remaining * pri(n)) / P));
        break;
      }
      capped.forEach((n) => {
        minutes.set(n.unitId, n.need);
        remaining -= n.need;
      });
      active = active.filter((n) => !capped.includes(n));
    }
  }
  for (const [k, v] of minutes) minutes.set(k, Math.max(MIN_CHUNK, floorStep(v)));
  return { minutes, ratio, level, required: N };
}

function packStudy(queue, dates, capacity, even = true) {
  const tasks = [];
  const items = queue.map((q) => ({ ...q }));
  let qi = 0;
  let totalLeft = sum(items, (x) => x.minutes);
  for (let i = 0; i < dates.length && qi < items.length; i++) {
    const daysLeft = dates.length - i;
    const target = even
      ? Math.min(capacity, Math.max(MIN_CHUNK, Math.ceil(totalLeft / daysLeft / STEP) * STEP))
      : capacity;
    let used = 0;
    while (qi < items.length) {
      const item = items[qi];
      const avail = target - used;
      if (avail <= 0) break;
      if (avail < MIN_CHUNK && item.minutes > avail) break;
      let take = Math.min(item.minutes, avail);
      const rest = item.minutes - take;
      // 10분 미만 자투리가 남으면 하루 가용 시간 안에서 한 번에 끝낸다
      if (rest > 0 && rest < MIN_CHUNK && used + item.minutes <= capacity) take = item.minutes;
      tasks.push({
        type: 'study',
        date: dates[i],
        unitId: item.unitId,
        subjectId: item.subjectId,
        unitName: item.unitName,
        subjectName: item.subjectName,
        tags: item.tags,
        baseRate: item.rate,
        minutes: take,
      });
      used += take;
      item.minutes -= take;
      totalLeft -= take;
      if (item.minutes <= 0) qi++;
    }
  }
  return { tasks, leftover: items.slice(qi).filter((x) => x.minutes > 0) };
}

function finalizeStudyTasks(tasks) {
  const byUnit = new Map();
  tasks.forEach((t) => {
    if (!byUnit.has(t.unitId)) byUnit.set(t.unitId, []);
    byUnit.get(t.unitId).push(t);
  });
  for (const list of byUnit.values()) {
    const total = sum(list, (t) => t.minutes);
    list.forEach((t, i) => {
      t.title = list.length > 1 ? `${t.unitName} (${i + 1}/${list.length})` : t.unitName;
      t.unitPlanMinutes = total;
    });
  }
  return tasks;
}

function buildReviewTasks(dates, subjects, capacity, usedByDate) {
  const tasks = [];
  if (!subjects.length) return tasks;
  let cursor = 0;
  for (const date of dates) {
    const free = capacity - (usedByDate[date] || 0);
    if (free < MIN_CHUNK) continue;
    const n = Math.min(free >= 120 ? 2 : 1, subjects.length);
    let remaining = free;
    for (let k = 0; k < n; k++) {
      const s = subjects[cursor % subjects.length];
      cursor++;
      const minutes = k === n - 1 ? remaining : floorStep(free / n);
      remaining -= minutes;
      tasks.push({
        type: 'review',
        date,
        subjectId: s.id,
        subjectName: s.name,
        unitId: null,
        unitName: null,
        title: `${s.name} 총정리 · 기출 회독`,
        minutes,
        baseRate: null,
        unitPlanMinutes: null,
        tags: [],
      });
    }
  }
  return tasks;
}

function checklistFor(t, stage) {
  const items =
    t.type === 'review'
      ? ['공개 기출 1회분 풀이', '틀린 문제 오답노트에 기록', '취약 유형 개념 다시 보기']
      : [...stagePlan(stage).checklist(t), ...(t.tags || []).slice(0, 1).map((x) => `${x} 관련 문제 확인`)].slice(0, 2).concat('이해도·복습 필요 여부 기록');
  return items.slice(0, 3).map((text) => ({ text, done: false }));
}

function buildPlan(input) {
  const { today, examDate, dailyHours, studyDays, subjects } = input;
  const stage = normalizeStage(input.stage);
  const sp = stagePlan(stage);
  const capacity = Math.round(dailyHours * 60);
  const dates = listStudyDates(today, examDate, studyDays);
  if (!dates.length) return { error: 'NO_STUDY_DAYS' };

  const warnings = [];
  if (diffDays(today, examDate) < 7) {
    warnings.push({ code: 'SHORT_PERIOD', message: '시험까지 7일이 남지 않았습니다. 핵심 단원과 총정리 위주로 배분했습니다.' });
  }

  const needs = computeNeeds(subjects, { ...input, stage });
  let reviewCount = reviewDayCount(dates.length, stage);
  if (!needs.length) {
    reviewCount = dates.length;
    warnings.push({ code: 'ALL_DONE', message: '모든 단원의 진도가 100%입니다. 남은 기간을 총정리로 배정했습니다.' });
  } else {
    // 학습 단계가 배분에 어떻게 반영됐는지 안내 (스케줄 화면의 안내 영역에 그대로 표시)
    const tail = reviewCount
      ? `마지막 ${reviewCount}일(학습일의 ${Math.round((reviewCount / dates.length) * 100)}%)을 총정리·기출 회독 기간으로 잡았습니다.`
      : '학습일이 적어 총정리 기간은 따로 두지 않았습니다.';
    warnings.unshift({ code: 'STAGE_APPLIED', stage, message: `현재 '${sp.label}' 단계에 맞춰 ${sp.note} ${tail}` });
  }
  const learnDates = dates.slice(0, dates.length - reviewCount);
  const reviewDates = dates.slice(dates.length - reviewCount);
  const T = learnDates.length * capacity;

  const { minutes, ratio, level, required } = allocate(needs, T, { corePriority: sp.corePriority });
  const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : 100;
  // 부족할 때는 남은 학습량 기준 권장 하루 시간을 함께 안내
  const recHours = learnDates.length ? roundUpHours(required / learnDates.length) : null;
  const fix = recHours ? `하루 ${recHours}시간 이상으로 늘리거나 학습 요일을 추가해 보세요.` : '선택한 요일로는 하루 12시간으로도 부족하니 학습 요일을 늘려 보세요.';
  if (level === 'tight') {
    warnings.push({ code: 'TIME_TIGHT', recommendedDailyHours: recHours, message: `가용 시간이 필요 학습량의 ${pct}% 수준이라 단원별 시간을 비율대로 줄여 배분했습니다. ${fix}` });
  } else if (level === 'shortage') {
    warnings.push({
      code: 'TIME_SHORTAGE',
      recommendedDailyHours: recHours,
      message: `가용 시간이 필요 학습량의 ${pct}%로 부족합니다. 핵심 단원을 우선 배분했습니다. ${fix}`,
    });
  }

  const queue = needs
    .slice()
    // 총정리 단계는 핵심 단원부터 회독하도록 앞으로 배치
    .sort((a, b) => (sp.corePriority ? Number(b.core) - Number(a.core) : 0) || a.order - b.order)
    .map((n) => ({ ...n, minutes: minutes.get(n.unitId) || 0 }))
    .filter((q) => q.minutes > 0);

  const main = packStudy(queue, learnDates, capacity, true);
  let spillTasks = [];
  let unscheduled = [];
  if (main.leftover.length) {
    const spill = packStudy(main.leftover, reviewDates, capacity, false);
    spillTasks = spill.tasks;
    unscheduled = spill.leftover;
  }
  if (unscheduled.length) {
    warnings.push({
      code: 'UNSCHEDULED_UNITS',
      message: `시간이 부족해 ${unscheduled.length}개 단원을 배정하지 못했습니다. 학습 조건을 조정해 주세요.`,
      units: unscheduled.map((u) => u.unitName),
    });
  }

  const usedByDate = {};
  [...main.tasks, ...spillTasks].forEach((t) => {
    usedByDate[t.date] = (usedByDate[t.date] || 0) + t.minutes;
  });
  const studyTasks = finalizeStudyTasks([...main.tasks, ...spillTasks]);
  const reviewTasks = buildReviewTasks(reviewDates, subjects, capacity, usedByDate);

  const tasks = [...studyTasks, ...reviewTasks]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'study' ? -1 : 1))
    .map((t) => ({ ...t, checklist: checklistFor(t, stage) }));

  return {
    capacity,
    studyDates: dates,
    reviewStartDate: reviewDates[0] || null,
    warnings,
    tasks,
    stats: {
      requiredMinutes: Math.round(required),
      availableMinutes: T,
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null,
      level,
      stage,
      studyDayCount: dates.length,
      reviewDayCount: reviewCount,
      totalHours: round1(sum(tasks, (t) => t.minutes) / 60),
    },
  };
}

// 하루 필요 학습 시간 추천
// 남은 학습량(단원별 표준 시간 × (1 - 진도) × 자신감·취약 가중치 × 학습 단계 배율)을
// 총정리 기간을 뺀 학습일 수로 나눠 하루 필요 시간을 구한다. 총정리 기간도 같은 시간을 쓰므로
// "복습 포함 총 필요 시간 ÷ 전체 학습일"과 같다. (예: 복습 포함 60시간 ÷ 20일 = 하루 3시간)
function loadForDays(needMinutes, dateCount, stage) {
  const reviewDays = needMinutes > 0 ? reviewDayCount(dateCount, stage) : dateCount;
  const learnDays = dateCount - reviewDays;
  const perDay = needMinutes <= 0 ? 0 : learnDays > 0 ? needMinutes / learnDays : Infinity;
  return {
    studyDayCount: dateCount,
    learnDayCount: learnDays,
    reviewDayCount: reviewDays,
    requiredDailyMinutes: Number.isFinite(perDay) ? Math.round(perDay) : null,
    recommendedDailyHours: needMinutes <= 0 ? 0 : roundUpHours(perDay),
  };
}

// 선택하지 않은 요일을 학습일이 많이 생기는 순(같으면 주말 먼저)으로 하나씩 추가한 대안
function studyDayOptions(today, examDate, studyDays) {
  const chosen = new Set(studyDays);
  const PREF = [6, 0, 5, 4, 3, 2, 1];
  const candidates = PREF.filter((d) => !chosen.has(d))
    .map((d) => ({ d, count: listStudyDates(today, examDate, [d]).length }))
    .sort((a, b) => b.count - a.count);
  const out = [];
  const days = [...chosen];
  for (const c of candidates) {
    days.push(c.d);
    out.push({ studyDays: [...days].sort(), added: c.d });
  }
  return out;
}

function estimateLoad(input) {
  const { today, examDate, studyDays, subjects } = input;
  const stage = normalizeStage(input.stage);
  const dday = diffDays(today, examDate);
  const needs = computeNeeds(subjects, { ...input, stage });
  const needMinutes = sum(needs, (n) => n.need);
  const dates = listStudyDates(today, examDate, studyDays);
  const current = loadForDays(needMinutes, dates.length, stage);
  const perDay = current.learnDayCount > 0 ? needMinutes / current.learnDayCount : needMinutes > 0 ? Infinity : 0;
  const reviewMinutes = Number.isFinite(perDay) ? Math.round(perDay * current.reviewDayCount) : null;

  const selectedMinutes = Math.round((input.dailyHours || 0) * 60);
  const enough = current.requiredDailyMinutes != null && selectedMinutes >= current.requiredDailyMinutes;
  let shortage = null;
  if (!enough) {
    const options = studyDayOptions(today, examDate, studyDays).map((o) => ({
      ...o,
      ...loadForDays(needMinutes, listStudyDates(today, examDate, o.studyDays).length, stage),
    }));
    const byDays = options.find((o) => o.requiredDailyMinutes != null && o.requiredDailyMinutes <= selectedMinutes) || null;
    shortage = {
      dailyMinutes: current.requiredDailyMinutes != null ? current.requiredDailyMinutes - selectedMinutes : null,
      // 선택한 시간으로 공부했을 때 시험일까지 모자라는 총 시간 (복습 포함)
      totalMinutes: Number.isFinite(perDay) ? Math.round((perDay - selectedMinutes) * dates.length) : null,
      byHours: current.recommendedDailyHours,
      byDays: byDays && { studyDays: byDays.studyDays, studyDayCount: byDays.studyDayCount, addedDays: byDays.studyDays.filter((d) => !studyDays.includes(d)) },
      // 요일을 모두 써도 부족하면 매일 공부할 때의 권장 시간
      everyDay: byDays ? null : options.length ? options[options.length - 1].recommendedDailyHours : null,
    };
  }

  return {
    stage,
    dday,
    minPrepDays: MIN_PREP_DAYS,
    meetsMinPrep: dday >= MIN_PREP_DAYS,
    ...current,
    learnMinutes: Math.round(needMinutes),
    reviewMinutes,
    totalMinutes: reviewMinutes == null ? null : Math.round(needMinutes) + reviewMinutes,
    selectedDailyHours: input.dailyHours ?? null,
    enough,
    shortage,
  };
}

function redistribute({ overdue, today, studyDates, reviewStartDate, capacity, usage = {}, reviewTasksByDate = {} }) {
  const use = { ...usage };
  const future = studyDates.filter((d) => d >= today);
  const learn = future.filter((d) => !reviewStartDate || d < reviewStartDate);
  const review = future.filter((d) => reviewStartDate && d >= reviewStartDate);
  const moves = [];
  const creates = [];
  const reviewMinutes = new Map();
  const unplaced = [];
  let lostMinutes = 0;

  const sorted = overdue.slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const task of sorted) {
    let left = task.minutes;
    const parts = [];
    const place = (d) => {
      const free = capacity - (use[d] || 0);
      if (free <= 0 || free < Math.min(MIN_CHUNK, left)) return;
      const take = Math.min(left, free);
      parts.push({ date: d, minutes: take });
      use[d] = (use[d] || 0) + take;
      left -= take;
    };
    for (const d of learn) {
      if (left <= 0) break;
      place(d);
    }
    for (const d of review) {
      if (left <= 0) break;
      let free = capacity - (use[d] || 0);
      if (free < left) {
        for (const rt of reviewTasksByDate[d] || []) {
          const cur = reviewMinutes.has(rt.id) ? reviewMinutes.get(rt.id) : rt.minutes;
          if (cur <= 0) continue;
          const cut = Math.min(cur, left - free);
          reviewMinutes.set(rt.id, cur - cut);
          use[d] -= cut;
          free += cut;
          if (free >= left) break;
        }
      }
      place(d);
    }
    if (!parts.length) {
      unplaced.push(task.id);
      continue;
    }
    lostMinutes += Math.max(0, left);
    moves.push({ id: task.id, fromDate: task.date, date: parts[0].date, minutes: parts[0].minutes });
    parts.slice(1).forEach((p) => creates.push({ fromId: task.id, date: p.date, minutes: p.minutes }));
  }

  const reviewUpdates = [];
  const reviewDeletes = [];
  for (const [id, minutes] of reviewMinutes) {
    if (minutes < MIN_CHUNK) reviewDeletes.push(id);
    else reviewUpdates.push({ id, minutes });
  }
  return { moves, creates, reviewUpdates, reviewDeletes, unplaced, lostMinutes, usage: use };
}

module.exports = {
  REVIEW_RATIO,
  STAGE_PLAN,
  MIN_PREP_DAYS,
  reviewDayCount,
  roundUpHours,
  estimateLoad,
  MIN_CHUNK,
  STEP,
  floorStep,
  listStudyDates,
  subjectWeight,
  computeNeeds,
  allocate,
  packStudy,
  buildPlan,
  redistribute,
  checklistFor,
};
