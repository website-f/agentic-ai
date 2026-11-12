// P100 (newb): the small layout pieces the vehicle moves, client portal and guard sign-in screens share with the Items
// screens' look (styles/items.css). Kept here, with no API call in this file, so the office's module map
// (agentic/prima/modules.json, built from what each screen's files call) gives those screens no Items route.
import type { ReactNode } from 'react';

/** The head of a tab: what it is for in one line, and its main action on the right (under it on a phone). */
export function TabIntro({ title, sub, actions }: { title: ReactNode; sub: ReactNode; actions?: ReactNode }) {
  return (
    <header className="it-intro">
      <div className="it-intro-text">
        <h2>{title}</h2>
        <p className="muted">{sub}</p>
      </div>
      {actions && <div className="it-intro-actions">{actions}</div>}
    </header>
  );
}

/** Filter chips with their counts (Open 3, All 12); one is chosen. */
export function FilterChips<K extends string>({ value, onChange, options, label }: { value: K; onChange: (k: K) => void; options: [K, string, number][]; label: string }) {
  return (
    <div className="it-chips-row" role="group" aria-label={label}>
      {options.map(([k, l, n]) => (
        <button key={k} type="button" className="it-fchip" aria-pressed={value === k} onClick={() => onChange(k)}>
          <span>{l}</span> <strong>{n}</strong>
        </button>
      ))}
    </div>
  );
}

/** Case-insensitive "does any of these texts contain the search". */
export const hasText = (q: string, ...texts: (string | null | undefined)[]) => {
  const t = q.trim().toLowerCase();
  return !t || texts.some((x) => (x ?? '').toLowerCase().includes(t));
};
