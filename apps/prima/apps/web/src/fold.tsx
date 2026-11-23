/**
 * P128 (Fitri, 24 Nov 2026: "all alerts need to be fixed, make them collapsible and a cleaner UI"): notices and long
 * sections fold to one line. Each fold remembers, on this device, whether the person closed or opened it (localStorage,
 * wrapped: a private window simply starts with the default every visit).
 *
 *   <FoldNotice id="org.how" tone="info" summary="How the lines work">…the long explanation…</FoldNotice>
 *   <FoldSection id="home.watch" title="Monitor" badge={<Chip …/>} summary="12 areas, 3 urgent">…</FoldSection>
 *
 * Every English string passed in is translated by the page translator (i18n.ts) like any other text.
 */
import { useCallback, useId, useState, type ReactNode } from 'react';
import { CaretDownIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon } from '@phosphor-icons/react';
import type { Tone } from './ui';
import './styles/fold.css';

const PREFIX = 'prima.fold.';

function readFold(id: string): boolean | null {
  try {
    const v = localStorage.getItem(PREFIX + id);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeFold(id: string, open: boolean): void {
  try {
    localStorage.setItem(PREFIX + id, open ? '1' : '0');
  } catch {
    /* private window: the choice lasts for this visit */
  }
}

/** Open or closed, remembered on this device under `id`. */
export function useFold(id: string, defaultOpen: boolean): [boolean, (next?: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => readFold(id) ?? defaultOpen);
  const toggle = useCallback(
    (next?: boolean) =>
      setOpen((o) => {
        const v = next ?? !o;
        writeFold(id, v);
        return v;
      }),
    [id],
  );
  return [open, toggle];
}

/** Several folds under one key (a card per area): `isOpen(name)`, `toggle(name)`, `setAll(names, open)`. */
export function useFoldMap(id: string, defaultOpen: boolean) {
  const [map, setMap] = useState<Record<string, boolean>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(PREFIX + id) ?? '{}');
      return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const save = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(PREFIX + id, JSON.stringify(next));
    } catch {
      /* private window */
    }
    return next;
  };
  return {
    isOpen: (name: string) => map[name] ?? defaultOpen,
    toggle: (name: string) => setMap((m) => save({ ...m, [name]: !(m[name] ?? defaultOpen) })),
    setAll: (names: string[], open: boolean) => setMap((m) => save({ ...m, ...Object.fromEntries(names.map((n) => [n, open])) })),
  };
}

const TONE_ICON: Partial<Record<Tone, ReactNode>> = {
  crit: <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />,
  warn: <WarningIcon size={18} weight="fill" aria-hidden="true" />,
  ok: <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />,
};

/**
 * A notice that reads as one line until opened: an icon for its tone, the summary, and a caret. Without children it is a
 * plain one-line notice (nothing to open).
 */
export function FoldNotice({
  id,
  tone = 'info',
  summary,
  children,
  defaultOpen = false,
  role,
}: {
  /** Remembers open or closed on this device, e.g. "org.how". */
  id: string;
  tone?: Tone;
  summary: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  role?: 'alert' | 'status';
}) {
  const [open, toggle] = useFold(id, defaultOpen);
  const bodyId = useId();
  const icon = TONE_ICON[tone] ?? <InfoIcon size={18} weight="fill" aria-hidden="true" />;
  if (!children)
    return (
      <div className="fold-notice" data-tone={tone} role={role}>
        <div className="fold-notice-head">
          <span className="fold-notice-icon">{icon}</span>
          <span className="fold-notice-summary">{summary}</span>
        </div>
      </div>
    );
  return (
    <div className="fold-notice" data-tone={tone} data-open={open || undefined} role={role}>
      <button type="button" className="fold-notice-head" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle()}>
        <span className="fold-notice-icon">{icon}</span>
        <span className="fold-notice-summary">{summary}</span>
        <span className="fold-notice-more">{open ? 'Hide' : 'Details'}</span>
        <CaretDownIcon className="fold-caret" size={16} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div className="fold-notice-body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A page section whose heading folds it: the title with a caret, a count or chip beside it, and a one-line summary while
 * it is closed. `actions` sit at the right of the heading (e.g. "Open all").
 */
export function FoldSection({
  id,
  title,
  badge,
  summary,
  actions,
  defaultOpen = true,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  badge?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, toggle] = useFold(id, defaultOpen);
  const headId = useId();
  const bodyId = useId();
  return (
    <section className={`fold-sec${className ? ` ${className}` : ''}`} data-open={open || undefined} aria-labelledby={headId}>
      <div className="fold-sec-head">
        <h2 className="fold-sec-title">
          <button type="button" id={headId} className="fold-sec-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle()}>
            <CaretDownIcon className="fold-caret" size={16} weight="bold" aria-hidden="true" />
            <span>{title}</span>
          </button>
        </h2>
        {badge}
        {!open && summary && <span className="fold-sec-summary">{summary}</span>}
        {open && actions && <div className="fold-sec-actions">{actions}</div>}
      </div>
      {open && (
        <div className="fold-sec-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
