import { Body, Controller, Get, Header, HttpException, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { IdentityToken } from './arisha';
import { KEY_IN_RULE, RULES } from '@prima/core';
import { PgAiBudget } from './ai-budget';
import { AzureKeyInModel, KeyInError, KeyInService, keyInHttpStatus, keyInOnlineConfig, type KeyInAudit } from './key-in';

/** Metadata-only audit of each online read, in its own short transaction (never the paper's words or the values). */
export function keyInAudit(db: Pick<Db, 'asUser'>): KeyInAudit {
  return {
    append: async (e) => {
      await db.asUser(e.actorId, async (_svc, _user, store) => {
        await store.audit({
          at: e.at, actor: e.actorId, companyId: null, action: 'key-in.online', entity: 'key_in', entityId: e.readId,
          summary: JSON.stringify({ team: e.team, paper: e.paper, inputSha256: e.inputSha256, fieldsAsked: e.fieldsAsked, fieldsFilled: e.fieldsFilled, tokensIn: e.tokensIn, tokensOut: e.tokensOut, costUsd: Number(e.costUsd.toFixed(6)), outcome: e.outcome }),
        });
      });
    },
  };
}

/**
 * Key-in helper, "Isi automatik" (rules KEY-IN and AI-AGENT-BUDGET). Returns suggested field values for the screen
 * only; nothing is saved here, and the host form saves under the person's own rights after they confirm each value.
 */
@Controller('api/key-in')
@UseGuards(AuthGuard)
export class KeyInController {
  private readonly service: KeyInService;
  constructor(private readonly db: Db) {
    const cfg = keyInOnlineConfig();
    const token = new IdentityToken();
    const capUsd = RULES.aiAgentBudget.value.usdPerAgentPerMonth;
    // The spend is kept in the database (module ai-budget-v1); without the module the online reader stays off.
    this.service = new KeyInService(
      cfg ? { model: new AzureKeyInModel(cfg, (signal) => token.get(signal)), price: cfg.price } : null,
      keyInAudit(db),
      { timeoutMs: 30_000, perHour: KEY_IN_RULE.perUserPerHour, now: Date.now, capUsd, keep: 500 },
      new PgAiBudget(db.pool, capUsd),
    );
  }

  /** Short read of the signed-in user; the provider is never called inside a database transaction. */
  private who(uid: string) {
    return this.db.asUser(uid, async (svc, user) => ({ user, today: svc.today() }));
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async status(@UserId() uid: string) {
    const { user, today } = await this.who(uid);
    return this.service.status(user, today);
  }

  @Post(':paper')
  @Header('Cache-Control', 'no-store')
  async read(@UserId() uid: string, @Param('paper') paper: string, @Body() body: unknown) {
    const { user, today } = await this.who(uid);
    try {
      return await this.service.read(user, paper, body, today);
    } catch (e) {
      const err = e instanceof KeyInError ? e : new KeyInError('INVALID_INPUT');
      throw new HttpException({ code: err.code, message: err.detail ?? err.code }, keyInHttpStatus(err.code));
    }
  }
}
