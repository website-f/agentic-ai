import { useMemo, useState } from 'react';
import { CheckIcon, ClockCountdownIcon, PlusIcon, SirenIcon, UserFocusIcon, WarningIcon } from '@phosphor-icons/react';
import { jaOwns, type CaseType, type EscalationLevel, type ProofInput, type Severity } from '@prima/core';
import { api, type CaseDetail, type CaseList, type SignOffOutcome } from '../api';
import { useApp } from '../App';
import { Empty, Facts, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, Sev, dateLabel, dateTimeLabel, hhmm, useAction, useLoad } from '../ui';
import { EvidenceCamera, PhotoCard } from './Camera';
import { VideoCard } from './SiteDispatch';
import { DocList, ProofPicker } from './Proof';
import { PoliceHelpPanel } from './PoliceHelp';
import '../styles/cases.css';

const LEVEL_SHORT: Record<EscalationLevel, string> = {
  OFFICER: 'With site officer',
  PATROL: 'With patrolling officer',
  OM: 'With Ops Manager',
  ROM: 'With Regional OM',
  HEAD: 'Escalated to head of ops',
  COO: 'Escalated to COO',
  CEO: 'Escalated to CEO',
  DONE: 'Fully resolved',
};

const TYPE_LABEL: Record<CaseType, string> = {
  INCIDENT: 'Incident',
  SOS: 'SOS',
  MISSED_CHECKIN: 'Missed patrol',
  NO_SHOW: 'No-show',
  COMPLAINT: 'Client complaint',
  COMPLIANCE: 'Compliance',
  IDENTITY_CHECK: 'Identity check',
  ARMS: 'Arms',
};
const SLA_TEXT: Record<Severity, string> = { P1: 'respond in 5 minutes', P2: 'respond in 30 minutes', P3: 'respond today', P4: 'respond in 2 working days' };
const SEVERITIES: Severity[] = ['P1', 'P2', 'P3', 'P4'];

type CaseRow = CaseList[number];
const isShut = (c: { status: string }) => c.status === 'resolved' || c.status === 'closed';
const statusTone = (s: string) => (s === 'resolved' || s === 'closed' ? 'ok' : s === 'escalated' ? 'warn' : 'neutral');

/** How long ago a case was opened, in words short enough for a row. */
function age(t: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60_000));
  if (Number.isNaN(min)) return '';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** Site filter: every site, cases with no site, or one site. */
const NO_SITE = '__none';

