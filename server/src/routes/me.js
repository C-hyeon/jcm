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
    // 레벨테스트: 신규 가입자는 levelTestPending=true → 응시하거나 건너뛰기 전까지 레벨테스트 화면으로 안내
    levelTestPending: !!u.levelTestPending,
    levelTest: u.levelTest || null,
  };
}

// 신규 사용자 문서의 기본값. 가입 직후 GET과 PUT이 동시에 도착할 수 있으므로
// 이 기본값은 "문서가 없을 때만" 원자적으로 기록해야 한다 (기존 값 덮어쓰기 금지).
function newUserDoc(user) {
  return {
    email: user.email,
    nickname: (user.email || '수험생').split('@')[0].slice(0, 20),
    role: 'user',
    levelTestPending: true,
    createdAt: FieldValue.serverTimestamp(),
  };
}

const ALREADY_EXISTS = 6; // gRPC status code

router.get(
  '/me',
  ah(async (req, res) => {
    const ref = userRef(req.user.uid);
    let snap = await ref.get();
    if (!snap.exists) {
      try {
        // create()는 문서가 이미 있으면 실패하므로, 그 사이 PUT이 저장한 닉네임·동의를 덮어쓰지 않는다.
        await ref.create(newUserDoc(req.user));
        log('auth.signup', { user: hashUid(req.user.uid), provider: req.user.provider });
      } catch (e) {
        if (e.code !== ALREADY_EXISTS) throw e;
      }
      snap = await ref.get();
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
    // PUT이 GET보다 먼저 도착해 문서를 처음 만드는 경우에도 role·createdAt 등 기본값을 채운다.
    const created = await db().runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const patch = { email: req.user.email, ...update, updatedAt: FieldValue.serverTimestamp() };
      if (cur.exists) tx.update(ref, patch);
      else tx.set(ref, { ...newUserDoc(req.user), ...patch });
      return !cur.exists;
    });
    if (created) log('auth.signup', { user: hashUid(req.user.uid), provider: req.user.provider });
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
