import { Select } from '../SearchSelect';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Accounts and Access (Fauzan, 15 Nov 2026). IT or central HR prepares sign-ins and company access as one request; the
 * HR Director (Chief of Staff or Deputy) or the CEO approves it with a comment, never their own, and then it all goes in
 * at once. The server and the database check every rule again; this screen only helps fill the request in.
 */
type Board = Awaited<ReturnType<typeof api.accounts>>;
type Line = Record<string, unknown> & { op: 'create' | 'update'; label: string };
type Access = { companyId: string; scope: 'act' | 'monitor' };

export function AccountsAccess() {
  const board = useLoad(() => api.accounts(), []);
  if (board.loading && !board.data) return <Loading what="accounts" />;
  if (board.error || !board.data)
    return (
      <section className="panel">
        <h3>Accounts and access</h3>
        <ErrorNotice error={board.error} />
      </section>
    );
  return <Screen b={board.data} />;
}

function Screen({ b }: { b: Board }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [find, setFind] = useState('');
  const [changing, setChanging] = useState<string | null>(null);
  const company = (id: string) => b.companies.find((c) => c.id === id)?.name ?? id;
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return b.accounts.filter((a) => !q || `${a.name} ${a.title} ${a.kind}`.toLowerCase().includes(q)).slice(0, 200);
  }, [b, find]);
  const waiting = b.requests.filter((r) => r.status === 'waiting');
  const add = (l: Line) => setLines((x) => [...x, l]);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Accounts and access</h3>
        </div>
        <div className="panel-body">
          <p className="muted small">
            Who can sign in to Prima and which companies they see. IT or HR prepares; the HR Director or the CEO approves with a comment, never their
            own. A leader's account needs the CEO. Closing a leaver's access stays in HR's leaving steps.
          </p>
        </div>
        <div className="kpis">
          <Kpi label="Accounts" value={b.accounts.length} />
          <Kpi label="Not linked to Microsoft" value={b.accounts.filter((a) => !a.linked && !a.closedFrom).length} tone="warn" />
          <Kpi label="Directory lines with no account" value={b.directory.length} tone={b.directory.length ? 'info' : 'ok'} />
          <Kpi label="Requests waiting" value={waiting.length} tone={waiting.length ? 'info' : 'neutral'} />
        </div>
      </section>
      {b.requests.length > 0 && <Requests b={b} company={company} />}
      {b.me.prepare && (
        <>
          <NewAccount b={b} onAdd={add} />
          {b.directory.length > 0 && <FromDirectory b={b} onAdd={(ls) => setLines((x) => [...x, ...ls])} taken={lines} />}
          {lines.length > 0 && <Draft lines={lines} setLines={setLines} />}
        </>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Everyone with an account</h3>
        </div>
        <div className="panel-body">
          <input className="input" aria-label="Find" placeholder="Find a name, title or kind" value={find} onChange={(e) => setFind(e.target.value)} />
          <div className="list" style={{ marginTop: 6 }}>
            {shown.map((a) => (
              <div key={a.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <strong>{a.name}</strong>
                  <span className="muted small">{a.title}</span>
                  <span className="small">{a.kind}</span>
                  {a.linked ? <Chip tone="ok">Microsoft linked</Chip> : <Chip tone="warn">Not linked</Chip>}
                  {!a.hrRecord && <Chip tone="neutral">No HR record</Chip>}
                  {a.closedFrom && <Chip tone="crit">Closed from {dateLabel(a.closedFrom)}</Chip>}
                </div>
                <span className="small muted">
                  {a.companyIds.length ? `Company: ${a.companyIds.map(company).join(', ')}` : ''}
                  {a.access.length > 4
                    ? `${a.companyIds.length ? ' · ' : ''}Access to ${a.access.length} companies (${a.access.filter((g) => g.scope === 'act').length} act, ${a.access.filter((g) => g.scope === 'monitor').length} monitor)`
                    : a.access.length
                      ? `${a.companyIds.length ? ' · ' : ''}Access: ${a.access.map((g) => `${company(g.companyId)} (${g.scope})`).join(', ')}`
                      : ''}
                </span>
                {b.me.prepare && a.mayChange && !a.closedFrom && (
                  changing === a.id ? (
                    <ChangeAccount
                      b={b}
                      a={a}
                      onAdd={(l) => {
                        add(l);
                        setChanging(null);
                      }}
                      onCancel={() => setChanging(null)}
                    />
                  ) : (
                    <div>
                      <button className="btn" disabled={lines.some((l) => l.userId === a.id)} onClick={() => setChanging(a.id)}>
                        Change name, link or access
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Requests({ b, company }: { b: Board; company: (id: string) => string }) {
  const act = useAction();
  const [comment, setComment] = useState<Record<string, string>>({});
  const name = (id: string) => b.accounts.find((a) => a.id === id)?.name ?? id;
  const decide = (id: string, approve: boolean) =>
    void act.run(() => api.accountsAct('decide', { requestId: id, approve, comment: comment[id] ?? '' }), approve ? 'Approved: the accounts and access are in.' : 'Returned to the preparer.');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Requests</h3>
      </div>
      <div className="panel-body">
        <ErrorNotice error={act.error} />
        <div className="list">
          {b.requests.slice(0, 30).map((r) => (
            <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <strong>{r.reason}</strong>
                <Chip tone={r.status === 'waiting' ? 'info' : r.status === 'approved' ? 'ok' : 'warn'}>{r.status}</Chip>
                <span className="small muted">
                  {r.preparedBy}, {dateTimeLabel(r.preparedAt)}
                  {r.decidedBy ? ` · ${r.status} by ${r.decidedBy}: ${r.comment}` : ''}
                </span>
              </div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {r.items.map((i, n) =>
                  i.op === 'create' ? (
                    <li key={n}>
                      New: {i.name} ({i.title}), {b.templates.find((t) => t.key === i.template)?.label}
                      {i.companyId ? `, ${company(i.companyId)}` : ''}
                      {i.access.length ? `, sees ${i.access.map((a) => `${company(a.companyId)} (${a.scope})`).join(', ')}` : ''}
                      {i.entraOid ? ', Microsoft account given' : ''}
                    </li>
                  ) : (
                    <li key={n}>
                      Change {i.before.name}
                      {i.name ? `: name to ${i.name}` : ''}
                      {i.title ? `, title to ${i.title}` : ''}
                      {i.entraOid ? ', link Microsoft account' : ''}
                      {i.personId ? ', join HR record' : ''}
                      {i.addAccess.length ? `, add ${i.addAccess.map((a) => `${company(a.companyId)} (${a.scope})`).join(', ')}` : ''}
                      {i.endAccess.length ? `, end ${i.endAccess.length} access` : ''}
                    </li>
                  ),
                )}
              </ul>
              {r.status === 'waiting' && r.items.some((i) => (i.op === 'create' ? i.access.length : i.addAccess.length) > 0) && <span className="small muted">Company access added runs to {dateLabel(r.accessUntil)}.</span>}
              {r.mayDecide && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    aria-label="Comment"
                    placeholder="Comment (needed)"
                    value={comment[r.id] ?? ''}
                    onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })}
                  />
                  <button className="btn primary" disabled={act.busy} onClick={() => decide(r.id, true)}>
                    Approve
                  </button>
                  <button className="btn" disabled={act.busy} onClick={() => decide(r.id, false)}>
                    Return
                  </button>
                </div>
              )}
              {r.status === 'waiting' && !r.mayDecide && b.me.approve && <span className="small muted">Someone else decides this request (yours, about you, or a leader's account).</span>}
              {r.applied && <span className="small muted">Made {r.applied.users.map(name).join(', ') || 'no new accounts'}.</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AccessPicker({ b, value, onChange }: { b: Board; value: Access[]; onChange: (v: Access[]) => void }) {
  const [scope, setScope] = useState<'act' | 'monitor'>('act');
  const has = (id: string) => value.some((v) => v.companyId === id);
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span>Companies this person may</span>
        <Select className="select" aria-label="Act or monitor" value={scope} onChange={(e) => setScope(e.target.value as 'act' | 'monitor')}>
          <option value="act">act on</option>
          <option value="monitor">monitor only</option>
        </Select>
        <button className="btn" type="button" onClick={() => onChange(b.companies.map((c) => ({ companyId: c.id, scope })))}>
          All companies
        </button>
        <button className="btn" type="button" onClick={() => onChange([])}>
          None
        </button>
      </div>
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--line, #ddd)', padding: 4 }}>
        {b.companies.map((c) => (
          <label key={c.id} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={has(c.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, { companyId: c.id, scope }] : value.filter((v) => v.companyId !== c.id))}
            />{' '}
            {c.name}
            {has(c.id) ? ` (${value.find((v) => v.companyId === c.id)!.scope})` : ''}
          </label>
        ))}
      </div>
    </div>
  );
}

function NewAccount({ b, onAdd }: { b: Board; onAdd: (l: Line) => void }) {
  const [t, setT] = useState('admin_exec');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [access, setAccess] = useState<Access[]>([]);
  const [financeTeam, setFinanceTeam] = useState('');
  const [actTeam, setActTeam] = useState('');
  const [opsSector, setOpsSector] = useState('');
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [areaStates, setAreaStates] = useState<string[]>([]);
  const [entraOid, setOid] = useState('');
  const [personId, setPersonId] = useState('');
  const tpl = b.templates.find((x) => x.key === t)!;
  const needs = tpl.needs as string[];
  const multi = (v: string[], set: (x: string[]) => void, opts: [string, string][], label: string) => (
    <Select className="select" multiple aria-label={label} value={v} onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))} style={{ minHeight: 80 }}>
      {opts.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </Select>
  );
  const addLine = () => {
    onAdd({
      op: 'create',
      label: `New ${tpl.label}: ${name || '(no name)'}`,
      template: t,
      name,
      title,
      companyId: tpl.where === 'office' ? companyId : null,
      access: tpl.where === 'central' ? access : [],
      ...(needs.includes('financeTeam') ? { financeTeam: Number(financeTeam) } : {}),
      ...(needs.includes('actTeam') ? { actTeam: Number(actTeam) } : {}),
      ...(needs.includes('opsSector') && opsSector ? { opsSector } : {}),
      ...(needs.includes('regionIds') ? { regionIds } : {}),
      ...(needs.includes('areaStates') ? { areaStates } : {}),
      entraOid: entraOid.trim() || null,
      personId: personId || null,
      directoryId: null,
    });
    setName('');
    setTitle('');
    setOid('');
    setPersonId('');
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Add a new account</h3>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="small">
          Kind of account{' '}
          <Select className="select" value={t} onChange={(e) => setT(e.target.value)}>
            {b.templates.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </Select>
        </label>
        {b.people.length > 0 && (
          <label className="small">
            HR record (fills the name){' '}
            <Select
              className="select"
              value={personId}
              onChange={(e) => {
                setPersonId(e.target.value);
                const p = b.people.find((x) => x.id === e.target.value);
                if (p) {
                  setName(p.name);
                  if (tpl.where === 'office') setCompanyId(p.companyId);
                }
              }}
            >
              <option value="">None</option>
              {b.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.staffNo})
                </option>
              ))}
            </Select>
          </label>
        )}
        <input className="input" aria-label="Full name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="Job title" placeholder="Job title" value={title} onChange={(e) => setTitle(e.target.value)} />
        {tpl.where === 'office' ? (
          <label className="small">
            Company{' '}
            <Select className="select" aria-label="Company of the new account" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Choose</option>
              {b.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <AccessPicker b={b} value={access} onChange={setAccess} />
        )}
        {needs.includes('financeTeam') && (
          <label className="small">
            Finance team{' '}
            <Select className="select" value={financeTeam} onChange={(e) => setFinanceTeam(e.target.value)}>
              <option value="">Choose</option>
              {[1, 2, 3, 4, 5, 6, 7].map((x) => (
                <option key={x} value={x}>
                  Team {x}
                </option>
              ))}
            </Select>
          </label>
        )}
        {needs.includes('actTeam') && (
          <label className="small">
            ACT team{' '}
            <Select className="select" value={actTeam} onChange={(e) => setActTeam(e.target.value)}>
              <option value="">Choose</option>
              <option value="1">Team A (1)</option>
              <option value="2">Team B (2)</option>
            </Select>
          </label>
        )}
        {needs.includes('opsSector') && (
          <label className="small">
            Side{' '}
            <Select className="select" value={opsSector} onChange={(e) => setOpsSector(e.target.value)}>
              <option value="">Both</option>
              <option value="government">Government (Goodwill Empire)</option>
              <option value="private">Private (Sasa Team)</option>
            </Select>
          </label>
        )}
        {needs.includes('regionIds') && <label className="small">Regions covered {multi(regionIds, setRegionIds, b.regions.map((r) => [r.id, r.name]), 'Regions')}</label>}
        {needs.includes('areaStates') && <label className="small">States covered {multi(areaStates, setAreaStates, b.states.map((s) => [s, s]), 'States')}</label>}
        <input
          className="input"
          aria-label="Microsoft object ID"
          placeholder="Microsoft object ID (optional; from the Entra admin centre)"
          value={entraOid}
          onChange={(e) => setOid(e.target.value)}
        />
        <div>
          <button className="btn" onClick={addLine}>
            Add to the request
          </button>
        </div>
      </div>
    </section>
  );
}

function FromDirectory({ b, onAdd, taken }: { b: Board; onAdd: (l: Line[]) => void; taken: Line[] }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const free = b.directory.filter((d) => !taken.some((l) => l.directoryId === d.id));
  const office = b.templates.filter((t) => t.where === 'office');
  const addAll = () => {
    const ls: Line[] = free
      .filter((d) => pick[d.id])
      .map((d) => ({
        op: 'create',
        label: `New from the directory: ${d.name}`,
        template: pick[d.id],
        name: d.name,
        title: d.title || 'Staff',
        companyId: d.companyId,
        access: [],
        entraOid: null,
        personId: null,
        directoryId: d.id,
      }));
    onAdd(ls);
    setPick({});
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>From the staff directory (company office staff)</h3>
      </div>
      <div className="panel-body">
        <p className="muted small">Pick the kind of account for each person; leave it empty to skip. Central staff are added one by one above, with their companies.</p>
        <div className="list">
          {free
            .filter((d) => d.companyId)
            .slice(0, 300)
            .map((d) => (
              <div key={d.id} className="list-item row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <strong>{d.name}</strong>
                <span className="small muted">
                  {d.title || 'no title'} · {d.orgUnit}
                </span>
                <Select className="select" aria-label={`Kind for ${d.name}`} value={pick[d.id] ?? ''} onChange={(e) => setPick({ ...pick, [d.id]: e.target.value })}>
                  <option value="">Skip</option>
                  {office.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
        </div>
        {free.some((d) => !d.companyId) && <p className="small muted">{free.filter((d) => !d.companyId).length} line(s) are not matched to a company; add them by hand above.</p>}
        <button className="btn" disabled={!Object.values(pick).some(Boolean)} onClick={addAll}>
          Add the picked people to the request
        </button>
      </div>
    </section>
  );
}

function ChangeAccount({ b, a, onAdd, onCancel }: { b: Board; a: Board['accounts'][number]; onAdd: (l: Line) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [entraOid, setOid] = useState('');
  const [personId, setPersonId] = useState('');
  const [addAccess, setAddAccess] = useState<Access[]>([]);
  const [endAccess, setEnd] = useState<string[]>([]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '3px solid var(--line, #ddd)', paddingLeft: 8 }}>
      <input className="input" aria-label="New name" placeholder={`New name (now ${a.name})`} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" aria-label="New title" placeholder={`New title (now ${a.title})`} value={title} onChange={(e) => setTitle(e.target.value)} />
      {!a.linked && <input className="input" aria-label="Microsoft object ID" placeholder="Microsoft object ID to link" value={entraOid} onChange={(e) => setOid(e.target.value)} />}
      {!a.hrRecord && b.people.length > 0 && (
        <Select className="select" aria-label="HR record" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">No HR record change</option>
          {b.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.staffNo})
            </option>
          ))}
        </Select>
      )}
      {a.role === 'pwvsb_officer' && <AccessPicker b={{ ...b, companies: b.companies.filter((c) => !a.access.some((g) => g.companyId === c.id)) }} value={addAccess} onChange={setAddAccess} />}
      {a.access.length > 0 && (
        <div className="small">
          End access:{' '}
          {a.access.map((g) => (
            <label key={g.id} style={{ marginRight: 8 }}>
              <input type="checkbox" checked={endAccess.includes(g.id)} onChange={(e) => setEnd(e.target.checked ? [...endAccess, g.id] : endAccess.filter((x) => x !== g.id))} />{' '}
              {b.companies.find((c) => c.id === g.companyId)?.name ?? g.companyId}
            </label>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn"
          onClick={() =>
            onAdd({ op: 'update', label: `Change ${a.name}`, userId: a.id, name: name || null, title: title || null, entraOid: entraOid.trim() || null, personId: personId || null, addAccess, endAccess })
          }
        >
          Add to the request
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Draft({ lines, setLines }: { lines: Line[]; setLines: (f: (x: Line[]) => Line[]) => void }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const send = () =>
    void act
      .run(() => api.accountsAct('submit', { items: lines.map(({ label: _l, ...x }) => x), reason, accessUntil: until || undefined }), 'Sent to the HR Director and the CEO for approval.')
      .then((r) => {
        if (r) setLines(() => []);
      });
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Your request ({lines.length} line{lines.length === 1 ? '' : 's'})</h3>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {lines.map((l, n) => (
            <li key={n}>
              {l.label}{' '}
              <button className="btn" onClick={() => setLines((x) => x.filter((_, i) => i !== n))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        <input className="input" aria-label="Why" placeholder="Why (for example: Sasa office staff starting 18 Nov)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="small">
          Company access runs to (empty: one year){' '}
          <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <ErrorNotice error={act.error} />
        <div>
          <button className="btn primary" disabled={act.busy} onClick={send}>
            Send for approval
          </button>
        </div>
      </div>
    </section>
  );
}
