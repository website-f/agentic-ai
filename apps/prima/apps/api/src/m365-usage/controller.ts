import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, HttpCode, Post, Query, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import {
  USE_CHECKS,
  USE_HOWTO,
  USE_PLAN_GIVES,
  USE_STEPS,
  buildUsage,
  dateOf,
  usageCovered,
  usagePlanCounts,
  usageScore,
  usageSeesAll,
  usageSummary,
  usageVisible,
  type UsageSnapshot,
  type User,
} from '@prima/core';
import { AuthGuard, UserId } from '../auth';
import { noQuery } from '../connections-mail/delegated';
import { Db, nowMyt } from '../db';
import { GraphUsageReader, usageGraphConfiguration } from './graph';
import { m365Links } from './links';
import { PgUsageStore, type UsageStore } from './pg-store';

/** Settings read once at start. Null reader = the daily read is switched off (the board still shows the last day). */
export class UsageRuntime {
  constructor(
    readonly runKey: string | null,
    readonly reader: Pick<GraphUsageReader, 'read'> | null,
    readonly store: UsageStore,
    /** Every Prima to Microsoft 365 link and whether its settings are on (read once at start). */
    readonly links: ReturnType<typeof m365Links> = [],
  ) {}
}

/** Off unless M365_USAGE_ENABLED=true with a run key of 32+ characters and the app's tenant, client id and secret. */
export function usageRuntime(env: NodeJS.ProcessEnv, store: UsageStore, http: typeof fetch = fetch): UsageRuntime {
  const key = env.M365_USAGE_RUN_KEY ?? '';
  const graph = usageGraphConfiguration(env);
  const on = env.M365_USAGE_ENABLED === 'true' && key.length >= 32 && key.length <= 512 && !!graph;
  return new UsageRuntime(on ? key : null, on && graph ? new GraphUsageReader(graph, http) : null, store, m365Links(env));
}

function sameKey(given: string | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What one viewer may see of a stored day: their own checklist, then the people inside their walls. */
export function usageBoard(viewer: User, users: User[], snap: UsageSnapshot | null, today: string, links: ReturnType<typeof m365Links> = []) {
  const howto = USE_CHECKS.map((id) => ({ id, ...USE_HOWTO[id], ...USE_STEPS[id] }));
  // The list of Prima to Microsoft links is for IT and group leaders: it shows only On, Partly or Off, never a setting.
  const linkList = usageSeesAll(viewer) ? links : undefined;
  if (!snap) return { snapshot: null, howto, links: linkList };
  const byId = new Map(users.map((u) => [u.id, u]));
  const rows = snap.people.flatMap((usage) => {
    const person = byId.get(usage.userId);
    return person && usageCovered(person, today) && usageVisible(viewer, person) ? [{ person, usage }] : [];
  });
  const mine = rows.find((r) => r.person.id === viewer.id)?.usage ?? null;
  const others = rows.filter((r) => r.person.id !== viewer.id);
  return {
    snapshot: { asOf: snap.asOf, refreshed: snap.refreshed, namesHidden: snap.namesHidden },
    howto,
    mine: mine && { ...mine, score: usageScore(mine), planGives: mine.plan ? USE_PLAN_GIVES[mine.plan] : null },
    seesAll: usageSeesAll(viewer),
    people: others
      .map(({ person, usage }) => ({
        id: person.id,
        name: person.name,
        title: person.title,
        companyIds: person.companyIds,
        department: person.department ?? null,
        ...usage,
        score: usageScore(usage),
      }))
      .sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || a.name.localeCompare(b.name)),
    summary: others.length ? { ...usageSummary(rows), plans: usagePlanCounts(rows.map((r) => r.usage)) } : null,
    links: linkList,
    /** How many of the people shown actually use the links that can be measured. */
    linkUse: linkList
      ? {
          people: rows.length,
          linked: rows.filter((r) => r.usage.linked).length,
          primaSignIn: rows.filter((r) => r.usage.checks.prima_signin === 'ok').length,
          myApps: rows.filter((r) => r.usage.checks.my_apps === 'ok').length,
          sharePoint: rows.filter((r) => r.usage.checks.sharepoint === 'ok').length,
          teams: rows.filter((r) => r.usage.checks.teams === 'ok').length,
        }
      : undefined,
  };
}

@Controller('api')
export class UsageController {
  constructor(private readonly db: Db, private readonly rt: UsageRuntime) {}

  private async users(): Promise<User[]> {
    const r = await this.db.pool.query('SELECT data FROM prima.users');
    return r.rows.map((x) => x.data as User);
  }

  /** Called once a day by the scheduler with X-Usage-Key. Answers counts only: no names or sign-in names. */
  @Post('m365-usage/run')
  @HttpCode(200)
  async run(@Headers('x-usage-key') key: string | undefined, @Query() q: Record<string, unknown>) {
    noQuery(q);
    const { runKey, reader, store } = this.rt;
    if (!runKey || !reader) throw new ServiceUnavailableException('The Microsoft use board is switched off.');
    if (!sameKey(key, runKey)) throw new UnauthorizedException('Usage key not valid.');
    if (!(await store.ready())) throw new ServiceUnavailableException('The Microsoft use board is not installed yet.');
    const today = dateOf(nowMyt());
    const { sources, failed } = await reader.read();
    const snap = buildUsage(await this.users(), sources, today);
    await store.save(snap);
    return {
      asOf: snap.asOf,
      refreshed: snap.refreshed,
      people: snap.people.length,
      linked: snap.people.filter((p) => p.linked).length,
      namesHidden: snap.namesHidden,
      sourcesNotRead: failed,
    };
  }

  /** The signed-in person's board (Connections screen). Reads the stored day only; never calls Microsoft. */
  @Get('connections/m365/usage')
  @UseGuards(AuthGuard)
  async board(@UserId() uid: string, @Query() q: Record<string, unknown>) {
    noQuery(q);
    const installed = await this.rt.store.ready().catch(() => false);
    const on = !!this.rt.reader;
    return this.db.asUser(uid, async (_svc, viewer) => {
      if (viewer.integration) throw new UnauthorizedException('Not for connected systems.');
      const today = dateOf(nowMyt());
      const snap = installed ? await this.rt.store.latest() : null;
      return { on, installed, ...usageBoard(viewer, installed ? await this.users() : [], snap, today, this.rt.links) };
    });
  }
}

export const usageModule = (env: NodeJS.ProcessEnv = process.env) => ({
  controllers: [UsageController],
  providers: [{ provide: UsageRuntime, inject: [Db], useFactory: (db: Db) => usageRuntime(env, new PgUsageStore(db.pool)) }],
});
