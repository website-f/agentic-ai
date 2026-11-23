import { useMemo, useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Org chart (Fauzan, 23 Nov 2026: "Make sure every head can put who staff under it. So every task can be set
 * correctly."). Each head puts staff under themselves, or under someone already in their own line, with a reason. The
 * CEO or the HR Director names the head and deputy of each central department and central company, and can set any
 * line. Work, help, team memos, claim checks, time slips and leave follow the line shown here. The server checks every
 * rule again; this screen only helps.
 */
type Chart = Awaited<ReturnType<typeof api.orgChart>>;
type Person = Chart['people'][number];

const HOW: Record<Person['how'], { tone: 'ok' | 'info' | 'warn' | 'neutral'; text: string }> = {
  set: { tone: 'info', text: 'Set by a head' },
  standard: { tone: 'neutral', text: 'From the job' },
  assumed: { tone: 'warn', text: 'Assumed: no line yet' },
  top: { tone: 'ok', text: 'Top of the group' },
};

export function OrgChart() {
  const chart = useLoad(() => api.orgChart(), []);
  if (chart.loading && !chart.data) return <Loading what="the org chart" />;
  if (chart.error || !chart.data)
    return (
      <section className="panel">
        <h3>Org chart</h3>
        <ErrorNotice error={chart.error} />
      </section>
    );
  return <Screen c={chart.data} />;
}

function Screen({ c }: { c: Chart }) {
  const [find, setFind] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(c.people.map((p) => [p.id, p])), [c]);
  const children = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of c.people) {
      const key = p.managerId && byId.has(p.managerId) ? p.managerId : '';
      m.set(key, [...(m.get(key) ?? []), p]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [c, byId]);
  const q = find.trim().toLowerCase();
  const matches = q ? c.people.filter((p) => `${p.name} ${p.title}`.toLowerCase().includes(q)).slice(0, 50) : [];
  const mine = children.get(c.meId) ?? [];
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Org chart</h3>
        </div>
        <div className="panel-body">
          <p className="muted small">
            Who reports to whom. Work, help, team memos, claim checks, time slips and leave go to the manager shown here. A head puts staff under
            themselves or under someone in their own line, with a reason; a move between heads goes to the HR Director. {c.whole ? 'You see the whole group.' : 'You see your own line: the people above you and everyone under you.'}
          </p>
          {!c.installed && <p className="small">The org chart settings are not installed in this database yet (module org-lines-v1). The lines shown come from each job; changes open once Fauzan runs the module.</p>}
        </div>
        <div className="kpis">
          <Kpi label="People on the chart" value={c.people.length} />
          <Kpi label="Directly under you" value={mine.length} />
          <Kpi label="Lines set by a head" value={c.people.filter((p) => p.how === 'set').length} tone="info" />
          <Kpi label="Assumed lines" value={c.people.filter((p) => p.how === 'assumed').length} tone={c.people.some((p) => p.how === 'assumed') ? 'warn' : 'ok'} />
        </div>
      </section>
      {c.gaps.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Gaps to fix</h3>
          </div>
          <div className="panel-body">
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {c.gaps.slice(0, 40).map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {c.canBring.length > 0 && <Bring c={c} />}
      <Units c={c} />
      <section className="panel">
        <div className="panel-head">
          <h3>Chart</h3>
        </div>
        <div className="panel-body">
          <input className="input" aria-label="Find" placeholder="Find a name or title" value={find} onChange={(e) => setFind(e.target.value)} />
          {q ? (
            <div className="list" style={{ marginTop: 6 }}>
              {matches.map((p) => (
                <Row key={p.id} p={p} c={c} byId={byId} depth={0} open={open} setOpen={setOpen} />
              ))}
              {!matches.length && <p className="muted small">Nobody matches.</p>}
            </div>
          ) : (
            <div className="list" style={{ marginTop: 6 }}>
              {(children.get('') ?? []).map((p) => (
                <Tree key={p.id} p={p} c={c} byId={byId} kids={children} depth={0} open={open} setOpen={setOpen} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Tree({ p, c, byId, kids, depth, open, setOpen }: { p: Person; c: Chart; byId: Map<string, Person>; kids: Map<string, Person[]>; depth: number; open: string | null; setOpen: (id: string | null) => void }) {
  const under = kids.get(p.id) ?? [];
  // Open the first two levels and the path down to the signed-in person.
  const [shown, setShown] = useState(depth < 2 || p.above || p.id === c.meId);
  return (
    <>
      <Row p={p} c={c} byId={byId} depth={depth} open={open} setOpen={setOpen} count={under.length} expanded={shown} onToggle={() => setShown((s) => !s)} />
      {shown && depth < 12 && under.map((k) => <Tree key={k.id} p={k} c={c} byId={byId} kids={kids} depth={depth + 1} open={open} setOpen={setOpen} />)}
    </>
  );
}

function Row({
  p,
  c,
  byId,
  depth,
  open,
  setOpen,
  count,
  expanded,
  onToggle,
}: {
  p: Person;
  c: Chart;
  byId: Map<string, Person>;
  depth: number;
  open: string | null;
  setOpen: (id: string | null) => void;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const how = HOW[p.how];
  const manager = p.managerId ? byId.get(p.managerId) : undefined;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, marginLeft: Math.min(depth, 6) * 16 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {onToggle && count ? (
          <button className="btn btn-sm" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? '−' : '+'} {count}
          </button>
        ) : null}
        <strong>{p.name}</strong>
        {p.id === c.meId && <Chip tone="info">You</Chip>}
        <span className="muted small">{p.title}</span>
        <Chip tone={how.tone} title={p.setBy ? `${p.setBy.by}, ${dateLabel(p.setBy.at)}: ${p.setBy.reason}` : undefined}>
          {p.setBy?.until ? `${how.text} until ${dateLabel(p.setBy.until)}` : how.text}
        </Chip>
        {p.heads.length > 0 && <Chip tone="ok">{`Head: ${p.heads.length} unit${p.heads.length > 1 ? 's' : ''}`}</Chip>}
        {p.canMove && (
          <button className="btn btn-sm" onClick={() => setOpen(open === p.id ? null : p.id)}>
            Change line
          </button>
        )}
      </div>
      {manager && <span className="small muted">{`Reports to ${manager.name}`}</span>}
      {open === p.id && <MoveForm p={p} c={c} onDone={() => setOpen(null)} />}
    </div>
  );
}

function MoveForm({ p, c, onDone }: { p: Person; c: Chart; onDone: () => void }) {
  const act = useAction();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const choices = c.managerChoices.filter((m) => m.id !== p.id);
  return (
    <div className="panel" style={{ padding: 8, display: 'grid', gap: 6 }}>
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>{`Put ${p.name} under`}</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose…</option>
          {choices.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Reason</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Joins the Selangor team" />
      </label>
      <label className="field">
        <span>Until (leave empty if it is for good)</span>
        <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !to || reason.trim().length < 3}
          onClick={() => act.run(() => api.orgSetLine({ userId: p.id, managerId: to, reason, until: until || null }), 'Line saved.').then((r) => r && onDone())}
        >
          Save
        </button>
        {p.how === 'set' && (
          <button
            className="btn btn-sm"
            disabled={act.busy || reason.trim().length < 3}
            onClick={() => act.run(() => api.orgSetLine({ userId: p.id, managerId: null, reason }), 'Back to the line from the job.').then((r) => r && onDone())}
          >
            Back to the line from the job
          </button>
        )}
      </div>
    </div>
  );
}

function Bring({ c }: { c: Chart }) {
  const act = useAction();
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Put staff under me</h3>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 6 }}>
        <p className="muted small">People in your line or your unit whom you can bring directly under you. Their work, help and team memos come to you from then on.</p>
        <ErrorNotice error={act.error} />
        <select className="input" aria-label="Staff member" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose…</option>
          {c.canBring.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </select>
        <input className="input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !who || reason.trim().length < 3}
          onClick={() => act.run(() => api.orgSetLine({ userId: who, managerId: c.meId, reason }), 'Now under you.').then((r) => r && (setWho(''), setReason('')))}
        >
          Put under me
        </button>
      </div>
    </section>
  );
}

function Units({ c }: { c: Chart }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (!c.units.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Departments and central companies</h3>
      </div>
      <div className="panel-body">
        <p className="muted small">
          A unit's head sees the unit's items and is the manager of its staff who have no other line. {c.canNameHeads ? 'You can name the head and deputy; nobody names themselves.' : 'The CEO or the HR Director names heads.'}
        </p>
        <div className="list">
          {c.units.map((u) => (
            <div key={u.key} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong>{u.label}</strong>
                <span className="small muted">{`${u.members} staff`}</span>
                {u.heads.length ? (
                  u.heads.map((h) => (
                    <Chip key={h.id} tone="ok" title={h.how === 'job' ? 'Head by job' : 'Named in the org chart'}>
                      {h.name}
                      {h.how === 'named' ? ' (named)' : ''}
                    </Chip>
                  ))
                ) : (
                  <Chip tone={u.members ? 'warn' : 'neutral'}>No head</Chip>
                )}
                {u.deputy && <span className="small">{`Deputy: ${u.deputy.name}`}</span>}
                {u.named?.until && <Chip tone="info">{`Until ${dateLabel(u.named.until)}`}</Chip>}
                {c.canNameHeads && (
                  <button className="btn btn-sm" onClick={() => setEdit(edit === u.key ? null : u.key)}>
                    Name head
                  </button>
                )}
              </div>
              {edit === u.key && <HeadForm c={c} unit={u} onDone={() => setEdit(null)} />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeadForm({ c, unit, onDone }: { c: Chart; unit: Chart['units'][number]; onDone: () => void }) {
  const act = useAction();
  const named = unit.heads.find((h) => h.how === 'named');
  const [head, setHead] = useState(named?.id ?? '');
  const [deputy, setDeputy] = useState(unit.deputy?.id ?? '');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const staff = c.people.filter((p) => p.role === 'pwvsb_officer');
  return (
    <div className="panel" style={{ padding: 8, display: 'grid', gap: 6 }}>
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Head</span>
        <select className="input" value={head} onChange={(e) => setHead(e.target.value)}>
          <option value="">Not named (head by job only)</option>
          {staff.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Deputy</span>
        <select className="input" value={deputy} onChange={(e) => setDeputy(e.target.value)}>
          <option value="">None</option>
          {staff.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </select>
      </label>
      <input className="input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      <label className="field">
        <span>Until (leave empty if it is for good)</span>
        <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || reason.trim().length < 3}
        onClick={() => act.run(() => api.orgSetHead({ unit: unit.key, headId: head || null, deputyId: deputy || null, reason, until: until || null }), 'Saved.').then((r) => r && onDone())}
      >
        Save
      </button>
    </div>
  );
}
