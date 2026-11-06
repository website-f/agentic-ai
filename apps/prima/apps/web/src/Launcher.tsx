import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { BookOpenTextIcon, ChatCircleDotsIcon, MegaphoneSimpleIcon, XIcon } from '@phosphor-icons/react';
import type { User } from '@prima/core';
import { Arisha, useArishaReady } from './Arisha';
import { ArishaAvatar } from './ArishaAvatar';
import { useLang, type Lang } from './i18n';

/**
 * P80: Prima's one floating launcher, bottom right (above the tab bar on a phone). It opens a small sheet:
 *   Ask Arisha                    the AI assistant panel (Arisha.tsx), when she is on for this person;
 *   Give feedback                 the Agentic Office's feedback, and
 *   Rules & guide for this page   its Rules & guide, both through the office's widget (/feedback-widget.js), which
 *                                 main.tsx loads in host mode so it draws no button of its own.
 * The feedback items show only when the widget says feedback is on for this person (AgenticFeedback.enabled). With one
 * thing to offer the button opens it at once: without the widget (the test link, or it never loaded) it is Arisha's.
 */

type Panel = 'feedback' | 'guide';
interface OfficeFeedback {
  open(panel: Panel): boolean;
  close(): void;
  isOpen(): boolean;
  readonly enabled: boolean;
}
declare global {
  interface Window {
    __agenticLauncher?: string;
    AgenticFeedback?: OfficeFeedback;
  }
}

/** The office widget's state: on for this person, and whether one of its panels is open. */
export function useOfficeFeedback(): { enabled: boolean; open: boolean } {
  const read = () => ({ enabled: !!window.AgenticFeedback?.enabled, open: !!window.AgenticFeedback?.isOpen() });
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener('agentic-feedback:ready', sync);
    window.addEventListener('agentic-feedback:state', sync);
    sync(); // it may have loaded before this screen
    return () => {
      window.removeEventListener('agentic-feedback:ready', sync);
      window.removeEventListener('agentic-feedback:state', sync);
    };
  }, []);
  return state;
}

const T: Record<string, Record<Lang, string>> = {
  help: { en: 'Help: Arisha, feedback, rules and guide', ms: 'Bantuan: Arisha, maklum balas, peraturan dan panduan', mix: 'Help: Arisha, feedback, rules dan guide' },
  close: { en: 'Close help', ms: 'Tutup bantuan', mix: 'Tutup help' },
  heading: { en: 'How can we help?', ms: 'Apa yang boleh kami bantu?', mix: 'Boleh kami bantu apa?' },
  ask: { en: 'Ask Arisha', ms: 'Tanya Arisha', mix: 'Tanya Arisha' },
  askHint: { en: 'Your AI assistant: how to do things in Prima', ms: 'Pembantu AI anda: cara membuat sesuatu dalam Prima', mix: 'Assistant AI anda: cara buat sesuatu dalam Prima' },
  feedback: { en: 'Give feedback', ms: 'Beri maklum balas', mix: 'Bagi feedback' },
  feedbackHint: { en: 'Tell the developer what to fix or add', ms: 'Beritahu pembangun apa yang perlu dibaiki atau ditambah', mix: 'Bagitahu developer apa nak fix atau tambah' },
  guide: { en: 'Rules & guide for this page', ms: 'Peraturan & panduan halaman ini', mix: 'Rules & guide untuk page ini' },
  guideHint: { en: 'What this page is for, its steps and rules', ms: 'Tujuan halaman ini, langkah dan peraturannya', mix: 'Page ini untuk apa, step dan rules dia' },
};

interface Item {
  id: 'arisha' | Panel;
  icon: ReactNode;
  label: string;
  hint: string;
}

export function Launcher({ user, view, viewLabel, menu }: { user: User; view: string; viewLabel: string; menu: string[] }) {
  const { lang } = useLang();
  const t = (k: keyof typeof T) => T[k][lang];
  const arisha = useArishaReady();
  const feedback = useOfficeFeedback();
  const [sheet, setSheet] = useState(false);
  const [arishaOpen, setArishaOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetId = useId();

  const items: Item[] = [
    ...(arisha.ready ? [{ id: 'arisha' as const, icon: <ArishaAvatar size={36} decorative />, label: t('ask'), hint: t('askHint') }] : []),
    ...(feedback.enabled
      ? [
          { id: 'feedback' as const, icon: <MegaphoneSimpleIcon size={20} weight="fill" aria-hidden="true" />, label: t('feedback'), hint: t('feedbackHint') },
          { id: 'guide' as const, icon: <BookOpenTextIcon size={20} weight="fill" aria-hidden="true" />, label: t('guide'), hint: t('guideHint') },
        ]
      : []),
  ];

  const closeSheet = useCallback((refocus = true) => {
    setSheet(false);
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  }, []);
  const closeArisha = useCallback(() => {
    setArishaOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  }, []);

  const choose = (id: Item['id']) => {
    closeSheet(false);
    if (id === 'arisha') setArishaOpen(true);
    else if (!window.AgenticFeedback?.open(id)) requestAnimationFrame(() => button.current?.focus());
  };

  // The sheet: the first item takes focus; Escape closes; arrows move between items.
  useEffect(() => {
    if (!sheet) return;
    sheetRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, closeSheet]);
  const onSheetKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const all = [...(sheetRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (!all.length) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  };

  if (!items.length) return null;
  const only = items.length === 1 ? items[0] : null;
  const press = () => {
    if (only) choose(only.id);
    else setSheet((s) => !s);
  };

  return (
    <>
      <div className="launcher" data-feedback-ignore="" data-no-translate hidden={arishaOpen}>
        {sheet && <div className="launcher-catch" aria-hidden="true" onPointerDown={() => closeSheet()} />}
        {sheet && (
          <div className="launcher-sheet" id={sheetId} ref={sheetRef} role="menu" aria-label={t('heading')} onKeyDown={onSheetKey}>
            <div className="launcher-heading" aria-hidden="true">{t('heading')}</div>
            {items.map((it) => (
              <button key={it.id} type="button" role="menuitem" className="launcher-item" data-item={it.id} onClick={() => choose(it.id)}>
                <span className="launcher-icon" data-item={it.id}>{it.icon}</span>
                <span className="launcher-text">
                  <span className="launcher-label">{it.label}</span>
                  <span className="launcher-hint">{it.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <button
          ref={button}
          type="button"
          className="launcher-button"
          data-face={sheet ? 'close' : arisha.ready ? 'arisha' : 'help'}
          aria-label={only ? only.label : sheet ? t('close') : t('help')}
          title={only ? only.label : sheet ? t('close') : t('help')}
          aria-haspopup={only ? undefined : 'menu'}
          aria-expanded={only ? undefined : sheet}
          aria-controls={sheet ? sheetId : undefined}
          onClick={press}
        >
          {sheet ? (
            <XIcon size={22} weight="bold" aria-hidden="true" />
          ) : arisha.ready ? (
            <ArishaAvatar size={52} decorative />
          ) : (
            <ChatCircleDotsIcon size={26} weight="fill" aria-hidden="true" />
          )}
        </button>
      </div>
      {arisha.ready && (
        <Arisha
          key={user.id}
          user={user}
          view={view}
          viewLabel={viewLabel}
          menu={menu}
          open={arishaOpen}
          onClose={closeArisha}
          serverOn={arisha.serverOn}
          sample={arisha.sample}
        />
      )}
    </>
  );
}
