'use strict';

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const round1 = (v) => Math.round(v * 10) / 10;

function subjectRate(units, rateOf) {
  const total = sum(units, (u) => u.standardHours);
  return total ? sum(units, (u) => u.standardHours * rateOf(u)) / total : 0;
}

function remainingMinutes(units, rateOf) {
  return sum(units, (u) => u.standardHours * 60 * (1 - rateOf(u) / 100));
}

function completionDelta(baseRate, taskMinutes, unitPlanMinutes) {
  if (!unitPlanMinutes || unitPlanMinutes <= 0) return 0;
  return ((100 - (baseRate || 0)) * taskMinutes) / unitPlanMinutes;
}

function clampRate(v) {
  if (v >= 99.5) return 100;
  if (v <= 0.05) return 0;
  return Math.round(v * 100) / 100;
}

function expectedRate(baseRate, studyMinutesByDate, today) {
  const entries = Object.entries(studyMinutesByDate || {});
  const total = sum(entries, ([, m]) => m);
  if (!total) return null;
  const done = sum(entries.filter(([d]) => d < today), ([, m]) => m);
  return (baseRate || 0) + ((100 - (baseRate || 0)) * done) / total;
}

module.exports = { round1, subjectRate, remainingMinutes, completionDelta, clampRate, expectedRate };
