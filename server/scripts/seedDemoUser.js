'use strict';
// 데모 계정 1개 생성: 웹에서 모든 화면(오늘 할 일·재배분·스케줄·진도·오답·취약도·대시보드·레벨테스트)을 확인하기 위한 데이터
//
// 시나리오: 필기 준비 3주째인 직장인 수험생
//  - 3주 전 가입 → 레벨테스트 중급(20문항 중 11문항, 정답률 55%) → 개념 학습 단계, 평일 하루 2시간으로 계획 생성
//  - 지난 3주 학습 과제 중 약 80% 완료(실제 시간·이해도 기록), 나머지는 미완료 → 첫 접속 시 자동 재배분
//  - 데이터베이스(정규화·SQL)·보안 쪽 오답이 많아 취약 유형으로 잡힘
//
// 사용법 (server 폴더에서)
//   node scripts/seedDemoUser.js --prod            실제 프로젝트에 생성(이미 있으면 이 계정 데이터만 지우고 다시 생성)
//   node scripts/seedDemoUser.js --prod --remove   데모 계정과 데이터 삭제
require('dotenv').config();
const { db, auth, FieldValue } = require('../src/config/firebase');
const { addDays, todayKST } = require('../src/lib/dates');
const { statsFromNotes } = require('../src/services/weakness');
const { completionDelta, clampRate } = require('../src/services/progressCalc');
const { gradeLevelTest } = require('../src/services/levelTest');

const DEMO = { email: 'demo@jcm.test', password: 'Demo1234!', nickname: '데모계정' };
const EXAM_ID = '2027-1-written';
const HISTORY_DAYS = 21; // 3주 전에 계획을 만든 것으로 가정

// 레벨테스트 답안(20문항)
//  필기: 설계 3/3, 개발 2/3, DB 1/3, 언어 2/3, 정보시스템 0/3 → 8/15
//  실기: SQL 정답, Python 모름, XSS 정답, 서브넷 오답, 알파 테스트 정답 → 3/5
//  합계 11/20(55%) → 중급, 개념 학습 단계
const LEVEL_ANSWERS = {
  lt01: 3, lt02: 1, lt03: 1, lt04: 1, lt05: 2, lt06: 1, lt07: 3, lt08: 1, lt09: 0, lt10: 1, lt11: 1, lt12: null, lt13: null, lt14: 0, lt15: null,
  lt16: 3, lt17: null, lt18: 2, lt19: 1, lt20: 0,
};

// 오답 기록 12건 (문제 본문은 저장하지 않고 회차·번호·메모만)
const WRONG_NOTES = [
  { daysAgo: 19, subjectId: 'w3', unitId: 'w3-u3', typeTag: '정규화', difficulty: 'high', round: '2024년 1회', number: '43', memo: '2NF·3NF 구분이 헷갈림', reviewed: true },
  { daysAgo: 16, subjectId: 'w3', unitId: 'w3-u1', typeTag: 'SQL', difficulty: 'mid', round: '2024년 2회', number: '47', memo: 'GROUP BY와 HAVING 순서', reviewed: true },
  { daysAgo: 14, subjectId: 'w2', unitId: 'w2-u1', typeTag: '자료구조', difficulty: 'low', round: '2024년 2회', number: '22', memo: '스택·큐 연산 결과', reviewed: false },
  { daysAgo: 12, subjectId: 'w3', unitId: 'w3-u3', typeTag: '정규화', difficulty: 'high', round: '2024년 3회', number: '41', memo: '이행 함수 종속 예시 다시 보기', reviewed: false },
  { daysAgo: 10, subjectId: 'w5', unitId: 'w5-u4', typeTag: '암호화', difficulty: 'mid', round: '2024년 3회', number: '88', memo: '대칭키·공개키 알고리즘 구분', reviewed: false },
  { daysAgo: 9, subjectId: 'w4', unitId: 'w4-u2', typeTag: '코드 실행 결과', difficulty: 'mid', round: '2025년 1회', number: '63', memo: '정수 나눗셈 결과', reviewed: true },
  { daysAgo: 7, subjectId: 'w3', unitId: 'w3-u2', typeTag: '트랜잭션', difficulty: 'mid', round: '2025년 1회', number: '45', memo: 'ACID 각 특성 설명', reviewed: false },
  { daysAgo: 6, subjectId: 'w5', unitId: 'w5-u3', typeTag: '보안 취약점', difficulty: 'high', round: '2025년 1회', number: '91', memo: 'XSS·CSRF 차이', reviewed: false },
  { daysAgo: 4, subjectId: 'w3', unitId: 'w3-u1', typeTag: 'SQL', difficulty: 'high', round: '2025년 2회', number: '49', memo: '서브쿼리 결과 행 수', reviewed: false },
  { daysAgo: 3, subjectId: 'w4', unitId: 'w4-u2', typeTag: '코드 실행 결과', difficulty: 'high', round: '2025년 2회', number: '66', memo: '반복문 누적 값 추적', reviewed: false },
  { daysAgo: 2, subjectId: 'w5', unitId: 'w5-u4', typeTag: '암호화', difficulty: 'mid', round: '2025년 2회', number: '93', memo: '해시와 암호화 차이', reviewed: false },
  { daysAgo: 1, subjectId: 'w3', unitId: 'w3-u3', typeTag: '정규화', difficulty: 'mid', round: '2025년 3회', number: '42', memo: '함수 종속 표기 다시 정리', reviewed: false },
];
const BOOKMARKS = ['w3schools-sql', 'atlassian-agile'];

