import { timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { RULES, accessClosed, dateOf, type User } from '@prima/core';
import { AuthGuard, UserId, pilotAdmits } from '../auth';
import { leadershipOnboardingPermits } from '../arisha-pilot';
import { Db, nowMyt } from '../db';
import { GraphAlertMail, alertsConfiguration, runAlerts, type AlertLedger, type AlertRecipient, type AlertsConfig } from './alerts';
import { PgAlertLedger } from './pg-alert-ledger';

/** Settings and senders, read once at start. Null config = alerts are switched off. */
export class AlertsRuntime {
  constructor(
    readonly config: AlertsConfig | null,
    readonly ledger: (AlertLedger & { ready(): Promise<boolean> }) | null,
    readonly mail: GraphAlertMail | null,
    readonly http: typeof fetch = fetch,
  ) {}
}

function sameKey(given: string | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** People who can receive alerts: a linked Microsoft account, an open account, office staff, the pilot rule. */
export function alertRecipients(users: User[], today: string, env: Record<string, string | undefined> = process.env): AlertRecipient[] {
  return users
    .filter((u) => !u.integration && u.role !== 'guard' && u.role !== 'site_device' && typeof u.entraOid === 'string' && u.entraOid)
    .filter((u) => !accessClosed(u, today) && (!RULES.pilot.value.on || pilotAdmits(u, env)) && leadershipOnboardingPermits(u, env))
    .map((u) => ({ id: u.id, entraOid: u.entraOid!, department: u.department ?? null }));
}

@Controller('api/alerts')
export class AlertsController {
  constructor(private readonly db: Db, private readonly rt: AlertsRuntime) {}

  /**
   * Called by the scheduler (urgent every 15 minutes in working hours, digest once at 8 am), with X-Alerts-Key.
   * Answers counts only: no names, addresses or item text.
   */
  @Post('run')
  @HttpCode(200)
  async run(@Headers('x-alerts-key') key: string | undefined, @Query('mode') mode: string | undefined) {
    const { config, ledger } = this.rt;
    if (!config || !ledger) throw new ServiceUnavailableException('Alerts are switched off.');
    if (!sameKey(key, config.runKey)) throw new UnauthorizedException('Alerts key not valid.');
    if (mode !== 'urgent' && mode !== 'digest') throw new BadRequestException('mode must be urgent or digest.');
    if (!(await ledger.ready())) throw new ServiceUnavailableException('Alerts sent-record is not installed yet.');
    const today = dateOf(nowMyt());
    const rows = await this.db.pool.query('SELECT data FROM prima.users');
    const recipients = alertRecipients(rows.rows.map((r) => r.data as User), today);
    return runAlerts({
      config,
      mode,
      today,
      recipients,
      itemsFor: (id) => this.db.asUser(id, (svc, u) => svc.alertItems(u)),
      prefsFor: (id) => this.db.asUser(id, (svc, u) => svc.alertPrefsRow(u)),
      ledger,
      mail: this.rt.mail,
      http: this.rt.http,
    });
  }

  /**
   * The in-app bell (Fauzan, 5 Nov 2026: alerts in Teams, email AND Prima): the signed-in person's own alerts,
   * red first, and whether email and their department's Teams channel are on. Sends nothing.
   */
  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@UserId() uid: string) {
    return this.db.asUser(uid, async (svc, u) => ({
      items: await svc.myAlerts(u),
      email: !!this.rt.config?.mail,
      teamsChannel: !!(u.department && this.rt.config?.teams[u.department]),
    }));
  }
}

/** J6: each person chooses their own alerts (urgent safety alerts always go out). Their own row only. */
@Controller('api/alerts')
@UseGuards(AuthGuard)
export class AlertPrefsController {
  constructor(private readonly db: Db) {}

  @Get('prefs')
  mine(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myAlertPrefs(u));
  }

  @Post('prefs')
  @HttpCode(200)
  save(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.urgent !== 'boolean' || typeof b.digest !== 'boolean') throw new BadRequestException('urgent and digest must be true or false');
    if (!Array.isArray(b.muted) || b.muted.length > 100 || b.muted.some((x) => typeof x !== 'string' || x.length > 60)) throw new BadRequestException('muted must be a list of up to 100 topics');
    return this.db.asUser(uid, (svc, u) => svc.setMyAlertPrefs(u, { urgent: b.urgent as boolean, digest: b.digest as boolean, muted: b.muted as string[] }));
  }
}

export const alertsModule = (env: NodeJS.ProcessEnv = process.env) => ({
  controllers: [AlertsController, AlertPrefsController],
  providers: [
    {
      provide: AlertsRuntime,
      inject: [Db],
      useFactory: (db: Db) => {
        const config = alertsConfiguration(env);
        return new AlertsRuntime(config, config ? new PgAlertLedger(db.pool) : null, config?.mail ? new GraphAlertMail(config.mail) : null);
      },
    },
  ],
});
