'use strict';
/**
 * Firebase Admin SDK 초기화 (지연 초기화)
 * - 운영: FIREBASE_SERVICE_ACCOUNT_BASE64(서비스 계정 JSON을 base64로) 환경변수
 * - 로컬: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST 가 있으면 에뮬레이터에 자동 연결
 * 서비스 계정 키는 코드·저장소에 넣지 않는다(명세 3.8).
 */
const admin = require('firebase-admin');
const { FieldValue, FieldPath, Timestamp } = require('firebase-admin/firestore');

let initialized = false;
function init() {
  if (initialized) return;
  const options = { projectId: process.env.FIREBASE_PROJECT_ID };
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    options.credential = admin.credential.cert(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')));
  }
  admin.initializeApp(options);
  admin.firestore().settings({ ignoreUndefinedProperties: true });
  initialized = true;
}

const db = () => {
  init();
  return admin.firestore();
};
const auth = () => {
  init();
  return admin.auth();
};

module.exports = { db, auth, FieldValue, FieldPath, Timestamp };