export function Cases({ openCaseId }: { openCaseId?: string }) {
  const { isGroup, companyId, me } = useApp();
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [waiting, setWaiting] = useState(false);
  const [scope, setScope] = useState<'company' | 'all'>(isGroup ? 'all' : 'company');
  const [open, setOpen] = useState<string | undefined>(openCaseId);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [sev, setSev] = useState<Severity | ''>('');
  const [site, setSite] = useState('');
  const { data: all, error } = useLoad(() => api.cases({ companyId: scope === 'company' ? companyId : undefined, status }), [status, scope, companyId]);
  const mineCount = all?.filter((c) => c.mine === 'own').length ?? 0;
  const data = all && waiting ? all.filter((c) => c.mine) : all;

  const counts = useMemo(() => {
    const live = (all ?? []).filter((c) => !isShut(c));
    return {
      open: live.length,
      p1: live.filter((c) => c.severity === 'P1').length,
      stepIn: (all ?? []).filter((c) => c.mine === 'step_in').length,
      late: live.filter((c) => c.sla === 'breached').length,
      ladderLate: live.filter((c) => c.ladder?.overdue).length,
      overdue: live.filter((c) => c.sla === 'breached' || c.ladder?.overdue).length,
    };
  }, [all]);

  const sites = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of all ?? []) if (c.siteId) m.set(c.siteId, c.siteName ?? c.siteId);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter(
    (c) =>
      (!sev || c.severity === sev) &&
      (!site || (site === NO_SITE ? !c.siteId : c.siteId === site)) &&
      (!needle || [c.title, c.ref, c.companyName, c.siteName ?? 'Company-wide', TYPE_LABEL[c.type]].some((v) => v.toLowerCase().includes(needle))),
  );
  const filtered = !!(needle || sev || site);

  return (
    <div className="page cs-page">
      <PageHead
        title="Cases"
        sub="Incidents, complaints and alerts in one place. Each has a response clock by severity. Only the company closes a case."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon size={16} weight="bold" aria-hidden="true" />
            Raise a case
          </button>
        }
      />
      <ErrorNotice error={error} />
      {/* Police call or visit help (Fauzan, 3 Nov 2026): the company manager and admin executives ask Arms Control here. */}
      {(me.user.role === 'company_manager' || me.user.role === 'admin_exec') && <PoliceHelpPanel />}
      {all && (
        <Stats>
          <Stat
            label="Open"
            value={counts.open}
            note={status === 'all' ? `${all.length} cases in the list` : 'Not yet resolved'}
            icon={<WarningIcon size={16} />}
            tone="info"
          />
          <Stat
            label="P1 open"
            value={counts.p1}
            note={sev === 'P1' ? 'Showing P1 only' : SLA_TEXT.P1}
            tone={counts.p1 ? 'crit' : undefined}
            icon={<SirenIcon size={16} />}
            onClick={() => setSev(sev === 'P1' ? '' : 'P1')}
          />
          <Stat
            label="Waiting for me"
            value={mineCount}
            note={counts.stepIn ? `${counts.stepIn} more you may step in on` : waiting ? 'Showing only these' : 'Your turn to sign off'}
            tone={mineCount ? 'warn' : undefined}
            icon={<UserFocusIcon size={16} />}
            onClick={() => setWaiting(!waiting)}
          />
          <Stat
            label="Overdue"
            value={counts.overdue}
            note={`${counts.late} response late · ${counts.ladderLate} past escalation time`}
            tone={counts.overdue ? 'crit' : undefined}
            icon={<ClockCountdownIcon size={16} />}
          />
        </Stats>
      )}

      <Toolbar
        end={
          <>
            {isGroup && (
              <div className="seg" role="group" aria-label="Companies">
                <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                  All companies
                </button>
                <button aria-pressed={scope === 'company'} onClick={() => setScope('company')}>
                  Selected company
                </button>
              </div>
            )}
            <button className="btn" aria-pressed={waiting} onClick={() => setWaiting(!waiting)}>
              Waiting for me{mineCount ? ` (${mineCount})` : ''}
            </button>
            <div className="seg" role="group" aria-label="Status">
              <button aria-pressed={status === 'active'} onClick={() => setStatus('active')}>
                Open
              </button>
              <button aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
                All
              </button>
            </div>
          </>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search title, reference, site or company" label="Search cases" />
        <select className="select cs-filter" aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value as Severity | '')}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}: {SLA_TEXT[s]}
            </option>
          ))}
        </select>
        <select className="select cs-filter" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          <option value={NO_SITE}>Company-wide (no site)</option>
          {sites.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Toolbar>

      <section className="k-card cs-board" aria-label="Cases">
        {!data && !error && <Loading what="cases" />}
        {data && (
          <>
            <div className="cs-board-head">
              <h2>{waiting ? 'Waiting for me' : status === 'active' ? 'Open cases' : 'All cases'}</h2>
              <span className="muted small">{filtered ? `${shown.length} of ${data.length}` : `${data.length} case${data.length === 1 ? '' : 's'}`}</span>
            </div>
            {shown.length > 0 && (
              <ul className="cs-rows">
                {shown.map((c) => (
                  <li key={c.id}>
                    <CaseRowButton c={c} onOpen={() => setOpen(c.id)} />
                  </li>
                ))}
              </ul>
            )}
            {data.length === 0 && (
              <Empty
                title="No cases."
                action={
                  <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
                    Raise a case
                  </button>
                }
              >
                An incident, complaint or alert at a site goes here, with its proof.
              </Empty>
            )}
            {data.length > 0 && shown.length === 0 && (
              <Empty
                title="No cases."
                action={
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setQ('');
                      setSev('');
                      setSite('');
                    }}
                  >
                    Clear search and filters
                  </button>
                }
              >
                Nothing matches the search or filters.
              </Empty>
            )}
          </>
        )}
      </section>
      {open && <CaseDrawer caseId={open} onClose={() => setOpen(undefined)} />}
      {creating && <NewCase onClose={() => setCreating(false)} />}
    </div>
  );
}

