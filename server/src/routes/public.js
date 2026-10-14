'use strict';
// 비회원도 사용할 수 있는 API
const express = require('express');
const { ah, HttpError } = require('../lib/httpError');
const { validate, ipLimiter, today } = require('../middleware/common');
const { optionalAuth } = require('../middleware/auth');
const { userCol } = require('../lib/refs');
const { StudyProfileSchema, z, STAGES, MATERIAL_TYPES, EXAM_TYPES } = require('../lib/schemas');
const { getExams, getSubjects, getMaterials, getMaterialMap, materialCard } = require('../services/masters');
const { computePlan } = require('../services/planService');
const { STAGE_ORDER, pickForTask } = require('../services/materialLogic');
const { diffDays } = require('../lib/dates');

const router = express.Router();

router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get(
  '/exams',
  ipLimiter,
  today,
  ah(async (req, res) => {
    const exams = await getExams();
    res.json({ items: req.query.all === '1' ? exams : exams.filter((e) => e.examDate > req.today) });
  }),
);

router.get(
  '/subjects',
  ipLimiter,
  ah(async (req, res) => {
    const t = EXAM_TYPES.includes(req.query.examType) ? req.query.examType : undefined;
    res.json({ items: await getSubjects(t) });
  }),
);

// UC-07 학습 자료 목록·검색 — 자료 원문은 저장하지 않고 메타데이터와 링크만 제공
const MaterialQuery = z.object({
  subjectId: z.string().max(60).optional(),
  type: z.enum(MATERIAL_TYPES).optional(),
  stage: z.enum(STAGES).optional(),
  q: z.string().trim().max(50).optional(),
  bookmarked: z.enum(['1']).optional(),
});

router.get(
  '/materials',
  ipLimiter,
  optionalAuth,
  validate(MaterialQuery, 'query'),
  ah(async (req, res) => {
    const { subjectId, type, stage, q, bookmarked } = req.valid;
    let items = await getMaterials();
    if (subjectId) items = items.filter((m) => (subjectId === 'common' ? !m.subjectId : m.subjectId === subjectId));
    if (type) items = items.filter((m) => m.type === type);
    if (stage) items = items.filter((m) => m.stage === stage);
    if (q) {
      const k = q.toLowerCase();
      items = items.filter((m) => [m.title, m.sourceName, m.author, ...(m.tags || [])].some((x) => x && x.toLowerCase().includes(k)));
    }
    let marks = new Set();
    if (req.user) {
      const snap = await userCol(req.user.uid, 'bookmarks').get();
      marks = new Set(snap.docs.map((d) => d.id));
    }
    if (bookmarked) {
      if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', '북마크는 로그인 후 사용할 수 있습니다.');
      items = items.filter((m) => marks.has(m.id));
    }
    items = items.slice().sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.title.localeCompare(b.title));
    res.json({
      items: items.map((m) => ({ ...materialCard(m), reason: m.reason, tags: m.tags, unitIds: m.unitIds, bookmarked: marks.has(m.id) })),
      total: items.length,
    });
  }),
);

router.get(
  '/materials/:id',
  ipLimiter,
  ah(async (req, res) => {
    const m = (await getMaterialMap()).get(req.params.id);
    if (!m || !m.visible || m.linkStatus === 'broken') throw new HttpError(404, 'NOT_FOUND', '자료를 찾을 수 없습니다.');
    res.json({ ...materialCard(m), reason: m.reason, tags: m.tags, unitIds: m.unitIds });
  }),
);

// 비회원 스케줄 미리보기
router.post(
  '/plans/preview',
  ipLimiter,
  today,
  validate(StudyProfileSchema),
  ah(async (req, res) => {
    const profile = req.valid;
    if (profile.examDate <= req.today) throw new HttpError(400, 'EXAM_DATE_PAST', '시험일은 내일 이후 날짜여야 합니다.');
    const { result, materials } = await computePlan({ profile, today: req.today });
    const matMap = new Map(materials.map((m) => [m.id, m]));
    res.json({
      plan: {
        examType: profile.examType,
        examDate: profile.examDate,
        dday: diffDays(req.today, profile.examDate),
        capacityMinutes: result.capacity,
        reviewStartDate: result.reviewStartDate,
        studyDays: profile.studyDays,
        warnings: result.warnings,
        stats: result.stats,
      },
      tasks: result.tasks.map((t, i) => ({
        id: `guest-${i}`,
        date: t.date,
        type: t.type,
        subjectId: t.subjectId,
        subjectName: t.subjectName,
        unitId: t.unitId || null,
        title: t.title,
        minutes: t.minutes,
        checklist: t.checklist,
        done: false,
        materials: pickForTask(t, materials, profile.stage).map((id) => materialCard(matMap.get(id))),
      })),
    });
  }),
);

module.exports = router;
