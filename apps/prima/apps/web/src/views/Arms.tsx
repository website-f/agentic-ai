import { useState } from 'react';
import { REGIONS, type ArmedJobKind, type ArmedJobStatus, type ArmsOverdueState, type FirearmStatus } from '@prima/core';
import { api, type ArmsDetail } from '../api';
import { useApp } from '../App';
import { ArmsControlBoard, REQUEST_KIND, Resubmit, StepActions, type ArmsTab } from './ArmsControl';
import { OpsGuide } from './OpsGuide';
import { RecordButton } from './RecordForm';
import { WitnessField, emptyWitness } from './Witness';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Kpi, Loading, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';

const FIREARM_STATUS: Record<FirearmStatus, { label: string; tone: Tone }> = {
  IN_VAULT: { label: 'In vault', tone: 'ok' },
  ISSUED: { label: 'Issued', tone: 'info' },
  MAINTENANCE: { label: 'Maintenance', tone: 'neutral' },
  UNVERIFIED: { label: 'Unverified', tone: 'crit' },
  LOST: { label: 'Lost', tone: 'crit' },
  DEPOSITED: { label: 'With the police', tone: 'neutral' },
  OFF_REGISTER: { label: 'Off the register', tone: 'neutral' },
};

const OVERDUE: Record<ArmsOverdueState, { label: string; tone: Tone }> = {
  out: { label: 'On duty', tone: 'info' },
  alert: { label: 'Overdue 15 min', tone: 'warn' },
  escalate: { label: 'Overdue 30 min: escalate', tone: 'crit' },
  loss_case: { label: 'Over 2 hours: possible loss', tone: 'crit' },
  returned: { label: 'Returned', tone: 'ok' },
};

type OpenRow = ArmsDetail['open'][number];

/**
 * Arms control (V13, V14). PWVSB Arms Control and the Director Office monitor; the
 * licensed company issues, receives and counts. The paper register book stays in use.
 */
export function ArmsView() {
  const { isGroup, companyId, me, go } = useApp();
  const runsCms = me.user.role === 'director' || me.user.department === 'arms_control';
  const [tab, setTab] = useState<ArmsTab>('alerts');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Arms control</h1>
          <p>
            Firearms, vaults and every issue and return. PWVSB Arms Control monitors and coordinates; the licensed company issues, receives and counts, with a
            witness each time. The paper register book stays in use beside the app.
          </p>
        </div>
        {runsCms && (
          <button className="btn btn-primary" onClick={() => go({ view: 'cms' })}>
            CMS management
          </button>
        )}
      </div>
      {isGroup && <ArmsControlBoard tab={tab} onTab={setTab} />}
      {(!isGroup || tab === 'companies') && (
        <>
          {isGroup && <GroupArms />}
          <CompanyArms companyId={companyId} />
        </>
      )}
    </div>
  );
}

