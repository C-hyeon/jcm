'use strict';
// 취약도 계산 (UC-06)
const { diffDays } = require('../lib/dates');

const RECENT_DAYS = 14;
const W_RECENT = 1.5;
const W_NORMAL = 1.0;
const W_REVIEWED = 0.5;

const statKey = (subjectId, typeTag) => `${subjectId}|${typeTag}`;

function noteWeight(note, today) {
  if (note.reviewed) return W_REVIEWED;
  return diffDays(note.createdDate, today) < RECENT_DAYS ? W_RECENT : W_NORMAL;
}

function statDelta(note, delta) {
  const key = statKey(note.subjectId, note.typeTag);
  const field = note.reviewed ? 'reviewed' : 'open';
  return { key, subjectId: note.subjectId, typeTag: note.typeTag, date: note.createdDate, field, delta };
}

function scoresFromStats(tags, today) {
  const rows = [];
  let total = 0;
  for (const [key, v] of Object.entries(tags || {})) {
    let weight = 0;
    let count = 0;
    for (const [date, b] of Object.entries(v.buckets || {})) {
      const open = Math.max(0, b.open || 0);
      const reviewed = Math.max(0, b.reviewed || 0);
      weight += reviewed * W_REVIEWED + open * (diffDays(date, today) < RECENT_DAYS ? W_RECENT : W_NORMAL);
      count += open + reviewed;
    }
    if (count > 0) {
      rows.push({ key, subjectId: v.subjectId, typeTag: v.typeTag, weight, count });
      total += weight;
    }
  }
  rows.forEach((r) => {
    r.score = total ? r.weight / total : 0;
  });
  rows.sort((a, b) => b.score - a.score || b.count - a.count || a.typeTag.localeCompare(b.typeTag));
  const bySubject = {};
  rows.forEach((r) => {
    bySubject[r.subjectId] = (bySubject[r.subjectId] || 0) + r.score;
  });
  return { rows, top3: rows.slice(0, 3), bySubject, total };
}

function statsFromNotes(notes) {
  const tags = {};
  for (const n of notes) {
    const d = statDelta(n, 1);
    tags[d.key] ??= { subjectId: d.subjectId, typeTag: d.typeTag, buckets: {} };
    const b = (tags[d.key].buckets[d.date] ??= { open: 0, reviewed: 0 });
    b[d.field] += 1;
  }
  return tags;
}

function scoresFromNotes(notes, today) {
  return scoresFromStats(statsFromNotes(notes), today);
}

module.exports = { RECENT_DAYS, statKey, noteWeight, statDelta, scoresFromStats, statsFromNotes, scoresFromNotes };
