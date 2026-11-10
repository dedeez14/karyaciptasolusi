import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { env, isProd } from './config/env';
import { AppModule } from './app.module';
import { RequestCtx } from './common/context/request-context';

// BigInt (audit ids) -> JSON string
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: isProd ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'] });
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  // Layer: security headers (CSP, HSTS, frame-ancestors, no-sniff, referrer policy ...)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  app.use(compression({ filter: (req: any, res: any) => !String(req.headers.accept ?? '').includes('text/event-stream') && compression.filter(req, res) }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });

  // Request context (request id, ip, user agent) for logging / auditing
  app.use((req: any, res: any, next: () => void) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    RequestCtx.run({ requestId, ip: req.ip, userAgent: req.headers['user-agent'] }, next);
  });

  // A missing bundle (old page after an update) must 404 instead of falling back to index.html,
  // otherwise the browser receives HTML for a CSS/JS file and renders an unstyled, broken page.
  const assetsDir = join(__dirname, '..', '..', 'web', 'dist', 'assets');
  app.use('/assets', (req: any, res: any, next: () => void) => {
    const rel = normalize(decodeURIComponent(req.path)).replace(/^[/\\]+/, '');
    if (rel.includes('..') || !existsSync(join(assetsDir, rel))) return res.status(404).type('text/plain').send('Not found');
    next();
  });

  // API responses must never be cached by browsers/proxies
  app.use('/api', (_req: any, res: any, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.enableCors({ origin: (o, cb) => cb(null, !o || origins.includes(o)), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-Id', 'X-Branch-Id', 'X-Requested-With'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  Logger.log(`${env.APP_NAME} API listening on http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
}

bootstrap();
