import { Select } from '../SearchSelect';
import { useMemo, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, BriefcaseIcon, BuildingsIcon, CheckCircleIcon, QuestionIcon, TrayIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import type { HomeLink, OfficeGuideRole } from '@prima/core';
import { OFFICE_GUIDE_VERSION, officeGuideFor } from '@prima/core';
import { useLang } from '../i18n';
import { api, type CompanyOffice, type CompanyOffices } from '../api';
import { useApp } from '../App';
import { SopHelp } from '../sop/SopHelp';
import { Chip, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Person, Stat, Stats } from '../kit';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import '../styles/leadership.css';

/**
 * Each licensed company's own office (Fauzan, 2 Nov 2026: 1 Company Manager or GM and 2 to 8 executives). The head
 * shares the company's work out to desks, each with an owner and a backup; executives see the team and the work on their
 * desks; group leaders see every office's staffing. The people come from the accounts HR and IT already keep.
 */
export function OfficeView() {
  const { me, companyId } = useApp();
  const companyScoped = me.user.role === 'company_manager' || me.user.role === 'admin_exec';
  const [pick, setPick] = useState<string | null>(null);
  if (companyScoped) return <OneOffice companyId={companyId} />;
  if (pick) return <OneOffice companyId={pick} back={() => setPick(null)} />;
  return <AllOffices open={setPick} />;
}

const DESK_STATE: Record<CompanyOffice['desks'][number]['state'], [Tone, string]> = {
  ok: ['ok', 'Owner on duty'],
  cover: ['info', 'Backup covering'],
  head: ['warn', 'With the head'],
  unassigned: ['warn', 'Not shared out'],
};

/** The KDN licence as already recorded under Licences: a fact shown beside the company, never a block. */
const KDN_LABEL: Record<CompanyOffice['kdnLicence'], [Tone, string]> = {
  held: ['ok', 'KDN licence held'],
  expired: ['warn', 'KDN licence expired'],
  unknown: ['neutral', 'KDN licence not recorded'],
};

type OfficeRow = CompanyOffices['rows'][number];
type WorkRow = CompanyOffices['work'][number] & { key: string };
type QueueRow = CompanyOffice['queue'][number] & { key: string };
const officeState = (t: Tone) => (t === 'ok' ? 'Ready' : t === 'neutral' ? 'Unknown' : t === 'crit' ? 'Short' : 'Check');

const OFFICE_COLUMNS: DtColumn<OfficeRow>[] = [
  {
    id: 'name',
    label: 'Company',
    value: (r) => r.company.name,
    render: (r) => (
      <span className="ld-co-name">
        <strong>{r.company.name}</strong>
        <span className="ld-co-sub">
          {r.company.isPilot ? 'Pilot · ' : ''}
          {r.runBy ? `Run by the ${r.runBy.name} office` : r.runs.length > 0 ? `Also runs: ${r.runs.map((x) => x.name).join(', ')}` : ''}
        </span>
      </span>
    ),
    phone: 'title',
  },
  { id: 'state', label: 'Office', value: (r) => officeState(r.tone), translate: true, render: (r) => <Chip tone={r.tone}>{officeState(r.tone)}</Chip> },
  {
    id: 'heads',
    label: 'Head',
    value: (r) => r.heads.map((h) => h.name).join(', '),
    render: (r) => (r.heads.length ? r.heads.map((h) => <Person key={h.name} name={h.name} sub={h.job} size={26} />) : <span className="muted small">No head entered</span>),
    phone: 'sub',
    hideBelow: 1100,
  },
  { id: 'execs', label: 'Executives', value: (r) => r.execCount, sort: 'number' },
  { id: 'desks', label: 'Desks shared out', value: (r) => (r.unassigned === null ? null : r.desksAssigned), sort: 'number', render: (r) => (r.unassigned === null ? '–' : `${r.desksAssigned} of ${r.desksTotal}`), hideBelow: 1200 },
  {
    id: 'open',
    label: 'Open work',
    value: (r) => r.open,
    sort: 'number',
    render: (r) => (
      <Chip tone={r.urgent ? 'crit' : r.open ? 'warn' : 'ok'}>
        {r.open} open{r.urgent ? ` (${r.urgent} urgent)` : ''}
      </Chip>
    ),
  },
  { id: 'kdn', label: 'KDN licence', value: (r) => KDN_LABEL[r.kdnLicence][1], translate: true, render: (r) => <Chip tone={KDN_LABEL[r.kdnLicence][0]}>{KDN_LABEL[r.kdnLicence][1]}</Chip>, hideBelow: 1280 },
  { id: 'notes', label: 'To fix', value: (r) => r.findings.map((f) => f.message).join(' '), sort: false, render: (r) => <span className="small">{r.findings.map((f) => f.message).join(' ') || '–'}</span>, hideBelow: 1500 },
];
const OFFICE_FILTERS: DtFilter<OfficeRow>[] = [
  { id: 'state', label: 'Office', value: (r) => r.tone, optionLabel: (t) => officeState(t as Tone) },
  { id: 'kdn', label: 'KDN licence', value: (r) => r.kdnLicence, optionLabel: (k) => KDN_LABEL[k as CompanyOffice['kdnLicence']]?.[1] ?? k },
  { id: 'pilot', label: 'Pilot', value: (r) => (r.company.isPilot ? 'yes' : 'no'), options: [{ value: 'yes', label: 'Pilot companies' }, { value: 'no', label: 'Not in the pilot' }] },
];

const WORK_COLUMNS: DtColumn<WorkRow>[] = [
  { id: 'title', label: 'Work', value: (w) => w.title, render: (w) => <strong>{w.title}</strong>, phone: 'title' },
  { id: 'company', label: 'Company', value: (w) => w.companyName, phone: 'sub' },
  { id: 'desk', label: 'Desk', value: (w) => w.deskLabel, translate: true },
  { id: 'who', label: 'Who', value: (w) => w.actingName, hideBelow: 1100 },
  { id: 'detail', label: 'Detail', value: (w) => w.detail, sort: false, hideBelow: 1200 },
  { id: 'tag', label: 'Status', value: (w) => w.tag, translate: true, render: (w) => <Chip tone={w.tone}>{w.tag}</Chip> },
];
const WORK_FILTERS: DtFilter<WorkRow>[] = [
  { id: 'desk', label: 'Desk', value: (w) => w.desk, optionLabel: (d) => d },
  { id: 'company', label: 'Company', value: (w) => w.companyName },
  { id: 'tag', label: 'Status', value: (w) => w.tag },
];

const QUEUE_COLUMNS: DtColumn<QueueRow>[] = [
  { id: 'title', label: 'Work', value: (q) => q.title, render: (q) => <strong>{q.title}</strong>, phone: 'title' },
  { id: 'detail', label: 'Detail', value: (q) => q.detail, sort: false, phone: 'sub' },
  { id: 'desk', label: 'Desk', value: (q) => q.deskLabel, translate: true },
  { id: 'who', label: 'Who', value: (q) => (q.actingName ? (q.mine ? 'you' : q.actingName) : ''), hideBelow: 1100 },
  { id: 'tag', label: 'Status', value: (q) => q.tag, translate: true, render: (q) => <Chip tone={q.tone}>{q.tag}</Chip> },
];
const QUEUE_FILTERS: DtFilter<QueueRow>[] = [
  { id: 'whose', label: 'Whose work', value: (q) => (q.mine ? 'mine' : 'others'), options: [{ value: 'mine', label: 'Show only mine' }, { value: 'others', label: 'Other people' }], allLabel: 'The whole office' },
  { id: 'desk', label: 'Desk', value: (q) => q.deskLabel },
  { id: 'tag', label: 'Status', value: (q) => q.tag },
];

function AllOffices({ open }: { open: (id: string) => void }) {
  const { me, setCompanyId, go } = useApp();
  // Fauzan, 3 Nov 2026: "cos will set" (the CEO keeps the right as owner); the server checks again.
  const canSetRunBy = (me.user.role === 'pwvsb_officer' && me.user.leadership === 'cos') || (me.user.role === 'director' && me.user.opsTier === 'ceo');
  const { data, error } = useLoad(() => api.companyOffices(), []);
  const workTable = useTableState('board.office.work');
  const desk = workTable.state.f.desk || null;
  const setDesk = (d: string | null) => workTable.set({ f: { desk: d ?? '' } });
  const workRows = useMemo(() => (data?.work ?? []).map((w, i) => ({ ...w, key: String(i) })), [data]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="company offices" />
      </div>
    );
  const goWork = (w: WorkRow) => {
    setCompanyId(w.companyId);
    go({
      view: w.go.view,
      siteId: w.go.siteId,
      personId: w.go.personId,
      caseId: w.go.caseId,
      tenderId: w.go.tenderId,
    });
  };
  return (
    <div className="page ld">
      <PageHead
        title="Company offices"
        sub={
          <>
            {officeRule(data.rule)} All offices in one place: staffing, desk cover and every company's open work. Each company still acts on its own work; totals
            are a management view, not combined company records.
          </>
        }
        actions={<SopHelp id="board-office-desks" />}
      />
      <Stats>
        <Stat label="Companies" value={data.totals.companies} icon={<BuildingsIcon />} tone="info" />
        <Stat label="Office ready" value={data.totals.ready} tone="ok" icon={<CheckCircleIcon />} />
        <Stat label="Short of people" value={data.totals.short} tone={data.totals.short ? 'crit' : 'ok'} icon={<WarningIcon />} />
        <Stat label="Not entered yet" value={data.totals.notEntered} tone="neutral" note="Shown as Unknown" icon={<QuestionIcon />} />
        <Stat label="Executives in all" value={data.totals.execs} icon={<UsersThreeIcon />} />
        <Stat
          label="Open office work"
          value={data.totals.open}
          tone={data.totals.urgent ? 'crit' : 'ok'}
          note={`${data.totals.urgent} urgent`}
          icon={<TrayIcon />}
        />
      </Stats>

      <section className="ld-section" aria-labelledby="ld-offices">
        <div className="ld-section-head">
          <h2 id="ld-offices">Offices</h2>
          <Chip tone="neutral">{data.rows.length}</Chip>
        </div>
        <DataTable
          label="Offices"
          stateKey="board.office.offices"
          rows={data.rows}
          rowKey={(r) => r.company.id}
          columns={OFFICE_COLUMNS}
          filters={OFFICE_FILTERS}
          searchText={(r) => `${r.heads.map((h) => h.name).join(' ')} ${r.runBy?.name ?? ''} ${r.runs.map((x) => x.name).join(' ')}`}
          onRowClick={(r) => open(r.company.id)}
          rowTone={(r) => (r.tone === 'crit' ? 'crit' : r.tone === 'warn' ? 'warn' : undefined)}
          actions={(r) => [{ label: 'Open office', onClick: () => open(r.company.id) }]}
        />
      </section>

      <Card
        title="All office work, by desk"
        actions={
          desk && (
            <button className="btn btn-sm" onClick={() => setDesk(null)}>
              Show all desks
            </button>
          )
        }
        flush
      >
        <div className="ld-filters" role="group" aria-label="Filter by desk">
          {data.byDesk.map((d) => (
            <button
              key={d.desk}
              type="button"
              className="ld-filter"
              aria-pressed={desk === d.desk}
              data-urgent={d.urgent ? true : undefined}
              onClick={() => setDesk(desk === d.desk ? null : d.desk)}
            >
              <span>{d.label}</span>
              <span className="ld-filter-count">
                {d.open}
                {d.urgent ? ` (${d.urgent} urgent)` : ''}
              </span>
            </button>
          ))}
        </div>
        <DataTable
          label="All office work"
          control={workTable}
          rows={workRows}
          rowKey={(w) => w.key}
          columns={WORK_COLUMNS}
          filters={[{ ...WORK_FILTERS[0], optionLabel: (d) => data.byDesk.find((x) => x.desk === d)?.label ?? d }, ...WORK_FILTERS.slice(1)]}
          onRowClick={goWork}
          rowTone={(w) => (w.tone === 'crit' ? 'crit' : w.tone === 'warn' ? 'warn' : undefined)}
          empty={<Empty title="Nothing waiting." />}
        />
      </Card>
      {canSetRunBy && <RunByForm rows={data.rows} />}
      <OfficeGuide role="monitor" />
    </div>
  );
}

/**
 * Chief of Staff (Fauzan, 3 Nov 2026: "cos will set") and the CEO: a company without a licence, or without enough work of its own, can be run by another
 * company's office. Its head then manages and monitors it and can give its desks to their own executives. One level only;
 * a reason is required and every change is audited. The server checks all of this again.
 */
function RunByForm({ rows }: { rows: CompanyOffices['rows'] }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState('');
  const [runBy, setRunBy] = useState('');
  const [reason, setReason] = useState('');
  const target = rows.find((r) => r.company.id === companyId);
  // Only a company that runs its own office can run another; a company that runs others cannot itself be run.
  const parents = rows.filter((r) => r.company.id !== companyId && !r.runBy);
  const save = async () => {
    const r = await act.run(
      () => api.setCompanyRunBy(companyId, runBy || null, reason),
      runBy ? 'Saved: the office now runs this company' : 'Saved: the company runs its own office',
    );
    if (r !== undefined) {
      setReason('');
      setCompanyId('');
      setRunBy('');
    }
  };
  return (
    <Card
      title="Companies run by another office"
      sub="For a company without a licence, or without enough work of its own. The running office's Company Manager or GM heads it and can give its desks to their own executives. One level only. Give the reason, for example the board decision."
      footer={
        target && (
          <button className="btn btn-primary btn-sm" disabled={act.busy || !reason.trim()} onClick={save}>
            Save
          </button>
        )
      }
    >
      <div className="ld-form">
        <label className="field">
          <span className="label">Company</span>
          <Select
            className="select"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setRunBy(rows.find((r) => r.company.id === e.target.value)?.runBy?.id ?? '');
            }}
          >
            <option value="">Choose a company</option>
            {rows
              .filter((r) => r.runs.length === 0)
              .map((r) => (
                <option key={r.company.id} value={r.company.id}>
                  {r.company.name}
                </option>
              ))}
          </Select>
        </label>
        {target && (
          <label className="field">
            <span className="label">Run by</span>
            <Select className="select" value={runBy} onChange={(e) => setRunBy(e.target.value)}>
              <option value="">Its own office</option>
              {parents.map((r) => (
                <option key={r.company.id} value={r.company.id}>
                  The {r.company.name} office
                </option>
              ))}
            </Select>
          </label>
        )}
        {target && (
          <label className="field ld-span">
            <span className="label">Reason</span>
            <input
              className="input"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: board decision of the parent company"
            />
          </label>
        )}
        {act.error && (
          <div className="notice ld-span" data-tone="crit">
            {act.error.message}
          </div>
        )}
      </div>
    </Card>
  );
}

