// K9 / N2 (Fauzan, 11 Nov 2026: "Arisha AI inside the app trains the staff"): Arisha teaches each person how to use
// Prima for their own role, on every screen, staff screens included (his decision of 11 Nov 2026; CLAUDE.md "Workflow
// boundaries"). "How do I ...?" is answered with the steps from the written screen guide (arisha-screens.data.ts, read by
// arisha-local.ts) for the screens in the person's own menu; a short first-time walk-through shows their role's main
// screens. Read-only: she explains and can open a screen, never saves, approves or sends anything. She sees the role and
// the open screen only. Without the AI (switched off until Azure OpenAI is set up) everything here still works; with it
// on, "Ask Arisha more" sends the role, the screen, its static guide and the question (numbers masked), nothing else.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon, XIcon } from '@phosphor-icons/react';
import { trainerRoleOf, trainerTour, TRAINER_ROLE_LABEL, type User } from '@prima/core';
import { api } from './api';
import { Rich } from './Arisha';
import { ArishaAvatar } from './ArishaAvatar';
import { SCREEN_GUIDES, screenGuide, screenGuideText } from './arisha-screens';
import { taskReply, type LocalChip } from './arisha-local';
import { trainerAnswer } from './arisha-trainer-answer';
import { useBackClose } from './back-close';
import { tr, useLang, type Lang } from './i18n';
import './styles/trainer.css';

const T: Record<string, Record<Lang, string>> = {
  title: { en: 'Learn with Arisha', ms: 'Belajar dengan Arisha', mix: 'Belajar dengan Arisha' },
  role: { en: 'Your role', ms: 'Peranan anda', mix: 'Role anda' },
  close: { en: 'Close', ms: 'Tutup', mix: 'Tutup' },
  tourAsk: { en: 'First time here? Take a short walk-through of the screens for your role.', ms: 'Kali pertama di sini? Ikuti lawatan ringkas skrin untuk peranan anda.', mix: 'Kali pertama di sini? Ikut walk-through ringkas skrin untuk role anda.' },
  tourStart: { en: 'Start the walk-through', ms: 'Mula lawatan', mix: 'Mula walk-through' },
  tourLater: { en: 'Not now', ms: 'Bukan sekarang', mix: 'Bukan sekarang' },
  tourAgain: { en: 'Walk-through again', ms: 'Ulang lawatan', mix: 'Ulang walk-through' },
  step: { en: 'Step {i} of {n}', ms: 'Langkah {i} daripada {n}', mix: 'Step {i} daripada {n}' },
  open: { en: 'Open this screen', ms: 'Buka skrin ini', mix: 'Buka skrin ini' },
  back: { en: 'Back', ms: 'Kembali', mix: 'Back' },
  next: { en: 'Next', ms: 'Seterusnya', mix: 'Next' },
  finish: { en: 'Finish', ms: 'Selesai', mix: 'Selesai' },
  here: { en: 'On this screen', ms: 'Di skrin ini', mix: 'Di skrin ini' },
  noGuide: { en: 'There is no written guide for this screen yet. Ask your manager.', ms: 'Belum ada panduan bertulis untuk skrin ini. Tanya pengurus anda.', mix: 'Belum ada guide bertulis untuk skrin ini. Tanya manager anda.' },
  ask: { en: 'How do I …?', ms: 'Bagaimana saya …?', mix: 'Macam mana saya …?' },
  send: { en: 'Ask', ms: 'Tanya', mix: 'Tanya' },
  readOnly: { en: 'Arisha only explains. She never saves, approves or sends anything, and she does not see your records.', ms: 'Arisha hanya menerangkan. Dia tidak menyimpan, meluluskan atau menghantar apa-apa, dan dia tidak melihat rekod anda.', mix: 'Arisha hanya terangkan. Dia tak simpan, lulus atau hantar apa-apa, dan dia tak nampak rekod anda.' },
  fromGuide: { en: 'From the written guide for your screens.', ms: 'Daripada panduan bertulis untuk skrin anda.', mix: 'Daripada guide bertulis untuk skrin anda.' },
  noMatch: { en: 'I could not find steps for that in your screens. Try other words, or ask your manager.', ms: 'Saya tidak jumpa langkah untuk itu dalam skrin anda. Cuba perkataan lain, atau tanya pengurus anda.', mix: 'Saya tak jumpa step untuk itu dalam skrin anda. Cuba perkataan lain, atau tanya manager anda.' },
  askMore: { en: 'Ask Arisha more', ms: 'Tanya Arisha lagi', mix: 'Tanya Arisha lagi' },
  thinking: { en: 'Arisha is thinking…', ms: 'Arisha sedang berfikir…', mix: 'Arisha tengah fikir…' },
};
const t = (k: keyof typeof T, lang: Lang, vars: Record<string, string> = {}) => T[k][lang].replace(/\{(\w+)\}/g, (_, v: string) => vars[v] ?? '');

