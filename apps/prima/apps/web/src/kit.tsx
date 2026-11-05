/**
 * P71: the building blocks of Prima's redesigned screens (Agentic Office look). Screens keep their own data, rules and
 * actions; these only lay them out the same way everywhere:
 *   PageHead     title, one line of what the page is for, actions on the right
 *   Stats/Stat   the numbers that matter, as tiles (the old Kpi tiles render inside)
 *   Toolbar      search, filters and view switches above a list or table
 *   Card         a titled surface with optional actions and footer
 *   Avatar       a person's initials in a tinted square
 *   Steps        where a request or a pay run is in its process
 *   Empty        nothing to show, with what to do next
 *   Split        a list on the left, the chosen item on the right (stacks on phones)
 */
import type { ReactNode } from 'react';

export function PageHead({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="k-head">
      <div className="k-head-text">
        <h1>{title}</h1>
        {sub && <p className="k-head-sub">{sub}</p>}
      </div>
      {actions && <div className="k-head-actions">{actions}</div>}
      {children && <div className="k-head-more">{children}</div>}
    </header>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="k-stats">{children}</div>;
}

export function Stat({ label, value, note, tone, icon, onClick }: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'ok' | 'warn' | 'crit' | 'unknown' | 'info' | 'neutral';
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="k-stat-top">
        {icon && <span className="k-stat-icon" aria-hidden="true">{icon}</span>}
        <span className="k-stat-label">{label}</span>
      </span>
      <span className="k-stat-value">{value}</span>
      {note && <span className="k-stat-note">{note}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="k-stat" data-tone={tone} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="k-stat" data-tone={tone}>
      {body}
    </div>
  );
}

export function Toolbar({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="k-toolbar">
      <div className="k-toolbar-main">{children}</div>
      {end && <div className="k-toolbar-end">{end}</div>}
    </div>
  );
}

/** A search box with its icon; the screen keeps the value. */
export function Search({ value, onChange, placeholder = 'Search', label }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <label className="k-search">
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M229.66 218.34l-50.07-50.06a88.11 88.11 0 10-11.31 11.31l50.06 50.07a8 8 0 0011.32-11.32zM40 112a72 72 0 1172 72 72.08 72.08 0 01-72-72z" fill="currentColor" />
      </svg>
      <input type="search" value={value} placeholder={placeholder} aria-label={label ?? placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Card({ title, sub, actions, footer, children, flush, id }: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** No inner padding: a list or table runs edge to edge. */
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className="k-card" id={id}>
      {(title || actions) && (
        <div className="k-card-head">
          <div className="k-card-title">
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div className="k-card-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? 'k-card-body k-flush' : 'k-card-body'}>{children}</div>
      {footer && <div className="k-card-foot">{footer}</div>}
    </section>
  );
}

const TINTS = 6;
/** A person's initials; the tint follows the name so it is the same everywhere. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((w) => !/^(bin|binti|a\/l|a\/p|b\.|bt\.)$/i.test(w));
  const initials = ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className="k-avatar" data-tint={h % TINTS} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** A person: avatar, name and one line under it. */
export function Person({ name, sub, size }: { name: string; sub?: ReactNode; size?: number }) {
  return (
    <span className="k-person">
      <Avatar name={name} size={size} />
      <span className="k-person-text">
        <span className="k-person-name">{name}</span>
        {sub && <span className="k-person-sub">{sub}</span>}
      </span>
    </span>
  );
}

export type StepState = 'done' | 'now' | 'todo' | 'stopped';
/** Where something is in its process: done steps ticked, the current one highlighted. */
export function Steps({ steps }: { steps: { label: ReactNode; state: StepState; note?: ReactNode }[] }) {
  return (
    <ol className="k-steps">
      {steps.map((s, i) => (
        <li key={i} className="k-step" data-state={s.state}>
          <span className="k-step-dot" aria-hidden="true">{s.state === 'done' ? '✓' : i + 1}</span>
          <span className="k-step-text">
            <span className="k-step-label">{s.label}</span>
            {s.note && <span className="k-step-note">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="k-empty">
      <span className="k-empty-mark" aria-hidden="true" />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Split({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="k-split">
      <div className="k-split-list">{list}</div>
      <div className="k-split-detail">{detail}</div>
    </div>
  );
}

/** Label: value pairs, two columns on a computer. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="k-facts">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
