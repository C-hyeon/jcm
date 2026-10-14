'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { requireAuth } = require('./middleware/auth');
const { userLimiter, today, httpsRedirect, notFound, errorHandler } = require('./middleware/common');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(httpsRedirect);
  app.use(helmet({ hsts: { maxAge: 15552000, includeSubDomains: true } }));

  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Debug-Today'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', require('./routes/public'));

  const priv = express.Router();
  priv.use(requireAuth, userLimiter, today);
  priv.use(require('./routes/me'));
  priv.use(require('./routes/study'));
  priv.use(require('./routes/insights'));
  priv.use(require('./routes/wrongNotes'));
  priv.use(require('./routes/personal'));
  priv.use(require('./routes/admin'));
  app.use('/api', priv);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
