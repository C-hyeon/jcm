'use strict';
// 마스터 데이터(시험 일정, 과목·단원, 학습 자료 메타데이터) 조회 + 메모리 캐시.
const { db } = require('../config/firebase');

const TTL = 5 * 60 * 1000;
const cache = new Map();
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await loader();
  cache.set(key, { value, at: Date.now() });
  return value;
}
function invalidate(...keys) {
  if (!keys.length) cache.clear();
  keys.forEach((k) => cache.delete(k));
}

async function getSubjects(examType) {
  const all = await cached('subjects', async () => {
    const snap = await db().collection('subjects').get();
    const list = await Promise.all(
      snap.docs.map(async (d) => {
        const units = await d.ref.collection('units').get();
        return {
          id: d.id,
          ...d.data(),
          units: units.docs.map((u) => ({ id: u.id, subjectId: d.id, ...u.data() })).sort(byOrder),
        };
      }),
    );
    return list.sort((a, b) => (a.examType === b.examType ? byOrder(a, b) : a.examType === 'written' ? -1 : 1));
  });
  return examType ? all.filter((s) => s.examType === examType) : all;
}

async function getUnitIndex() {
  const subjects = await getSubjects();
  const map = new Map();
  subjects.forEach((s) => s.units.forEach((u) => map.set(u.id, { unit: u, subject: s })));
  return map;
}

async function getExams() {
  return cached('exams', async () => {
    const snap = await db().collection('exams').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.examDate.localeCompare(b.examDate));
  });
}

function normalizeMaterial(id, d) {
  return {
    id,
    title: d.title,
    sourceName: d.sourceName,
    author: d.author,
    url: d.url,
    subjectId: d.subjectId || null,
    unitIds: d.unitIds || [],
    type: d.type,
    stage: d.stage,
    reason: d.reason,
    tags: d.tags || [],
    linkStatus: d.linkStatus || 'unknown',
    linkCheckedAt: d.linkCheckedAt || null,
    visible: d.visible !== false,
  };
}

async function getAllMaterials() {
  return cached('materials', async () => {
    const snap = await db().collection('materials').get();
    return snap.docs.map((d) => normalizeMaterial(d.id, d.data()));
  });
}
async function getMaterials() {
  return (await getAllMaterials()).filter((m) => m.visible && m.linkStatus !== 'broken');
}
async function getMaterialMap() {
  return new Map((await getAllMaterials()).map((m) => [m.id, m]));
}

function materialCard(m) {
  if (!m) return null;
  return { id: m.id, title: m.title, sourceName: m.sourceName, author: m.author, url: m.url, type: m.type, stage: m.stage, subjectId: m.subjectId };
}

module.exports = { invalidate, getSubjects, getUnitIndex, getExams, getAllMaterials, getMaterials, getMaterialMap, materialCard, normalizeMaterial };
