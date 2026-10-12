'use strict';
require('dotenv').config();
const { createApp } = require('./app');

const port = Number(process.env.PORT || 8787);
createApp().listen(port, () => {
  console.log(`정처기메이트 API 서버 실행 중: http://localhost:${port}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) console.log(`Firestore 에뮬레이터 사용: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`AI 제공사: ${process.env.AI_PROVIDER || 'mock'}`);
});
