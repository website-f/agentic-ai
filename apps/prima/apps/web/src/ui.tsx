import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DataMode, ExpiryStatus, Finding, Severity } from '@prima/core';
import { activateDrawer } from './drawer-focus';
import { ApiError, api } from './api';

// ---------- Data loading ----------

/** Bumped after every change so open screens reload. */
export const RefreshContext = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => undefined });

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { version } = useContext(RefreshContext);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => live && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

// ---------- Toast ----------

export const ToastContext = createContext<(msg: string) => void>(() => undefined);

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  // notify() reaches here from code outside React (a pop-up alert is blocked inside the test link's frame).
  useEffect(() => {
    const on = (e: Event) => setMsg((e as CustomEvent<string>).detail);
    window.addEventListener('prima-notify', on);
    return () => window.removeEventListener('prima-notify', on);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3800);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastContext.Provider value={setMsg}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Show a short message at the bottom of the screen. */
export function notify(message: string) {
  window.dispatchEvent(new CustomEvent('prima-notify', { detail: message }));
}

export function useToast() {
  return useContext(ToastContext);
}

/** Run a change, show its error or findings, and refresh the screens. */
export function useAction() {
  const { bump } = useContext(RefreshContext);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // A second click before the screen shows "busy" (a fast double click) does nothing.
  const running = useRef(false);
  const [error, setError] = useState<{ message: string; findings: Pick<Finding, 'level' | 'message'>[] } | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        bump();
        if (success) toast(typeof success === 'function' ? success(r) : success);
        return r;
      } catch (e) {
        if (e instanceof ApiError) setError({ message: e.message, findings: e.findings });
        else setError({ message: e instanceof Error ? e.message : String(e), findings: [] });
        return undefined;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [bump, toast],
  );
  return { run, busy, error, clearError: () => setError(null) };
}

/**
 * The data label on a screen (Fauzan, 31 Oct 2026, task T1). The test version is always test data. A server says what
 * its records are; only an explicit pilot setting drops the label, and sample names stay marked "(mock)" until verified.
 */
export function dataNotice(mode: DataMode | undefined): string {
  return api.mode === 'server' && mode === 'staging-pilot'
    ? 'Pilot records: what you enter here is real work. Names marked (mock) are placeholders until verified.'
    : 'Test data.';
}

// ---------- Formatting ----------

export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(11, 16) : '–';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export function dateLabel(d: string | null | undefined): string {
  if (!d) return '–';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function dateTimeLabel(t: string): string {
  return `${dateLabel(t)}, ${hhmm(t)}`;
}

export function n(v: number | 'UNKNOWN'): string {
  return v === 'UNKNOWN' ? 'Unknown' : v.toLocaleString('en-MY');
}

// ---------- Small components ----------

export type Tone = 'ok' | 'warn' | 'crit' | 'unknown' | 'neutral' | 'info';

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className="chip" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

const EXPIRY_TONE: Record<ExpiryStatus, Tone> = { OK: 'ok', DUE: 'warn', OVERDUE: 'crit', UNKNOWN: 'unknown' };
const EXPIRY_TEXT: Record<ExpiryStatus, string> = { OK: 'Valid', DUE: 'Due soon', OVERDUE: 'Expired', UNKNOWN: 'Unknown' };

export function ExpiryChip({ status, daysLeft, text: override }: { status: ExpiryStatus; daysLeft?: number | null; text?: string }) {
  let text = EXPIRY_TEXT[status];
  if (status === 'DUE' && daysLeft != null) text = `${daysLeft} days left`;
  if (status === 'OVERDUE' && daysLeft != null) text = `Expired ${-daysLeft} days`;
  if (override) text = override;
  return (
    <Chip tone={EXPIRY_TONE[status]} title={status === 'UNKNOWN' ? 'No record yet. Unknown is never shown as compliant.' : undefined}>
      {text}
    </Chip>
  );
}

export function Sev({ s }: { s: Severity }) {
  return (
    <span className="sev" data-sev={s}>
      {s}
    </span>
  );
}

export function Kpi({ label, value, note, tone }: { label: string; value: number | 'UNKNOWN' | string; note?: string; tone?: Tone }) {
  return (
    <div className="kpi" data-tone={value === 'UNKNOWN' ? 'unknown' : tone}>
      <span className="label">{label}</span>
      <span className="kpi-value">{typeof value === 'number' || value === 'UNKNOWN' ? n(value) : value}</span>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}

export function Findings({ items }: { items: Pick<Finding, 'level' | 'message'>[] }) {
  if (!items.length) return null;
  return (
    <div className="list" style={{ gap: 4 }}>
      {items.map((f, i) => (
        <div key={i} className="finding" data-level={f.level}>
          <strong>{f.level === 'block' ? 'Blocked' : 'Check'}</strong>
          <span>{f.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ErrorNotice({ error }: { error: { message: string; findings: Pick<Finding, 'level' | 'message'>[] } | string | null }) {
  if (!error) return null;
  const e = typeof error === 'string' ? { message: error, findings: [] } : error;
  return (
    <div className="notice" data-tone="crit" role="alert">
      {e.findings.length ? <Findings items={e.findings} /> : e.message}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="empty">Loading {what}…</div>;
}

export function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => dialog.current ? activateDrawer(dialog.current, () => close.current()) : undefined, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={dialog} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {sub && <div className="muted small">{sub}</div>}
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// ---------- Icons (inline, stroke) ----------

const paths: Record<string, string> = {
  group: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6',
  company: 'M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M8 8h3M8 12h3M8 16h3M3 21h18',
  sites: 'M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  roster: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4M8 13h3M13 13h3M8 17h3',
  people: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6',
  attendance: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  cases: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  compliance: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  audit: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  arms: 'M4 8h11l2 2h3v3h-5l-1 2h-3l-1 4H6l1-5H4zM9 13h3',
  tender: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5M15.5 17.5l1.5 1.5 3-3',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20h.01M17 20h.01',
  insurance: 'M12 3a9 9 0 019 9H3a9 9 0 019-9zM12 12v7a2 2 0 01-4 0',
  device: 'M7 2h10a1 1 0 011 1v18a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2',
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.group} />
    </svg>
  );
}
