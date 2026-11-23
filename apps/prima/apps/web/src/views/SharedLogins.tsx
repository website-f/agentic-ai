import { useEffect, useMemo, useRef, useState } from 'react';
import { CENTRAL_EMPLOYER_IDS, SHARED_LOGIN_DEPARTMENTS, SHARED_LOGIN_MASTER, SHARED_LOGIN_PLACES, SHARED_LOGIN_PLACE_LABEL } from '@prima/core';
import { api } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Shared login list (Fauzan, 23 Nov 2026). Prima keeps only the list: which shared login exists, whose it is, who may
 * use it, where the password is kept and when it was last changed. No password is ever typed here; it stays in the
 * Microsoft shared-login tile or the vault. The server checks every rule again.
 */
type Board = Awaited<ReturnType<typeof api.sharedLogins>>;
type Row = Board['rows'][number];
/** What an "Add" button next to a gap fills in for the new login. */
type Preset = { scope: string; kind: string; provider?: string; accounts?: string };
const kindLabel = (b: Board, k: string) => b.kinds.find((x) => x.key === k)?.label ?? k;
const USUAL_LABEL: Record<Board['kinds'][number]['usual'], string> = {
  every: 'Every company must have one',
  security: 'Every security company must have one',
  none: 'Not needed by every company',
};

const DEPT_LABEL: Record<string, string> = {
  finance: 'Finance', hr: 'HR', fwm: 'Foreign Worker Management', it: 'IT', procurement: 'Procurement', transport: 'Transport',
  arms_control: 'Arms Control', asset: 'Asset Management', audit: 'ACT', operations: 'Operations', cms: 'CMS', chief_of_staff: 'Chief of Staff office',
  director_office: 'Director Office', pdpa: 'PDPA', legal: 'Legal', marketing: 'Marketing', [SHARED_LOGIN_MASTER]: 'CEO master accounts',
};
const STATE: Record<Row['state'], { tone: 'ok' | 'warn' | 'crit' | 'neutral'; label: string }> = {
  ok: { tone: 'ok', label: 'Up to date' },
  due_soon: { tone: 'warn', label: 'Change soon' },
  overdue: { tone: 'crit', label: 'Change overdue' },
  leaver: { tone: 'warn', label: 'Someone left: change now' },
  leaver_late: { tone: 'crit', label: 'Someone left: change is late' },
  closed: { tone: 'neutral', label: 'Closed' },
};

export function SharedLogins() {
  const board = useLoad(() => api.sharedLogins(), []);
  if (board.loading && !board.data) return <Loading what="shared logins" />;
  if (board.error || !board.data)
    return (
      <section className="panel">
        <h3>Shared logins</h3>
        <ErrorNotice error={board.error} />
      </section>
    );
  return <Screen b={board.data} reload={board.reload} />;
}

