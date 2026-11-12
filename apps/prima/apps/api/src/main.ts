import 'reflect-metadata';
import {assertReleaseCurrent} from './release-state';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { devLoginOn, rateIdentity } from './auth';
import { faceEngineConfig } from './face-engine';
import { guardPhoneConfig } from './guard-phone';
import { Db, assertRestrictedLogin, assertSchemaCurrent } from './db';
import { DomainErrors } from './errors';
import { hideSecrets, rateLimit, securityHeaders } from './security';

export async function createApp() {
  // The container image runs with NODE_ENV=production: the test sign-in can never be switched on there.
  if (process.env.NODE_ENV === 'production' && devLoginOn()) throw new Error('ALLOW_DEV_LOGIN must not be true in production.');
  // FACE_ENGINE=server without a challenge secret stops the API here, not at the first face check.
  faceEngineConfig();
  // GUARD_PHONE=on without its own token secret stops the API here.
  guardPhoneConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], rawBody: true });
  // Stamped photos from the in-app camera are sent as JPEG data URLs (rule EVID-GEO caps one at 700 KB).
  app.useBodyParser('json', { limit: '3mb' });
  app.useGlobalFilters(new DomainErrors());
  // Azure Container Apps' ingress is the one proxy in front: the caller's address is the last one it adds.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('json replacer', hideSecrets);
  app.use(securityHeaders);
  // Client report links are public: a tighter limit per address on top of the general one.
  app.use('/api/share', rateLimit(Number(process.env.SHARE_RATE_LIMIT_PER_MIN ?? 30)));
  // J1: the client portal is public too (a personal link and an access code): the same tighter limit.
  app.use('/api/portal', rateLimit(Number(process.env.SHARE_RATE_LIMIT_PER_MIN ?? 30)));
  app.use(rateLimit(undefined, undefined, undefined, undefined, rateIdentity));
  // On Azure the website (Static Web Apps) and the API (Container Apps) have different addresses: only the
  // website named in WEB_ORIGIN may call the API from a browser. Unset in development, where Vite proxies /api.
  const origins = (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, methods: ['GET', 'POST'], allowedHeaders: ['authorization', 'content-type'], maxAge: 600 });
  app.enableShutdownHooks();
  // On Azure the API must run as its own restricted login (prima_api), never as the database administrator, and only
  // on a database already set up for this build.
  if (process.env.NODE_ENV === 'production') {
    try {
      await assertRestrictedLogin(app.get(Db).pool);
      await assertSchemaCurrent(app.get(Db).pool);
      await assertReleaseCurrent(app.get(Db).pool);
      // With cloud file storage switched on, prove the API can save and read a file before it takes any photo.
      const files = app.get(Db).files;
      if (files) await files.backend.check();
    } catch (e) {
      await app.close();
      throw e;
    }
  }
  return app;
}

if (require.main === module) {
  createApp()
    .then(async (app) => {
      const port = Number(process.env.PORT ?? 3000);
      await app.listen(port);
      console.log(`Prima Secure API listening on http://localhost:${port}`);
      const files = app.get(Db).files;
      console.log(files ? `Photos and documents are kept in ${files.backend.label}.` : 'Cloud file storage is off: photos and documents stay in the database.');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