async function findDemoUser() {
  try {
    return await auth().getUserByEmail(DEMO.email);
  } catch {
    return null;
  }
}

async function removeDemo() {
  const user = await findDemoUser();
  if (!user) return console.log('데모 계정이 없습니다.');
  await db().recursiveDelete(db().collection('users').doc(user.uid));
  await auth().deleteUser(user.uid);
  console.log(`삭제 완료: ${DEMO.email}`);
}

async function seedDemo({ today = todayKST() } = {}) {
  const { generatePlan } = require('../src/services/planService');
  const start = addDays(today, -HISTORY_DAYS);

  // 1) 로그인 계정 (이미 있으면 이 계정의 데이터만 지우고 비밀번호 초기화)
  let user = await findDemoUser();
  if (user) {
    // 같은 이메일로 만든 실제 사용자 데이터를 지우지 않도록, 이 스크립트가 만든 계정(demo: true)만 다시 만든다.
    const existing = await db().collection('users').doc(user.uid).get();
    if (existing.exists && existing.data()?.demo !== true) throw new Error(`${DEMO.email}은 데모 계정이 아닌 기존 사용자입니다. 데이터를 지우지 않고 중단합니다.`);
    await db().recursiveDelete(db().collection('users').doc(user.uid));
    await auth().updateUser(user.uid, { password: DEMO.password, displayName: DEMO.nickname });
  } else {
    user = await auth().createUser({ email: DEMO.email, password: DEMO.password, displayName: DEMO.nickname });
  }
  const userRef = db().collection('users').doc(user.uid);

  // 2) 레벨테스트 결과 → 학습 단계·과목별 자신감 (실제 채점 함수 사용)
  const { result } = gradeLevelTest(LEVEL_ANSWERS);
  const exam = (await db().collection('exams').doc(EXAM_ID).get()).data();
  if (!exam) throw new Error(`시험 회차 ${EXAM_ID}가 없습니다. 먼저 npm run seed -- --prod 로 마스터 데이터를 넣어 주세요.`);
  const profile = {
    examType: 'written',
    examId: EXAM_ID,
    examDate: exam.examDate,
    dailyHours: 2,
    studyDays: [1, 2, 3, 4, 5],
    stage: result.recommendedStage,
    subjectProgress: { w1: 40, w2: 20, w3: 10, w4: 30, w5: 0 },
    subjectConfidence: Object.fromEntries(['w1', 'w2', 'w3', 'w4', 'w5'].map((s) => [s, result.subjectConfidence[s]])),
    updatedAt: new Date(`${start}T09:00:00+09:00`).toISOString(),
  };
  await userRef.set({
    email: DEMO.email,
    nickname: DEMO.nickname,
    role: 'user',
    consentAgreedAt: new Date(`${start}T09:00:00+09:00`).toISOString(),
    levelTestPending: false,
    levelTest: { ...result, takenAt: new Date(`${start}T09:05:00+09:00`).toISOString(), takenDate: start },
    profile,
    targetExamId: EXAM_ID,
    demo: true,
    createdAt: new Date(`${start}T09:00:00+09:00`),
  });

  // 3) 오답 기록 + 취약도 집계
  const notes = WRONG_NOTES.map((n) => ({
    subjectId: n.subjectId,
    unitId: n.unitId,
    typeTag: n.typeTag,
    difficulty: n.difficulty,
    sourceRef: { round: n.round, number: n.number, url: '' },
    memo: n.memo,
    reviewed: n.reviewed,
    createdDate: addDays(today, -n.daysAgo),
  }));
  const batch = db().batch();
  notes.forEach((n) => batch.set(userRef.collection('wrongNotes').doc(), { ...n, createdAt: new Date(`${n.createdDate}T21:00:00+09:00`) }));
  BOOKMARKS.forEach((id) => batch.set(userRef.collection('bookmarks').doc(id), { createdAt: FieldValue.serverTimestamp() }));
  await batch.commit();
  await userRef.collection('meta').doc('wrongStats').set({ tags: statsFromNotes(notes) });

  // 4) 3주 전 날짜로 스케줄 생성 (실제 스케줄러 사용)
  const plan = await generatePlan(user.uid, { today: start, confirmOverwrite: true });

  // 5) 지난 3주 학습 기록: 약 80% 완료, 나머지는 미완료로 남겨 첫 접속 때 재배분되게 함
  const past = (await userRef.collection('tasks').where('planId', '==', plan.planId).where('date', '<', today).get()).docs
    .map((d) => ({ ref: d.ref, ...d.data() }))
    .filter((t) => t.type === 'study')
    .sort((a, b) => a.date.localeCompare(b.date));
  const progress = {};
  const writes = db().batch();
  let doneCount = 0;
  past.forEach((t, i) => {
    if (i % 5 === 3) return; // 미완료
    const understanding = i % 7 === 0 ? 1 : i % 2 ? 2 : 3;
    const needsReview = understanding === 1;
    writes.update(t.ref, {
      done: true,
      doneAt: t.date,
      actualMinutes: Math.max(10, t.minutes + ((i % 3) - 1) * 10),
      understanding,
      needsReview,
      checklist: (t.checklist || []).map((c) => ({ ...c, done: true })),
    });
    const prev = progress[t.unitId]?.rate ?? t.baseRate ?? 0;
    progress[t.unitId] = {
      subjectId: t.subjectId,
      rate: clampRate(prev + completionDelta(t.baseRate, t.minutes, t.unitPlanMinutes)),
      understanding,
      needsReview,
    };
    doneCount++;
  });
  Object.entries(progress).forEach(([unitId, p]) => writes.set(userRef.collection('progress').doc(unitId), { ...p, updatedAt: FieldValue.serverTimestamp() }));
  await writes.commit();

  return { uid: user.uid, start, examDate: profile.examDate, level: result, taskCount: plan.taskCount, pastStudy: past.length, doneCount, units: Object.keys(progress).length, notes: notes.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !args.includes('--prod')) {
    console.error(`실제 프로젝트(${process.env.FIREBASE_PROJECT_ID})에 쓰려면 --prod 를 붙이세요.`);
    process.exit(1);
  }
  (args.includes('--remove') ? removeDemo() : seedDemo().then((r) => {
    console.log(`데모 계정 생성 완료 (${process.env.FIREBASE_PROJECT_ID})`);
    console.log(`  로그인: ${DEMO.email} / ${DEMO.password}`);
    console.log(`  레벨테스트 ${r.level.levelLabel} ${r.level.correct}/${r.level.total} → ${r.level.recommendedStage} 단계`);
    console.log(`  계획 시작 ${r.start}, 시험일 ${r.examDate}, 과제 ${r.taskCount}건`);
    console.log(`  지난 학습 과제 ${r.pastStudy}건 중 ${r.doneCount}건 완료(단원 ${r.units}개 진도 반영), 오답 ${r.notes}건`);
  }))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { seedDemo, removeDemo, DEMO };
