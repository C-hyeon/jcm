'use strict';
/**
 * 초기 마스터 데이터(시험 일정, 과목·단원, 학습 자료 메타데이터) 적재 + 테스트 계정 5개 생성
 *
 *   npm run seed                    # 에뮬레이터에 마스터 데이터
 *   npm run seed:test-users         # + 테스트 계정 5개(시험일까지 30·90·180일, 오답 0·20·100건 등)
 *   node scripts/seed.js --prod     # 운영 프로젝트에 마스터 데이터만(테스트 계정 불가)
 */
require('dotenv').config();
const { db, auth, FieldValue } = require('../src/config/firebase');
const { addDays, todayKST } = require('../src/lib/dates');
const { statsFromNotes } = require('../src/services/weakness');

const args = process.argv.slice(2);
const withUsers = args.includes('--test-users');
const prod = args.includes('--prod');

if (!process.env.FIRESTORE_EMULATOR_HOST && !prod) {
  console.error('안전을 위해 기본은 에뮬레이터에서만 실행합니다. 운영에 마스터 데이터를 넣으려면 --prod 를 붙이세요.');
  process.exit(1);
}
if (withUsers && (!process.env.FIREBASE_AUTH_EMULATOR_HOST || prod)) {
  console.error('테스트 계정은 Auth 에뮬레이터(또는 테스트용 프로젝트)에서만 만듭니다. 실사용자 데이터를 테스트 환경에 복사하지 마세요.');
  process.exit(1);
}

async function seedMasters() {
  const exams = require('../seed/exams.json');
  const subjects = require('../seed/subjects.json');
  const materials = require('../seed/materials.json');
  const batch = db().batch();
  exams.forEach(({ id, ...e }) => batch.set(db().collection('exams').doc(id), e));
  subjects.forEach(({ id, units, ...s }) => {
    const ref = db().collection('subjects').doc(id);
    batch.set(ref, s);
    units.forEach(({ id: uid, ...u }) => batch.set(ref.collection('units').doc(uid), u));
  });
  materials.forEach(({ id, ...m }) =>
    batch.set(db().collection('materials').doc(id), { ...m, visible: true, linkStatus: 'unknown', createdAt: FieldValue.serverTimestamp() }),
  );
  await batch.commit();
  console.log(`마스터 적재 완료: 시험 ${exams.length}건, 과목 ${subjects.length}개(단원 ${subjects.reduce((a, s) => a + s.units.length, 0)}개), 자료 ${materials.length}건`);
}

// 재현 가능한 의사 난수
function prng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const TEST_USERS = [
  { email: 'test1@jcm.test', nickname: '입문자30', examType: 'written', days: 30, hours: 2, studyDays: [1, 2, 3, 4, 5], stage: 'intro', wrong: 0, progress: 0 },
  { email: 'test2@jcm.test', nickname: '전공생90', examType: 'written', days: 90, hours: 2, studyDays: [1, 2, 3, 4, 5], stage: 'concept', wrong: 20, progress: 30 },
  { email: 'test3@jcm.test', nickname: '재응시180', examType: 'written', days: 180, hours: 1.5, studyDays: [0, 1, 2, 3, 4, 5, 6], stage: 'practice', wrong: 100, progress: 60 },
  { email: 'test4@jcm.test', nickname: '실기준비', examType: 'practical', days: 60, hours: 3, studyDays: [0, 3, 6], stage: 'concept', wrong: 20, progress: 20 },
  { email: 'test5@jcm.test', nickname: '직장인', examType: 'practical', days: 21, hours: 1, studyDays: [1, 3, 5, 6], stage: 'final', wrong: 100, progress: 50 },
];
const PASSWORD = 'Test1234!';

async function seedUsers() {
  const { generatePlan } = require('../src/services/planService');
  const subjects = require('../seed/subjects.json');
  const today = todayKST();
  for (const [i, t] of TEST_USERS.entries()) {
    let user;
    try {
      user = await auth().getUserByEmail(t.email);
      await db().recursiveDelete(db().collection('users').doc(user.uid));
    } catch {
      user = await auth().createUser({ email: t.email, password: PASSWORD, displayName: t.nickname });
    }
    const subs = subjects.filter((s) => s.examType === t.examType);
    const rand = prng(1000 + i);
    const profile = {
      examType: t.examType,
      examId: null,
      examDate: addDays(today, t.days),
      dailyHours: t.hours,
      studyDays: t.studyDays,
      stage: t.stage,
      subjectProgress: Object.fromEntries(subs.map((s, k) => [s.id, Math.max(0, Math.min(100, t.progress + (k % 3) * 10 - 10))])),
      subjectConfidence: Object.fromEntries(subs.map((s, k) => [s.id, ((k + i) % 3) + 1])),
    };
    const userRef = db().collection('users').doc(user.uid);
    await userRef.set({ email: t.email, nickname: t.nickname, role: 'user', profile, consentAgreedAt: new Date().toISOString(), createdAt: FieldValue.serverTimestamp() });

    const notes = Array.from({ length: t.wrong }, () => {
      const s = subs[Math.floor(rand() * subs.length)];
      return {
        subjectId: s.id,
        unitId: null,
        typeTag: s.tags[Math.floor(rand() * s.tags.length)],
        difficulty: ['high', 'mid', 'low'][Math.floor(rand() * 3)],
        sourceRef: { round: `${2024 + Math.floor(rand() * 3)}년 ${1 + Math.floor(rand() * 3)}회`, number: String(1 + Math.floor(rand() * 100)), url: '' },
        memo: '헷갈린 개념 메모(예시)',
        reviewed: rand() < 0.25,
        createdDate: addDays(today, -Math.floor(rand() * 40)),
      };
    });
    for (let k = 0; k < notes.length; k += 400) {
      const batch = db().batch();
      notes.slice(k, k + 400).forEach((n) => batch.set(userRef.collection('wrongNotes').doc(), { ...n, createdAt: new Date(`${n.createdDate}T12:00:00+09:00`) }));
      await batch.commit();
    }
    await userRef.collection('meta').doc('wrongStats').set({ tags: statsFromNotes(notes) });

    const out = await generatePlan(user.uid, { today, confirmOverwrite: true });
    console.log(`  ${t.email} / ${PASSWORD} — ${t.examType === 'written' ? '필기' : '실기'} D-${t.days}, 오답 ${t.wrong}건, 과제 ${out.taskCount}건`);
  }
}

(async () => {
  await seedMasters();
  if (withUsers) {
    console.log('테스트 계정 생성:');
    await seedUsers();
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
