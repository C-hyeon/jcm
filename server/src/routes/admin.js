'use strict';

// UC-08 학습 자료·마스터 관리 (관리자 전용, admin custom claim 필요)
const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { ah, HttpError } = require('../lib/httpError');
const { validate } = require('../middleware/common');
const { requireAdmin } = require('../middleware/auth');
const { MaterialSchema, MastersSchema, z } = require('../lib/schemas');
const { normalizeUrl } = require('../lib/url');
const { log, hashUid } = require('../lib/logger');
const { invalidate, getAllMaterials } = require('../services/masters');

const router = express.Router();
router.use('/admin', requireAdmin);

const audit = (req, action, data = {}) => log('admin.action', { admin: hashUid(req.user.uid), action, ...data });
const materialsCol = () => db().collection('materials');

async function assertUniqueUrl(url, exceptId) {
  const snap = await materialsCol().where('url', '==', url).limit(2).get();
  if (snap.docs.some((d) => d.id !== exceptId)) throw new HttpError(400, 'DUPLICATE_URL', '이미 등록된 URL입니다.');
}

router.get(
  '/admin/materials',
  ah(async (_req, res) => {
    invalidate('materials');
    res.json({ items: await getAllMaterials() });
  }),
);

router.post(
  '/admin/materials',
  validate(MaterialSchema),
  ah(async (req, res) => {
    const data = { ...req.valid, url: normalizeUrl(req.valid.url) };
    await assertUniqueUrl(data.url);
    const ref = materialsCol().doc();
    await ref.set({ ...data, linkStatus: 'unknown', createdAt: FieldValue.serverTimestamp(), createdBy: req.user.uid });
    invalidate('materials');
    audit(req, 'material.create', { id: ref.id });
    res.status(201).json({ id: ref.id, ...data });
  }),
);

router.put(
  '/admin/materials/:id',
  validate(MaterialSchema),
  ah(async (req, res) => {
    const ref = materialsCol().doc(req.params.id);
    const prev = await ref.get();
    if (!prev.exists) throw new HttpError(404, 'NOT_FOUND', '자료를 찾을 수 없습니다.');
    const data = { ...req.valid, url: normalizeUrl(req.valid.url) };
    await assertUniqueUrl(data.url, req.params.id);
    const urlChanged = prev.data().url !== data.url;
    await ref.update({ ...data, ...(urlChanged ? { linkStatus: 'unknown' } : {}), updatedAt: FieldValue.serverTimestamp() });
    invalidate('materials');
    audit(req, 'material.update', { id: req.params.id });
    res.json({ id: req.params.id, ...data });
  }),
);

router.delete(
  '/admin/materials/:id',
  ah(async (req, res) => {
    await materialsCol().doc(req.params.id).delete();
    invalidate('materials');
    audit(req, 'material.delete', { id: req.params.id });
    res.json({ ok: true });
  }),
);

// 링크 점검: 대상 사이트 부하 방지를 위해 요청 간 1초 간격, 한 번에 최대 20건
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function checkUrl(url) {
  const opts = { redirect: 'follow', headers: { 'user-agent': 'JCM-LinkChecker/1.0 (+study platform link health check)' } };
  try {
    let r = await fetch(url, { ...opts, method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if ([403, 405, 501].includes(r.status)) r = await fetch(url, { ...opts, method: 'GET', signal: AbortSignal.timeout(8000) });
    // 403·429는 봇 차단일 수 있어 '확인 필요'로 표시(목록에서 숨기지 않음)
    const status = r.status < 400 ? 'ok' : r.status === 403 || r.status === 429 ? 'warn' : 'broken';
    return { status, httpStatus: r.status };
  } catch (e) {
    return { status: 'broken', httpStatus: null, error: e.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

router.post(
  '/admin/link-check',
  validate(z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(10) })),
  ah(async (req, res) => {
    const { offset, limit } = req.valid;
    const all = (await materialsCol().orderBy('createdAt').get()).docs;
    const slice = all.slice(offset, offset + limit);
    const results = [];
    for (let i = 0; i < slice.length; i++) {
      if (i > 0) await sleep(1000);
      const d = slice[i];
      const r = await checkUrl(d.data().url);
      await d.ref.update({ linkStatus: r.status, linkHttpStatus: r.httpStatus, linkCheckedAt: new Date().toISOString() });
      results.push({ id: d.id, title: d.data().title, url: d.data().url, ...r });
    }
    invalidate('materials');
    const nextOffset = offset + slice.length;
    audit(req, 'link.check', { offset, count: slice.length });
    res.json({ results, nextOffset, total: all.length, done: nextOffset >= all.length });
  }),
);

// 시험 일정·과목·단원 마스터
router.put(
  '/admin/masters',
  validate(MastersSchema),
  ah(async (req, res) => {
    const { exams, subjects } = req.valid;
    const batch = db().batch();
    let ops = 0;
    (exams || []).forEach(({ id, ...e }) => {
      batch.set(db().collection('exams').doc(id), { ...e, updatedAt: FieldValue.serverTimestamp() });
      ops++;
    });
    for (const { id, units, ...s } of subjects || []) {
      const sref = db().collection('subjects').doc(id);
      batch.set(sref, { ...s, updatedAt: FieldValue.serverTimestamp() });
      const existing = await sref.collection('units').get();
      const keep = new Set(units.map((u) => u.id));
      existing.docs.filter((d) => !keep.has(d.id)).forEach((d) => {
        batch.delete(d.ref);
        ops++;
      });
      units.forEach(({ id: uid, ...u }) => {
        batch.set(sref.collection('units').doc(uid), u);
        ops++;
      });
      ops++;
    }
    if (ops > 490) throw new HttpError(400, 'TOO_MANY', '한 번에 저장할 항목이 너무 많습니다. 나눠서 저장해 주세요.');
    await batch.commit();
    invalidate('exams', 'subjects');
    audit(req, 'masters.update', { exams: exams?.length || 0, subjects: subjects?.length || 0 });
    res.json({ ok: true, exams: exams?.length || 0, subjects: subjects?.length || 0 });
  }),
);

router.delete(
  '/admin/exams/:id',
  ah(async (req, res) => {
    await db().collection('exams').doc(req.params.id).delete();
    invalidate('exams');
    audit(req, 'exam.delete', { id: req.params.id });
    res.json({ ok: true });
  }),
);

module.exports = router;
