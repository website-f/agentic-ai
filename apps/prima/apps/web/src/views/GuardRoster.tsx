import { Select } from '../SearchSelect';
// Guard roster engine (Part O, Fauzan 13-14 Nov 2026). The OM prepares the month; the site's Area/Zone Supervisor
// verifies where there is one; the Operations Director (private) or OGM (government) publishes. Published versions are
// frozen: a change is a new version with a reason. Client limits block publishing; law points are flags. Allowances:
// HR Director verifies, COO approves. The lump-sum pay is signed by the guard in the app and counts at a site only after
// the CEO switches it on there. The database part is installed only on the CEO's go-ahead; until then this screen says
// so. Every permission is checked by the server.
import { useEffect, useMemo, useState } from 'react';
import { monthDates, type RosterStatus } from '@prima/core';
import { api, type GuardRosterBoard, type MyGuardRoster, type RosterActName } from '../api';
import { useApp } from '../App';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';

type Day = GuardRosterBoard['days'][number];
type Line = { personId: string; date: string; planned: RosterStatus; plannedStart?: string | null; plannedEnd?: string | null };

const CODES: RosterStatus[] = ['WORK_D', 'WORK_N', 'OFF_REST', 'OFF_ADD', 'AL', 'MC', 'HOSP', 'PH', 'UPL', 'ABS', 'RELIEF_D', 'RELIEF_N', 'TRF', 'END', 'PENDING'];
const SHORT: Record<RosterStatus, string> = { WORK_D: 'D', WORK_N: 'N', OFF_REST: 'OFF', OFF_ADD: 'OFF+', AL: 'AL', MC: 'MC', HOSP: 'HOS', PH: 'PH', UPL: 'UPL', ABS: 'ABS', RELIEF_D: 'RD', RELIEF_N: 'RN', TRF: 'TRF', END: 'END', PENDING: '?' };
const LEVEL_TONE: Record<string, Tone> = { block: 'crit', red: 'crit', amber: 'warn', info: 'info' };
const STATUS_TONE: Record<string, Tone> = { draft: 'neutral', submitted: 'warn', verified: 'warn', published: 'ok', replaced: 'unknown' };
const ROLE_LABEL: Record<string, string> = { om: 'OM (prepares)', area_supervisor: 'Area/Zone Supervisor (verifies)', ops_director: 'Operations Director (publishes)', ogm: 'OGM (publishes)', act: 'ACT (reads all)', coo: 'COO', ceo: 'CEO', view: 'View only' };

// P105: plain names for the codes the server keeps (the codes themselves are unchanged).
const ALLOWANCE_TYPE: Record<string, string> = { armed: 'Armed', transport: 'Transport', supervisor: 'Supervisor', night: 'Night', remote: 'Remote or rural', custom: 'Other (custom)' };
const ALLOWANCE_BASIS: Record<string, string> = { monthly: 'A month', per_duty: 'Per duty', per_night: 'Per night', per_trip: 'Per trip' };
const LAW_POINT: Record<string, string> = {
  weekly_rest: 'Weekly rest day',
  daily_12h: 'More than 12 hours in a day',
  spread_over: 'Spread-over of the day',
  ot_104: 'Overtime over 104 hours a month',
  break_after_5h: 'Break after 5 hours',
  normal_hours: 'Normal hours',
};
const EVIDENCE_KIND: Record<string, string> = { jtk_permit: 'Labour department permit', client_permission: 'Client permission', other_document: 'Other document' };
const VERSION_STATUS: Record<string, string> = { draft: 'draft', submitted: 'submitted', verified: 'verified', published: 'published', replaced: 'replaced' };
const REASON_HINT = 'Reason (needed, 5 characters or more)';

const isDutyCode = (s: RosterStatus) => s === 'WORK_D' || s === 'WORK_N' || s === 'RELIEF_D' || s === 'RELIEF_N';

function thisMonth(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
}

/** Duty times from the site's coverage shift (local +08:00); a night end before its start ends the next day. */
function dutyTimes(b: GuardRosterBoard, date: string, code: RosterStatus): { plannedStart: string; plannedEnd: string } | null {
  const shift = b.coverage?.shifts.find((s) => s.code === (code === 'WORK_N' || code === 'RELIEF_N' ? 'N' : 'D'));
  if (!shift) return null;
  const start = `${date}T${shift.start}:00+08:00`;
  const endDate = shift.end <= shift.start ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date;
  return { plannedStart: start, plannedEnd: `${endDate}T${shift.end}:00+08:00` };
}

