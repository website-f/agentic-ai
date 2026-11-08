import { Select } from '../SearchSelect';
import { useState } from 'react';
import { ClockCountdownIcon, CrosshairIcon, ScanIcon, ShieldCheckIcon, WarningIcon } from '@phosphor-icons/react';
import { REGIONS, type ArmedJobKind, type ArmedJobStatus, type ArmsOverdueState, type FirearmStatus } from '@prima/core';
import { api, type ArmsDetail } from '../api';
import { useApp } from '../App';
import { ArmsControlBoard, REQUEST_KIND, Resubmit, StepActions, type ArmsTab } from './ArmsControl';
import { OpsGuide } from './OpsGuide';
import { RecordButton } from './RecordForm';
import { WitnessField, emptyWitness } from './Witness';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Loading, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import '../styles/ops.css';

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
      <PageHead
        title="Arms control"
        sub="Firearms, vaults and every issue and return. PWVSB Arms Control monitors and coordinates; the licensed company issues, receives and counts, with a witness each time. The paper register book stays in use beside the app."
        actions={
          runsCms && (
            <button className="btn btn-primary" onClick={() => go({ view: 'cms' })}>
              CMS management
            </button>
          )
        }
      />
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
      <Stats>
        <Stat label="Firearms (companies with data)" value={total('firearms')} icon={<CrosshairIcon size={16} />} tone="info" />
        <Stat label="Out now" value={total('issued')} icon={<ShieldCheckIcon size={16} />} />
        <Stat label="Overdue" value={total('overdue')} tone={total('overdue') ? 'crit' : 'ok'} icon={<ClockCountdownIcon size={16} />} />
        <Stat
          label="Unverified or lost"
          value={total('unverified')}
          tone={total('unverified') ? 'crit' : 'ok'}
          note="Never counted as secure"
          icon={<WarningIcon size={16} />}
        />
      </Stats>
      <Card title="All companies" sub="Counts only. Serial numbers and vault locations stay with the company. Open a company to see its register." flush>
        <div className="table-wrap">
          <table className="op-sticky-first">
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
                      <td>{r.company.name}</td>
                      <td className="num">{r.firearms}</td>
                      <td className="num">{r.issued}</td>
                      <td className="num">{r.overdue ? <Chip tone="crit">{r.overdue}</Chip> : 0}</td>
                      <td className="num hide-sm op-num" data-tone={r.unverified ? 'crit' : undefined}>
                        {r.unverified}
                      </td>
                      <td className="num hide-sm op-num" data-tone={r.licenceIssues ? 'warn' : undefined}>
                        {r.licenceIssues}
                      </td>
                      <td className="num hide-sm op-num" data-tone={r.vaultIssues ? 'warn' : undefined}>
                        {r.vaultIssues}
                      </td>
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
        </div>
        <p className="op-note op-body-note">
          {data.rows.filter((r) => !r.hasDetail && !r.company.isPilot).length} other companies have no arms data loaded yet. Which companies hold firearms is
          still to be confirmed.
        </p>
      </Card>
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
      <Card title="Firearms">
        <Empty title={me.user.role === 'supervisor' ? 'No firearms at your sites or with your people.' : `${data.company.name} has no firearms recorded.`} />
      </Card>
    );
  const can = data.can.handle;
  const late = data.open.filter((o) => o.state !== 'out' && o.state !== 'returned').length;
  return (
    <>
      <h2 className="op-section-title">{data.company.name}</h2>
      <Stats>
        <Stat
          label="Out now"
          value={data.open.length}
          note={late ? `${late} overdue` : 'All on time'}
          tone={late ? 'crit' : undefined}
          icon={<ShieldCheckIcon size={16} />}
        />
        <Stat label="Armed shifts needing a firearm" value={data.needIssue.length} note="Now or within 2 hours" icon={<ClockCountdownIcon size={16} />} />
        <Stat
          label="No RFID tag yet"
          value={data.rfid.untagged}
          tone={data.rfid.untagged ? 'warn' : 'ok'}
          note="Record the tag on the firearm"
          icon={<ScanIcon size={16} />}
        />
        <Stat
          label="Not scanned, last 7 days"
          value={data.rfid.notScannedWeek}
          tone={data.rfid.notScannedWeek ? 'warn' : 'ok'}
          note="Issues or returns picked by hand"
          icon={<WarningIcon size={16} />}
        />
      </Stats>
      <ErrorNotice error={act.error} />
      {!can && <div className="notice">You can view this. Only the company&apos;s manager or the site supervisor issues, receives and counts firearms.</div>}

      <Card title="Firearms out now" sub="Who holds each firearm, where, and when it is due back" flush>
        {data.open.length === 0 && <Empty title="Every firearm is accounted for in the vault or in maintenance." />}
        <ul className="op-list">
          {data.open.map((o) => (
            <li key={o.movement.id} className="op-item" data-tone={OVERDUE[o.state].tone}>
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    <span className="mono">{o.firearm.tag}</span> · {o.personName} <span className="op-time">{o.staffNo}</span>
                  </span>
                  <span className="op-meta">
                    {o.siteName} · {o.movement.rounds} rounds · out {hhmm(o.movement.issuedAt)} · due back {hhmm(o.movement.dueBack)}
                    {o.movement.caseRef ? ` · case ${o.movement.caseRef}` : ''}
                  </span>
                </div>
                <div className="op-chips">
                  <Chip tone={OVERDUE[o.state].tone}>{OVERDUE[o.state].label}</Chip>
                  {o.movement.issueCheck !== 'rfid' && <Chip tone="unknown">Not scanned out</Chip>}
                </div>
              </div>
              {can && (
                <div className="op-act">
                  <button className="btn btn-sm" onClick={() => setRet(o)}>
                    Receive back
                  </button>
                  {o.state !== 'out' && !o.movement.caseRef && (
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
              )}
            </li>
          ))}
        </ul>
      </Card>

      {data.needIssue.length > 0 && (
        <Card title="Armed shifts needing a firearm" sub="Now or within 2 hours" flush>
          <ul className="op-list">
            {data.needIssue.map((s) => (
              <li key={s.id} className="op-item">
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">{s.personName}</span>
                    <span className="op-meta">
                      {s.siteName} · {hhmm(s.start)}–{hhmm(s.end)}
                    </span>
                  </div>
                  {can && (
                    <button className="btn btn-sm btn-primary" onClick={() => setIssue(s)}>
                      Issue firearm
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.recent.length > 0 && (
        <Card title="Returned in the last day" flush>
          <ul className="op-list">
            {data.recent.map((o) => (
              <li key={o.movement.id} className="op-item">
                <div className="op-line">
                  <span className="op-main">
                    <span>
                      <span className="mono">{o.firearm.tag}</span> · {o.personName} · back {hhmm(o.movement.returnedAt)} with {o.movement.roundsReturned} of{' '}
                      {o.movement.rounds} rounds
                    </span>
                  </span>
                  <span className="op-meta">witness {o.movement.returnWitness}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Vaults" actions={<RecordButton kind="vault" companyId={data.company.id} label="Add vault" />}>
        <div className="ar-vaults">
          {data.vaults.map((v) => (
            <article key={v.vault.id} className="ar-vault">
              <div className="ar-vault-head">
                <div className="op-main">
                  <h3>{v.vault.name}</h3>
                  <span className="op-meta">({v.vault.state})</span>
                </div>
                <RecordButton kind="vault" id={v.vault.id} />
              </div>
              <div className="ar-vault-figs">
                <div>
                  <span>In vault</span>
                  <strong>{v.inVault}</strong>
                </div>
                <div>
                  <span>Last count</span>
                  <strong className={v.vault.lastCountOk === false ? 'op-crit' : undefined}>
                    {v.vault.lastCountAt ? dateTimeLabel(v.vault.lastCountAt) : 'never'}
                  </strong>
                </div>
              </div>
              <span className="op-meta">
                A licence {v.vault.aLicenceHolder ?? 'not recorded'} · Amra {v.vault.custodian}
                {v.vault.lastCountOk === false ? ' · last count: difference found' : ''}
              </span>
              <div className="op-chips">
                <ExpiryChip status={v.approval.status} daysLeft={v.approval.daysLeft} text={v.approval.status === 'OK' ? 'PDRM approval valid' : undefined} />
                {v.vault.alarmOnline === true ? (
                  <Chip tone="ok">Alarm feed online</Chip>
                ) : v.vault.alarmOnline === false ? (
                  <Chip tone="crit">Alarm feed offline</Chip>
                ) : (
                  <Chip tone="unknown">Alarm feed not connected</Chip>
                )}
              </div>
              {can && (
                <div className="ar-vault-foot">
                  <button className="btn btn-sm" onClick={() => setCount(v)}>
                    Count now
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </Card>

      <Card
        title="Firearm register"
        sub="Serial numbers masked; full numbers are in the restricted register"
        actions={<RecordButton kind="firearm" companyId={data.company.id} label="Add firearm" />}
        flush
      >
        <div className="table-wrap">
          <table className="op-sticky-first">
            <thead>
              <tr>
                <th>Tag</th>
                <th className="hide-sm">Type</th>
                <th className="hide-sm">Serial</th>
                <th>Status</th>
                <th>Licence</th>
                <th>RFID</th>
                <th aria-label="Edit" />
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
      </Card>

      {me.user.role !== 'supervisor' && <ArmedJobs data={data} canPlan={can} />}
      {me.user.role !== 'supervisor' && <CompanyRequests data={data} />}
      <OpsGuide area="arms" />

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
        <Select id="ai-f" className="select" value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
          {firearms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.tag} · {f.kind}
            </option>
          ))}
        </Select>
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
        <span className="small ar-rfid-state" data-ok={ok}>
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
    <Card
      title="Arms requests"
      sub="Buy, service, dispose of or report the loss of firearms. Arms Control reviews; the company manager authorises."
      actions={
        data.can.raise && (
          <button className="btn btn-primary btn-sm" onClick={() => setRaising(true)}>
            New arms request
          </button>
        )
      }
      flush
    >
      {error && (
        <div className="op-pad">
          <ErrorNotice error={error} />
        </div>
      )}
      {data.requests.length === 0 && <Empty title="No arms requests in the last 30 days." />}
      <ul className="op-list">
        {data.requests.map((r) => {
          const step = data.requestSteps.find((s) => s.id === r.request.state);
          return (
            <li key={r.request.id} className="op-item">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">{r.request.title}</span>
                  <span className="op-meta">
                    {r.request.ref} · {REQUEST_KIND[r.request.kind]} · raised by {r.request.raisedBy}
                    {r.request.quantity ? ` · ${r.request.quantity} pcs` : ''}
                    {r.request.estCost ? ` · RM${r.request.estCost}` : ''}
                  </span>
                </div>
                <Chip tone={r.request.state === 'draft' ? 'warn' : r.request.state === 'closed' ? 'neutral' : 'info'}>{r.request.state === 'draft' ? 'Sent back' : (step?.label ?? r.request.state)}</Chip>
              </div>
              {r.last && (
                <span className="op-meta">
                  Last: {r.last.by}, {r.last.action.replace('_', ' ')}
                  {r.last.reason ? `: ${r.last.reason}` : ''}
                </span>
              )}
              {r.request.state === 'draft' && r.mine && (
                <Resubmit id={r.request.id} label={r.request.ref} quantity={r.request.quantity ?? null} estCost={r.request.estCost ?? null} busy={busy} run={run} />
              )}
              {r.request.state === 'company_auth' && data.can.authorise && !r.mine && (
                <StepActions id={r.request.id} label={r.request.ref} state={r.request.state} note={note[r.request.id] ?? ''} onNote={(v) => setNote({ ...note, [r.request.id]: v })} busy={busy} run={run} />
              )}
            </li>
          );
        })}
      </ul>
      {raising && <RaiseRequestDrawer data={data} onClose={() => setRaising(false)} />}
    </Card>
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
        <span className="label">What is it for</span>
        <Select className="select" value={kind} onChange={(e) => (setKind(e.target.value as RaiseKind), setPicked([]))}>
          {(['ACQUIRE', 'SERVICE', 'DISPOSE', 'LOSS_REPORT'] as const).map((k) => (
            <option key={k} value={k}>
              {REQUEST_KIND[k]}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">Short title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Buy 500 rounds for the CIT team" />
      </label>
      <label className="field">
        <span className="label">Why, and what papers you have</span>
        <textarea className="textarea" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Monthly range practice; supplier quotation attached to the file" />
      </label>
      {buying ? (
        <>
          <label className="field">
            <span className="label">Quantity</span>
            <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Calibre or model (optional)</span>
            <input className="input" value={calibre} onChange={(e) => setCalibre(e.target.value)} placeholder="e.g. 12 gauge" />
          </label>
          <label className="field">
            <span className="label">Estimated cost, RM (optional)</span>
            <input className="input" type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        </>
      ) : (
        <fieldset className="op-checks">
          <legend>Firearms</legend>
          {choices.length === 0 && <div className="muted small">No firearms on this company's register.</div>}
          {choices.map((f) => (
            <label key={f.firearm.id} className="op-check">
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
      <div className="op-form-actions">
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
    <Card
      title="Armed jobs"
      sub="The company plans and updates each job; Arms Control and the CMS command centre watch them."
      actions={
        canPlan && (
          <button className="btn btn-primary btn-sm" onClick={() => setPlanning(true)}>
            Plan an armed job
          </button>
        )
      }
      flush
    >
      {data.jobs.length === 0 && <Empty title="No armed jobs in the last 7 days or coming up." />}
      <ul className="op-list">
        {data.jobs.map((j) => (
          <JobLine key={j.job.id} row={j} canUpdate={canPlan} />
        ))}
      </ul>
      {planning && <PlanJobDrawer data={data} onClose={() => setPlanning(false)} />}
    </Card>
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
    <li className="op-item" data-tone={JOB_STATUS[j.status].tone}>
      <div className="op-line">
        <div className="op-main">
          <span className="op-title">
            {j.ref} · {JOB_KIND[j.kind]} · {j.client}
          </span>
          <span className="op-meta">
            {dateTimeLabel(j.start)} to {hhmm(j.end)} · crew {row.crewNames.join(', ')}
            {j.vehicle ? ` · ${j.vehicle}` : ''}
            {j.policeApproval ? ` · police approval ${j.policeApproval.ref}` : ''} · {j.lastUpdate} ({dateTimeLabel(j.lastUpdateAt)})
          </span>
        </div>
        <div className="op-chips">
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
          <div className="op-act">
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
    </li>
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
      <div className="op-form">
        <label className="field">
          <span className="label">Kind of job</span>
        <Select className="select" aria-label="Kind of job" value={kind} onChange={(e) => setKind(e.target.value as ArmedJobKind)}>
          {Object.entries(JOB_KIND).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        </label>
        <label className="field">
          <span className="label">Client</span>
          <input className="input" aria-label="Client" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Route or location</span>
          <input
            className="input"
            aria-label="Route or location"
            placeholder="Route, machines or location (no cash amounts)"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>
        <div className="op-form-grid">
          <label className="field">
            <span className="label">Starts</span>
            <input className="input" type="datetime-local" aria-label="Starts" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Ends</span>
            <input className="input" type="datetime-local" aria-label="Ends" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <fieldset className="op-checks op-check-scroll">
          <legend>Crew (people with a valid firearm permit)</legend>
          {data.crewChoices.length === 0 && <span className="muted small">Nobody in this company has a valid firearm permit on record.</span>}
          {data.crewChoices.map((p) => (
            <label key={p.id} className="op-check">
              <input
                type="checkbox"
                checked={crew.includes(p.id)}
                onChange={(e) => setCrew(e.target.checked ? [...crew, p.id] : crew.filter((x) => x !== p.id))}
              />
              {p.name} <span className="mono muted">{p.staffNo}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="label">Vehicle (optional)</span>
          <input className="input" aria-label="Vehicle" placeholder="Vehicle (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
        </label>
        <fieldset className="op-checks">
          <legend>States the job passes through{data.homeState ? ` (home state ${data.homeState})` : ''}</legend>
          {ALL_STATES.map((s) => (
            <label key={s} className="op-check">
              <input
                type="checkbox"
                checked={states.includes(s)}
                onChange={(e) => setStates(e.target.checked ? [...states, s] : states.filter((x) => x !== s))}
              />
              {s}
            </label>
          ))}
        </fieldset>
        {away.length > 0 && (
          <>
            <div className="notice" data-tone="info">
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
        <ErrorNotice error={act.error} />
        <div className="op-form-actions">
        <button
          className="btn btn-primary"
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
        </div>
      </div>
    </Drawer>
  );
}
