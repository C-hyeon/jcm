'use strict';
/**
 * 마스터·자료 메타데이터를 JSON으로 내보내 GitHub에서 버전 관리한다(명세 3.6 저장 및 백업).
 * 개인 학습 데이터(users/*)는 내보내지 않는다.
 *   node scripts/exportMasters.js  →  seed/export/*.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../src/config/firebase');

(async () => {
  const out = path.join(__dirname, '..', 'seed', 'export');
  fs.mkdirSync(out, { recursive: true });
  const strip = ({ createdAt, updatedAt, ...rest }) => rest;

  const exams = (await db().collection('exams').get()).docs.map((d) => ({ id: d.id, ...strip(d.data()) }));
  const subjects = await Promise.all(
    (await db().collection('subjects').get()).docs.map(async (d) => ({
      id: d.id,
      ...strip(d.data()),
      units: (await d.ref.collection('units').get()).docs.map((u) => ({ id: u.id, ...u.data() })).sort((a, b) => a.order - b.order),
    })),
  );
  const materials = (await db().collection('materials').get()).docs.map((d) => {
    const { createdBy, linkCheckedAt, linkHttpStatus, ...m } = strip(d.data());
    return { id: d.id, ...m };
  });

  fs.writeFileSync(path.join(out, 'exams.json'), JSON.stringify(exams, null, 2));
  fs.writeFileSync(path.join(out, 'subjects.json'), JSON.stringify(subjects.sort((a, b) => a.order - b.order), null, 2));
  fs.writeFileSync(path.join(out, 'materials.json'), JSON.stringify(materials, null, 2));
  console.log(`내보내기 완료: ${out} (시험 ${exams.length}, 과목 ${subjects.length}, 자료 ${materials.length})`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
