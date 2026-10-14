'use strict';
// UC-06 오답·취약 유형 기록 CRUD
const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { ah, HttpError } = require('../lib/httpError');
const { validate } = require('../middleware/common');
const { userCol, metaRef } = require('../lib/refs');
const { WrongNoteCreateSchema, WrongNotePatchSchema, z } = require('../lib/schemas');
const { getSubjects } = require('../services/masters');
const { statDelta } = require('../services/weakness');

const router = express.Router();
const PAGE = 30;

function applyDelta(tx, uid, note, delta) {
  const d = statDelta(note, delta);
  tx.set(
    metaRef(uid, 'wrongStats'),
    { tags: { [d.key]: { subjectId: d.subjectId, typeTag: d.typeTag, buckets: { [d.date]: { [d.field]: FieldValue.increment(delta) } } } } },
    { merge: true },
  );
}

async function assertMaster(subjectId, typeTag, unitId) {
  const subject = (await getSubjects()).find((s) => s.id === subjectId);
  if (!subject) throw new HttpError(400, 'VALIDATION_ERROR', '과목을 선택해 주세요.');
  if (typeTag !== undefined && !subject.tags.includes(typeTag)) throw new HttpError(400, 'VALIDATION_ERROR', '선택한 과목의 유형 태그에서 골라 주세요.');
  if (unitId && !subject.units.some((u) => u.id === unitId)) throw new HttpError(400, 'VALIDATION_ERROR', '단원이 과목과 맞지 않습니다.');
  return subject;
}

function view(id, n) {
  return {
    id,
    subjectId: n.subjectId,
    unitId: n.unitId || null,
    typeTag: n.typeTag,
    difficulty: n.difficulty,
    sourceRef: n.sourceRef || {},
    memo: n.memo || '',
    reviewed: !!n.reviewed,
    createdDate: n.createdDate,
  };
}

const ListQuery = z.object({
  subjectId: z.string().max(60).optional(),
  typeTag: z.string().max(30).optional(),
  reviewed: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(60).optional(),
});

router.get(
  '/wrong-notes',
  validate(ListQuery, 'query'),
  ah(async (req, res) => {
    const { subjectId, typeTag, reviewed, cursor } = req.valid;
    if (typeTag && !subjectId) throw new HttpError(400, 'VALIDATION_ERROR', '유형으로 거르려면 과목을 먼저 선택해 주세요.');
    const col = userCol(req.user.uid, 'wrongNotes');
    let q = col;
    if (subjectId) q = q.where('subjectId', '==', subjectId);
    if (typeTag) q = q.where('typeTag', '==', typeTag);
    if (reviewed) q = q.where('reviewed', '==', reviewed === 'true');
    q = q.orderBy('createdAt', 'desc').limit(PAGE + 1);
    if (cursor) {
      const c = await col.doc(cursor).get();
      if (c.exists) q = q.startAfter(c);
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, PAGE);
    res.json({ items: docs.map((d) => view(d.id, d.data())), nextCursor: snap.size > PAGE ? docs[docs.length - 1].id : null });
  }),
);

router.post(
  '/wrong-notes',
  validate(WrongNoteCreateSchema),
  ah(async (req, res) => {
    const uid = req.user.uid;
    const body = req.valid;
    await assertMaster(body.subjectId, body.typeTag, body.unitId);
    const ref = userCol(uid, 'wrongNotes').doc();
    const note = { ...body, unitId: body.unitId || null, reviewed: false, createdDate: req.today };
    await db().runTransaction(async (tx) => {
      tx.set(ref, { ...note, createdAt: FieldValue.serverTimestamp() });
      applyDelta(tx, uid, note, 1);
    });
    res.status(201).json(view(ref.id, note));
  }),
);

router.patch(
  '/wrong-notes/:id',
  validate(WrongNotePatchSchema),
  ah(async (req, res) => {
    const uid = req.user.uid;
    const ref = userCol(uid, 'wrongNotes').doc(req.params.id);
    const body = req.valid;
    const updated = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', '오답 기록을 찾을 수 없습니다.');
      const prev = snap.data();
      const next = { ...prev, ...body };
      if (body.typeTag !== undefined || body.unitId !== undefined) await assertMaster(prev.subjectId, next.typeTag, next.unitId);
      const statChanged = prev.typeTag !== next.typeTag || !!prev.reviewed !== !!next.reviewed;
      tx.update(ref, { ...body, updatedAt: FieldValue.serverTimestamp() });
      if (statChanged) {
        applyDelta(tx, uid, prev, -1);
        applyDelta(tx, uid, next, 1);
      }
      return next;
    });
    res.json(view(req.params.id, updated));
  }),
);

router.delete(
  '/wrong-notes/:id',
  ah(async (req, res) => {
    const uid = req.user.uid;
    const ref = userCol(uid, 'wrongNotes').doc(req.params.id);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', '오답 기록을 찾을 수 없습니다.');
      tx.delete(ref);
      applyDelta(tx, uid, snap.data(), -1);
    });
    res.json({ ok: true });
  }),
);

module.exports = router;
