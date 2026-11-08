import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import { RULES, type User } from '@prima/core';
import { GuardPhoneOpenController } from '../src/guard-phone.controller';
import type { AuthedRequest } from '../src/auth';
import type { Db } from '../src/db';

// No biometric engine or provider is invoked: a misconfigured server engine would throw if reached.
describe('guard phone credential check precedes biometric processing', () => {
  const saved = { ...process.env }, pilot = RULES.pilot.value.on;
  const user = { id: 'synthetic-guard', personId: 'synthetic-person', role: 'guard', companyIds: ['synthetic-company'], siteIds: [], name: 'Synthetic guard', title: 'Guard' } as User;
  const device = { userId: user.id, phoneId: 'synthetic-phone', secret: 'invalid-device-secret' };
  const req = { ip: 'synthetic-preauth-test' } as AuthedRequest;
  before(() => {
    (RULES.pilot.value as { on: boolean }).on = false;
    Object.assign(process.env, { GUARD_PHONE: 'on', GUARD_PHONE_SECRET: 'synthetic-guard-secret-at-least-32-characters', FACE_ENGINE: 'server' });
    delete process.env.FACE_CHALLENGE_SECRET;
    delete process.env.LEADERSHIP_ONBOARDING_ONLY;
  });
  after(() => {
    (RULES.pilot.value as { on: boolean }).on = pilot;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  for (const route of ['face', 'signIn'] as const) {
    it(`${route}: unknown, revoked or mismatched device is refused before any face setup`, async () => {
      const denied = new Error('synthetic device credential refused');let checked=0;
      const db = {
        pool: { query: async () => ({ rows: [{ data: user }] }) },
        asUser: async (_id: string, fn: (svc: unknown, user: User) => unknown) => fn({ guardPhone: { status: async () => { checked++;throw denied; } } }, user),
      } as unknown as Db;
      const controller = new GuardPhoneOpenController(db);
      await assert.rejects(controller[route](req, { device, pin: '4826', photo: 'data:image/jpeg;base64,c3ludGhldGlj' }), e => e === denied);
      assert.equal(checked,1);
    });
    it(`${route}: locked valid device is refused before face setup`, async () => {
      const db = {
        pool: { query: async () => ({ rows: [{ data: user }] }) },
        asUser: async (_id: string, fn: (svc: unknown, user: User) => unknown) => fn({ guardPhone: { status: async () => ({ lockedUntil: '2099-01-01T00:00:00Z' }) } }, user),
      } as unknown as Db;
      await assert.rejects(new GuardPhoneOpenController(db)[route](req,{ device,pin:'4826',photo:'data:image/jpeg;base64,c3ludGhldGlj' }), (e: unknown) => e instanceof HttpException && e.getStatus() === (route==='face'?400:423));
    });
  }
});
