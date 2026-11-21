import { CalendarCheckIcon, FirstAidKitIcon, ShieldCheckIcon, UserCheckIcon, UserMinusIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { RecordButton } from './RecordForm';
import { useState } from 'react';
import { useApp } from '../App';
import { Chip, ExpiryChip, Loading, ErrorNotice, n, useAction, useLoad, type Tone } from '../ui';
import { Empty, PageHead, Stat, Stats } from '../kit';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import '../styles/leadership.css';

type Num = number | 'UNKNOWN';
const some = (v: Num) => v !== 'UNKNOWN' && v > 0;

type Row = Awaited<ReturnType<typeof api.overview>>[number];

/** One figure in the companies table; Unknown stays Unknown and is never coloured as fine. */
function fig(value: Num, tone?: Tone) {
  if (value === 'UNKNOWN') return <span className="muted">{n(value)}</span>;
  return tone ? <Chip tone={tone}>{n(value)}</Chip> : n(value);
}
const figValue = (v: Num) => (v === 'UNKNOWN' ? null : v);

/** A row's worst state, as the old card's edge: red for an expired licence, a P1 or a no-show; amber for papers or a licence due. */
function toneOf(r: Row): Tone {
  return r.licenceStatus === 'OVERDUE' || some(r.p1Open) || some(r.noShowToday)
    ? 'crit'
    : r.licenceStatus === 'DUE' || some(r.credentialIssues)
      ? 'warn'
      : !r.hasDetail || r.licenceStatus === 'UNKNOWN'
        ? 'unknown'
        : 'ok';
}

const LICENCE_RANK: Record<Row['licenceStatus'], number> = { OVERDUE: 3, DUE: 2, UNKNOWN: 1, OK: 0 };
const LICENCE_SHOW: Partial<Record<Row['licenceStatus'], string>> = { OVERDUE: 'expired', DUE: 'due', UNKNOWN: 'unknown' };

const COMPANY_FILTERS: DtFilter<Row>[] = [
  {
    id: 'show',
    label: 'Show',
    value: (r) => [...(r.hasDetail ? ['pilot'] : []), ...(LICENCE_SHOW[r.licenceStatus] ? [LICENCE_SHOW[r.licenceStatus]!] : [])],
    options: [
      { value: 'pilot', label: 'Pilot' },
      { value: 'expired', label: 'Licence expired' },
      { value: 'due', label: 'Licence due' },
      { value: 'unknown', label: 'No licence record' },
    ],
  },
  { id: 'state', label: 'State', value: (r) => r.company.state },
];

export function Overview() {
  const { go, setCompanyId, me } = useApp();
  const { data, error, reload } = useLoad(() => api.overview(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="the group" />
      </div>
    );

  const pilots = data.filter((r) => r.hasDetail);
  const sum = (k: 'shiftsToday' | 'presentNow' | 'noShowToday' | 'unfilledToday' | 'openCases' | 'p1Open' | 'credentialIssues') =>
    pilots.reduce((s, r) => s + (r[k] === 'UNKNOWN' ? 0 : (r[k] as number)), 0);
  const licenceBad = data.filter((r) => r.licenceStatus === 'OVERDUE').length;
  const licenceUnknown = data.filter((r) => r.licenceStatus === 'UNKNOWN').length;
  // Pilot companies first: they carry live figures.
  const ordered = [...data.filter((r) => r.hasDetail), ...data.filter((r) => !r.hasDetail)];
  const openIt = (r: Row) => {
    setCompanyId(r.company.id);
    go({ view: 'company' });
  };
  // P107: the companies as a data table (search, filters, sort, pages; cards on a phone) in place of the card grid.
  // The figures, chips, the red/amber edge, Open company and Company record are as on the old cards.
  const columns: DtColumn<Row>[] = [
    {
      id: 'company',
      label: 'Company',
      value: (r) => r.company.name,
      phone: 'title',
      render: (r) => (
        <span style={{ display: 'grid', gap: 2, justifyItems: 'start' }}>
          {r.hasDetail ? (
            <button type="button" className="ld-co-link" onClick={() => openIt(r)}>
              {r.company.name}
            </button>
          ) : (
            <strong>{r.company.name}</strong>
          )}
          <span className="muted small">{r.company.isPilot ? 'Pilot' : 'Summary only'}</span>
        </span>
      ),
    },
    { id: 'state', label: 'State', value: (r) => r.company.state, phone: 'sub' },
    {
      id: 'access',
      label: 'Access',
      value: (r) => (r.canAct ? 'Act' : 'Monitor'),
      translate: true,
      hideBelow: 1300,
      phone: 'hidden',
      render: (r) => (r.canAct ? <Chip tone="info">Act</Chip> : <Chip tone="neutral">Monitor</Chip>),
    },
    {
      id: 'licences',
      label: 'Licences',
      value: (r) => LICENCE_RANK[r.licenceStatus],
      sort: 'number',
      search: false,
      align: 'left',
      render: (r) => {
        const bad = r.licences.filter((l) => l.status !== 'OK');
        return (
          <span style={{ display: 'grid', gap: 2, justifyItems: 'start' }}>
            <ExpiryChip status={r.licenceStatus} />
            <span className="small">{bad.map((l) => l.label).join(', ') || 'All valid'}</span>
          </span>
        );
      },
    },
    { id: 'guards', label: 'Guards', value: (r) => figValue(r.guards), sort: 'number', phone: 'hidden', render: (r) => fig(r.guards) },
    { id: 'sites', label: 'Sites', value: (r) => figValue(r.sites), sort: 'number', phone: 'hidden', hideBelow: 1100, render: (r) => fig(r.sites) },
    { id: 'onDuty', label: 'On duty', value: (r) => figValue(r.presentNow), sort: 'number', render: (r) => fig(r.presentNow, some(r.presentNow) ? 'ok' : undefined) },
    { id: 'noShows', label: 'No-shows', value: (r) => figValue(r.noShowToday), sort: 'number', render: (r) => fig(r.noShowToday, some(r.noShowToday) ? 'crit' : undefined) },
    {
      id: 'cases',
      label: 'Open cases',
      value: (r) => figValue(r.openCases),
      sort: 'number',
      render: (r) => (
        <>
          {fig(r.openCases, some(r.p1Open) ? 'crit' : undefined)}
          {r.p1Open !== 'UNKNOWN' && r.p1Open > 0 && (
            <>
              {' '}
              <Chip tone="crit">{r.p1Open} P1</Chip>
            </>
          )}
        </>
      ),
    },
    {
      id: 'papers',
      label: 'Papers to fix',
      value: (r) => figValue(r.credentialIssues),
      sort: 'number',
      hideBelow: 1200,
      phone: 'hidden',
      render: (r) => fig(r.credentialIssues, some(r.credentialIssues) ? 'warn' : undefined),
    },
  ];

  return (
    <div className="page ld">
      <PageHead
        title="Group today"
        sub={
          <>
            {data.length} companies. Live figures come only from the {pilots.length} pilot companies; the rest show Unknown until their data is connected.
            Unknown is never counted as fine.
          </>
        }
      />

      <Stats>
        <Stat label="Shifts today" value={sum('shiftsToday')} note="Pilot companies" icon={<CalendarCheckIcon />} tone="info" />
        <Stat label="On duty now" value={sum('presentNow')} tone="ok" icon={<UserCheckIcon />} />
        <Stat
          label="No-shows"
          value={sum('noShowToday')}
          tone={sum('noShowToday') ? 'crit' : undefined}
          note="Started 15+ min ago, no clock-in"
          icon={<UserMinusIcon />}
        />
        <Stat label="Unfilled shifts" value={sum('unfilledToday')} tone={sum('unfilledToday') ? 'warn' : undefined} icon={<CalendarCheckIcon />} />
        <Stat label="Open cases" value={sum('openCases')} note={`${sum('p1Open')} at P1`} tone={sum('p1Open') ? 'crit' : undefined} icon={<FirstAidKitIcon />} />
        <Stat
          label="Licences expired"
          value={licenceBad}
          tone={licenceBad ? 'crit' : 'ok'}
          note={`${licenceUnknown} companies with a missing record`}
          icon={<ShieldCheckIcon />}
        />
      </Stats>

      <section className="ld-section" aria-labelledby="ld-companies">
        <div className="ld-section-head">
          <h2 id="ld-companies">Companies</h2>
          <Chip tone="neutral">{data.length}</Chip>
          <span className="muted small">Select a pilot company to open it</span>
        </div>
        <DataTable
          label="Companies"
          stateKey="overview.companies"
          rows={ordered}
          rowKey={(r) => r.company.id}
          columns={columns}
          filters={COMPANY_FILTERS}
          searchPlaceholder="Search companies or states"
          searchText={(r) => r.licences.filter((l) => l.status !== 'OK').map((l) => l.label).join(' ')}
          onRowClick={(r) => {
            if (r.hasDetail) openIt(r);
          }}
          rowTone={(r) => {
            const t = toneOf(r);
            return t === 'crit' || t === 'warn' ? t : undefined;
          }}
          rowEnd={(r) => <RecordButton kind="company" companyId={r.company.id} label="Company record" />}
          actions={(r) => [{ label: 'Open company', onClick: () => openIt(r), hidden: !r.hasDetail }]}
          empty={<Empty title="No company matches." />}
        />
      </section>
      {me.user.opsTier === 'ceo' && <AddCompany onAdded={reload} />}
    </div>
  );
}

/**
 * Part N4: the CEO adds a company (audited, SSM number and source document, a reason). It starts as a draft; the
 * Deputy Chief of Staff or the CEO checks it against SSM in the company record.
 */
function AddCompany({ onAdded }: { onAdded: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const field = (k: string, label: string, placeholder = '') => (
    <label className="field">
      <span>{label}</span>
      <input className="input" value={f[k] ?? ''} placeholder={placeholder} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
    </label>
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Add a company</h3>
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Add a company'}
        </button>
      </div>
      {open && (
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          <ErrorNotice error={act.error} />
          {field('code', 'Company code', 'e.g. GWE')}
          {field('name', 'Registered company name')}
          {field('ssmNo', 'SSM registration number')}
          {field('state', 'Primary state')}
          {field('headOfCompany', 'Head of company (optional)')}
          {field('sourceRef', 'Source document reference', 'SSM document name and reference')}
          {field('reason', 'Why it is added (needed)')}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await act.run(() => api.addCompany(f), 'Company added as a draft. Check it against SSM in its company record.')) {
                setF({});
                setOpen(false);
                onAdded();
              }
            }}
          >
            Add as a draft
          </button>
        </div>
      )}
    </section>
  );
}
