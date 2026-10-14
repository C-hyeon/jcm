'use strict';
// 북마크(UC-07) / AI 추천(UC-09)
const express = require('express');
const { FieldValue } = require('../config/firebase');
const { ah, HttpError } = require('../lib/httpError');
const { validate } = require('../middleware/common');
const { userCol } = require('../lib/refs');
const { z } = require('../lib/schemas');
const { getMaterialMap, getSubjects } = require('../services/masters');
const { recommend, expand } = require('../services/recommendService');

const router = express.Router();

router.get(
  '/bookmarks',
  ah(async (req, res) => {
    const [snap, map] = await Promise.all([userCol(req.user.uid, 'bookmarks').get(), getMaterialMap()]);
    res.json({ items: snap.docs.map((d) => map.get(d.id)).filter((m) => m && m.visible).map((m) => ({ id: m.id, title: m.title, sourceName: m.sourceName, url: m.url })) });
  }),
);

router.post(
  '/bookmarks',
  validate(z.object({ materialId: z.string().max(80) })),
  ah(async (req, res) => {
    const m = (await getMaterialMap()).get(req.valid.materialId);
    if (!m || !m.visible) throw new HttpError(404, 'NOT_FOUND', '자료를 찾을 수 없습니다.');
    await userCol(req.user.uid, 'bookmarks').doc(m.id).set({ createdAt: FieldValue.serverTimestamp() });
    res.status(201).json({ materialId: m.id, bookmarked: true });
  }),
);

router.delete(
  '/bookmarks/:materialId',
  ah(async (req, res) => {
    await userCol(req.user.uid, 'bookmarks').doc(req.params.materialId).delete();
    res.json({ materialId: req.params.materialId, bookmarked: false });
  }),
);

router.post(
  '/recommendations',
  ah(async (req, res) => {
    res.status(201).json(await recommend(req.user.uid, req.today));
  }),
);

router.get(
  '/recommendations',
  validate(z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }), 'query'),
  ah(async (req, res) => {
    const [snap, map, subjects] = await Promise.all([
      userCol(req.user.uid, 'recommendations').orderBy('createdAt', 'desc').limit(req.valid.limit).get(),
      getMaterialMap(),
      getSubjects(),
    ]);
    res.json({ items: snap.docs.map((d) => expand({ id: d.id, ...d.data() }, map, subjects)) });
  }),
);

router.patch(
  '/recommendations/:id',
  validate(z.object({ feedback: z.enum(['helpful', 'not_helpful']) })),
  ah(async (req, res) => {
    const ref = userCol(req.user.uid, 'recommendations').doc(req.params.id);
    if (!(await ref.get()).exists) throw new HttpError(404, 'NOT_FOUND', '추천 기록을 찾을 수 없습니다.');
    await ref.update({ feedback: req.valid.feedback, feedbackAt: FieldValue.serverTimestamp() });
    res.json({ id: req.params.id, feedback: req.valid.feedback });
  }),
);

module.exports = router;
