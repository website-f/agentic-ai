// Hand-overs between departments and real-data import (connect-departments, 2 Nov 2026).
// Every route runs as the signed-in person (Db.asUser): the database walls and the service checks decide what they see.
import { Body, Controller, Get, HttpException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IMPORTABLE_KINDS, ImportError, OrgLinkError, registeredRollouts, type RecordKind } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { orgLinksProblems } from './org-links-readiness';

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function kindOf(v: unknown): RecordKind {
  const k = str(v, 40) as RecordKind;
  if (!IMPORTABLE_KINDS.includes(k)) throw new HttpException({ message: 'This kind of record is not imported in bulk.' }, 400);
  return k;
}

/** Map the layer's own errors to HTTP; everything else goes to the shared filter. */
async function mapped<R>(p: Promise<R>): Promise<R> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof OrgLinkError || e instanceof ImportError) throw new HttpException({ message: e.message }, e.status);
    throw e;
  }
}

@Controller('api/org')
@UseGuards(AuthGuard)
export class OrgController {
  constructor(private db: Db) {}

  /** Guide cards for me: what to enter, from where, whom to ask, what is reused (read-only help). */
  @Get('guide')
  guide(@UserId() uid: string) {
    return mapped(this.db.asUser(uid, async (svc, u) => svc.guideCards(u)));
  }

  /** My hand-overs from other departments. */
  @Get('inbox')
  inbox(@UserId() uid: string, @Query('offset') offset?: string) {
    const n = offset === undefined ? 0 : Number(offset);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new HttpException({ message: 'Offset must be a whole number.' }, 400);
    return mapped(this.db.asUser(uid, (svc, u) => svc.orgLinks.inbox(u, { offset: n })));
  }

  @Post('inbox/:id/close')
  close(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const outcome = b?.outcome === 'not_needed' ? 'not_needed' : 'done';
    return mapped(this.db.asUser(uid, (svc, u) => svc.orgLinks.close(u, str(id, 200), outcome, str(b?.note, 500))));
  }

  @Post('inbox/:id/read')
  read(@UserId() uid: string, @Param('id') id: string) {
    return mapped(this.db.asUser(uid, (svc, u) => svc.orgLinks.markRead(u, str(id, 200))));
  }

  /** How departments connect; counts and the late list for ACT and group leadership. */
  @Get('map')
  map(@UserId() uid: string) {
    return mapped(this.db.asUser(uid, async (svc, u) => ({ ...(await svc.orgLinks.map(u)), rollouts: registeredRollouts() })));
  }

  @Get('import/:kind/template')
  template(@UserId() uid: string, @Param('kind') kind: string) {
    return mapped(this.db.asUser(uid, async (svc) => svc.orgImport.template(kindOf(kind))));
  }

  @Post('import/:kind/preview')
  preview(@UserId() uid: string, @Param('kind') kind: string, @Body() b: Record<string, unknown>) {
    const k = kindOf(kind);
    return mapped(this.db.asUser(uid, (svc, u) => svc.orgImport.preview(u, k, str(b?.companyId, 60) || null, str(b?.csv, 1_000_001))));
  }

  @Post('import/:kind/commit')
  commit(@UserId() uid: string, @Param('kind') kind: string, @Body() b: Record<string, unknown>) {
    const k = kindOf(kind);
    return mapped(
      this.db.asUser(uid, (svc, u) => svc.orgImport.commit(u, k, str(b?.companyId, 60) || null, str(b?.csv, 1_000_001), str(b?.fingerprint, 64))),
    );
  }
}

@Controller('api')
export class OrgHealthController {
  constructor(private db: Db) {}

  /**
   * Whether the hand-over layer can run: off (PRIMA_ORG_LINKS not set) is a valid state; on with tables or walls
   * missing is not ready. Names only, never data.
   */
  @Get('health/org-links')
  async orgLinks() {
    const on = this.db.orgLinks;
    const problems = await orgLinksProblems(this.db.pool);
    return { on, installed: problems.length === 0, ready: !on || problems.length === 0, problems };
  }
}