function OneOffice({ companyId, back }: { companyId: string; back?: () => void }) {
  const { setCompanyId, go } = useApp();
  const { data, error } = useLoad(() => api.companyOffice(companyId), [companyId]);
  const [editing, setEditing] = useState(false);
  const queueRows = useMemo(() => (data?.queue ?? []).map((q, i) => ({ ...q, key: String(i) })), [data]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="the company office" />
      </div>
    );
  const openLink = (l: HomeLink) => {
    if (l.companyId) setCompanyId(l.companyId);
    go({
      view: l.view,
      siteId: l.siteId,
      personId: l.personId,
      caseId: l.caseId,
      tenderId: l.tenderId,
    });
  };
  const mine = data.queue.filter((q) => q.mine);
  return (
    <div className="page ld">
      <PageHead
        title={`${data.company.name} office`}
        sub={
          <>
            {officeRule(data.rule)} {data.role === 'head' ? 'You share' : 'The Company Manager or GM shares'} the work out by desk. Each desk has an owner and a
            backup, so the work moves to the backup when the owner is on leave.
          </>
        }
        actions={
          <>
            {back && (
              <button className="btn btn-sm" onClick={back}>
                <ArrowLeftIcon size={14} aria-hidden="true" /> All offices
              </button>
            )}
            <SopHelp id="board-office-desks" />
            {/* P121: the head's main step, at the top as well as on the Desks card further down. */}
            {data.canAssign && !editing && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setEditing(true);
                  document.getElementById('office-desks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                Share out desks
              </button>
            )}
          </>
        }
      />
      {data.runBy && (
        <div className="notice" data-tone="info">
          Run by the {data.runBy.name} office: its {data.role === 'head' ? 'head (you)' : 'Company Manager or GM'} leads this office, and its executives can
          hold desks here. {KDN_LABEL[data.kdnLicence][1]}.
        </div>
      )}
      {!data.ready && (
        <div className="notice" data-tone="warn">
          The company office is not switched on in this database yet. Desks cannot be saved until its module is applied.
        </div>
      )}

      <Stats>
        <Stat
          label="Executives"
          value={data.execCount}
          tone={data.execCount < data.rule.minExecs || data.execCount > data.rule.maxExecs ? 'crit' : 'ok'}
          note={`${data.rule.minExecs} to ${data.rule.maxExecs}`}
          icon={<UsersThreeIcon />}
        />
        <Stat
          label={data.role === 'exec' ? 'On your desks' : 'Office work open'}
          value={data.role === 'exec' ? mine.length : data.queue.length}
          tone={(data.role === 'exec' ? mine : data.queue).some((q) => q.tone === 'crit') ? 'crit' : 'ok'}
          icon={<TrayIcon />}
        />
        <Stat
          label="Desks shared out"
          value={data.desks.filter((d) => d.state !== 'unassigned').length}
          note={`of ${data.desks.length}`}
          icon={<BriefcaseIcon />}
        />
      </Stats>

      {data.findings.length > 0 && (
        <Card title="To fix" actions={<Chip tone={data.tone}>{data.findings.length}</Chip>} flush>
          <ul className="ld-rows">
            {data.findings.map((f, i) => (
              <li key={i} className="ld-row" data-tone={f.tone}>
                <span className="ld-row-main">
                  <span className="ld-row-text">{f.message}</span>
                </span>
                <span className="ld-row-aside">
                  {/* P80: how urgent, in words; the rule's code stays on hover for whoever looks it up. */}
                  <Chip tone={f.tone} title={`Rule ${f.rule}`}>
                    {f.tone === 'crit' ? 'Urgent' : f.tone === 'warn' ? 'To fix' : 'Note'}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="ld-main-side">
        <Card
          title={data.role === 'exec' ? 'Work' : 'Office work by desk'}
          flush
        >
          <DataTable
            label={data.role === 'exec' ? 'Work' : 'Office work by desk'}
            stateKey={`board.office.queue.${data.role === 'exec' ? 'exec' : 'head'}`}
            defaults={data.role === 'exec' ? { f: { whose: 'mine' } } : undefined}
            rows={queueRows}
            rowKey={(q) => q.key}
            columns={QUEUE_COLUMNS}
            filters={data.role === 'exec' ? QUEUE_FILTERS : QUEUE_FILTERS.slice(1)}
            onRowClick={(q) => openLink(q.go)}
            rowTone={(q) => (q.tone === 'crit' ? 'crit' : q.tone === 'warn' ? 'warn' : undefined)}
            empty={<Empty title="Nothing waiting." />}
          />
        </Card>

        <div className="ld-side">
          <Card title="Team" sub={`${data.team.length} in the office`} flush>
            {data.team.length === 0 ? (
              <Empty title="No office people entered yet. HR adds them when they join." />
            ) : (
              <ul className="ld-rows">
                {data.team.map((t) => (
                  <li key={t.userId} className="ld-row ld-row-team">
                    <Person name={t.name} sub={`${t.job}${t.from ? ` · from the ${t.from} office` : ''}`} size={32} />
                    <span className="ld-row-aside">
                      {t.onLeave && <Chip tone="info">On leave today</Chip>}
                      <Chip tone={t.open ? 'warn' : 'ok'}>{t.open} open</Chip>
                    </span>
                    <span className="ld-row-meta ld-row-full">
                      {t.desks.length ? `Owns: ${t.desks.join(', ')}` : t.job === 'Executive' ? 'No desk yet' : 'Approvals, arms and anything not shared out'}
                      {t.backupFor.length > 0 && ` · Backup for: ${t.backupFor.join(', ')}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.runs.length > 0 && (
            <Card title="Companies your office also runs" flush>
              <ul className="ld-rows">
                {data.runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="ld-row"
                      onClick={() => {
                        setCompanyId(r.id);
                        if (back) back();
                        go({ view: 'office' });
                      }}
                    >
                      <span className="ld-row-main">
                        <span className="ld-row-title">{r.name}</span>
                        <span className="ld-row-meta">Open its office to share out its desks and see its work.</span>
                      </span>
                      <span className="ld-row-aside">
                        <Chip tone={KDN_LABEL[r.kdnLicence][0]}>{KDN_LABEL[r.kdnLicence][1]}</Chip>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div id="office-desks" />
      <Card
        title="Desks"
        sub="Each desk has an owner and a backup"
        actions={
          data.canAssign &&
          !editing && (
            <button className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
              Share out desks
            </button>
          )
        }
      >
        {editing ? (
          <DeskForm office={data} onDone={() => setEditing(false)} />
        ) : (
          <ul className="ld-desks">
            {data.desks.map((d) => (
              <li key={d.desk} className="ld-desk" data-tone={DESK_STATE[d.state][0]}>
                <div className="ld-desk-head">
                  <h3>{d.label}</h3>
                  <Chip tone={DESK_STATE[d.state][0]}>{DESK_STATE[d.state][1]}</Chip>
                </div>
                <p className="ld-desk-covers">{d.covers}</p>
                <dl className="ld-desk-who">
                  <div>
                    <dt>Owner</dt>
                    <dd>{d.ownerName ? <Person name={d.ownerName} size={26} /> : <span className="muted">none</span>}</dd>
                  </div>
                  <div>
                    <dt>Backup</dt>
                    <dd>{d.backupName ? <Person name={d.backupName} size={26} /> : <span className="muted">none</span>}</dd>
                  </div>
                </dl>
                {d.actingName && d.state !== 'ok' && <p className="ld-desk-note">Today: {d.actingName}</p>}
                {d.note && <p className="ld-desk-note muted">{d.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <OfficeGuide role={data.role} />
    </div>
  );
}

function DeskForm({ office, onDone }: { office: CompanyOffice; onDone: () => void }) {
  const act = useAction();
  const start = Object.fromEntries(
    office.desks.map((d) => {
      const s = office.suggested?.[d.desk as keyof NonNullable<CompanyOffice['suggested']>];
      return [
        d.desk,
        {
          // A desk the head cleared on purpose stays clear; the suggestion fills only desks never shared out.
          owner: d.setAt ? (d.ownerUserId ?? '') : (d.ownerUserId ?? s?.ownerUserId ?? ''),
          backup: d.setAt ? (d.backupUserId ?? '') : (d.backupUserId ?? s?.backupUserId ?? ''),
        },
      ];
    }),
  ) as Record<string, { owner: string; backup: string }>;
  const [rows, setRows] = useState(start);
  const [note, setNote] = useState('');
  const people = office.team;
  const set = (desk: string, k: 'owner' | 'backup', v: string) => setRows({ ...rows, [desk]: { ...rows[desk], [k]: v } });
  const save = async () => {
    // Every desk is sent: "Not shared out" clears it on the server, so what is saved is what the form shows.
    const desks = office.desks.map((d) => ({
      desk: d.desk,
      ownerUserId: rows[d.desk].owner || null,
      backupUserId: rows[d.desk].owner ? rows[d.desk].backup || null : null,
    }));
    const r = await act.run(
      () => api.setOfficeDesks(office.company.id, desks, note),
      (x) => ((x as { changed: number }).changed ? `${(x as { changed: number }).changed} desk(s) saved` : 'No changes to save'),
    );
    if (r !== undefined) onDone();
  };
  return (
    <div className="ld-deskform">
      {office.suggested && (
        <p className="notice" data-tone="info">
          Filled with a fair first split: desks go round the executives, and each backup is the next person along. Change anything before saving.
        </p>
      )}
      <ul className="ld-deskform-rows">
        {office.desks.map((d) => (
          <li key={d.desk} className="ld-deskform-row">
            <div className="ld-deskform-desk">
              <strong>{d.label}</strong>
              <span className="muted small">{d.covers}</span>
            </div>
            <label className="field">
              <span className="label">Owner</span>
              <Select className="select" value={rows[d.desk].owner} onChange={(e) => set(d.desk, 'owner', e.target.value)}>
                <option value="">Not shared out</option>
                {people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name} ({p.job})
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">Backup</span>
              <Select className="select" value={rows[d.desk].backup} onChange={(e) => set(d.desk, 'backup', e.target.value)}>
                <option value="">None</option>
                {people
                  .filter((p) => p.userId !== rows[d.desk].owner)
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name} ({p.job})
                    </option>
                  ))}
              </Select>
            </label>
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: new executive joined" />
      </label>
      {act.error && (
        <div className="notice" data-tone="crit">
          {act.error.message}
        </div>
      )}
      <div className="ld-actions">
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={save}>
          Save desks
        </button>
      </div>
    </div>
  );
}

/**
 * In-app guide cards (main review, section A; shared guide-card shape of PR #56): read-only help for each office
 * task, scoped to the viewer's office role. Bahasa Melayu first, with English. It explains; it never saves or approves.
 */
function OfficeGuide({ role }: { role: OfficeGuideRole | null }) {
  const { lang } = useLang();
  const [openId, setOpenId] = useState<string | null>(null);
  const cards = officeGuideFor(role);
  if (!cards.length) return null;
  const en = lang === 'en';
  const T = ({ v }: { v: { bm: string; en: string } }) =>
    en ? (
      <>{v.en}</>
    ) : lang === 'ms' ? (
      <>{v.bm}</>
    ) : (
      <>
        {v.bm} <span className="muted small">({v.en})</span>
      </>
    );
  const L = (bm: string, english: string) => (en ? english : bm);
  return (
    <section className="k-card" aria-label="Office guide">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>{L('Panduan kerja', 'How to do it')}</h2>
          <p>
            {L(
              'Panduan sahaja. Ia tidak menyimpan, melulus atau mengubah apa-apa; gunakan skrin yang dinamakan pada setiap kad.',
              'Help only. It does not save, approve or change anything; you use the screen named on each card.',
            )}
          </p>
        </div>
        <span className="muted small">{OFFICE_GUIDE_VERSION}</span>
      </div>
      <ul className="ld-guide">
        {cards.map((c) => (
          <li key={c.id}>
            <button type="button" className="ld-guide-toggle" aria-expanded={openId === c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              <T v={c.title} />
            </button>
            {openId === c.id && (
              <div className="ld-guide-body">
                <p>
                  <T v={c.purpose} />
                </p>
                <p>
                  <strong>{L('Siapa', 'Who')}:</strong> <T v={c.who} />
                </p>
                <p>
                  <strong>{L('Di mana', 'Where')}:</strong> {c.screen.name} → <T v={c.screen.action} />
                </p>
                {c.fields && c.fields.length > 0 && (
                  <ul>
                    {c.fields.map((f) => (
                      <li key={f.key}>
                        <strong>{f.label}</strong> {f.required ? L('(wajib)', '(needed)') : L('(pilihan)', '(optional)')}: <T v={f.format} />{' '}
                        <span className="muted">
                          {L('Contoh (rekaan)', 'Example (made up)')}: {f.example}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.sources.map((s, i) => (
                  <p key={i}>
                    <strong>{L('Di mana rekod', 'Where the record is')}:</strong> <T v={s.what} />{' '}
                    <span className="muted">
                      {L('Tanya', 'Ask')}: {s.askDesk ? (OFFICE_ASK_LABEL[s.askDesk] ?? s.askDesk) : s.askName}
                    </span>
                  </p>
                ))}
                <p>
                  <strong>{L('Dimasukkan sekali, diguna semula', 'Entered once, reused')}:</strong> <T v={c.enteredOnce} />
                </p>
                <p>
                  <strong>{L('Simpan', 'Save')}:</strong> <T v={c.steps.save} />
                </p>
                <p>
                  <strong>{L('Semakan', 'Review')}:</strong> <T v={c.steps.review} />
                </p>
                <p>
                  <strong>{L('Jika dipulangkan', 'If returned')}:</strong> <T v={c.steps.returned} />
                </p>
                <p>
                  <strong>{L('Selesai bila', 'Done when')}:</strong> <T v={c.steps.done} />
                </p>
                <p>
                  <strong>{L('Jika ada ralat', 'If something goes wrong')}:</strong> <T v={c.steps.recover} />
                </p>
                {c.notVerified.length > 0 && (
                  <div className="notice" data-tone="unknown">
                    <strong>{L('Belum dibina atau belum disahkan', 'Not built or not verified yet')}:</strong>
                    <ul>
                      {c.notVerified.map((n, i) => (
                        <li key={i}>
                          <T v={n} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Desk names as the hand-over map (PR #56, ORG_DESK_LABEL) shows them. */
const OFFICE_ASK_LABEL: Record<string, string> = {
  company_office: 'Company office (manager and admin executives)',
  director_office: 'Director Office',
};

/** P80: the office size rule as a sentence, not its source note. */
function officeRule(r: { heads: number; minExecs: number; maxExecs: number }): string {
  return `Each company office has ${r.heads} Company Manager or GM and ${r.minExecs} to ${r.maxExecs} executives.`;
}
