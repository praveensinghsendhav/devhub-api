import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import { clientOrigins, env } from './config/env.js';
import { requestLogger } from './common/middlewares/requestLogger.js';
import { sanitizeRequest } from './common/middlewares/sanitizeRequest.js';
import { apiLimiter } from './common/middlewares/rateLimiter.js';
import { notFound } from './common/middlewares/notFound.js';
import { errorHandler } from './common/middlewares/errorHandler.js';
import { apiRouter } from './routes/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Trust the host's load balancer X-Forwarded-For so rate limits are per client.
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      origin: clientOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(hpp());
  app.use(sanitizeRequest);
  app.use(apiLimiter);

  app.get('/health', (_req, res) => {
    res.status(200).json({ success: true, data: { status: 'ok' } });
  });

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
