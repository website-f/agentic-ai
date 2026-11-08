import { Body, Controller, Get, Header, HttpException, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { IdentityToken } from './arisha';
import { AzureDraftHelpModel, DraftHelpError, DraftHelpService, draftHelpConfig, draftHelpHttpStatus, type DraftHelpAudit } from './draft-help';

/** Metadata-only audit in its own short transaction, before and after the provider call (never the text). */
export function draftHelpAudit(db: Pick<Db, 'asUser'>): DraftHelpAudit {
  return {
    append: async (e) => {
      await db.asUser(e.actorId, async (_svc, _user, store) => {
        await store.audit({
          at: e.at, actor: e.actorId, companyId: null, action: `draft.help.${e.phase}`, entity: 'draft_help', entityId: e.suggestionId,
          summary: JSON.stringify({ kind: e.kind, inputSha256: e.inputSha256, inputLength: e.inputLength, outcome: e.outcome }),
        });
      });
    },
  };
}

/**
 * Suggested drafts (rule DRAFT-HELP): BQ lines, vacancy post wording and bill figures. A suggestion is returned to the
 * screen only; nothing is saved here. Off unless DRAFT_HELP_ENABLED=true with the Azure settings.
 */
@Controller('api/draft-help')
@UseGuards(AuthGuard)
export class DraftHelpController {
  private readonly service: DraftHelpService;
  constructor(private readonly db: Db) {
    const cfg = draftHelpConfig();
    const token = new IdentityToken();
    this.service = new DraftHelpService(cfg ? new AzureDraftHelpModel(cfg, (signal) => token.get(signal)) : null, draftHelpAudit(db));
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

  @Post(':kind')
  @Header('Cache-Control', 'no-store')
  async suggest(@UserId() uid: string, @Param('kind') kind: string, @Body() body: unknown) {
    const { user, today } = await this.who(uid);
    try {
      return await this.service.suggest(user, kind, body, today);
    } catch (e) {
      const err = e instanceof DraftHelpError ? e : new DraftHelpError('UNAVAILABLE');
      throw new HttpException({ code: err.code, message: err.detail ?? err.code }, draftHelpHttpStatus(err.code));
    }
  }
}
