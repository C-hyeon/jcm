'use strict';

// UC-01 회원 관리
const express = require('express');
const { db, auth, FieldValue } = require('../config/firebase');
const { ah, HttpError } = require('../lib/httpError');
const { validate } = require('../middleware/common');
const { requireRecentAuth } = require('../middleware/auth');
const { userRef } = require('../lib/refs');
const { MeUpdateSchema } = require('../lib/schemas');
const { log, hashUid } = require('../lib/logger');
const { getExams } = require('../services/masters');

const router = express.Router();

function view(uid, u, isAdmin) {
  return {
    uid,
    email: u.email || null,
    nickname: u.nickname,
    role: isAdmin ? 'admin' : 'user',
    targetExamId: u.targetExamId || null,
    consentAgreedAt: u.consentAgreedAt || null,
    hasProfile: !!u.profile,
    activePlanId: u.activePlanId || null,
    profile: u.profile || null,
  };
}

router.get(
  '/me',
  ah(async (req, res) => {
    const ref = userRef(req.user.uid);
    let snap = await ref.get();
    if (!snap.exists) {
      const nickname = (req.user.email || '수험생').split('@')[0].slice(0, 20);
      await ref.set({ email: req.user.email, nickname, role: 'user', createdAt: FieldValue.serverTimestamp() });
      snap = await ref.get();
      log('auth.signup', { user: hashUid(req.user.uid), provider: req.user.provider });
    }
    log('auth.session', { user: hashUid(req.user.uid), provider: req.user.provider });
    res.json(view(req.user.uid, snap.data(), req.user.admin));
  }),
);

router.put(
  '/me',
  validate(MeUpdateSchema),
  ah(async (req, res) => {
    const { nickname, targetExamId, consent } = req.valid;
    const update = {};
    if (nickname !== undefined) update.nickname = nickname;
    if (targetExamId !== undefined) {
      if (targetExamId && !(await getExams()).some((e) => e.id === targetExamId)) {
        throw new HttpError(400, 'VALIDATION_ERROR', '선택한 시험 회차를 찾을 수 없습니다.');
      }
      update.targetExamId = targetExamId;
    }
    if (consent) update.consentAgreedAt = new Date().toISOString();
    const ref = userRef(req.user.uid);
    await ref.set({ email: req.user.email, ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const snap = await ref.get();
    res.json(view(req.user.uid, snap.data(), req.user.admin));
  }),
);

router.delete(
  '/me',
  requireRecentAuth(300),
  ah(async (req, res) => {
    const uid = req.user.uid;
    await db().recursiveDelete(userRef(uid));
    await auth().deleteUser(uid);
    log('auth.withdraw', { user: hashUid(uid) });
    res.status(200).json({ ok: true });
  }),
);

module.exports = router;
