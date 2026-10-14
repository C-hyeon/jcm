'use strict';

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