function GroupArms() {
  const { setCompanyId } = useApp();
  const { data, error } = useLoad(() => api.armsOverview(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="arms overview" />;
  const d = data.rows.filter((r) => r.hasDetail);
  const total = (k: 'firearms' | 'issued' | 'overdue' | 'unverified') => d.reduce((n, r) => n + (r.hasDetail ? r[k] : 0), 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Firearms (companies with data)" value={total('firearms')} />
        <Kpi label="Out now" value={total('issued')} />
        <Kpi label="Overdue" value={total('overdue')} tone={total('overdue') ? 'crit' : 'ok'} />
        <Kpi label="Unverified or lost" value={total('unverified')} tone={total('unverified') ? 'crit' : 'ok'} note="Never counted as secure" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>All companies</h3>
          <span className="muted small">Counts only. Serial numbers and vault locations stay with the company.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Firearms</th>
                <th className="num">Out</th>
                <th className="num">Overdue</th>
                <th className="num hide-sm">Unverified</th>
                <th className="num hide-sm">Licence issues</th>
                <th className="num hide-sm">Vault issues</th>
              </tr>
            </thead>
            <tbody>
              {data.rows
                .filter((r) => r.hasDetail || r.company.isPilot)
                .map((r) =>
                  r.hasDetail ? (
                    <tr key={r.company.id} className="clickable" onClick={() => setCompanyId(r.company.id)}>
                      <td style={{ fontWeight: 600 }}>{r.company.name}</td>
                      <td className="num">{r.firearms}</td>
                      <td className="num">{r.issued}</td>
                      <td className="num">{r.overdue ? <Chip tone="crit">{r.overdue}</Chip> : 0}</td>
                      <td className="num hide-sm">{r.unverified}</td>
                      <td className="num hide-sm">{r.licenceIssues}</td>
                      <td className="num hide-sm">{r.vaultIssues}</td>
                    </tr>
                  ) : (
                    <tr key={r.company.id}>
                      <td>{r.company.name}</td>
                      <td colSpan={6} className="muted small">
                        No arms record
                      </td>
                    </tr>
                  ),
                )}
            </tbody>
          </table>
          <p className="muted small" style={{ padding: '8px 16px' }}>
            {data.rows.filter((r) => !r.hasDetail && !r.company.isPilot).length} other companies have no arms data loaded yet. Which companies hold firearms is
            still to be confirmed.
          </p>
        </div>
      </section>
    </>
  );
}

function CompanyArms({ companyId }: { companyId: string }) {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.arms(companyId), [companyId]);
  const [issue, setIssue] = useState<ArmsDetail['needIssue'][number] | null>(null);
  const [ret, setRet] = useState<OpenRow | null>(null);
  const [count, setCount] = useState<ArmsDetail['vaults'][number] | null>(null);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="arms" />;
  // A supervisor sees only the arms at their own sites and with their own people (Fauzan, 26 Oct 2026).
  if (data.firearms.length === 0)
    return (
      <div className="empty">
        {me.user.role === 'supervisor' ? 'No firearms at your sites or with your people.' : `${data.company.name} has no firearms recorded.`}
      </div>
    );
  const can = data.can.handle;
  return (
    <>
      <h2 style={{ marginTop: 8 }}>{data.company.name}</h2>
      <div className="kpis">
        <Kpi label="No RFID tag yet" value={data.rfid.untagged} tone={data.rfid.untagged ? 'warn' : 'ok'} note="Record the tag on the firearm" />
        <Kpi
          label="Not scanned, last 7 days"
          value={data.rfid.notScannedWeek}
          tone={data.rfid.notScannedWeek ? 'warn' : 'ok'}
          note="Issues or returns picked by hand"
        />
      </div>
      <ErrorNotice error={act.error} />
      <section className="panel">
        <div className="panel-head">
          <h3>Firearms out now</h3>
        </div>
        <div className="list">
          {data.open.map((o) => (
            <div key={o.movement.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {o.firearm.tag} · {o.personName} <span className="muted small mono">{o.staffNo}</span>
                </div>
                <div className="muted small">
                  {o.siteName} · {o.movement.rounds} rounds · out {hhmm(o.movement.issuedAt)} · due back {hhmm(o.movement.dueBack)}
                  {o.movement.caseRef ? ` · case ${o.movement.caseRef}` : ''}
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Chip tone={OVERDUE[o.state].tone}>{OVERDUE[o.state].label}</Chip>
                {o.movement.issueCheck !== 'rfid' && <Chip tone="unknown">Not scanned out</Chip>}
                {can && (
                  <button className="btn btn-sm" onClick={() => setRet(o)}>
                    Receive back
                  </button>
                )}
                {can && o.state !== 'out' && !o.movement.caseRef && (
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={act.busy}
                    onClick={() =>
                      act.run(
                        () => api.escalateFirearm(o.movement.id),
                        (c) => `Case ${c.ref} opened as P1.`,
                      )
                    }
                  >
                    Open P1 case
                  </button>
                )}
              </div>
            </div>
          ))}
          {data.open.length === 0 && <div className="empty">Every firearm is accounted for in the vault or in maintenance.</div>}
        </div>
      </section>

      {data.needIssue.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Armed shifts needing a firearm</h3>
            <span className="muted small">Now or within 2 hours</span>
          </div>
          <div className="list">
            {data.needIssue.map((s) => (
              <div key={s.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{s.personName}</div>
                  <div className="muted small">
                    {s.siteName} · {hhmm(s.start)}–{hhmm(s.end)}
                  </div>
                </div>
                {can && (
                  <button className="btn btn-sm btn-primary" onClick={() => setIssue(s)}>
                    Issue firearm
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Vaults</h3>
          <RecordButton kind="vault" companyId={data.company.id} label="Add vault" />
        </div>
        <div className="list">
          {data.vaults.map((v) => (
            <div key={v.vault.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {v.vault.name} <span className="muted small">({v.vault.state})</span>
                </div>
                <div className="muted small">
                  A licence {v.vault.aLicenceHolder ?? 'not recorded'} · Amra {v.vault.custodian}
                </div>
                <div className="muted small">
                  {v.inVault} in vault · last count {v.vault.lastCountAt ? dateTimeLabel(v.vault.lastCountAt) : 'never'}
                  {v.vault.lastCountOk === false ? ' (difference found)' : ''}
                </div>
                <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                  <ExpiryChip status={v.approval.status} daysLeft={v.approval.daysLeft} text={v.approval.status === 'OK' ? 'PDRM approval valid' : undefined} />
                  {v.vault.alarmOnline === true ? (
                    <Chip tone="ok">Alarm feed online</Chip>
                  ) : v.vault.alarmOnline === false ? (
                    <Chip tone="crit">Alarm feed offline</Chip>
                  ) : (
                    <Chip tone="unknown">Alarm feed not connected</Chip>
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <RecordButton kind="vault" id={v.vault.id} />
                {can && (
                  <button className="btn btn-sm" onClick={() => setCount(v)}>
                    Count now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Firearm register</h3>
          <span className="muted small">Serial numbers masked; full numbers are in the restricted register</span>
          <RecordButton kind="firearm" companyId={data.company.id} label="Add firearm" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th className="hide-sm">Type</th>
                <th className="hide-sm">Serial</th>
                <th>Status</th>
                <th>Licence</th>
                <th>RFID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.firearms.map((f) => (
                <tr key={f.firearm.id}>
                  <td className="mono">{f.firearm.tag}</td>
                  <td className="hide-sm">{f.firearm.kind}</td>
                  <td className="mono hide-sm">{f.firearm.serialMasked}</td>
                  <td>
                    <Chip tone={FIREARM_STATUS[f.firearm.status].tone}>{FIREARM_STATUS[f.firearm.status].label}</Chip>
                  </td>
                  <td>
                    <ExpiryChip status={f.licence.status} daysLeft={f.licence.daysLeft} />
                  </td>
                  <td>{f.firearm.rfidTag ? <Chip tone="ok">Tagged</Chip> : <Chip tone="unknown">No tag</Chip>}</td>
                  <td>
                    <RecordButton kind="firearm" id={f.firearm.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.recent.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Returned in the last day</h3>
          </div>
          <div className="list">
            {data.recent.map((o) => (
              <div key={o.movement.id} className="list-item">
                <span>
                  {o.firearm.tag} · {o.personName} · back {hhmm(o.movement.returnedAt)} with {o.movement.roundsReturned} of {o.movement.rounds} rounds
                </span>
                <span className="muted small">witness {o.movement.returnWitness}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {me.user.role !== 'supervisor' && <ArmedJobs data={data} canPlan={can} />}
      {me.user.role !== 'supervisor' && <CompanyRequests data={data} />}
      <OpsGuide area="arms" />
      {!can && <p className="muted small">You can view this. Only the company's manager or the site supervisor issues, receives and counts firearms.</p>}

      {issue && (
        <IssueDrawer
          shift={issue}
          firearms={data.firearms.filter((f) => f.firearm.status === 'IN_VAULT').map((f) => f.firearm)}
          onClose={() => setIssue(null)}
        />
      )}
      {ret && <ReturnDrawer row={ret} onClose={() => setRet(null)} />}
      {count && <CountDrawer v={count} onClose={() => setCount(null)} />}
    </>
  );
}

function IssueDrawer({
  shift,
  firearms,
  onClose,
}: {
  shift: ArmsDetail['needIssue'][number];
  firearms: ArmsDetail['firearms'][number]['firearm'][];
  onClose: () => void;
}) {
  const act = useAction();
  const [firearmId, setFirearmId] = useState(firearms[0]?.id ?? '');
  const [rounds, setRounds] = useState('5');
  const [witness, setWitness] = useState(emptyWitness);
  const [scan, setScan] = useState('');
  const scanned = rfidCode(scan);
  const match = scanned ? firearms.find((f) => f.rfidTag === scanned) : undefined;
  return (
    <Drawer title="Issue firearm" sub={`${shift.personName} · ${shift.siteName} · ${hhmm(shift.start)}–${hhmm(shift.end)}`} onClose={onClose}>
      <RfidField
        id="ai-s"
        value={scan}
        onChange={(v) => {
          setScan(v);
          const f = firearms.find((x) => x.rfidTag === rfidCode(v));
          if (f) setFirearmId(f.id);
        }}
        state={!scanned ? null : match ? `${match.tag} found` : 'No firearm in this vault has this tag'}
        ok={!!match}
      />
      <div className="field">
        <label className="label" htmlFor="ai-f">
          Firearm
        </label>
        <select id="ai-f" className="select" value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
          {firearms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.tag} · {f.kind}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="ai-r">
          Rounds issued
        </label>
        <input id="ai-r" className="input num" inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
      </div>
      <WitnessField id="ai-w" companyId={shift.companyId} value={witness} onChange={setWitness} />
      <p className="muted small">
        The app checks the guard's firearm permit, the roster, the firearm licence, the vault approval and that this firearm belongs to this company. Any
        failure stops the issue.
      </p>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary"
        disabled={act.busy || !firearmId}
        onClick={async () => {
          const r = await act.run(
            () => api.issueFirearm({ shiftId: shift.id, firearmId, rounds: Number(rounds), witness, rfidScan: scanned }),
            scanned ? 'Firearm scanned, issued and recorded.' : 'Firearm issued and recorded as not scanned.',
          );
          if (r) onClose();
        }}
      >
        Issue and record
      </button>
    </Drawer>
  );
}

function ReturnDrawer({ row, onClose }: { row: OpenRow; onClose: () => void }) {
  const act = useAction();
  const [rounds, setRounds] = useState(String(row.movement.rounds));
  const [witness, setWitness] = useState(emptyWitness);
  const [scan, setScan] = useState('');
  const scanned = rfidCode(scan);
  const ok = !!scanned && scanned === row.firearm.rfidTag;
  return (
    <Drawer title={`Receive ${row.firearm.tag}`} sub={`${row.personName} · ${row.movement.rounds} rounds issued`} onClose={onClose}>
      <RfidField
        id="ar-s"
        value={scan}
        onChange={setScan}
        state={!scanned ? null : ok ? `${row.firearm.tag} confirmed` : `This tag is not ${row.firearm.tag}’s`}
        ok={ok}
      />
      <div className="field">
        <label className="label" htmlFor="ar-r">
          Rounds returned
        </label>
        <input id="ar-r" className="input num" inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
      </div>
      <WitnessField id="ar-w" companyId={row.movement.companyId} value={witness} onChange={setWitness} />
      <p className="muted small">Count every round. If the number differs, a P1 case opens at once and the firearm is marked unverified until it is checked.</p>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary"
        disabled={act.busy}
        onClick={async () => {
          const r = await act.run(
            () => api.returnFirearm(row.movement.id, { roundsReturned: Number(rounds), witness, rfidScan: scanned }),
            (x) => (x.caseRef ? `Rounds differ: case ${x.caseRef} opened as P1.` : 'Back in the vault.'),
          );
          if (r) onClose();
        }}
      >
        Receive into vault
      </button>
    </Drawer>
  );
}

/** A tag code as the server stores it: upper case, no spaces, colons or dashes. */
const rfidCode = (v: string) => v.toUpperCase().replace(/[\s:-]+/g, '') || null;

/**
 * The vault RFID reader (Fauzan, 27 Oct 2026). A USB or Bluetooth reader types the tag code into this box, as a keyboard
 * does; the code can also be typed from the label. Left empty, the issue or return is recorded as not scanned.
 */
function RfidField({ id, value, onChange, state, ok }: { id: string; value: string; onChange: (v: string) => void; state: string | null; ok: boolean }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        Scan RFID tag
      </label>
      <input
        id={id}
        className="input mono"
        autoFocus
        autoComplete="off"
        placeholder="Hold the firearm to the reader"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {state ? (
        <span className="small" style={{ color: ok ? 'var(--ok)' : 'var(--crit)' }}>
          {state}
        </span>
      ) : (
        <span className="muted small">If the reader is not working, choose by hand: it is recorded as not scanned.</span>
      )}
    </div>
  );
}

function CountDrawer({ v, onClose }: { v: ArmsDetail['vaults'][number]; onClose: () => void }) {
  const act = useAction();
  const [counted, setCounted] = useState('');
  const [witness, setWitness] = useState(emptyWitness);
  return (
    <Drawer title={`Count ${v.vault.name}`} sub="Count at every shift change, with a witness" onClose={onClose}>
      <div className="field">
        <label className="label" htmlFor="ac-c">
          Firearms counted in the vault
        </label>
        <input id="ac-c" className="input num" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
      </div>
      <WitnessField id="ac-w" companyId={v.vault.companyId} value={witness} onChange={setWitness} />
      <p className="muted small">
        Count what is physically there before looking at the register. A difference opens a P1 case; the register is never adjusted to fit.
      </p>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary"
        disabled={act.busy || counted === ''}
        onClick={async () => {
          const r = await act.run(
            () => api.countVault(v.vault.id, { counted: Number(counted), witness }),
            (x) =>
              x.ok ? `Count matches the register (${x.expected}).` : `Difference: register ${x.expected}, counted ${x.counted}. Case ${x.caseRef} opened.`,
          );
          if (r) onClose();
        }}
      >
        Record count
      </button>
    </Drawer>
  );
}

const JOB_KIND: Record<ArmedJobKind, string> = {
  CIT: 'Cash-in-transit',
  CDM: 'Cash machine service',
  CASH_VAULT: 'Cash vault',
  BODYGUARD: 'Close protection',
};
const JOB_STATUS: Record<ArmedJobStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Booked', tone: 'neutral' },
  in_progress: { label: 'Running', tone: 'info' },
  delayed: { label: 'Delayed', tone: 'warn' },
  incident: { label: 'Incident', tone: 'crit' },
  completed: { label: 'Completed', tone: 'ok' },
};
const ALL_STATES = REGIONS.flatMap((r) => r.states);

/** The company's armed jobs: plan them and record how each goes. Arms Control and CMS watch the same jobs. */
type RaiseKind = 'ACQUIRE' | 'SERVICE' | 'DISPOSE' | 'LOSS_REPORT';

/**
 * The company's arms requests (review, 2 Nov 2026): the company raises a request, Arms Control reviews it, the company
 * manager (holder of the A licence) authorises it, and a request sent back is corrected and sent again here. The server
 * decides who may press each button; nobody decides their own request.
 */
function CompanyRequests({ data }: { data: ArmsDetail }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const [raising, setRaising] = useState(false);
  const { run, busy, error } = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Arms requests</h3>
          <div className="muted small">Buy, service, dispose of or report the loss of firearms. Arms Control reviews; the company manager authorises.</div>
        </div>
        {data.can.raise && (
          <button className="btn btn-primary btn-sm" onClick={() => setRaising(true)}>
            New arms request
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      <div className="list">
        {data.requests.length === 0 && <div className="empty">No arms requests in the last 30 days.</div>}
        {data.requests.map((r) => {
          const step = data.requestSteps.find((s) => s.id === r.request.state);
          return (
            <div key={r.request.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.request.title}</div>
                  <div className="muted small">
                    {r.request.ref} · {REQUEST_KIND[r.request.kind]} · raised by {r.request.raisedBy}
                    {r.request.quantity ? ` · ${r.request.quantity} pcs` : ''}
                    {r.request.estCost ? ` · RM${r.request.estCost}` : ''}
                  </div>
                </div>
                <Chip tone={r.request.state === 'draft' ? 'warn' : r.request.state === 'closed' ? 'neutral' : 'info'}>{r.request.state === 'draft' ? 'Sent back' : (step?.label ?? r.request.state)}</Chip>
              </div>
              {r.last && (
                <div className="small">
                  Last: {r.last.by}, {r.last.action.replace('_', ' ')}
                  {r.last.reason ? `: ${r.last.reason}` : ''}
                </div>
              )}
              {r.request.state === 'draft' && r.mine && (
                <Resubmit id={r.request.id} label={r.request.ref} quantity={r.request.quantity ?? null} estCost={r.request.estCost ?? null} busy={busy} run={run} />
              )}
              {r.request.state === 'company_auth' && data.can.authorise && !r.mine && (
                <StepActions id={r.request.id} label={r.request.ref} state={r.request.state} note={note[r.request.id] ?? ''} onNote={(v) => setNote({ ...note, [r.request.id]: v })} busy={busy} run={run} />
              )}
            </div>
          );
        })}
      </div>
      {raising && <RaiseRequestDrawer data={data} onClose={() => setRaising(false)} />}
    </section>
  );
}

function RaiseRequestDrawer({ data, onClose }: { data: ArmsDetail; onClose: () => void }) {
  const [kind, setKind] = useState<RaiseKind>('ACQUIRE');
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [qty, setQty] = useState('');
  const [calibre, setCalibre] = useState('');
  const [cost, setCost] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const act = useAction();
  const buying = kind === 'ACQUIRE';
  const choices = data.firearms.filter((f) => f.firearm.status !== 'OFF_REGISTER' && f.firearm.ownership !== 'TRADE');
  const ready = title.trim().length >= 4 && why.trim().length >= 3 && (buying ? Number(qty) >= 1 : picked.length > 0);
  return (
    <Drawer title="New arms request" onClose={onClose}>
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>What is it for</span>
        <select className="input" value={kind} onChange={(e) => (setKind(e.target.value as RaiseKind), setPicked([]))}>
          {(['ACQUIRE', 'SERVICE', 'DISPOSE', 'LOSS_REPORT'] as const).map((k) => (
            <option key={k} value={k}>
              {REQUEST_KIND[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Short title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Buy 500 rounds for the CIT team" />
      </label>
      <label className="field">
        <span>Why, and what papers you have</span>
        <textarea className="input" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Monthly range practice; supplier quotation attached to the file" />
      </label>
      {buying ? (
        <>
          <label className="field">
            <span>Quantity</span>
            <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="field">
            <span>Calibre or model (optional)</span>
            <input className="input" value={calibre} onChange={(e) => setCalibre(e.target.value)} placeholder="e.g. 12 gauge" />
          </label>
          <label className="field">
            <span>Estimated cost, RM (optional)</span>
            <input className="input" type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        </>
      ) : (
        <fieldset className="field">
          <legend>Firearms</legend>
          {choices.length === 0 && <div className="muted small">No firearms on this company's register.</div>}
          {choices.map((f) => (
            <label key={f.firearm.id} className="row small" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={picked.includes(f.firearm.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, f.firearm.id] : picked.filter((x) => x !== f.firearm.id))}
              />
              {f.firearm.tag} · {f.firearm.kind} · {f.firearm.serialMasked}
            </label>
          ))}
        </fieldset>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={act.busy || !ready}
          onClick={() =>
            act.run(
              () =>
                api.raiseArmsRequest({
                  companyId: data.company.id,
                  kind,
                  title: title.trim(),
                  note: why.trim(),
                  firearmIds: buying ? [] : picked,
                  quantity: buying ? Number(qty) : null,
                  calibre: buying && calibre.trim() ? calibre.trim() : null,
                  estCost: buying && cost !== '' ? Number(cost) : null,
                }),
              'Sent to Arms Control',
            ).then((r) => r && onClose())
          }
        >
          Send to Arms Control
        </button>
      </div>
    </Drawer>
  );
}

function ArmedJobs({ data, canPlan }: { data: ArmsDetail; canPlan: boolean }) {
  const [planning, setPlanning] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Armed jobs</h3>
          <div className="muted small">The company plans and updates each job; Arms Control and the CMS command centre watch them.</div>
        </div>
        {canPlan && (
          <button className="btn btn-primary btn-sm" onClick={() => setPlanning(true)}>
            Plan an armed job
          </button>
        )}
      </div>
      <div className="list">
        {data.jobs.length === 0 && <div className="empty">No armed jobs in the last 7 days or coming up.</div>}
        {data.jobs.map((j) => (
          <JobLine key={j.job.id} row={j} canUpdate={canPlan} />
        ))}
      </div>
      {planning && <PlanJobDrawer data={data} onClose={() => setPlanning(false)} />}
    </section>
  );
}

function JobLine({ row, canUpdate }: { row: ArmsDetail['jobs'][number]; canUpdate: boolean }) {
  const j = row.job;
  const act = useAction();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const update = (status: ArmedJobStatus, done: string) =>
    act
      .run(() => api.updateArmedJob(j.id, status, note), done)
      .then((r) => {
        if (r) {
          setNote('');
          setOpen(false);
        }
      });
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {j.ref} · {JOB_KIND[j.kind]} · {j.client}
          </div>
          <div className="muted small">
            {dateTimeLabel(j.start)} to {hhmm(j.end)} · crew {row.crewNames.join(', ')}
            {j.vehicle ? ` · ${j.vehicle}` : ''}
            {j.policeApproval ? ` · police approval ${j.policeApproval.ref}` : ''} · {j.lastUpdate} ({dateTimeLabel(j.lastUpdateAt)})
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Chip>
          {canUpdate && j.status !== 'completed' && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              Update
            </button>
          )}
        </div>
      </div>
      {open && (
        <>
          <input className="input" aria-label="What happened" placeholder="What happened" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {j.status === 'scheduled' && (
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => update('in_progress', 'Job started.')}>
                Started
              </button>
            )}
            <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => update('delayed', 'Delay recorded.')}>
              Delayed
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() => update('incident', 'Incident recorded. Raise a case too.')}
            >
              Incident
            </button>
            <button className="btn btn-primary btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => update('completed', 'Job completed.')}>
              Completed
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </>
      )}
    </div>
  );
}

function PlanJobDrawer({ data, onClose }: { data: ArmsDetail; onClose: () => void }) {
  const act = useAction();
  const [kind, setKind] = useState<ArmedJobKind>('CIT');
  const [client, setClient] = useState('');
  const [detail, setDetail] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [crew, setCrew] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [states, setStates] = useState<string[]>(data.homeState ? [data.homeState] : []);
  const [policeRef, setPoliceRef] = useState('');
  const [policeOn, setPoliceOn] = useState('');
  const away = states.filter((s) => data.homeState && s !== data.homeState);
  return (
    <Drawer
      title="Plan an armed job"
      sub="Crew need a valid firearm permit for the whole job. Firearms are issued at the vault before it starts."
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <select className="select" aria-label="Kind of job" value={kind} onChange={(e) => setKind(e.target.value as ArmedJobKind)}>
          {Object.entries(JOB_KIND).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input className="input" aria-label="Client" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
        <input
          className="input"
          aria-label="Route or location"
          placeholder="Route, machines or location (no cash amounts)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <label className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Starts
          <input className="input" type="datetime-local" aria-label="Starts" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Ends
          <input className="input" type="datetime-local" aria-label="Ends" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <div className="muted small">Crew (people with a valid firearm permit)</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, maxHeight: 160, overflow: 'auto' }}>
          {data.crewChoices.length === 0 && <span className="muted small">Nobody in this company has a valid firearm permit on record.</span>}
          {data.crewChoices.map((p) => (
            <label key={p.id} className="row small" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={crew.includes(p.id)}
                onChange={(e) => setCrew(e.target.checked ? [...crew, p.id] : crew.filter((x) => x !== p.id))}
              />
              {p.name} <span className="mono muted">{p.staffNo}</span>
            </label>
          ))}
        </div>
        <input className="input" aria-label="Vehicle" placeholder="Vehicle (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
        <div className="muted small">States the job passes through{data.homeState ? ` (home state ${data.homeState})` : ''}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {ALL_STATES.map((s) => (
            <label key={s} className="row small" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={states.includes(s)}
                onChange={(e) => setStates(e.target.checked ? [...states, s] : states.filter((x) => x !== s))}
              />
              {s}
            </label>
          ))}
        </div>
        {away.length > 0 && (
          <>
            <div className="muted small">
              Arms leave {data.homeState} for {away.join(', ')}. Record the police approval reference here when you have it.
            </div>
            <input
              className="input"
              aria-label="Police approval reference"
              placeholder="Police approval reference"
              value={policeRef}
              onChange={(e) => setPoliceRef(e.target.value)}
            />
            <input className="input" type="date" aria-label="Police approval date" value={policeOn} onChange={(e) => setPoliceOn(e.target.value)} />
          </>
        )}
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !client.trim() || !start || !end || !crew.length}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.planArmedJob({
                  companyId: data.company.id,
                  kind,
                  client,
                  detail,
                  start: `${start}:00+08:00`,
                  end: `${end}:00+08:00`,
                  crew,
                  vehicle: vehicle || null,
                  states,
                  policeApproval: policeRef.trim() ? { ref: policeRef, on: policeOn } : null,
                }),
              'Armed job booked.',
            );
            if (ok) onClose();
          }}
        >
          Book the job
        </button>
        <ErrorNotice error={act.error} />
      </div>
    </Drawer>
  );
}
