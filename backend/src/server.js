import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { router as healthRouter } from './routes/health.js';
import { router as authRouter } from './routes/auth.js';
import { router as usersRouter } from './routes/users.js';

export async function createApp() {
  const app = express();
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    cors({
      origin(origin, cb) {
        // allow same-origin / no-origin (server-side / curl / mobile) requests
        if (!origin) return cb(null, true);
        // In dev, allow file:// protocol (Origin: null) for quick frontend testing
        if (origin === 'null' && !env.isProd) return cb(null, true);
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );
  app.use(morgan(env.isProd ? 'combined' : 'dev'));
  app.use(apiLimiter);

  // --- routes ---
  app.use('/', healthRouter);        // GET /health
  app.use('/auth', authRouter);      // POST /auth/register, POST /auth/login
  app.use('/users', usersRouter);    // GET/PATCH /users/me

  // --- error handling (last!) ---
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = await createApp();

if (!env.isTest) {
  app.listen(env.port, () => {
    console.log(`[server] Poker777 Core API listening on http://localhost:${env.port}`);
  });
}

export { app };