/** One case on the board: severity first, then what and where, who has it, and how long ago it opened. */
function CaseRowButton({ c, onOpen }: { c: CaseRow; onOpen: () => void }) {
  return (
    <button type="button" className="cs-row" data-sev={c.severity} data-mine={c.mine ?? undefined} onClick={onOpen}>
      <span className="cs-row-sev">
        <Sev s={c.severity} />
      </span>
      <span className="cs-row-main">
        <span className="cs-row-title">{c.title}</span>
        <span className="cs-row-meta">
          <span className="mono">{c.ref}</span> · {TYPE_LABEL[c.type]}
        </span>
        <span className="cs-row-where">
          {c.companyName} · {c.siteName ?? 'Company-wide'}
        </span>
      </span>
      <span className="cs-row-state">
        <Chip tone={statusTone(c.status)}>{c.status}</Chip>
        {c.sla === 'breached' && <Chip tone="crit">Response late</Chip>}
        {c.ladder && c.ladder.level !== 'DONE' && (
          <Chip tone={c.ladder.overdue ? 'crit' : 'info'}>
            {LEVEL_SHORT[c.ladder.level]}
            {c.ladder.overdue ? ', overdue' : ''}
          </Chip>
        )}
        {c.mine === 'own' && <Chip tone="warn">Your turn</Chip>}
        {c.mine === 'step_in' && <Chip tone="neutral">You may step in</Chip>}
      </span>
      <span className="cs-row-when">
        <span className="cs-row-age">{age(c.openedAt)}</span>
        <span className="mono">{dateTimeLabel(c.openedAt)}</span>
      </span>
    </button>
  );
}

