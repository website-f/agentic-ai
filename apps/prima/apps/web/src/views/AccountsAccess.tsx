import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { Card, Empty, PageHead, Search, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { DataTable } from '../DataTable';

/**
 * Accounts and Access (Fauzan, 15 Nov 2026). IT or central HR prepares sign-ins and company access as one request; the
 * HR Director (Chief of Staff or Deputy) or the CEO approves it with a comment, never their own, and then it all goes in
 * at once. The server and the database check every rule again; this screen only helps fill the request in.
 * P105: the office kit look (page head, cards, search, rows that fit a phone), BM rows, and check-boxes in place of the
 * multi-pick lists for regions and states (the searchable pick-list chooses one value only).
 */
type Board = Awaited<ReturnType<typeof api.accounts>>;
type Line = Record<string, unknown> & { op: 'create' | 'update'; label: string };
type Access = { companyId: string; scope: 'act' | 'monitor' };

const SCOPE: Record<Access['scope'], string> = { act: 'acts on', monitor: 'monitors only' };
const STATUS: Record<string, string> = { waiting: 'Waiting for approval', approved: 'Approved', returned: 'Returned' };

export function AccountsAccess() {
  const board = useLoad(() => api.accounts(), []);
  if (board.loading && !board.data) return <Loading what="accounts" />;
  if (board.error || !board.data)
    return (
      <div className="page">
        <PageHead title="Accounts and access" sub="Who can sign in to Prima and which companies they see." />
        <Card>
          <ErrorNotice error={board.error} />
        </Card>
      </div>
    );
  return <Screen b={board.data} />;
}

function Screen({ b }: { b: Board }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [changing, setChanging] = useState<string | null>(null);
  const company = (id: string) => b.companies.find((c) => c.id === id)?.name ?? id;
  const waiting = b.requests.filter((r) => r.status === 'waiting');
  const notLinked = b.accounts.filter((a) => !a.linked && !a.closedFrom).length;
  const add = (l: Line) => setLines((x) => [...x, l]);
  const count = `${b.accounts.length} accounts`;
  const inRequest = (id: string) => lines.some((l) => l.userId === id);
  const changingAccount = changing ? b.accounts.find((a) => a.id === changing) : undefined;
  return (
    <div className="page">
      <PageHead
        title="Accounts and access"
        sub="Who can sign in to Prima and which companies they see. IT or HR prepares a request; the HR Director or the CEO approves it with a comment, never their own. A leader's account needs the CEO. Closing a leaver's access stays in HR's leaving steps."
      />
      <Stats>
        <Stat label="Accounts" value={b.accounts.length} />
        <Stat label="Not linked to Microsoft" value={notLinked} tone={notLinked ? 'warn' : 'ok'} />
        <Stat label="Directory lines with no account" value={b.directory.length} tone={b.directory.length ? 'info' : 'ok'} />
        <Stat label="Requests waiting" value={waiting.length} tone={waiting.length ? 'info' : 'neutral'} />
      </Stats>
      {b.requests.length > 0 && <Requests b={b} company={company} />}
      {b.me.prepare && (
        <>
          <NewAccount b={b} onAdd={add} />
          {b.directory.length > 0 && <FromDirectory b={b} onAdd={(ls) => setLines((x) => [...x, ...ls])} taken={lines} />}
          {lines.length > 0 && <Draft lines={lines} setLines={setLines} />}
        </>
      )}
      <Card title="Everyone with an account" actions={<span className="hx-count">{count}</span>}>
        {/* P107: the data table (search, filters, sort, pages; a card per account on a phone). A change opens in a drawer. */}
        <DataTable
          label="Everyone with an account"
          stateKey="accounts.everyone"
          rows={b.accounts}
          rowKey={(a) => a.id}
          searchPlaceholder="Find a name, title or kind"
          rowTone={(a) => (a.closedFrom ? 'crit' : undefined)}
          empty={<Empty title="No accounts yet." />}
          columns={[
            { id: 'name', label: 'Name', value: (a) => a.name, render: (a) => <strong>{a.name}</strong>, phone: 'title' },
            { id: 'title', label: 'Job title', value: (a) => `${a.title}${a.kind ? ` · ${a.kind}` : ''}`, phone: 'sub' },
            {
              id: 'access',
              label: 'Company and access',
              value: (a) => [...a.companyIds.map(company), ...a.access.map((g) => company(g.companyId))].join(', '),
              sort: false,
              render: (a) => <span className="small">{accessText(a, company) || '–'}</span>,
            },
            {
              id: 'state',
              label: 'Sign-in',
              value: (a) => (a.closedFrom ? 'Closed' : a.linked ? 'Microsoft linked' : 'Not linked'),
              translate: true,
              render: (a) => (
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {a.linked ? <Chip tone="ok">Microsoft linked</Chip> : <Chip tone="warn">Not linked</Chip>}
                  {!a.hrRecord && <Chip tone="neutral">No HR record</Chip>}
                  {a.closedFrom && <Chip tone="crit">Closed from {dateLabel(a.closedFrom)}</Chip>}
                </span>
              ),
            },
          ]}
          filters={[
            { id: 'kind', label: 'Kind', value: (a) => a.kind },
            { id: 'company', label: 'Company', value: (a) => [...new Set([...a.companyIds, ...a.access.map((g) => g.companyId)])], optionLabel: company },
            {
              id: 'link',
              label: 'Sign-in',
              value: (a) => [a.closedFrom ? 'closed' : a.linked ? 'linked' : 'not_linked', ...(a.hrRecord ? [] : ['no_hr'])],
              options: [
                { value: 'linked', label: 'Microsoft linked' },
                { value: 'not_linked', label: 'Not linked' },
                { value: 'no_hr', label: 'No HR record' },
                { value: 'closed', label: 'Closed' },
              ],
            },
          ]}
          rowEnd={(a) =>
            b.me.prepare && a.mayChange && !a.closedFrom ? (
              inRequest(a.id) ? (
                <span className="small muted">In your request</span>
              ) : (
                <button className="btn btn-sm" onClick={() => setChanging(a.id)}>
                  Change name, link or access
                </button>
              )
            ) : null
          }
        />
        {changingAccount && (
          <Drawer title="Change name, link or access" sub={changingAccount.name} onClose={() => setChanging(null)}>
            <ChangeAccount
              b={b}
              a={changingAccount}
              onAdd={(l) => {
                add(l);
                setChanging(null);
              }}
              onCancel={() => setChanging(null)}
            />
          </Drawer>
        )}
      </Card>
    </div>
  );
}

/** Where an account belongs and which companies it sees, in one line. */
function accessText(a: Board['accounts'][number], company: (id: string) => string): string {
  return `${a.companyIds.length ? `Company: ${a.companyIds.map(company).join(', ')}` : ''}${
    a.access.length > 4
      ? `${a.companyIds.length ? ' · ' : ''}Sees ${a.access.length} companies (acts on ${a.access.filter((g) => g.scope === 'act').length}, monitors ${a.access.filter((g) => g.scope === 'monitor').length})`
      : a.access.length
        ? `${a.companyIds.length ? ' · ' : ''}Sees ${a.access.map((g) => `${company(g.companyId)} (${SCOPE[g.scope as Access['scope']] ?? g.scope})`).join(', ')}`
        : ''
  }`;
}

function Requests({ b, company }: { b: Board; company: (id: string) => string }) {
  const act = useAction();
  const [comment, setComment] = useState<Record<string, string>>({});
  const name = (id: string) => b.accounts.find((a) => a.id === id)?.name ?? id;
  const decide = (id: string, approve: boolean) =>
    void act.run(() => api.accountsAct('decide', { requestId: id, approve, comment: comment[id] ?? '' }), approve ? 'Approved: the accounts and access are in.' : 'Returned to the preparer.');
  const waiting = b.requests.filter((r) => r.status === 'waiting').length;
  return (
    <Card title="Requests" sub="Approve or return each request with a comment. Nobody decides their own request." actions={<span className="hx-count">{waiting} waiting</span>}>
      <ErrorNotice error={act.error} />
      {/* P107: every request (no longer only the first 30), searchable, by status, in pages. */}
      <DataTable
        label="Requests"
        stateKey="accounts.requests"
        rows={b.requests}
        rowKey={(r) => r.id}
        searchPlaceholder="Find a request"
        searchText={(r) => `${r.preparedBy} ${r.decidedBy ?? ''} ${r.items.map((i) => (i.op === 'create' ? i.name : i.before.name)).join(' ')}`}
        rowTone={(r) => (r.status === 'returned' ? 'warn' : undefined)}
        filters={[{ id: 'status', label: 'Status', value: (r) => r.status, optionLabel: (v) => STATUS[v] ?? v }]}
        columns={[
          {
            id: 'request',
            label: 'Request',
            value: (r) => r.reason,
            phone: 'title',
            render: (r) => (
              <div className="hx-row-main">
                <span className="hx-row-title">{r.reason}</span>
                <span className="hx-row-meta">
                  {r.preparedBy}, {dateTimeLabel(r.preparedAt)}
                  {r.decidedBy ? ` · ${r.status} by ${r.decidedBy}: ${r.comment}` : ''}
                </span>
              </div>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            value: (r) => STATUS[r.status] ?? r.status,
            translate: true,
            render: (r) => <Chip tone={r.status === 'waiting' ? 'info' : r.status === 'approved' ? 'ok' : 'warn'}>{STATUS[r.status] ?? r.status}</Chip>,
          },
          { id: 'prepared', label: 'Prepared', value: (r) => r.preparedAt, sort: 'date', phone: 'hidden', hideBelow: 1200, render: (r) => dateLabel(r.preparedAt) },
        ]}
        rowDetail={(r) => (
          <div className="hx-row-body hx-dt-body">
            <ul className="hx-row-text" style={{ margin: 0, paddingLeft: 18 }}>
              {r.items.map((i, n) =>
                i.op === 'create' ? (
                  <li key={n}>
                    New: {i.name} ({i.title}), {b.templates.find((t) => t.key === i.template)?.label}
                    {i.companyId ? `, ${company(i.companyId)}` : ''}
                    {i.access.length ? `, sees ${i.access.map((a) => `${company(a.companyId)} (${SCOPE[a.scope as Access['scope']] ?? a.scope})`).join(', ')}` : ''}
                    {i.entraOid ? ', Microsoft account given' : ''}
                  </li>
                ) : (
                  <li key={n}>
                    Change {i.before.name}
                    {i.name ? `: name to ${i.name}` : ''}
                    {i.title ? `, title to ${i.title}` : ''}
                    {i.entraOid ? ', link Microsoft account' : ''}
                    {i.personId ? ', join HR record' : ''}
                    {i.addAccess.length ? `, add ${i.addAccess.map((a) => `${company(a.companyId)} (${SCOPE[a.scope as Access['scope']] ?? a.scope})`).join(', ')}` : ''}
                    {i.endAccess.length ? `, end ${i.endAccess.length} access` : ''}
                  </li>
                ),
              )}
            </ul>
            {r.status === 'waiting' && r.items.some((i) => (i.op === 'create' ? i.access.length : i.addAccess.length) > 0) && (
              <span className="small muted">Company access added runs to {dateLabel(r.accessUntil)}.</span>
            )}
            {r.mayDecide && (
              <div className="hx-form">
                <label className="field">
                  <span className="label">Your comment (needed, 3 characters or more)</span>
                  <input
                    className="input"
                    aria-label="Comment"
                    placeholder="Comment (needed)"
                    value={comment[r.id] ?? ''}
                    onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })}
                  />
                </label>
                <div className="hx-form-actions">
                  <button className="btn btn-primary" disabled={act.busy} onClick={() => decide(r.id, true)}>
                    Approve
                  </button>
                  <button className="btn" disabled={act.busy} onClick={() => decide(r.id, false)}>
                    Return
                  </button>
                </div>
              </div>
            )}
            {r.status === 'waiting' && !r.mayDecide && b.me.approve && <span className="small muted">Someone else decides this request (yours, about you, or a leader's account).</span>}
            {r.status === 'waiting' && !b.me.approve && <span className="small muted">Waiting for the HR Director or the CEO.</span>}
            {r.applied && <span className="small muted">Accounts made: {r.applied.users.map(name).join(', ') || 'none'}.</span>}
          </div>
        )}
      />
    </Card>
  );
}

function Checks({ label, value, onChange, opts }: { label: string; value: string[]; onChange: (v: string[]) => void; opts: [string, string][] }) {
  return (
    <fieldset className="field hx-form-wide" style={{ border: 0, padding: 0, margin: 0 }}>
      <span className="label">{label}</span>
      <ul className="hx-checks" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {opts.map(([k, l]) => (
          <li key={k}>
            <label>
              <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
              {l}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function AccessPicker({ b, value, onChange }: { b: Board; value: Access[]; onChange: (v: Access[]) => void }) {
  const [scope, setScope] = useState<'act' | 'monitor'>('act');
  const [q, setQ] = useState('');
  const has = (id: string) => value.some((v) => v.companyId === id);
  const list = b.companies.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="field hx-form-wide">
      <span className="label">Companies this person may see ({value.length} chosen)</span>
      <div className="hx-form-actions">
        <Select className="select hx-filter" aria-label="Act or monitor" value={scope} onChange={(e) => setScope(e.target.value as 'act' | 'monitor')}>
          <option value="act">Act on (work in the company)</option>
          <option value="monitor">Monitor only</option>
        </Select>
        <button className="btn btn-sm" type="button" onClick={() => onChange(b.companies.map((c) => ({ companyId: c.id, scope })))}>
          All companies
        </button>
        <button className="btn btn-sm" type="button" onClick={() => onChange([])}>
          None
        </button>
      </div>
      {b.companies.length > 8 && <Search value={q} onChange={setQ} placeholder="Find a company" label="Find a company" />}
      <ul className="hx-checks" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 8, background: 'var(--surface)' }}>
        {list.map((c) => (
          <li key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={has(c.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, { companyId: c.id, scope }] : value.filter((v) => v.companyId !== c.id))}
              />
              <span>
                {c.name}
                {has(c.id) ? ` (${SCOPE[value.find((v) => v.companyId === c.id)!.scope]})` : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
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
  const ready = name.trim().length >= 2 && title.trim().length >= 2 && (tpl.where === 'office' ? !!companyId : access.length > 0);
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
    <Card title="Add a new account" sub="Each line goes into one request. Nothing changes until the HR Director or the CEO approves it.">
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Kind of account</span>
          <Select className="select" aria-label="Kind of account" value={t} onChange={(e) => setT(e.target.value)}>
            {b.templates.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </Select>
        </label>
        {b.people.length > 0 && (
          <label className="field">
            <span className="label">HR record (fills the name)</span>
            <Select
              className="select"
              aria-label="HR record"
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
        <label className="field">
          <span className="label">Full name</span>
          <input className="input" aria-label="Full name" placeholder="As on the IC" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Job title</span>
          <input className="input" aria-label="Job title" placeholder="For example: Admin Executive" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {tpl.where === 'office' ? (
          <label className="field">
            <span className="label">Company</span>
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
          <label className="field">
            <span className="label">Finance team</span>
            <Select className="select" aria-label="Finance team" value={financeTeam} onChange={(e) => setFinanceTeam(e.target.value)}>
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
          <label className="field">
            <span className="label">ACT team</span>
            <Select className="select" aria-label="ACT team" value={actTeam} onChange={(e) => setActTeam(e.target.value)}>
              <option value="">Choose</option>
              <option value="1">Team A (1)</option>
              <option value="2">Team B (2)</option>
            </Select>
          </label>
        )}
        {needs.includes('opsSector') && (
          <label className="field">
            <span className="label">Side</span>
            <Select className="select" aria-label="Side" value={opsSector} onChange={(e) => setOpsSector(e.target.value)}>
              <option value="">Both</option>
              <option value="government">Government (Goodwill Empire)</option>
              <option value="private">Private (Sasa Team)</option>
            </Select>
          </label>
        )}
        {needs.includes('regionIds') && <Checks label="Regions covered" value={regionIds} onChange={setRegionIds} opts={b.regions.map((r) => [r.id, r.name])} />}
        {needs.includes('areaStates') && <Checks label="States covered" value={areaStates} onChange={setAreaStates} opts={b.states.map((s) => [s, s])} />}
        <label className="field hx-form-wide">
          <span className="label">Microsoft object ID (optional)</span>
          <input className="input" aria-label="Microsoft object ID" placeholder="From the Entra admin centre" value={entraOid} onChange={(e) => setOid(e.target.value)} />
        </label>
      </div>
      <div className="hx-form-actions" style={{ marginTop: 12 }}>
        <button className="btn" disabled={!ready} onClick={addLine}>
          Add to the request
        </button>
        {!ready && <span className="small muted">{tpl.where === 'office' ? 'Fill in the name, the job title and the company.' : 'Fill in the name and the job title, and choose at least one company.'}</span>}
      </div>
    </Card>
  );
}

function FromDirectory({ b, onAdd, taken }: { b: Board; onAdd: (l: Line[]) => void; taken: Line[] }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const free = b.directory.filter((d) => !taken.some((l) => l.directoryId === d.id));
  const office = b.templates.filter((t) => t.where === 'office');
  const matched = free.filter((d) => d.companyId);
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
  const picked = Object.values(pick).filter(Boolean).length;
  return (
    <Card
      title="From the staff directory (company office staff)"
      sub="Pick the kind of account for each person; leave it on Skip to leave them out. Central staff are added one by one above, with their companies."
      actions={<span className="hx-count">{matched.length} with no account</span>}
    >
      {matched.length === 0 ? (
        <Empty title="Everyone in the directory is in your request or has an account." />
      ) : (
        <DataTable
          label="From the staff directory"
          stateKey="accounts.directory"
          rows={matched}
          rowKey={(d) => d.id}
          searchPlaceholder="Find a name, title or unit"
          columns={[
            { id: 'name', label: 'Name', value: (d) => d.name, render: (d) => <strong>{d.name}</strong>, phone: 'title' },
            { id: 'title', label: 'Job title', value: (d) => d.title, render: (d) => d.title || <span className="muted">no title</span>, phone: 'sub' },
            { id: 'unit', label: 'Unit', value: (d) => d.orgUnit },
            {
              id: 'kind',
              label: 'Kind of account',
              value: (d) => pick[d.id] ?? '',
              sort: false,
              search: false,
              render: (d) => (
                <Select className="select hx-filter" aria-label={`Kind for ${d.name}`} value={pick[d.id] ?? ''} onChange={(e) => setPick({ ...pick, [d.id]: e.target.value })}>
                  <option value="">Skip</option>
                  {office.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              ),
            },
          ]}
          filters={[
            { id: 'unit', label: 'Unit', value: (d) => d.orgUnit },
            { id: 'company', label: 'Company', value: (d) => d.companyId ?? '', optionLabel: (id) => b.companies.find((c) => c.id === id)?.name ?? id },
          ]}
        />
      )}
      {free.some((d) => !d.companyId) && <p className="hx-source">{free.filter((d) => !d.companyId).length} line(s) are not matched to a company; add them by hand above.</p>}
      <div className="hx-form-actions" style={{ marginTop: 12 }}>
        <button className="btn" disabled={!picked} onClick={addAll}>
          Add the picked people to the request
        </button>
      </div>
    </Card>
  );
}

function ChangeAccount({ b, a, onAdd, onCancel }: { b: Board; a: Board['accounts'][number]; onAdd: (l: Line) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [entraOid, setOid] = useState('');
  const [personId, setPersonId] = useState('');
  const [addAccess, setAddAccess] = useState<Access[]>([]);
  const [endAccess, setEnd] = useState<string[]>([]);
  const something = !!(name.trim() || title.trim() || entraOid.trim() || personId || addAccess.length || endAccess.length);
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">Change {a.name}</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">New name</span>
          <input className="input" aria-label="New name" placeholder={`Now: ${a.name}`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">New title</span>
          <input className="input" aria-label="New title" placeholder={`Now: ${a.title}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {!a.linked && (
          <label className="field">
            <span className="label">Microsoft object ID to link</span>
            <input className="input" aria-label="Microsoft object ID" placeholder="From the Entra admin centre" value={entraOid} onChange={(e) => setOid(e.target.value)} />
          </label>
        )}
        {!a.hrRecord && b.people.length > 0 && (
          <label className="field">
            <span className="label">HR record</span>
            <Select className="select" aria-label="HR record" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">No HR record change</option>
              {b.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.staffNo})
                </option>
              ))}
            </Select>
          </label>
        )}
        {a.role === 'pwvsb_officer' && <AccessPicker b={{ ...b, companies: b.companies.filter((c) => !a.access.some((g) => g.companyId === c.id)) }} value={addAccess} onChange={setAddAccess} />}
        {a.access.length > 0 && (
          <fieldset className="field hx-form-wide" style={{ border: 0, padding: 0, margin: 0 }}>
            <span className="label">End access (stops the day before approval)</span>
            <ul className="hx-checks" style={{ maxHeight: 220, overflowY: 'auto' }}>
              {a.access.map((g) => (
                <li key={g.id}>
                  <label>
                    <input type="checkbox" checked={endAccess.includes(g.id)} onChange={(e) => setEnd(e.target.checked ? [...endAccess, g.id] : endAccess.filter((x) => x !== g.id))} />
                    {b.companies.find((c) => c.id === g.companyId)?.name ?? g.companyId}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </div>
      <div className="hx-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={!something}
          onClick={() =>
            onAdd({ op: 'update', label: `Change ${a.name}`, userId: a.id, name: name || null, title: title || null, entraOid: entraOid.trim() || null, personId: personId || null, addAccess, endAccess })
          }
        >
          Add to the request
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
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
    <Card title="Your request" sub="Check the lines, say why, then send it. Approved lines go in together, or none of them does." actions={<span className="hx-count">{lines.length === 1 ? '1 line' : `${lines.length} lines`}</span>}>
      <ul className="hx-rows">
        {lines.map((l, n) => (
          <li key={n} className="hx-row">
            <div className="hx-row-main">
              <span className="hx-row-title">{l.label}</span>
            </div>
            <div className="hx-row-side">
              <button className="btn btn-sm btn-ghost" onClick={() => setLines((x) => x.filter((_, i) => i !== n))}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="hx-form-grid" style={{ marginTop: 12 }}>
        <label className="field">
          <span className="label">Why (needed)</span>
          <input className="input" aria-label="Why" placeholder="For example: Sasa office staff starting 18 Nov" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Company access runs to (empty: one year)</span>
          <input className="input" type="date" aria-label="Company access runs to" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={act.busy || reason.trim().length < 3} onClick={send}>
          Send for approval
        </button>
      </div>
    </Card>
  );
}
