// Monthly reports Prima makes by itself (Fauzan, 23 Nov 2026: "Let system automaticly create every month report
// needed"). Once a day, as the system sign-in u-report-maker (integration report_maker), Prima makes the month's
// reports once the make day has come (the 1st, rule RPT-AUTO) and sends any internal report its owner has not sent by
// the due day, marked Not checked (decision card, 23 Nov 2026). Client reports are never sent by it.
//
// Settings:
//   AUTO_REPORTS_ENABLED=false     stops the daily run (on by default; it does nothing until module auto-reports-v1 is in)
//   AUTO_REPORTS_USER_ID           the system sign-in (default u-report-maker). It sees a company only through the
//                                  monitor lines the CEO gives it in the app; without them, company and client reports
//                                  are made when the owner opens Reports instead, and sent on the due day by the
//                                  Director Office's Make now.
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Db } from './db';

export function autoReportsOn(env: NodeJS.ProcessEnv = process.env) {
  return env.AUTO_REPORTS_ENABLED?.trim() !== 'false';
}
const userId = () => process.env.AUTO_REPORTS_USER_ID?.trim() || 'u-report-maker';

export async function runAutoReports(db: Db, clock?: () => string) {
  return db.asUser(userId(), async (svc, u) => {
    if (!(await svc.autoReports.installed())) return { month: null, made: 0, sent: 0, installed: false };
    return { ...(await svc.autoReports.run(u)), installed: true };
  }, clock);
}

/** Runs 10 minutes after the server starts, then every 6 hours (a run that finds nothing to do changes nothing). */
@Injectable()
export class AutoReportsRunner implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  constructor(private db: Db) {}
  onModuleInit() {
    if (!autoReportsOn()) return;
    const tick = () => void runAutoReports(this.db).catch((e: unknown) => console.error(`Monthly reports: ${e instanceof Error ? e.message : 'failed'}`));
    const first = setTimeout(tick, 10 * 60_000);
    const every = setInterval(tick, 6 * 3_600_000);
    first.unref();
    every.unref();
    this.timers.push(first, every);
  }
  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }
}