export function GuardRosterView() {
  const { companyId } = useApp();
  const sites = useLoad(() => api.sites(companyId), [companyId]);
  const [siteId, setSiteId] = useState<string>('');
  const [month, setMonth] = useState(thisMonth());
  useEffect(() => {
    if (sites.data?.length && !sites.data.some((s) => s.site.id === siteId)) setSiteId(sites.data[0].site.id);
  }, [sites.data, siteId]);
  const board = useLoad(() => (siteId ? api.guardRosterBoard(siteId, month) : Promise.resolve(null)), [siteId, month]);

  return (
    <div className="page">
      <PageHead
        title="Guard roster (engine)"
        sub="The OM prepares the month, the Area/Zone Supervisor verifies where the site has one, and the Operations Director (private) or OGM (government) publishes. Client limits block publishing; law points are flags to follow up."
        actions={<Chip tone="warn">Trial: not switched on</Chip>}
      />
      <Card>
        <div className="hx-form-grid">
          <label className="field">
            <span className="label">Site</span>
            <Select className="select" aria-label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {(sites.data ?? []).map((s) => (
                <option key={s.site.id} value={s.site.id}>
                  {s.site.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="label">Month</span>
            <input className="input" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
      </Card>
      <ErrorNotice error={sites.error ?? board.error} />
      {sites.data && sites.data.length === 0 && <Empty title="No sites in this company." />}
      {board.loading && !board.data ? <Loading what="the roster" /> : board.data ? <Board b={board.data} /> : null}
    </div>
  );
}

function Reason({ value, onChange, label = REASON_HINT }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" aria-label={label} value={value} maxLength={500} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Board({ b }: { b: GuardRosterBoard }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<Day | null>(null);
  const [panel, setPanel] = useState<'grid' | 'coverage' | 'pay' | 'evidence'>('grid');
  const run = (name: RosterActName, args: unknown[], done: string) => act.run(() => api.rosterAct(name, args), done);
  const v = b.current;
  const editable = b.can.prepare && (!v || v.status === 'draft' || v.status === 'published');
  const d = b.dashboard;
  const ready = reason.trim().length >= 5;
  return (
    <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Chip tone="info">{ROLE_LABEL[b.role] ?? b.role}</Chip>
        <Chip tone="neutral">{b.site.sector === 'government' ? 'Government site: OGM publishes' : 'Private site: Operations Director publishes'}</Chip>
        {b.coverage?.lumpSumSwitch?.on ? <Chip tone="warn">Lump-sum pay ON (CEO)</Chip> : <Chip tone="neutral">Lump-sum pay off</Chip>}
      </div>
      {!b.coverage && <div className="notice" data-tone="warn">Coverage for this site is not set yet. The {b.publisher === 'ogm' ? 'OGM' : 'Operations Director'} enters it from the signed contract.</div>}
      {d && (
        <Stats>
          <Stat label="Coverage" value={`${d.coveragePct ?? 0}%`} tone={(d.coveragePct ?? 0) >= 100 ? 'ok' : 'crit'} />
          <Stat label="Open exceptions" value={b.exceptions.length} tone={b.exceptions.length ? 'warn' : 'ok'} />
          <Stat label="Late changes" value={d.lateChanges} />
          <Stat label="Version" value={v ? `v${v.version} ${VERSION_STATUS[v.status] ?? v.status}` : 'none'} tone={v ? STATUS_TONE[v.status] : 'unknown'} />
        </Stats>
      )}
      <div className="seg hx-tabs" role="group" aria-label="Roster part">
        {(['grid', 'coverage', 'pay', 'evidence'] as const).map((p) => (
          <button key={p} aria-pressed={panel === p} onClick={() => setPanel(p)}>
            {{ grid: 'Month', coverage: 'Coverage and breaks', pay: 'Allowances and lump sum', evidence: 'Permits and evidence' }[p]}
          </button>
        ))}
      </div>
      <ErrorNotice error={act.error} />
      {panel === 'grid' && (
        <>
          {v && ((b.can.prepare && v.status === 'draft') || b.can.verify || b.can.publish) && (
            <Card title="Next step" sub={b.can.prepare ? 'Send the draft on with a reason. Nobody approves their own roster.' : 'Check the month below, then decide with a reason. Nobody approves their own roster.'}>
              <div className="hx-form-grid">
                <Reason value={reason} onChange={setReason} />
              </div>
              <div className="hx-form-actions" style={{ marginTop: 12 }}>
                {b.can.prepare && v.status === 'draft' && <button className="btn btn-primary" disabled={act.busy || !ready} onClick={() => run('rosterStep', [v.id, 'submit', reason], 'Roster submitted.')}>Submit</button>}
                {b.can.verify && <button className="btn btn-primary" disabled={act.busy || !ready} onClick={() => run('rosterStep', [v.id, 'verify', reason], 'Roster verified.')}>Verify</button>}
                {b.can.publish && <button className="btn btn-primary" disabled={act.busy || !b.canPublish || !ready} onClick={() => run('rosterStep', [v.id, 'publish', reason], 'Roster published.')}>Publish</button>}
                {(b.can.verify || b.can.publish) && <button className="btn" disabled={act.busy || !ready} onClick={() => run('rosterStep', [v.id, 'return', reason], 'Roster returned to the OM.')}>Return</button>}
                {b.can.publish && !b.canPublish && <span className="small muted">A problem below blocks publishing.</span>}
              </div>
            </Card>
          )}
          <Card title="Month">
            <div className="hx-stack-tight">
              <Findings b={b} />
              <Grid b={b} editable={editable} onOpen={setOpen} />
            </div>
          </Card>
          <Versions b={b} />
          {v && <PrintSheet b={b} />}
        </>
      )}
      {panel === 'coverage' && (
        <Card title="Coverage and breaks">
          <Coverage b={b} />
        </Card>
      )}
      {panel === 'pay' && (
        <Card title="Allowances and lump sum">
          <Pay b={b} />
        </Card>
      )}
      {panel === 'evidence' && (
        <Card title="Permits and evidence">
          <Evidence b={b} />
        </Card>
      )}
      {/* P105: the drawer follows the reloaded board, so a recorded day shows its next step at once. */}
      {open && <DayDrawer b={b} day={b.days.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * The checker's findings. P105: the same point on many days is one line with its count and its first and last date
 * (a month of amber flags pushed the roster itself off the screen); blocking points first.
 */
function Findings({ b }: { b: GuardRosterBoard }) {
  const [all, setAll] = useState(false);
  if (!b.findings.length) return b.current ? <p className="muted">No problems found by the checker.</p> : null;
  const order = ['block', 'red', 'amber', 'info'];
  const groups = new Map<string, { f: GuardRosterBoard['findings'][number]; dates: string[]; n: number }>();
  for (const f of b.findings) {
    const k = `${f.level}|${f.owner}|${f.message}`;
    const g = groups.get(k) ?? { f, dates: [], n: 0 };
    g.n += 1;
    if (f.date) g.dates.push(f.date);
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((x, y) => order.indexOf(x.f.level) - order.indexOf(y.f.level) || y.n - x.n);
  const shown = all ? list : list.slice(0, 6);
  const span = (d: string[]) => {
    if (!d.length) return '';
    const sorted = [...d].sort();
    return sorted.length === 1 ? `${sorted[0]}: ` : `${sorted.length} days, ${sorted[0]} to ${sorted[sorted.length - 1]}: `;
  };
  return (
    <>
      <ul className="list" aria-label="Roster checks">
        {shown.map(({ f, dates }, i) => (
          <li key={i}>
            <Chip tone={LEVEL_TONE[f.level] ?? 'neutral'}>{f.level === 'block' ? 'Blocks publishing' : f.level === 'red' ? 'Red flag' : f.level === 'amber' ? 'Amber flag' : 'Note'}</Chip> {span(dates)}
            {f.message} <span className="muted">({f.owner === 'OM' ? 'OM to fix' : 'OD/OGM to follow up'})</span>
          </li>
        ))}
      </ul>
      {list.length > 6 && (
        <div>
          <button className="btn btn-sm btn-ghost" onClick={() => setAll((x) => !x)}>
            {all ? 'Show fewer checks' : `Show all ${list.length} checks`}
          </button>
        </div>
      )}
    </>
  );
}

function Grid({ b, editable, onOpen }: { b: GuardRosterBoard; editable: boolean; onOpen: (d: Day) => void }) {
  const act = useAction();
  const dates = useMemo(() => monthDates(b.month), [b.month]);
  const [lines, setLines] = useState<Map<string, RosterStatus>>(new Map());
  const [extra, setExtra] = useState<string[]>([]);
  const [why, setWhy] = useState('');
  const [pattern, setPattern] = useState<'5on2off' | '6on1off'>('5on2off');
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  // P105: on a published roster the OM records each day (tap a day); changing the roster itself is a new version,
  // opened on purpose. Before, the OM only ever saw the edit lists and could not open a day to record it.
  const [changing, setChanging] = useState(false);
  const propose = async () => {
    // A suggestion changes nothing on the server, so the board is not reloaded (that would wipe the suggestion).
    setProposeError(null);
    let r: Awaited<ReturnType<typeof api.proposeGuardRoster>>;
    try {
      r = await api.proposeGuardRoster(b.site.id, b.month, { pattern, personIds: pick });
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : String(e));
      return;
    }
    setLines(new Map(r.lines.map((l) => [`${l.personId}|${l.date}`, l.planned])));
    setExtra(pick);
    const blocks = r.findings.filter((f) => f.level === 'block').length;
    setNote(`${r.note} ${r.uncovered.length ? `${r.uncovered.length} shift(s) still short of guards.` : 'Every post is covered.'} ${blocks ? `${blocks} problem(s) block publishing.` : ''}`);
  };
  useEffect(() => {
    setLines(new Map(b.days.map((d) => [`${d.personId}|${d.date}`, d.planned])));
    setExtra([]);
  }, [b.days]);
  const people = [...new Set([...b.days.map((d) => d.personId), ...extra])];
  const name = (id: string) => b.people.find((p) => p.id === id)?.staffNo ?? id;
  const full = (id: string) => b.people.find((p) => p.id === id)?.name ?? '';
  const byKey = new Map(b.days.map((d) => [`${d.personId}|${d.date}`, d]));
  const published = b.current?.status === 'published';
  const save = () => {
    const days: Line[] = [];
    for (const [k, planned] of lines) {
      const [personId, date] = k.split('|');
      if (!people.includes(personId)) continue;
      days.push({ personId, date, planned, ...(isDutyCode(planned) ? dutyTimes(b, date, planned) ?? {} : {}) });
    }
    return act.run(() => api.rosterAct('saveRosterDraft', [b.site.id, b.month, { days, changeReason: why }]), 'Draft saved and checked.');
  };
  return (
    <>
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table className="table compact" data-no-translate>
          <thead>
            <tr>
              <th>Guard</th>
              {dates.map((d) => (
                <th key={d}>{Number(d.slice(8))}</th>
              ))}
              <th>Duties</th>
            </tr>
          </thead>
          <tbody>
            {people.map((pid) => (
              <tr key={pid}>
                <th title={full(pid)}>
                  {name(pid)}
                  <span className="small muted" style={{ display: 'block', fontWeight: 400, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {full(pid)}
                  </span>
                </th>
                {dates.map((date) => {
                  const k = `${pid}|${date}`;
                  const day = byKey.get(k);
                  const code = lines.get(k);
                  if (editable && (!published || changing))
                    return (
                      <td key={date}>
                        <Select aria-label={`${name(pid)} ${date}`} value={code ?? ''} onChange={(e) => setLines((m) => new Map(m).set(k, e.target.value as RosterStatus))}>
                          <option value="">–</option>
                          {CODES.map((c) => (
                            <option key={c} value={c}>
                              {SHORT[c]}
                            </option>
                          ))}
                        </Select>
                      </td>
                    );
                  return (
                    <td key={date}>
                      {day && published ? (
                        <button className="btn btn-xs" title={b.statuses[day.planned]} onClick={() => onOpen(day)}>
                          {SHORT[day.planned]}
                          {day.actual && day.actual !== day.planned ? `→${SHORT[day.actual]}` : day.actual ? '✓' : ''}
                        </button>
                      ) : (
                        <span title={code ? b.statuses[code] : ''}>{code ? SHORT[code] : '–'}</span>
                      )}
                    </td>
                  );
                })}
                <td>{b.dutiesPerPerson[pid] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {people.length === 0 && <Empty title={editable ? 'No guards on this month yet.' : 'No published roster for this month yet.'}>{editable ? 'Add guards below, or let Prima suggest a month.' : undefined}</Empty>}
      {editable && published && (
        <div className="hx-form-actions">
          <button className="btn btn-sm" onClick={() => setChanging((x) => !x)}>
            {changing ? 'Back to recording days' : 'Change the published roster (new version)'}
          </button>
        </div>
      )}
      {editable && (!published || changing) && b.can.autoRoster && (
        <details style={{ margin: '8px 0' }}>
          <summary>Auto-roster suggestion</summary>
          <p className="muted">Prima suggests a month with staggered OFF days and fixed day/night teams. Nothing is saved until you press Save draft, and it still goes through the approval chain.</p>
          <label className="field">
            <span className="label">Pattern</span>
            <Select className="select" aria-label="Pattern" value={pattern} onChange={(e) => setPattern(e.target.value as '5on2off' | '6on1off')}>
              <option value="5on2off">5 on / 2 off</option>
              <option value="6on1off">6 on / 1 off</option>
            </Select>
          </label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {b.people.map((p) => (
              <label key={p.id} className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={pick.includes(p.id)} onChange={(e) => setPick((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} /> {p.staffNo} {p.name}
              </label>
            ))}
          </div>
          <button className="btn btn-sm" disabled={act.busy || !pick.length} onClick={propose}>Suggest a month</button>
          {note && <p className="notice" data-tone="info">{note}</p>}
          <ErrorNotice error={proposeError} />
        </details>
      )}
      {editable && (!published || changing) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <label className="field">
            <span className="label">Add a guard</span>
            <Select className="select" aria-label="Add a guard" value="" onChange={(e) => e.target.value && setExtra((x) => [...x, e.target.value])}>
              <option value="">Choose…</option>
              {b.people.filter((p) => !people.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.staffNo} {p.name}
                </option>
              ))}
            </Select>
          </label>
          {published && <Reason label="Why the published roster changes (needed)" value={why} onChange={setWhy} />}
          <button className="btn btn-sm btn-primary" disabled={act.busy || people.length === 0 || (published && why.trim().length < 5)} onClick={save}>
            {published ? 'Make a new version' : 'Save draft'}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <p className="muted">D day duty, N night, OFF rest day, OFF+ extra off day, RD/RN relief. On a published roster, tap a day to record what happened.</p>
    </>
  );
}

function Versions({ b }: { b: GuardRosterBoard }) {
  if (!b.versions.length) return null;
  return (
    <Card title="Versions and steps">
      <ul className="hx-rows" aria-label="Versions">
        {b.versions.map((v) => (
          <li key={v.id} className="hx-row">
            <div className="hx-row-main">
              <span className="hx-row-title">Version {v.version}</span>
              {v.changeReason && <span className="hx-row-meta">Change: {v.changeReason}</span>}
              {v.steps.map((s, i) => (
                <span key={i} className="hx-row-meta">
                  {s.action} ({ROLE_LABEL[s.role] ?? s.role}): {s.reason}
                </span>
              ))}
            </div>
            <div className="hx-row-side">
              <Chip tone={STATUS_TONE[v.status] ?? 'neutral'}>{VERSION_STATUS[v.status] ?? v.status}</Chip>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DayDrawer({ b, day, onClose }: { b: GuardRosterBoard; day: Day; onClose: () => void }) {
  const act = useAction();
  const [status, setStatus] = useState<RosterStatus>(day.planned);
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [brk, setBrk] = useState({ slot: 'A', from: '', to: '', relieved: true, interrupted: 0 });
  const run = (name: RosterActName, args: unknown[], done: string) => act.run(() => api.rosterAct(name, args), done);
  const c = day.actualCorrection;
  const at = (t: string) => `${day.date}T${t}:00+08:00`;
  return (
    <Drawer title={`${b.people.find((p) => p.id === day.personId)?.staffNo ?? ''} · ${day.date}`} sub={`Planned ${b.statuses[day.planned]}${day.actual ? `, actual ${b.statuses[day.actual]}` : ''}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <label className="field">
        <span className="label">What happened</span>
        <Select className="select" aria-label="What happened" value={status} onChange={(e) => setStatus(e.target.value as RosterStatus)}>
          {CODES.map((x) => (
            <option key={x} value={x}>
              {b.statuses[x]}
            </option>
          ))}
        </Select>
      </label>
      {!day.actual ? (
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('recordRosterActual', [day.id, status], 'Day recorded.')}>Record what happened</button>
      ) : (
        <>
          <label className="field">
            <span className="label">Evidence (attendance record, letter, photo)</span>
            <input className="input" aria-label="Evidence" value={evidence} maxLength={200} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <Reason value={reason} onChange={setReason} />
          {b.can.prepare && <button className="btn btn-sm" disabled={act.busy} onClick={() => run('proposeRosterCorrection', [day.id, { to: status, evidence, reason }], 'Correction proposed to the OD/OGM.')}>Propose a correction</button>}
          {c && !c.approvedById && b.can.decide && (
            <div className="row" style={{ gap: 6 }}>
              <span>Proposed: {b.statuses[c.to]} ({c.evidence}): {c.reason}</span>
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run('decideRosterCorrection', [day.id, true, reason], 'Correction approved.')}>Approve</button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => run('decideRosterCorrection', [day.id, false, reason], 'Correction refused.')}>Refuse</button>
            </div>
          )}
          {day.actual === 'ABS' && !day.absDecision && b.can.decide && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => run('decideRosterAbsence', [day.id, true, reason], 'Absence decided: unpaid.')}>Absence unpaid</button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => run('decideRosterAbsence', [day.id, false, reason], 'Absence decided: paid.')}>Absence paid</button>
            </div>
          )}
          {day.actual === 'ABS' && !day.absDecision && !b.can.decide && (
            <p className="notice" data-tone="info">
              Absent: the Operations Director or OGM decides paid or unpaid. Until then only this guard&apos;s pay waits.
            </p>
          )}
          {day.absDecision && (
            <p>
              {day.absDecision.unpaid ? 'Absence decided: unpaid.' : 'Absence decided: paid.'} <span className="muted">{day.absDecision.reason}</span>
            </p>
          )}
        </>
      )}
      {isDutyCode(day.actual ?? day.planned) && (
        <fieldset>
          <legend>Break taken</legend>
          <div className="hx-form-grid">
            <label className="field"><span className="label">Slot</span><input className="input" aria-label="Slot" value={brk.slot} maxLength={10} onChange={(e) => setBrk({ ...brk, slot: e.target.value })} /></label>
            <label className="field"><span className="label">Interrupted (minutes)</span><input className="input" aria-label="Interrupted (minutes)" type="number" min={0} value={brk.interrupted} onChange={(e) => setBrk({ ...brk, interrupted: Number(e.target.value) })} /></label>
            <label className="field"><span className="label">From</span><input className="input" aria-label="From" type="time" value={brk.from} onChange={(e) => setBrk({ ...brk, from: e.target.value })} /></label>
            <label className="field"><span className="label">To</span><input className="input" aria-label="To" type="time" value={brk.to} onChange={(e) => setBrk({ ...brk, to: e.target.value })} /></label>
          </div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={brk.relieved} onChange={(e) => setBrk({ ...brk, relieved: e.target.checked })} /> Relieved (free of duty)</label>
          <button className="btn btn-sm" disabled={act.busy || !brk.from || !brk.to} onClick={() => run('recordRosterBreak', [day.id, { slot: brk.slot, start: at(brk.from), end: at(brk.to), relieved: brk.relieved, interruptedMinutes: brk.interrupted, confirm: true }], 'Break recorded and confirmed.')}>Record and confirm the break</button>
          <ul className="list">
            {b.breaks.filter((x) => x.rosterDayId === day.id).map((x) => (
              <li key={x.id}>
                {x.slot} {x.start.slice(11, 16)}–{x.end.slice(11, 16)} {x.relieved ? 'relieved' : 'not relieved'} {x.confirmedById ? <Chip tone="ok">confirmed</Chip> : <button className="btn btn-xs" onClick={() => run('confirmRosterBreak', [x.id], 'Break confirmed.')}>Confirm</button>}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </Drawer>
  );
}

function Coverage({ b }: { b: GuardRosterBoard }) {
  const act = useAction();
  const c = b.coverage;
  const day = c?.shifts.find((s) => s.code === 'D');
  const night = c?.shifts.find((s) => s.code === 'N');
  const [f, setF] = useState({
    effectiveFrom: c?.effectiveFrom ?? `${b.month}-01`,
    dPosts: day?.posts ?? 1, dStart: day?.start ?? '08:00', dEnd: day?.end ?? '20:00',
    nPosts: night?.posts ?? 0, nStart: night?.start ?? '20:00', nEnd: night?.end ?? '08:00',
    minActive: c?.minActive ?? 1, maxDutyHours: c?.clientLimits.maxDutyHours ?? '', maxHours7d: c?.clientLimits.maxHours7d ?? '', maxDaysInRow: c?.clientLimits.maxDaysInRow ?? '',
    breakMinutes: c?.breakPlan?.minutesPerShift ?? 0, breakMax: c?.breakPlan?.maxSegmentMinutes ?? 60, breakPaid: c?.breakPlan?.paid ?? true, breakPermissionRef: c?.breakPermissionRef ?? '',
    areaSupervisorId: c?.areaSupervisorId ?? '', documentRef: c?.documentRef ?? '', reason: '',
  });
  const [sw, setSw] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    act.run(
      () =>
        api.rosterAct('saveSiteCoverage', [
          b.site.id,
          {
            effectiveFrom: f.effectiveFrom,
            calendar: { kind: 'every_day' },
            shifts: [...(Number(f.dPosts) > 0 ? [{ code: 'D', start: f.dStart, end: f.dEnd, posts: Number(f.dPosts) }] : []), ...(Number(f.nPosts) > 0 ? [{ code: 'N', start: f.nStart, end: f.nEnd, posts: Number(f.nPosts) }] : [])],
            minActive: Number(f.minActive),
            armed: b.site.armed,
            clientLimits: { maxDutyHours: f.maxDutyHours, maxHours7d: f.maxHours7d, maxDaysInRow: f.maxDaysInRow },
            billing: 'fixed_monthly_post',
            breakPermissionRef: f.breakPermissionRef || null,
            breakPlan: Number(f.breakMinutes) > 0 ? { minutesPerShift: Number(f.breakMinutes), maxSegmentMinutes: Number(f.breakMax), paid: f.breakPaid, permission: 'relief_required' } : null,
            areaSupervisorId: f.areaSupervisorId || null,
            documentRef: f.documentRef,
            reason: f.reason,
          },
        ]),
      'Coverage saved.',
    );
  const ro = !b.can.coverage;
  return (
    <>
      <ErrorNotice error={act.error} />
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0 }}>
        <p className="muted small">
          {ro ? 'View only: the Operations Director (private) or OGM (government) sets coverage from the signed contract.' : 'From the signed contract or schedule, with a reason. A change starts from its date; the earlier coverage is kept.'}
        </p>
        <div className="hx-form-grid">
          <label className="field"><span className="label">From</span><input className="input" aria-label="From" type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} /></label>
          <label className="field"><span className="label">Fewest guards on duty at any minute</span><input className="input" aria-label="Fewest guards on duty at any minute" type="number" min={0} value={f.minActive} onChange={set('minActive')} /></label>
          <label className="field"><span className="label">Day posts</span><input className="input" aria-label="Day posts" type="number" min={0} value={f.dPosts} onChange={set('dPosts')} /></label>
          <label className="field"><span className="label">Day duty</span><span className="row" style={{ gap: 4 }}><input type="time" value={f.dStart} onChange={set('dStart')} /><input type="time" value={f.dEnd} onChange={set('dEnd')} /></span></label>
          <label className="field"><span className="label">Night posts</span><input className="input" aria-label="Night posts" type="number" min={0} value={f.nPosts} onChange={set('nPosts')} /></label>
          <label className="field"><span className="label">Night duty</span><span className="row" style={{ gap: 4 }}><input type="time" value={f.nStart} onChange={set('nStart')} /><input type="time" value={f.nEnd} onChange={set('nEnd')} /></span></label>
          <label className="field"><span className="label">Client: longest duty (hours)</span><input className="input" aria-label="Client: longest duty (hours)" value={f.maxDutyHours} onChange={set('maxDutyHours')} /></label>
          <label className="field"><span className="label">Client: most hours in 7 days</span><input className="input" aria-label="Client: most hours in 7 days" value={f.maxHours7d} onChange={set('maxHours7d')} /></label>
          <label className="field"><span className="label">Client: most days in a row</span><input className="input" aria-label="Client: most days in a row" value={f.maxDaysInRow} onChange={set('maxDaysInRow')} /></label>
          <label className="field"><span className="label">Area/Zone Supervisor's Prima user ID (only if the site has one)</span><input className="input" aria-label="Area/Zone Supervisor's Prima user ID (only if the site has one)" value={f.areaSupervisorId} onChange={set('areaSupervisorId')} /></label>
          <label className="field"><span className="label">Break minutes a shift (0 = none)</span><input className="input" aria-label="Break minutes a shift (0 = none)" type="number" min={0} value={f.breakMinutes} onChange={set('breakMinutes')} /></label>
          <label className="field"><span className="label">Longest single break (minutes)</span><input className="input" aria-label="Longest single break (minutes)" type="number" min={1} value={f.breakMax} onChange={set('breakMax')} /></label>
          <label className="field"><span className="label">Client's written break permission (reference)</span><input className="input" aria-label="Client's written break permission (reference)" value={f.breakPermissionRef} onChange={set('breakPermissionRef')} /></label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.breakPaid} onChange={(e) => setF({ ...f, breakPaid: e.target.checked })} /> Breaks are paid (by the client)</label>
          <label className="field"><span className="label">Signed contract or schedule (needed)</span><input className="input" aria-label="Signed contract or schedule (needed)" value={f.documentRef} onChange={set('documentRef')} /></label>
          <Reason value={f.reason} onChange={(v) => setF({ ...f, reason: v })} />
        </div>
        {!ro && (
          <div className="hx-form-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={act.busy || !f.documentRef.trim() || f.reason.trim().length < 5} onClick={save}>
              Save coverage
            </button>
          </div>
        )}
      </fieldset>
      {b.can.lumpSumSwitch && c && (
        <fieldset>
          <legend>CEO: lump-sum pay at this site</legend>
          <Reason value={sw} onChange={setSw} />
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('setLumpSumSwitch', [b.site.id, !c.lumpSumSwitch?.on, sw]), c.lumpSumSwitch?.on ? 'Switched off.' : 'Switched on.')}>
            {c.lumpSumSwitch?.on ? 'Switch off' : 'Switch on'}
          </button>
        </fieldset>
      )}
    </>
  );
}

function Pay({ b }: { b: GuardRosterBoard }) {
  const act = useAction();
  const [al, setAl] = useState({ personId: '', type: 'transport', basis: 'per_duty', amount: '', from: `${b.month}-01`, reason: '' });
  const [ls, setLs] = useState({ personId: '', target: '', from: b.month, language: 'ms' });
  const [why, setWhy] = useState('');
  const staff = (id: string) => b.people.find((p) => p.id === id)?.staffNo ?? id;
  const run = (name: RosterActName, args: unknown[], done: string) => act.run(() => api.rosterAct(name, args), done);
  const pick = (value: string, onChange: (v: string) => void) => (
    <Select className="select" aria-label="Guard" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a guard…</option>
      {b.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.staffNo} {p.name}
        </option>
      ))}
    </Select>
  );
  return (
    <>
      <ErrorNotice error={act.error} />
      <Reason label="Reason or comment (for the steps below)" value={why} onChange={setWhy} />
      <h3>Allowances</h3>
      <p className="muted">Operations proposes from an approval, the HR Director verifies, the COO approves. Nothing is paid before both.</p>
      <ul className="list">
        {b.allowances.length === 0 && <li className="muted">No allowances yet.</li>}
        {b.allowances.map((a) => (
          <li key={a.id}>
            {staff(a.personId)}: {ALLOWANCE_TYPE[a.type] ?? a.label} RM{a.amount} ({ALLOWANCE_BASIS[a.basis] ?? a.basis}) from {a.from}{' '}
            {a.refused ? <Chip tone="crit">refused</Chip> : a.approvedById ? <Chip tone="ok">approved</Chip> : a.verifiedById ? <Chip tone="warn">verified, COO to approve</Chip> : <Chip tone="warn">HR Director to verify</Chip>}
            {!a.refused && !a.verifiedById && b.can.allowanceVerify && <button className="btn btn-xs" onClick={() => run('decideGuardAllowance', [a.id, 'verify', true, why], 'Verified.')}>Verify</button>}
            {!a.refused && a.verifiedById && !a.approvedById && b.can.allowanceApprove && <button className="btn btn-xs" onClick={() => run('decideGuardAllowance', [a.id, 'approve', true, why], 'Approved.')}>Approve</button>}
            {!a.refused && !a.approvedById && (b.can.allowanceVerify || b.can.allowanceApprove) && <button className="btn btn-xs" onClick={() => run('decideGuardAllowance', [a.id, a.verifiedById ? 'approve' : 'verify', false, why], 'Refused.')}>Refuse</button>}
          </li>
        ))}
      </ul>
      {(b.can.prepare || b.can.decide) && (
        <div className="hx-form-grid">
          <label className="field"><span className="label">Guard</span>{pick(al.personId, (v) => setAl({ ...al, personId: v }))}</label>
          <label className="field"><span className="label">Type</span><Select value={al.type} onChange={(e) => setAl({ ...al, type: e.target.value })}>{['armed', 'transport', 'supervisor', 'night', 'remote', 'custom'].map((t) => <option key={t} value={t}>{ALLOWANCE_TYPE[t]}</option>)}</Select></label>
          <label className="field"><span className="label">Counted</span><Select value={al.basis} onChange={(e) => setAl({ ...al, basis: e.target.value })}>{['monthly', 'per_duty', 'per_night', 'per_trip'].map((t) => <option key={t} value={t}>{ALLOWANCE_BASIS[t]}</option>)}</Select></label>
          <label className="field"><span className="label">Amount (RM, from the approval)</span><input className="input" aria-label="Amount (RM, from the approval)" value={al.amount} onChange={(e) => setAl({ ...al, amount: e.target.value })} /></label>
          <label className="field"><span className="label">From</span><input className="input" aria-label="From" type="date" value={al.from} onChange={(e) => setAl({ ...al, from: e.target.value })} /></label>
          <Reason label="Approval it comes from" value={al.reason} onChange={(v) => setAl({ ...al, reason: v })} />
          <button className="btn btn-sm" disabled={act.busy} onClick={() => run('proposeGuardAllowance', [b.site.id, { ...al, amount: Number(al.amount) }], 'Allowance proposed.')}>Propose allowance</button>
        </div>
      )}
      <h3>Agreed lump-sum pay</h3>
      <p className="muted">The guard is always paid at least what the law and the formula make due. The guard signs in the app; it counts only after the CEO switches it on at the site.</p>
      <ul className="list">
        {b.lumpSums.length === 0 && <li className="muted">No agreements yet.</li>}
        {b.lumpSums.map((l) => (
          <li key={l.id}>
            {staff(l.personId)}: RM{l.target} from {l.from} <Chip tone={l.status === 'signed' ? 'ok' : l.status === 'proposed' ? 'warn' : 'neutral'}>{l.status}{l.status === 'proposed' ? (l.approvedById ? ', guard to sign' : ', COO to approve') : ''}</Chip>
            {l.status === 'proposed' && !l.approvedById && b.can.lumpSumApprove && <button className="btn btn-xs" onClick={() => run('approveLumpSum', [l.id, why], 'Approved; the guard can now sign.')}>Approve</button>}
          </li>
        ))}
      </ul>
      {b.can.lumpSumPropose && (
        <div className="hx-form-grid">
          <label className="field"><span className="label">Guard</span>{pick(ls.personId, (v) => setLs({ ...ls, personId: v }))}</label>
          <label className="field"><span className="label">Target a month (RM)</span><input className="input" aria-label="Target a month (RM)" value={ls.target} onChange={(e) => setLs({ ...ls, target: e.target.value })} /></label>
          <label className="field"><span className="label">First month</span><input className="input" aria-label="First month" type="month" value={ls.from} onChange={(e) => setLs({ ...ls, from: e.target.value })} /></label>
          <label className="field"><span className="label">Agreement language</span><Select value={ls.language} onChange={(e) => setLs({ ...ls, language: e.target.value })}><option value="ms">Bahasa Melayu</option><option value="en">English</option></Select></label>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => run('proposeLumpSum', [b.site.id, { ...ls, target: Number(ls.target) }], 'Agreement proposed.')}>Propose agreement</button>
        </div>
      )}
    </>
  );
}

function Evidence({ b }: { b: GuardRosterBoard }) {
  const act = useAction();
  const [actNote, setActNote] = useState('');
  const [e, setE] = useState({ rule: 'weekly_rest', kind: 'jtk_permit', documentRef: '', from: `${b.month}-01`, to: `${b.month}-28`, conditions: '' });
  return (
    <>
      <ErrorNotice error={act.error} />
      {b.can.actCheck && <Reason label="ACT note" value={actNote} onChange={setActNote} />}
      <p className="muted">A permit or permission for a schedule the law needs one for. Recorded by the Operations Director / OGM, checked by ACT, never edited. No waiver without the document.</p>
      <ul className="list">
        {b.evidence.length === 0 && <li className="muted">No permits or permissions recorded.</li>}
        {b.evidence.map((x) => (
          <li key={x.id}>
            {LAW_POINT[x.rule] ?? x.rule} · {EVIDENCE_KIND[x.kind] ?? x.kind} · {x.documentRef} · {x.from} to {x.to} {x.personIds.length ? `(${x.personIds.length} guards)` : '(whole site)'}{' '}
            {x.actCheck ? <Chip tone={x.actCheck.result === 'ok' ? 'ok' : 'warn'}>ACT {x.actCheck.result === 'ok' ? 'checked' : 'queried'}: {x.actCheck.note}</Chip> : <Chip tone="neutral">ACT to check</Chip>}
            {!x.actCheck && b.can.actCheck && (
              <>
                <button className="btn btn-xs" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('checkRosterEvidence', [x.id, 'ok', actNote]), 'Checked.')}>Checked</button>
                <button className="btn btn-xs" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('checkRosterEvidence', [x.id, 'query', actNote]), 'Queried.')}>Query</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {b.can.evidence && (
        <div className="hx-form-grid">
          <label className="field"><span className="label">Law point</span><Select value={e.rule} onChange={(v) => setE({ ...e, rule: v.target.value })}>{['weekly_rest', 'daily_12h', 'spread_over', 'ot_104', 'break_after_5h', 'normal_hours'].map((r) => <option key={r} value={r}>{LAW_POINT[r]}</option>)}</Select></label>
          <label className="field"><span className="label">Document</span><Select value={e.kind} onChange={(v) => setE({ ...e, kind: v.target.value })}><option value="jtk_permit">Labour department permit</option><option value="client_permission">Client permission</option><option value="other_document">Other document</option></Select></label>
          <label className="field"><span className="label">Reference</span><input className="input" aria-label="Reference" value={e.documentRef} onChange={(v) => setE({ ...e, documentRef: v.target.value })} /></label>
          <label className="field"><span className="label">From</span><input className="input" aria-label="From" type="date" value={e.from} onChange={(v) => setE({ ...e, from: v.target.value })} /></label>
          <label className="field"><span className="label">To</span><input className="input" aria-label="To" type="date" value={e.to} onChange={(v) => setE({ ...e, to: v.target.value })} /></label>
          <label className="field"><span className="label">Conditions</span><input className="input" aria-label="Conditions" value={e.conditions} onChange={(v) => setE({ ...e, conditions: v.target.value })} /></label>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('recordRosterEvidence', [b.site.id, e]), 'Evidence recorded.')}>Record</button>
        </div>
      )}
    </>
  );
}

/** Printable monthly roster: one row per guard, legend, version and who published it. */
function PrintSheet({ b }: { b: GuardRosterBoard }) {
  const [show, setShow] = useState(false);
  const dates = monthDates(b.month);
  const people = [...new Set(b.days.map((d) => d.personId))];
  const cell = new Map(b.days.map((d) => [`${d.personId}|${d.date}`, d]));
  const v = b.current!;
  const pub = v.steps.filter((s) => s.action === 'publish').at(-1);
  return (
    <>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => setShow((x) => !x)}>{show ? 'Hide printable roster' : 'Printable roster'}</button>
        {show && <button className="btn btn-sm" onClick={() => window.print()}>Print</button>}
      </div>
      {show && (
        <div className="print-sheet">
          <h3>{b.site.name} · {b.month} · version {v.version} ({v.status})</h3>
          <p>{pub ? `Published ${pub.at.slice(0, 10)} (${ROLE_LABEL[pub.role] ?? pub.role})` : 'Not published: draft for checking only.'}</p>
          <table className="table compact" data-no-translate>
            <thead>
              <tr>
                <th>Guard</th>
                {dates.map((d) => <th key={d}>{Number(d.slice(8))}</th>)}
                <th>Duties</th>
              </tr>
            </thead>
            <tbody>
              {people.map((pid) => (
                <tr key={pid}>
                  <th>{b.people.find((p) => p.id === pid)?.staffNo ?? pid}</th>
                  {dates.map((d) => {
                    const x = cell.get(`${pid}|${d}`);
                    return <td key={d}>{x ? SHORT[x.actual ?? x.planned] : ''}</td>;
                  })}
                  <td>{b.dutiesPerPerson[pid] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{CODES.map((c) => `${SHORT[c]} = ${b.statuses[c]}`).join(' · ')}</p>
        </div>
      )}
    </>
  );
}

/** A guard's own published roster and pay agreements (view only, plus their own signature). */
export function MyGuardRosterPanel() {
  const [month, setMonth] = useState(thisMonth());
  const data = useLoad(() => api.myGuardRoster(month), [month]);
  const act = useAction();
  const d: MyGuardRoster | null = data.data;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>My roster</h2>
        <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <ErrorNotice error={data.error ?? act.error} />
      {!d ? (
        data.loading ? <Loading what="your roster" /> : null
      ) : (
        <>
          {d.days.length ? (
            <ul className="list">
              {d.days.map((x) => (
                <li key={x.date}>
                  {x.date}: {d.statuses[x.planned]} {x.plannedStart ? `${x.plannedStart.slice(11, 16)}–${x.plannedEnd?.slice(11, 16)}` : ''} {x.actual && x.actual !== x.planned ? `(recorded: ${d.statuses[x.actual]})` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No published roster for this month yet.</p>
          )}
          {d.agreements.map((a) => (
            <div key={a.id} className="notice" data-tone={a.status === 'signed' ? 'ok' : 'info'}>
              <p>{a.text}</p>
              {a.status === 'proposed' && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('decideMyLumpSum', [a.id, 'sign']), 'Signed. A copy is kept with the time you signed.')}>I agree and sign</button>
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('decideMyLumpSum', [a.id, 'refuse']), 'Refused. Your pay follows the site formula.')}>I do not agree</button>
                </div>
              )}
              {a.status === 'signed' && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.rosterAct('decideMyLumpSum', [a.id, 'withdraw']), 'Withdrawn for the following month.')}>Withdraw my agreement</button>
              )}
              {a.status !== 'proposed' && <Chip tone="neutral">{a.status}{a.signedAt ? ` ${a.signedAt.slice(0, 16).replace('T', ' ')}` : ''}</Chip>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