function CaseDrawer({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.caseDetail(caseId), [caseId]);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const c = data?.case;
  const done = c?.status === 'closed';
  const doIt = async (action: 'acknowledge' | 'escalate' | 'resolve' | 'close' | 'note', msg: string) => {
    const r = await act.run(() => api.updateCase(caseId, action, note, action === 'resolve' ? proof : []), msg);
    if (r) {
      setNote('');
      if (action === 'resolve') setProof([]);
    }
  };
  return (
    <Drawer title={c?.title ?? 'Case'} sub={c ? `${c.ref} · ${c.companyName}${c.siteName ? ` · ${c.siteName}` : ''}` : undefined} onClose={onClose}>
      <ErrorNotice error={error} />
      {!data && !error && <Loading what="case" />}
      {c && data && (
        <>
          <div className="cs-dhead">
            <Sev s={c.severity} />
            <Chip tone={statusTone(c.status)}>{c.status}</Chip>
            {c.sla === 'breached' ? (
              <Chip tone="crit">First response was due {hhmm(c.slaDueAt)}</Chip>
            ) : c.status === 'open' ? (
              <Chip tone="info">
                Due {hhmm(c.slaDueAt)} ({SLA_TEXT[c.severity]})
              </Chip>
            ) : null}
          </div>
          <p className="cs-desc">{c.description || <span className="muted">No description.</span>}</p>
          <div className="cs-facts">
            <Facts
              items={[
                ['Type', TYPE_LABEL[c.type]],
                ['Company', c.companyName],
                ['Site', c.siteName ?? 'Company-wide'],
                ['Opened', dateTimeLabel(c.openedAt)],
                ['Response clock', `${c.severity}: ${SLA_TEXT[c.severity]}`],
                ...(c.ladder ? ([['Who has it', c.ladder.overdue && c.ladder.level !== 'DONE' ? `${LEVEL_SHORT[c.ladder.level]}, overdue` : LEVEL_SHORT[c.ladder.level]]] as [string, string][]) : []),
              ]}
            />
          </div>
          {!data.can.update && <p className="notice" data-tone="info">You can see this case but not change it.</p>}
          {data.ladder && <Ladder data={data} caseId={caseId} />}
          {!done && data.can.update && (
            <section className="cs-sec" aria-labelledby="case-update-h">
              <h3 id="case-update-h">Update this case</h3>
              <div className="cs-act">
                <div className="field">
                  <label className="label" htmlFor="case-note">
                    Note
                  </label>
                  <textarea id="case-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done or decided" />
                </div>
                {c.status !== 'resolved' && !c.siteId && <ProofPicker site={null} refText={c.ref} items={proof} onChange={setProof} />}
                <div className="cs-act-buttons">
                  {c.status === 'open' && (
                    <button className="btn btn-primary" disabled={act.busy} onClick={() => doIt('acknowledge', 'Case acknowledged.')}>
                      Acknowledge
                    </button>
                  )}
                  {c.status !== 'resolved' && !c.siteId && (
                    <>
                      <button className="btn" disabled={act.busy} onClick={() => doIt('escalate', 'Case escalated.')}>
                        Escalate
                      </button>
                      <button className="btn" disabled={act.busy || !proof.length} onClick={() => doIt('resolve', 'Case resolved.')} title="Needs proof">
                        Resolve
                      </button>
                    </>
                  )}
                  <button className="btn btn-ghost" disabled={act.busy || !note.trim()} onClick={() => doIt('note', 'Note added.')}>
                    Add note
                  </button>
                  {c.status === 'resolved' && data.can.close && (
                    <button className="btn btn-primary" disabled={act.busy} onClick={() => doIt('close', 'Case closed.')}>
                      Close case
                    </button>
                  )}
                </div>
                {c.status === 'resolved' && !data.can.close && (
                  <p className="muted small">Only the company closes a case. It is waiting for the Company Manager.</p>
                )}
                <ErrorNotice error={act.error} />
              </div>
            </section>
          )}
          <CasePhotos data={data} caseId={caseId} />
          <section className="cs-sec" aria-labelledby="case-history-h">
            <h3 id="case-history-h">History</h3>
            <ol className="cs-tl">
              {c.events.map((e, i) => (
                <li key={i}>
                  <span className="cs-tl-dot" aria-hidden="true" />
                  <div className="cs-tl-body">
                    <div className="cs-tl-top">
                      <span>
                        <strong>{e.action}</strong> by {e.by}
                      </span>
                      <time dateTime={e.at} title={dateTimeLabel(e.at)}>
                        {hhmm(e.at)} <span className="cs-tl-date">{dateLabel(e.at)}</span>
                      </time>
                    </div>
                    {e.note && <div className="cs-tl-note">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </Drawer>
  );
}

function NewCase({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { me } = app;
  // Group leadership sees several companies: the case is raised for the one chosen here (the app's company to start).
  const [companyId, setCompanyId] = useState(app.companyId);
  const sites = useLoad(() => api.sites(companyId), [companyId]);
  const [form, setForm] = useState({
    siteId: '',
    type: (jaOwns('incidents') ? 'COMPLAINT' : 'INCIDENT') as CaseType,
    severity: 'P3' as Severity,
    title: '',
    description: '',
  });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const company = me.companies.find((c) => c.id === companyId);
  const site = sites.data?.find((s) => s.site.id === form.siteId)?.site ?? null;
  return (
    <Drawer title="Raise a case" sub={company?.name} onClose={onClose}>
      <div className="cs-form">
        {me.companies.length > 1 && (
          <div className="field cs-span">
            <label className="label" htmlFor="nc-company">
              Company
            </label>
            <select
              id="nc-company"
              className="select"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setForm({ ...form, siteId: '' });
                setProof([]);
              }}
            >
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="nc-site">
            Site
          </label>
          <select id="nc-site" className="select" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
            <option value="">Company-wide (no site)</option>
            {sites.data?.map((s) => (
              <option key={s.site.id} value={s.site.id}>
                {s.site.code} · {s.site.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-type">
            Type
          </label>
          <select id="nc-type" className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CaseType })}>
            {/* Incidents are reported in the JA Group app while it owns them (rule SYS-JA-OWNS). */}
            {Object.entries(TYPE_LABEL)
              .filter(([k]) => k !== 'INCIDENT' || !jaOwns('incidents'))
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-sev">
            Severity
          </label>
          <select id="nc-sev" className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}: {SLA_TEXT[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-title">
            Title
          </label>
          <input id="nc-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short summary" />
        </div>
        <div className="field cs-span">
          <label className="label" htmlFor="nc-desc">
            What happened
          </label>
          <textarea id="nc-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="cs-span">
          <ProofPicker
            site={site}
            refText={form.title || 'New case'}
            items={proof.filter((p) => site || p.kind !== 'photo')}
            onChange={setProof}
            required={form.type !== 'SOS'}
          />
        </div>
      </div>
      <ErrorNotice error={act.error} />
      <div className="cs-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !form.title.trim() || (form.type !== 'SOS' && !proof.some((p) => site || p.kind !== 'photo'))}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.raiseCase({
                  companyId,
                  siteId: form.siteId || null,
                  type: form.type,
                  severity: form.severity,
                  title: form.title,
                  description: form.description,
                  proof: proof.filter((p) => site || p.kind !== 'photo'),
                }),
              (c) => `Case ${c.ref} raised.`,
            );
            if (r) onClose();
          }}
        >
          Raise case
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

/** Proof on a case (Fauzan, 25 Oct 2026): stamped, geo-tagged photos and supporting documents. */
function CasePhotos({ data, caseId }: { data: CaseDetail; caseId: string }) {
  const [taking, setTaking] = useState(false);
  const site = data.site;
  const none = !data.photos.length && !data.docs.length;
  return (
    <section className="cs-sec">
      <div className="cs-sec-head">
        <h3>
          Proof ({data.photos.length} photo{data.photos.length === 1 ? '' : 's'}, {data.docs.length} document{data.docs.length === 1 ? '' : 's'})
        </h3>
        {data.can.photo && site && !taking && (
          <button className="btn btn-sm" onClick={() => setTaking(true)}>
            Take photo
          </button>
        )}
      </div>
      {taking && site && <EvidenceCamera site={site} refText={data.case.ref} onSend={(p) => api.addCasePhoto(caseId, p)} onDone={() => setTaking(false)} />}
      {none && !taking && (
        <div className="notice" data-tone={data.case.type === 'SOS' ? 'info' : 'warn'}>
          {data.case.type === 'SOS'
            ? 'No proof yet. An SOS goes out without proof; the first sign-off adds it.'
            : 'No proof on record. Every case needs a photo or a document (rule CASE-PROOF).'}
        </div>
      )}
      {data.photos.map((p) => (
        <PhotoCard key={p.id} p={p} />
      ))}
      {data.videos.map((v) => (
        <VideoCard key={v.id} v={v} />
      ))}
      <DocList docs={data.docs} />
    </section>
  );
}

/** Verify, resolve and confirm only with proof (rule CASE-PROOF); send back and escalate need a reason. */
const NEEDS_PROOF: SignOffOutcome[] = ['verified', 'resolved', 'confirmed'];

const BUTTON_LABEL: Record<SignOffOutcome, string> = {
  verified: 'Verify, pass up',
  resolved: 'Resolved, pass up',
  sent_back: 'Send back',
  confirmed: 'Confirm fully resolved',
  escalated: 'Escalate higher',
};

const OUTCOME_LABEL: Record<SignOffOutcome, string> = {
  verified: 'Verified',
  resolved: 'Resolved',
  sent_back: 'Sent back',
  confirmed: 'Confirmed fully resolved',
  escalated: 'Escalated',
};

/**
 * Escalation until fully resolved (Fauzan, 25 Oct 2026): site officer (where stationed), patrolling officer,
 * Operations Manager, then the Regional OM confirms. Above the ROM only big matters, escalated by decision: the OGM
 * (government site) or Operations Director (private site), then the COO, then the CEO.
 */
function Ladder({ data, caseId }: { data: CaseDetail; caseId: string }) {
  const c = data.case;
  const l = data.ladder!;
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const level = c.ladder?.level ?? 'DONE';
  const at = l.steps.findIndex((s) => s.level === level);
  const top = level === 'ROM' || l.steps.some((s) => s.level === level && s.onlyIfEscalated);
  const reached = new Set((c.signOffs ?? []).map((x) => x.level));
  const hiddenFrom = l.steps.findIndex((s) => s.onlyIfEscalated && s.level !== level && !reached.has(s.level));
  const sign = (o: SignOffOutcome) =>
    act
      .run(() => api.signOffCase(caseId, o, note, NEEDS_PROOF.includes(o) ? proof : []), `${OUTCOME_LABEL[o]}.`)
      .then((r) => {
        if (r) {
          setNote('');
          setProof([]);
        }
      });
  return (
    <section className="cs-sec" aria-labelledby="case-ladder-h">
      <h3 id="case-ladder-h">Escalation until fully resolved</h3>
      {c.reporter && (
        <div className="cs-reporter">
          <span className="small">
            Reported by {c.reporter.name} ({c.reporter.staffNo})
          </span>
          <Chip tone={c.reporter.face === 'confirmed' ? 'ok' : 'crit'}>{c.reporter.face === 'confirmed' ? 'Face confirmed' : 'Face not confirmed'}</Chip>
        </div>
      )}
      <ol className="cs-ladder">
        {l.steps.map((s, i) => {
          const signs = (c.signOffs ?? []).filter((x) => x.level === s.level);
          const here = level === s.level;
          const passed = level === 'DONE' ? reached.has(s.level) : i < at;
          // Levels above the ROM show only when the case went there; the rest are named once.
          if (s.onlyIfEscalated && !here && !reached.has(s.level)) {
            if (i !== hiddenFrom) return null;
            return (
              <li key={s.level} data-state="more">
                <span className="cs-ladder-dot" aria-hidden="true" />
                <div className="cs-ladder-body small">
                  Only if escalated as a big matter:{' '}
                  {l.steps
                    .slice(i)
                    .map((x) => `${x.label} (${x.person})`)
                    .join(', then ')}
                </div>
              </li>
            );
          }
          return (
            <li key={s.level} data-state={passed ? 'done' : here ? 'now' : 'todo'}>
              <span className="cs-ladder-dot" aria-hidden="true">
                {passed ? <CheckIcon size={12} weight="bold" /> : null}
              </span>
              <div className="cs-ladder-body">
                <div>
                  <strong>{s.label}</strong> <span className="muted">· {s.person}</span>
                  <span className="cs-sr">{passed ? ' (done)' : here ? ' (now)' : ''}</span>
                </div>
                {here && c.ladder?.dueAt && (
                  <div>
                    <Chip tone={c.ladder.overdue ? 'crit' : 'info'}>
                      {c.ladder.overdue
                        ? top
                          ? `Overdue since ${dateTimeLabel(c.ladder.dueAt)}`
                          : `Overdue since ${dateTimeLabel(c.ladder.dueAt)}; next level may step in`
                        : `Waiting, due ${dateTimeLabel(c.ladder.dueAt)}`}
                    </Chip>
                  </div>
                )}
                {signs.map((x, j) => (
                  <div key={j} className="cs-ladder-sign">
                    {OUTCOME_LABEL[x.outcome]} by {x.by}
                    {x.stepIn ? ' (stepped in)' : ''}, {dateTimeLabel(x.at)}: {x.note}
                    {x.proofIds?.length ? ` · ${x.proofIds.length} proof` : NEEDS_PROOF.includes(x.outcome) ? ' · no proof on record' : ''}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {level === 'DONE' && (
        <div>
          <Chip tone="ok">Fully resolved. The company closes the case.</Chip>
        </div>
      )}
      {l.actions.length > 0 && (
        <div className="cs-act">
          <div className="field">
            <label className="label" htmlFor="ladder-note">
              Your sign-off as {l.myLabel}
              {l.myLevel !== level ? ` (stepping in for ${l.steps.find((s) => s.level === level)?.label ?? level})` : ''}
            </label>
            <textarea
              id="ladder-note"
              className="textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={top ? 'What was done, or why this is a big matter that needs a higher level' : 'What you checked or what was done'}
            />
          </div>
          <ProofPicker site={data.site ?? null} refText={c.ref} items={proof} onChange={setProof} />
          <div className="cs-act-buttons">
            {l.actions.map((o) => (
              <button
                key={o}
                className={`btn ${o === 'confirmed' || o === 'resolved' ? 'btn-primary' : ''}`}
                disabled={act.busy || (NEEDS_PROOF.includes(o) && !proof.length)}
                title={NEEDS_PROOF.includes(o) ? 'Needs proof: a photo or a document' : undefined}
                onClick={() => sign(o)}
              >
                {o === 'resolved' && top ? 'Resolved, fully resolved' : BUTTON_LABEL[o]}
              </button>
            ))}
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </section>
  );
}