type Msg = { who: 'me' | 'arisha'; text: string; chips?: LocalChip[]; local?: boolean; question?: string };

const tourKey = (u: User) => `prima.trainer.tour.v1.${u.id}`;
function tourSeen(u: User): boolean {
  try {
    return !!localStorage.getItem(tourKey(u));
  } catch {
    return true;
  }
}
function markTour(u: User, v: 'done' | 'later') {
  try {
    localStorage.setItem(tourKey(u), v);
  } catch {
    /* private window: shown again next time */
  }
}
/** Whether the walk-through is still new for this person (the launcher shows a small dot). */
export function trainerTourNew(u: User): boolean {
  return !u.integration && !tourSeen(u);
}

export function ArishaTrainer({ user, view, menu, open, onClose, go }: { user: User; view: string; menu: string[]; open: boolean; onClose: () => void; go: (view: string) => void }) {
  const { lang } = useLang();
  const titleId = useId();
  useBackClose(open, onClose);
  const role = trainerRoleOf(user);
  // The person's own screens, by the menu labels the frame passes (the guides are titled as the menu).
  const menuViews = useMemo(() => SCREEN_GUIDES.filter((g) => menu.includes(g.title)).map((g) => g.view), [menu]);
  const tour = useMemo(() => trainerTour(role, menuViews, lang), [role, menuViews, lang]);
  const [tourAt, setTourAt] = useState<number | null>(null);
  const [offerTour, setOfferTour] = useState(() => !tourSeen(user));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const guide = screenGuide(view);

  useEffect(() => {
    if (!open || api.mode !== 'server') return;
    api.trainer.state().then((s) => setAi(!!s.ai), () => setAi(false));
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length, tourAt]);

  const roleLabel = TRAINER_ROLE_LABEL[role][lang === 'en' ? 'en' : 'ms'];

  function answer(q: string) {
    const question = q.trim();
    if (!question) return;
    setDraft('');
    const mine: Msg = { who: 'me', text: question };
    const a = trainerAnswer(question, role, view, menu, lang);
    if (a.refused && a.refused !== 'action') return setMsgs((m) => [...m, mine, { who: 'arisha', text: a.text }]);
    const text = a.reply ? a.text : `${a.text ? `${a.text}\n` : ''}${t('noMatch', lang)}`;
    setMsgs((m) => [...m, mine, { who: 'arisha', text, chips: a.reply?.chips ?? [], local: true, question }]);
  }

  function showTask(c: LocalChip) {
    const r = taskReply(c.view, c.task, view, lang);
    if (r) setMsgs((m) => [...m, { who: 'me', text: c.label }, { who: 'arisha', text: r.text, chips: r.chips, local: true, question: c.label }]);
  }

  async function askMore(question: string) {
    setBusy(true);
    try {
      const guideText = screenGuideText(view, menu, lang, 12_000);
      const r = await api.trainer.ask({ screen: guide?.title ?? view, guide: guideText, question, lang });
      setMsgs((m) => [...m, { who: 'arisha', text: r.text }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: 'arisha', text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  const step = tourAt === null ? null : tour[tourAt];
  const endTour = () => {
    markTour(user, 'done');
    setTourAt(null);
    setOfferTour(false);
  };

  return (
    <div data-no-translate>
      <section className="arisha-panel atr" hidden={!open} role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <header className="arisha-head">
          <ArishaAvatar size={36} decorative />
          <div className="arisha-title">
            <strong className="arisha-heading" id={titleId}>
              {t('title', lang)}
            </strong>
            <span className="arisha-sub">{`${t('role', lang)}: ${roleLabel}`}</span>
          </div>
          <button className="arisha-close" aria-label={t('close', lang)} title={t('close', lang)} onClick={onClose}>
            <XIcon size={18} weight="bold" aria-hidden="true" />
          </button>
        </header>
        <div className="arisha-body">
          {offerTour && tourAt === null && (
            <div className="atr-tour-offer">
              <p>{t('tourAsk', lang)}</p>
              <div className="atr-row">
                <button type="button" className="btn btn-primary atr-big" onClick={() => setTourAt(0)}>
                  {t('tourStart', lang)}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    markTour(user, 'later');
                    setOfferTour(false);
                  }}
                >
                  {t('tourLater', lang)}
                </button>
              </div>
            </div>
          )}
          {step && tourAt !== null && (
            <div className="atr-tour" aria-live="polite">
              <div className="atr-tour-top">
                <span className="atr-step">{t('step', lang, { i: String(tourAt + 1), n: String(tour.length) })}</span>
                <span className="atr-dots" aria-hidden="true">
                  {tour.map((_, i) => (
                    <i key={i} data-on={i <= tourAt || undefined} />
                  ))}
                </span>
              </div>
              {step.view && <strong className="atr-screen">{tr(screenGuide(step.view)?.title ?? step.view, lang)}</strong>}
              <p>{step.text}</p>
              {step.view && step.view !== view && (
                <button type="button" className="btn atr-open" onClick={() => go(step.view!)}>
                  {t('open', lang)} <ArrowRightIcon size={16} aria-hidden="true" />
                </button>
              )}
              <div className="atr-row atr-nav">
                <button type="button" className="btn" disabled={tourAt === 0} onClick={() => setTourAt(tourAt - 1)}>
                  {t('back', lang)}
                </button>
                {tourAt < tour.length - 1 ? (
                  <button type="button" className="btn btn-primary atr-big" onClick={() => setTourAt(tourAt + 1)}>
                    {t('next', lang)}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary atr-big" onClick={endTour}>
                    {t('finish', lang)}
                  </button>
                )}
              </div>
            </div>
          )}
          {tourAt === null && (
            <div className="arisha-msg" data-who="arisha">
              <strong>{`${t('here', lang)}: ${tr(guide?.title ?? view, lang)}`}</strong>
              {guide ? (
                <div className="arisha-chips">
                  {guide.tasks.slice(0, 6).map((task, i) => (
                    <button key={i} type="button" className="arisha-chip" onClick={() => showTask({ view: guide.view, task: i, label: tr(task.task, lang) })}>
                      {tr(task.task, lang)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="small">{t('noGuide', lang)}</p>
              )}
              {!offerTour && tour.length > 2 && (
                <button type="button" className="btn btn-sm btn-ghost atr-again" onClick={() => setTourAt(0)}>
                  {t('tourAgain', lang)}
                </button>
              )}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className="arisha-msg" data-who={m.who} data-local={m.local ? '' : undefined}>
              {m.who === 'me' ? m.text : <Rich text={m.text} />}
              {m.chips && m.chips.length > 0 && (
                <div className="arisha-chips">
                  {m.chips.map((c) => (
                    <button key={`${c.view}-${c.task}`} type="button" className="arisha-chip" onClick={() => showTask(c)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {m.local && (
                <div className="arisha-local-foot">
                  <span className="muted small">{t('fromGuide', lang)}</span>
                  {ai && i === msgs.length - 1 && m.question && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void askMore(m.question!)}>
                      {t('askMore', lang)}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="arisha-msg muted" data-who="arisha">{t('thinking', lang)}</div>}
          <div ref={endRef} />
        </div>
        <form
          className="arisha-input"
          onSubmit={(e) => {
            e.preventDefault();
            answer(draft);
          }}
        >
          <textarea
            className="input"
            rows={2}
            value={draft}
            maxLength={600}
            placeholder={t('ask', lang)}
            aria-label={t('ask', lang)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                answer(draft);
              }
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
            {t('send', lang)}
          </button>
        </form>
        <p className="atr-foot muted small">{t('readOnly', lang)}</p>
      </section>
    </div>
  );
}
