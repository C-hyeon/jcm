'use strict';
// Vercel Serverless Functions 진입점 (배포 플랫폼 종속 코드는 이 파일과 vercel.json에만 둔다)
require('dotenv').config();
const { createApp } = require('../src/app');

module.exports = createApp();
