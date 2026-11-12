// K9 / N2 (Fauzan, 11 Nov 2026: "Arisha AI inside the app trains the staff"): the AI part of Arisha's training. The
// trainer works without it (the web app shows the written guide steps); this only answers a question the guide could
// not, and only when switched on. It sees the person's role (worked out here from their stored record) and the screen
// they are on, with that screen's static guide text; never their records, name or company. It is read-only: no tools.
import { Body, Controller, ForbiddenException, Get, Header, HttpException, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { arishaMayConsult, trainerBrief, trainerRefusal, trainerRoleOf, type TrainerLang } from '@prima/core';
import { ArishaBusy, ArishaUnavailable, IdentityToken, askArisha, askArishaOn } from './arisha';
import { arishaProvider, officeModel } from './arisha-office';
import { AuthGuard, UserId, type AuthedRequest } from './auth';
import { Db } from './db';

/** Off unless PRIMA_TRAINER_AI_ENABLED=true AND Arisha AI itself is on (Azure OpenAI; Fauzan's go-ahead, D7). */
export const trainerAiOn = (env: NodeJS.ProcessEnv = process.env) => env.PRIMA_TRAINER_AI_ENABLED?.trim() === 'true' && !!arishaProvider(env);
const trainerToken = new IdentityToken();
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const langOf = (v: unknown): TrainerLang => (v === 'en' || v === 'mix' ? v : 'ms');

@Controller('api/arisha-trainer')
@UseGuards(AuthGuard)
export class ArishaTrainerController {
  constructor(private readonly db: Db) {}

  /** Whether the AI part is on here (the trainer itself always works from the written guides). */
  @Get()
  @Header('Cache-Control', 'no-store')
  state() {
    return { ai: trainerAiOn() };
  }

  /** One question the guide could not answer, for the AI. Refusals are decided here first, without the AI. */
  @Post('ask')
  @Header('Cache-Control', 'no-store')
  async ask(@UserId() uid: string, @Body() b: Record<string, unknown>, @Req() req: AuthedRequest) {
    if (!trainerAiOn()) throw new ServiceUnavailableException('Arisha’s AI answers are not switched on here. The written steps still work.');
    const user = await this.db.asUser(uid, async (_s, u) => u);
    if (!arishaMayConsult(user)) throw new ForbiddenException('Arisha is not available to integration logins.');
    const role = trainerRoleOf(user);
    const lang = langOf(b?.lang);
    const question = str(b?.question, 600);
    if (question.trim().length < 3) throw new HttpException('Type your question.', 400);
    const refused = trainerRefusal(question, role, lang);
    if (refused && refused.kind !== 'action') return { refused: refused.kind, text: refused.text };
    const input = trainerBrief({ role, screen: str(b?.screen, 80), guide: str(b?.guide, 16_000), question, lang });
    try {
      const provider = arishaProvider()!;
      const answer =
        provider.kind === 'azure'
          ? await askArisha(provider.azure, () => trainerToken.get(), input)
          : req.office?.via === 'person'
            ? await askArishaOn(officeModel(provider.office, uid), input)
            : (() => {
                throw new ForbiddenException('Open Prima from the office to ask Arisha.');
              })();
      return { refused: null, text: `${refused ? `${refused.text}\n` : ''}${answer.text}` };
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      if (e instanceof ArishaBusy) throw new HttpException(e.message, 429);
      if (e instanceof ArishaUnavailable) throw new ServiceUnavailableException(e.message);
      console.error('Arisha trainer request failed'); // Never log the question or the answer.
      throw new ServiceUnavailableException('Arisha could not answer. The written steps still work.');
    }
  }
}
