// Arisha trains staff in the app (Fitri package K9 / N3, approved by Fauzan 11 Nov 2026). "How do I...?" is answered
// from the person's OWN guide cards (guideCardsFor, the same permission rules the server uses), Bahasa Melayu first.
// Read only: it names the screen and the button, and never saves, approves or sends. A question about a task the person
// does not have gets the same plain refusal, so it never describes another department's records. This is the fixed
// matcher; an AI-worded answer may later sit behind ARISHA_TRAINER_AI_ENABLED (off; Azure OpenAI and Fauzan's go-ahead).
import type { GuideCardView } from './guide-cards';

const STOP = new Set(['how', 'do', 'i', 'to', 'a', 'an', 'the', 'my', 'for', 'of', 'in', 'on', 'and', 'what', 'where', 'can', 'bagaimana', 'cara', 'saya', 'nak', 'mahu', 'untuk', 'di', 'ke', 'dan', 'yang', 'apa', 'mana', 'boleh', 'macam', 'mana']);
const words = (s: string) => s.toLowerCase().normalize('NFKD').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

export interface TrainerAnswer {
  found: boolean;
  /** BM first, English after. */
  reply: { bm: string; en: string };
  steps: { cardId: string; title: { bm: string; en: string }; screen: string; action: { bm: string; en: string }; status: GuideCardView['status'] }[];
}

/** The best matching cards (at most 3), or the refusal when none of the person's own tasks matches. */
export function trainerAnswer(cards: GuideCardView[], question: string): TrainerAnswer {
  const q = new Set(words(String(question ?? '').slice(0, 300)));
  const scored = cards
    .map((c) => {
      const text = new Set(words([c.title.bm, c.title.en, c.purpose.bm, c.purpose.en, c.screen.name, c.screen.action.bm, c.screen.action.en].join(' ')));
      let n = 0;
      for (const w of q) if (text.has(w) || [...text].some((t) => t.length > 4 && (t.startsWith(w) || w.startsWith(t)))) n++;
      return { c, n };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  if (!q.size || !scored.length)
    return {
      found: false,
      reply: {
        bm: 'Itu bukan antara tugas anda dalam Prima, jadi saya tidak boleh menerangkannya. Tanya pengurus anda, atau cuba perkataan lain.',
        en: 'That is not one of your tasks in Prima, so I cannot explain it. Ask your manager, or try other words.',
      },
      steps: [],
    };
  return {
    found: true,
    reply: { bm: 'Ini langkah untuk tugas anda. Saya hanya menerangkan; anda yang menekan butang.', en: 'Here are the steps for your task. I only explain; you press the button.' },
    steps: scored.map(({ c }) => ({ cardId: c.id, title: c.title, screen: c.screen.name, action: c.screen.action, status: c.status })),
  };
}

/** A short first-time walk-through for the person's role: their first tasks in order, ready ones first. */
export function trainerWalkThrough(cards: GuideCardView[], max = 5) {
  const order = { ready: 0, partial: 1, off: 2, not_built: 3 } as const;
  return [...cards]
    .sort((a, b) => order[a.status] - order[b.status])
    .slice(0, max)
    .map((c, i) => ({ step: i + 1, cardId: c.id, title: c.title, screen: c.screen.name, action: c.screen.action, status: c.status }));
}