function Screen({ b, reload }: { b: Board; reload: () => void }) {
  const [find, setFind] = useState('');
  const [show, setShow] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | Preset | null>(null);
  const active = b.rows.filter((r) => r.status === 'active');
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    const needs = (r: Row) => ['overdue', 'leaver', 'leaver_late', 'due_soon'].includes(r.state);
    return b.rows.filter(
      (r) =>
        (!show || (show === 'action' ? needs(r) : show === `c:${r.companyId}` || show === `d:${r.department}`)) &&
        (!q || `${r.system} ${r.companyName ?? ''} ${DEPT_LABEL[r.department ?? ''] ?? ''} ${r.owner.name} ${r.backup.name}`.toLowerCase().includes(q)),
    );
  }, [b, find, show]);
  // Places to filter by: those on the list, and for the group-wide view every company and department.
  const places = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of b.coverage) m.set(c.key, c.kind === 'department' ? (DEPT_LABEL[c.name] ?? c.name) : c.name);
    for (const r of b.rows) m.set(r.companyId ? `c:${r.companyId}` : `d:${r.department}`, r.companyName ?? DEPT_LABEL[r.department ?? ''] ?? String(r.department));
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [b]);
  const count = (s: Row['state'][]) => active.filter((r) => s.includes(r.state)).length;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Shared logins</h3>
          {b.mayAdd && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
              Add a login
            </button>
          )}
        </div>
        <div className="panel-body">
          <p className="muted small">
            The list of logins a team shares (bank, SSM, eSIMS, LHDN, EPF, SOCSO, tender portals, suppliers). Prima keeps the list only. Never type a
            password here: it stays in the Microsoft tile or the vault. A shared password is changed every {b.rule.changeDays} days, and within{' '}
            {b.rule.leaverWorkingDays} working days after anyone on it leaves.
          </p>
        </div>
        <div className="kpis">
          <Kpi label="Logins on the list" value={active.length} />
          <Kpi label="Change within 14 days" value={count(['due_soon'])} tone={count(['due_soon']) ? 'warn' : 'ok'} />
          <Kpi label="Change overdue" value={count(['overdue'])} tone={count(['overdue']) ? 'crit' : 'ok'} />
          <Kpi label="Someone left" value={count(['leaver', 'leaver_late'])} tone={count(['leaver', 'leaver_late']) ? 'crit' : 'ok'} />
        </div>
      </section>
      {editing && (
        <Form
          key={editing === 'new' ? 'new' : 'id' in editing ? editing.id : `${editing.scope}-${editing.kind}-${editing.accounts ?? ''}`}
          b={b}
          row={editing === 'new' || !('id' in editing) ? null : editing}
          preset={editing !== 'new' && !('id' in editing) ? editing : null}
          onDone={() => (setEditing(null), reload())}
          onCancel={() => setEditing(null)}
        />
      )}
      {b.coverage.length > 0 && <Coverage b={b} onPick={(key) => (setShow(key), setFind(''))} onAdd={b.mayAdd ? (p) => setEditing(p) : null} />}
      {b.mayKinds && <Kinds b={b} reload={reload} />}
      {b.mayLeaverList && <Leaver b={b} />}
      <section className="panel">
        <div className="panel-head">
          <h3>The list</h3>
        </div>
        <div className="panel-body">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 2, minWidth: 180 }} aria-label="Find" placeholder="Find a system, company or person" value={find} onChange={(e) => setFind(e.target.value)} />
            <select className="input" style={{ flex: 1, minWidth: 160 }} aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="">Every login</option>
              <option value="action">Needs a change</option>
              {places.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="list" style={{ marginTop: 6 }}>
            {shown.length === 0 && <div className="empty">No shared logins on the list yet.</div>}
            {shown.map((r) => (
              <RowItem key={r.id} r={r} onEdit={() => setEditing(r)} reload={reload} today={b.today} kind={(k) => kindLabel(b, k)} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Every company (the 38 security companies and the 5 central companies) and every central department, with how many
 * logins each has on the list. A place with none listed is shown first, so IT can see what is still missing group-wide.
 */
function Coverage({ b, onPick, onAdd }: { b: Board; onPick: (key: string) => void; onAdd: ((p: Preset) => void) | null }) {
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const label = (c: Board['coverage'][number]) => (c.kind === 'department' ? (DEPT_LABEL[c.name] ?? c.name) : c.name);
  const empty = b.coverage.filter((c) => c.logins === 0);
  const action = b.coverage.filter((c) => c.needAction > 0);
  const gaps = b.coverage.filter((c) => c.kind === 'company' && c.missing.length > 0);
  const unbanked = b.coverage.filter((c) => (c.bankAccounts?.noLogin.length ?? 0) > 0);
  const bankTotal = b.coverage.reduce((n, c) => n + (c.bankAccounts?.total ?? 0), 0);
  const bankOpen = b.coverage.reduce((n, c) => n + (c.bankAccounts?.noLogin.length ?? 0), 0);
  const banksKnown = b.coverage.some((c) => c.bankAccounts);
  const wallets = b.coverage.reduce((n, c) => n + c.walletLogins, 0);
  const groupWide = b.coverage.some((c) => c.kind === 'department');
  const list = [...b.coverage]
    .filter((c) => !onlyEmpty || c.logins === 0 || c.needAction > 0 || c.missing.length > 0 || (c.bankAccounts?.noLogin.length ?? 0) > 0 || c.tenderStaffNotNamed.length > 0)
    .sort((x, y) => y.needAction - x.needAction || (x.logins === 0 ? 0 : 1) - (y.logins === 0 ? 0 : 1) || label(x).localeCompare(label(y)));
  const companies = b.coverage.filter((c) => c.kind === 'company');
  const depts = b.coverage.filter((c) => c.kind === 'department');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{groupWide ? 'Across the group' : 'Your companies'}</h3>
      </div>
      <div className="panel-body">
        <p className="muted small">
          {companies.filter((c) => c.logins > 0).length} of {companies.length} companies and {depts.filter((c) => c.logins > 0).length} of {depts.length} central
          departments have logins on the list. {empty.length} have none yet; {action.length} have a password to change now. {gaps.length} of{' '}
          {companies.length} companies still miss one of the usual portals ({b.usualPortals.map((k) => kindLabel(b, k)).join(', ')}
          {b.securityPortals.length > 0 && <>; {b.securityPortals.map((k) => kindLabel(b, k)).join(', ')} too for security companies</>}).{' '}
          {onAdd && 'Press a missing portal or bank account to add its login.'}
        </p>
        <p className="muted small">
          Banks and e-wallets:{' '}
          {banksKnown
            ? `${bankTotal - bankOpen} of ${bankTotal} company bank accounts in Finance's list are reached by a bank login on this list; ${bankOpen} are not yet (${unbanked.length} companies).`
            : "Finance's list of company bank accounts is not shown to you, so it is checked by Finance and the leaders."}{' '}
          {wallets} e-wallet logins are listed.
        </p>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          Only those with something missing or a change due
        </label>
        <div className="list" style={{ marginTop: 6, maxHeight: 360, overflowY: 'auto' }}>
          {list.length === 0 && <div className="empty">Every company and department has logins on the list and nothing is due.</div>}
          {list.map((c) => (
            <div key={c.key} className="list-item" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 160 }}>
                <button style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => onPick(c.key)} title="Show its logins">
                  {label(c)}
                </button>
                {c.kind === 'department' ? <span className="muted small"> · central department</span> : c.central ? <span className="muted small"> · central company</span> : null}
              </span>
              {c.logins === 0 ? <Chip tone="warn">None listed</Chip> : <Chip tone="neutral">{c.logins} logins</Chip>}
              {c.needAction > 0 && <Chip tone="crit">{c.needAction} to change now</Chip>}
              {c.kind === 'company' && (c.bankLogins > 0 || c.walletLogins > 0) && (
                <Chip tone="neutral">
                  {c.bankLogins} bank · {c.walletLogins} e-wallet
                </Chip>
              )}
              {onAdd && (
                <button className="btn btn-sm" aria-label={`Add a login for ${label(c)}`} onClick={() => onAdd({ scope: c.key, kind: 'other' })}>
                  + Add
                </button>
              )}
              {c.logins > 0 && c.missing.length > 0 && (
                <span className="muted small row" style={{ flexBasis: '100%', gap: 4, flexWrap: 'wrap' }}>
                  Missing: {onAdd ? '' : c.missing.map((k) => kindLabel(b, k)).join(', ')}
                  {onAdd &&
                    c.missing.map((k) => (
                      <button key={k} className="btn btn-sm" aria-label={`Add ${kindLabel(b, k)} for ${label(c)}`} onClick={() => onAdd({ scope: c.key, kind: k })}>
                        + {kindLabel(b, k)}
                      </button>
                    ))}
                </span>
              )}
              {c.tenderStaffNotNamed.length > 0 && (
                <span className="small row" style={{ flexBasis: '100%', gap: 4, flexWrap: 'wrap' }}>
                  {c.tenderLogins
                    ? `Marketing staff who cover it but are not named on its tender portal login: ${c.tenderStaffNotNamed.join(', ')}`
                    : `No ePerolehan or tender portal login listed, and Marketing covers it (${c.tenderStaffNotNamed.join(', ')})`}
                  {onAdd && !c.tenderLogins && (
                    <button className="btn btn-sm" aria-label={`Add ePerolehan for ${label(c)}`} onClick={() => onAdd({ scope: c.key, kind: 'eperolehan' })}>
                      + {kindLabel(b, 'eperolehan')}
                    </button>
                  )}
                </span>
              )}
              {(c.bankAccounts?.noLogin.length ?? 0) > 0 && (
                <span className="small row" style={{ flexBasis: '100%', gap: 4, flexWrap: 'wrap' }}>
                  Bank accounts with no login listed: {onAdd ? '' : c.bankAccounts!.noLogin.join(', ')}
                  {onAdd &&
                    c.bankAccounts!.noLogin.map((a) => {
                      const m = /^(.*) ••(\d{4})$/.exec(a);
                      return (
                        <button key={a} className="btn btn-sm" aria-label={`Add a bank login for ${a}`} onClick={() => onAdd({ scope: c.key, kind: 'bank', provider: m?.[1] ?? '', accounts: m?.[2] ?? '' })}>
                          + {a}
                        </button>
                      );
                    })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RowItem({ r, onEdit, reload, today, kind }: { r: Row; onEdit: () => void; reload: () => void; today: string; kind: (k: string) => string }) {
  const act = useAction();
  const [mode, setMode] = useState<'changed' | 'close' | null>(null);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const s = STATE[r.state];
  const send = () =>
    act
      .run(() => api.sharedLoginsAct(mode!, mode === 'changed' ? { id: r.id, date, reason } : { id: r.id, reason }), mode === 'changed' ? 'Password change recorded.' : 'Login closed.')
      .then((x) => x && (setMode(null), setReason(''), reload()));
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <strong>{r.system}</strong>
        <Chip tone="neutral">{r.companyName ?? DEPT_LABEL[r.department ?? ''] ?? r.department}</Chip>
        {r.kind && r.kind !== 'other' && <Chip tone="neutral">{kind(r.kind)}</Chip>}
        {r.provider && (r.accounts?.length ?? 0) > 0 && (
          <span className="muted small">
            {r.provider}: {r.accounts!.map((a) => `••${a}`).join(', ')}
          </span>
        )}
        <Chip tone={s.tone}>{s.label}</Chip>
      </div>
      <div className="small">
        Owner: {r.owner.name} · Backup: {r.backup.name}
        {r.twoFa && <> · Second-step phone: {r.twoFa.name}</>}
        {r.users.length > 0 && <> · Also used by: {r.users.map((u) => u.name).join(', ')}</>}
      </div>
      <div className="muted small">
        Password kept in: {SHARED_LOGIN_PLACE_LABEL[r.place]}
        {r.lastChanged && <> · Last changed {dateLabel(r.lastChanged)}</>}
        {r.nextDue && r.status === 'active' && <> · Next change by {dateLabel(r.nextDue)}</>}
        {r.url && (
          <>
            {' · '}
            <a href={r.url} target="_blank" rel="noreferrer noopener">
              Sign-in page
            </a>
          </>
        )}
      </div>
      {r.leavers.length > 0 && (
        <div className="small" style={{ fontWeight: 600 }}>
          {r.leavers.join(', ')} left. {r.place === 'own_account' ? 'Close their own login on the portal, then ask IT to take them off this row.' : `Change the password by ${dateLabel(r.changeBy)} and record it here.`}
        </div>
      )}
      {r.note && <div className="muted small">{r.note}</div>}
      <ErrorNotice error={act.error} />
      {(r.mayRecord || r.mayEdit) && r.status === 'active' && !mode && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.mayRecord && (
            <button className="btn btn-sm btn-primary" onClick={() => setMode('changed')}>
              Password changed
            </button>
          )}
          {r.mayEdit && (
            <button className="btn btn-sm" onClick={onEdit}>
              Edit
            </button>
          )}
          {r.mayEdit && (
            <button className="btn btn-sm" onClick={() => setMode('close')}>
              Close
            </button>
          )}
        </div>
      )}
      {mode && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
          {mode === 'changed' && (
            <label className="field">
              <span>Day it was changed</span>
              <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span>{mode === 'changed' ? 'Why (for example: 90-day change, staff left)' : 'Why it is closed'}</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button className="btn btn-sm btn-primary" disabled={act.busy || reason.trim().length < 3} onClick={send}>
            Save
          </button>
          <button className="btn btn-sm" onClick={() => setMode(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function Form({ b, row, preset, onDone, onCancel }: { b: Board; row: Row | null; preset: Preset | null; onDone: () => void; onCancel: () => void }) {
  const act = useAction();
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView?.({ block: 'start' });
  }, []);
  const [system, setSystem] = useState(row?.system ?? '');
  const [url, setUrl] = useState(row?.url ?? '');
  const [scope, setScope] = useState(row ? (row.companyId ? `c:${row.companyId}` : `d:${row.department}`) : (preset?.scope ?? ''));
  const [place, setPlace] = useState<string>(row?.place ?? 'microsoft_tile');
  const [kind, setKind] = useState<string>(row?.kind ?? preset?.kind ?? 'other');
  const [provider, setProvider] = useState(row?.provider ?? preset?.provider ?? '');
  const [accounts, setAccounts] = useState(row ? (row.accounts ?? []).join(', ') : (preset?.accounts ?? ''));
  const kinds = b.kinds.filter((k) => k.active || k.key === row?.kind);
  const money = !!b.kinds.find((k) => k.key === kind)?.money;
  const [ownerId, setOwnerId] = useState(row?.owner.id ?? '');
  const [backupId, setBackupId] = useState(row?.backup.id ?? '');
  const [twoFaId, setTwoFaId] = useState(row?.twoFa?.id ?? '');
  const [userIds, setUserIds] = useState<string[]>(row?.users.map((u) => u.id) ?? []);
  const [addUser, setAddUser] = useState('');
  const [lastChanged, setLastChanged] = useState(row?.lastChanged ?? b.today);
  const [note, setNote] = useState(row?.note ?? '');
  const name = (id: string) => b.people.find((p) => p.id === id)?.name ?? id;
  const people = (
    <>
      <option value="">Choose a person</option>
      {b.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.title})
        </option>
      ))}
    </>
  );
  const save = () =>
    act
      .run(
        () =>
          api.sharedLoginsAct('save', {
            id: row?.id ?? null,
            system,
            url,
            companyId: scope.startsWith('c:') ? scope.slice(2) : null,
            department: scope.startsWith('d:') ? scope.slice(2) : null,
            place,
            kind,
            provider: money ? provider : null,
            accounts: money ? accounts.split(/[\s,;]+/).filter(Boolean) : [],
            ownerId,
            backupId,
            twoFaId: twoFaId || null,
            userIds,
            lastChanged,
            note,
          }),
        'Saved.',
      )
      .then((x) => x && onDone());
  return (
    <section className="panel" ref={top}>
      <div className="panel-head">
        <h3>{row ? `Edit ${row.system}` : 'Add a login'}</h3>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <p className="muted small">Only the details of the login. Never the password, a PIN or a code.</p>
        <ErrorNotice error={act.error} />
        <label className="field">
          <span>System (for example: SSM e-Info, KDN eSIMS, Maybank2E maker)</span>
          <input className="input" value={system} onChange={(e) => setSystem(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Kind of portal</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {money && (
          <>
            <label className="field">
              <span>{kind === 'bank' ? 'Bank (for example: Maybank, CIMB, Bank Islam)' : "E-wallet provider (for example: Touch 'n Go, GrabPay, Boost)"}</span>
              <input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={60} />
            </label>
            <label className="field">
              <span>Last 4 digits of each {kind === 'bank' ? 'account' : 'wallet'} this login reaches (for example: 1234, 5678). Never the full number.</span>
              <input className="input" value={accounts} onChange={(e) => setAccounts(e.target.value)} inputMode="numeric" />
            </label>
          </>
        )}
        <label className="field">
          <span>Sign-in page (https://, optional)</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </label>
        <label className="field">
          <span>Company or central department</span>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value)} disabled={!!row}>
            <option value="">Choose</option>
            <optgroup label="Central departments">
              {SHARED_LOGIN_DEPARTMENTS.filter((d) => d !== SHARED_LOGIN_MASTER || b.mayMaster).map((d) => (
                <option key={d} value={`d:${d}`}>
                  {DEPT_LABEL[d]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Central companies">
              {b.companies.filter((c) => CENTRAL_EMPLOYER_IDS.includes(c.id)).map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Security companies">
              {b.companies.filter((c) => !CENTRAL_EMPLOYER_IDS.includes(c.id)).map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="field">
          <span>Where the password is kept</span>
          <select className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
            {SHARED_LOGIN_PLACES.map((p) => (
              <option key={p} value={p}>
                {SHARED_LOGIN_PLACE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Owner</span>
          <select className="input" aria-label="Owner of the login" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {people}
          </select>
        </label>
        <label className="field">
          <span>Backup (a different person)</span>
          <select className="input" aria-label="Backup of the login" value={backupId} onChange={(e) => setBackupId(e.target.value)}>
            {people}
          </select>
        </label>
        <label className="field">
          <span>Who holds the phone or token for the second-step code (optional)</span>
          <select className="input" value={twoFaId} onChange={(e) => setTwoFaId(e.target.value)}>
            {people}
          </select>
        </label>
        <div className="field">
          <span>Others who may use it</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {userIds.map((id) => (
              <button key={id} className="btn btn-sm" onClick={() => setUserIds((x) => x.filter((y) => y !== id))} title="Take off the list">
                {name(id)} ✕
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, minWidth: 0 }}>
            <select className="input" aria-label="Add a user" style={{ minWidth: 0, flex: '1 1 auto', maxWidth: '100%' }} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
              {people}
            </select>
            <button className="btn btn-sm" disabled={!addUser || userIds.includes(addUser)} onClick={() => (setUserIds((x) => [...x, addUser]), setAddUser(''))}>
              Add
            </button>
          </div>
        </div>
        {place !== 'own_account' && !row?.lastChanged && (
          <label className="field">
            <span>Day the password was last changed</span>
            <input className="input" type="date" max={b.today} value={lastChanged} onChange={(e) => setLastChanged(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>Note (optional, never a password)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </label>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-primary btn-sm" disabled={act.busy || system.trim().length < 2 || !scope || !ownerId || !backupId} onClick={save}>
            Save
          </button>
          <button className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Kinds of portal (Fauzan, 23 Nov 2026: "Make sure it have add button to add anything more"). IT or the CEO add a new
 * kind, rename one, choose whether every company or every security company must have a login for it, or turn it off.
 */
function Kinds({ b, reload }: { b: Board; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Board['kinds'][number] | 'new' | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Kinds of portal</h3>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setOpen((x) => !x)}>
            {open ? 'Hide' : `Show all ${b.kinds.length}`}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => (setOpen(true), setEditing('new'))}>
            Add a kind of portal
          </button>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 6, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <p className="muted small">
          The kinds IT can choose for a login, and which ones every company must have. A company without one shows it as missing above. Turning a kind off
          keeps the logins that have it.
        </p>
        {editing && <KindForm key={editing === 'new' ? 'new' : editing.key} k={editing === 'new' ? null : editing} onDone={() => (setEditing(null), reload())} onCancel={() => setEditing(null)} />}
        {open && (
          <div className="list">
            {b.kinds.map((k) => (
              <div key={k.key} className="list-item" style={{ gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ flex: 1, minWidth: 140 }}>{k.label}</strong>
                <Chip tone={k.usual === 'none' ? 'neutral' : 'ok'}>{USUAL_LABEL[k.usual]}</Chip>
                {!k.active && <Chip tone="warn">Off</Chip>}
                {!k.builtIn && <Chip tone="neutral">Added</Chip>}
                <button className="btn btn-sm" aria-label={`Change ${k.label}`} onClick={() => setEditing(k)}>
                  Change
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function KindForm({ k, onDone, onCancel }: { k: Board['kinds'][number] | null; onDone: () => void; onCancel: () => void }) {
  const act = useAction();
  const [label, setLabel] = useState(k?.label ?? '');
  const [usual, setUsual] = useState<string>(k?.usual ?? 'none');
  const [active, setActive] = useState(k?.active ?? true);
  const save = () => act.run(() => api.sharedLoginsAct('kind', { key: k?.key ?? null, label, usual, active }), 'Saved.').then((x) => x && onDone());
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <strong>{k ? `Change ${k.label}` : 'Add a kind of portal'}</strong>
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Name of the kind of portal (for example: Majlis Daerah licence, client portal)</span>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </label>
      <label className="field">
        <span>Which companies must have a login for it</span>
        <select className="input" value={usual} onChange={(e) => setUsual(e.target.value)} disabled={k?.key === 'other'}>
          {(['none', 'every', 'security'] as const).map((u) => (
            <option key={u} value={u}>
              {USUAL_LABEL[u]}
            </option>
          ))}
        </select>
      </label>
      {k && k.key !== 'other' && (
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          On (offered for new logins)
        </label>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={act.busy || label.trim().length < 2} onClick={save}>
          Save kind
        </button>
        <button className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Leaving steps: every shared login a person is named on. */
function Leaver({ b }: { b: Board }) {
  const [id, setId] = useState('');
  const list = useLoad(() => (id ? api.sharedLoginsLeaver(id) : Promise.resolve(null)), [id]);
  const named = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of b.rows) for (const p of [r.owner, r.backup, ...(r.twoFa ? [r.twoFa] : []), ...r.users]) m.set(p.id, p.name);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [b]);
  if (!named.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>When someone leaves</h3>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 6, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <p className="muted small">Choose the person to see every shared login they are on. The owner of each one changes the password and records it.</p>
        <select className="input" aria-label="Person leaving" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose a person</option>
          {named.map(([pid, n]) => (
            <option key={pid} value={pid}>
              {n}
            </option>
          ))}
        </select>
        <ErrorNotice error={list.error} />
        {id && list.data && (
          <div className="list">
            {list.data.length === 0 && <div className="empty">Not on any shared login.</div>}
            {list.data.map((r) => (
              <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <strong>{r.system}</strong>
                <div className="small">
                  On it as {r.as} · Owner: {r.owner} · Backup: {r.backup}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
