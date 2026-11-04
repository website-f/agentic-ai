import 'reflect-metadata';
import {assertReleaseCurrent} from './release-state';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { devLoginOn } from './auth';
import { Db, assertRestrictedLogin, assertSchemaCurrent } from './db';
import { DomainErrors } from './errors';
import { hideSecrets, rateLimit, securityHeaders } from './security';

export async function createApp() {
  // The container image runs with NODE_ENV=production: the test sign-in can never be switched on there.
  if (process.env.NODE_ENV === 'production' && devLoginOn()) throw new Error('ALLOW_DEV_LOGIN must not be true in production.');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], rawBody: true });
  // Stamped photos from the in-app camera are sent as JPEG data URLs (rule EVID-GEO caps one at 700 KB).
  app.useBodyParser('json', { limit: '3mb' });
  app.useGlobalFilters(new DomainErrors());
  // Azure Container Apps' ingress is the one proxy in front: the caller's address is the last one it adds.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('json replacer', hideSecrets);
  app.use(securityHeaders);
  app.use(rateLimit());
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
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
