// K9: how "Learn with Arisha" answers without the AI: the refusal check first, then the written guide's steps for the
// person's own menu (arisha-local.ts: a clear match, else the closest how-to). Pure, so the core tests run it too.
import { trainerRefusal, type TrainerRole } from '@prima/core';
import { fallbackAnswer, localAnswer, type LocalReply } from './arisha-local';
import { SCREEN_GUIDES } from './arisha-screens';
import type { Lang } from './i18n';

export interface TrainerAnswer {
  /** Set when Arisha refuses ("other_department", "records") or will not act for the person ("action"). */
  refused: 'other_department' | 'records' | 'action' | null;
  text: string;
  reply: LocalReply | null;
}

export function trainerAnswer(question: string, role: TrainerRole, view: string, menu: string[], lang: Lang): TrainerAnswer {
  const refusal = trainerRefusal(question, role, lang);
  if (refusal && refusal.kind !== 'action') return { refused: refusal.kind, text: refusal.text, reply: null };
  // A question that names another screen of the person's menu ("a payment request" on the Finance screen) is answered
  // from that screen's how-tos, as a person would open it first.
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const named = SCREEN_GUIDES.filter((g) => menu.includes(g.title) && g.view !== view && g.title.length > 4)
    .filter((g) => q.includes(` ${g.title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/s$/, '')}`))
    .sort((a, b) => b.title.length - a.title.length)[0];
  const at = named?.view ?? view;
  const reply = localAnswer(question, { view: at, menu, lang }) ?? fallbackAnswer(question, at, menu, lang);
  const body = reply?.text ?? '';
  return { refused: refusal?.kind ?? null, text: refusal ? `${refusal.text}\n${body}` : body, reply };
}
