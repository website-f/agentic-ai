import { useState } from 'react';
import { api } from '../api';
import { Card, Empty } from '../kit';
import { ErrorNotice, Loading, useAction, useLoad } from '../ui';

/**
 * Part N17 (Fitri package, 14 Nov 2026): the guard course list, the medical claim clauses and the discipline steps are
 * keyed in by the HR Administrator, each version from a date with a reason. Old versions stay; a record uses the version
 * in force on its date. The HR Director views them. Until HR keys one in, the screens say "not set by HR".
 */
type Kind = 'guard_courses' | 'claim_clauses' | 'discipline_steps';

const COLS: Record<Kind, [string, string][]> = {
  guard_courses: [
    ['name', 'Course'],
    ['needed', 'required or optional'],
    ['byWhen', 'By when'],
  ],
  claim_clauses: [
    ['clause', 'Clause'],
    ['item', 'Item'],
    ['covered', 'Covered'],
    ['note', 'Note'],
  ],
  discipline_steps: [
    ['step', 'Step'],
    ['when', 'When'],
    ['by', 'Decided by'],
    ['keep', 'Kept for'],
  ],
};

export function HrListsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? 'Close HR lists' : 'HR lists'}
      </button>
      {open && <HrLists />}
    </>
  );
}

/** One line per row, fields split by " | " in the column order shown. */
function parseLines(kind: Kind, text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split('|').map((x) => x.trim());
      return Object.fromEntries(COLS[kind].map(([k], i) => [k, parts[i] ?? '']));
    });
}

function HrLists() {
  const v = useLoad(() => api.hrLists(), []);
  const act = useAction();
  const [kind, setKind] = useState<Kind | null>(null);
  const [from, setFrom] = useState('');
  const [why, setWhy] = useState('');
  const [text, setText] = useState('');
  return (
    <div style={{ width: '100%' }}>
    <Card title="HR lists" sub="HR keys in each list from a date, with a reason. Earlier versions are kept, and each record uses the version in force on its date.">
      <ErrorNotice error={act.error ?? v.error} />
      {v.loading && !v.data && <Loading what="HR lists" />}
      {v.data && !v.data.installed && <Empty title="Not installed in this database yet." />}
      <div className="list">
        {(v.data?.lists ?? []).map((l) => (
          <div key={l.kind} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <strong>{l.label}</strong>
              {v.data?.canSet && (
                <button className="btn btn-sm" onClick={() => (setKind(kind === l.kind ? null : l.kind), setText(''), setFrom(''), setWhy(''))}>
                  New version
                </button>
              )}
            </div>
            {l.versions.length === 0 && <div className="muted small">Not set by HR yet.</div>}
            {l.versions.map((ver) => (
              <details key={ver.id}>
                <summary className="small">
                  From {ver.from}: {ver.items.length} line(s) · {ver.by} · {ver.reason}
                </summary>
                <ul className="small" style={{ paddingLeft: 18 }}>
                  {ver.items.map((it, i) => (
                    <li key={i}>{Object.values(it).filter(Boolean).join(' · ')}</li>
                  ))}
                </ul>
              </details>
            ))}
            {kind === l.kind && (
              <div style={{ display: 'grid', gap: 6 }}>
                <label className="field">
                  <span className="label">In force from</span>
                  <input className="input" type="date" aria-label="In force from" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">One line each, parts split by |</span>
                  <span className="small muted" data-no-translate>{COLS[l.kind].map(([, h]) => h).join(' | ')}</span>
                  <textarea className="input" rows={6} aria-label="Lines" value={text} onChange={(e) => setText(e.target.value)} />
                  <span className="small muted">{parseLines(l.kind, text).length} line(s)</span>
                </label>
                <label className="field">
                  <span className="label">Why (needed)</span>
                  <input className="input" aria-label="Why" value={why} onChange={(e) => setWhy(e.target.value)} />
                </label>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !from || !why.trim() || !text.trim()}
                  onClick={() => act.run(() => api.setHrList(l.kind, { from, reason: why, items: parseLines(l.kind, text) }), 'Saved.').then((r) => r && (setKind(null), v.reload()))}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
    </div>
  );
}
