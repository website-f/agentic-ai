import { useMemo, useState, type ReactNode } from 'react';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import { ClockCountdownIcon, QuestionIcon, SealCheckIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, ExpiryChip, Loading, dateLabel, useLoad } from '../ui';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { SopHelp } from '../sop/SopHelp';
import '../styles/hrx.css';

type Status = 'OK' | 'DUE' | 'OVERDUE' | 'UNKNOWN';

/** The order a compliance calendar reads in: expired first, then no record, then due, then valid. */
export const URGENCY: { status: Status; title: string; tone: 'crit' | 'unknown' | 'warn' | 'ok' }[] = [
  { status: 'OVERDUE', title: 'Expired', tone: 'crit' },
  { status: 'UNKNOWN', title: 'No record', tone: 'unknown' },
  { status: 'DUE', title: 'Due soon', tone: 'warn' },
  { status: 'OK', title: 'Valid', tone: 'ok' },
];

/** An expiry date as a small calendar leaf: day on top, month and year under it. */
export function DateLeaf({ date, tone }: { date: string | null | undefined; tone?: string }) {
  if (!date)
    return (
      <span className="rn-leaf" data-tone={tone} aria-label="No date on file">
        <span className="rn-leaf-day">?</span>
        <span className="rn-leaf-mon">No date</span>
      </span>
    );
  const [d, m, y] = dateLabel(date).split(' ');
  return (
    <span className="rn-leaf" data-tone={tone} aria-hidden="true">
      <span className="rn-leaf-mon">{m}</span>
      <span className="rn-leaf-day">{d}</span>
      <span className="rn-leaf-year">{y}</span>
    </span>
  );
}

/** One titled group of the calendar: a status band or a company. */
export function CalendarGroup({ title, count, tone, children }: { title: ReactNode; count: number; tone?: string; children: ReactNode }) {
  return (
    <section className="k-card rn-group" data-tone={tone}>
      <div className="k-card-head rn-group-head">
        <h2>
          {tone && <span className="rn-dot" aria-hidden="true" />}
          {title}
        </h2>
        <span className="hx-count">{count}</span>
      </div>
      <ul className="hx-rows">{children}</ul>
    </section>
  );
}

type Licence = Awaited<ReturnType<typeof api.compliance>>['licences'][number];
const urgencyOf = (s: Status) => URGENCY.findIndex((u) => u.status === s);

/** P107: the licences as one table (was groups by urgency or by company): search, status / company / licence filters. */
const LICENCE_COLUMNS: DtColumn<Licence>[] = [
  {
    id: 'company',
    label: 'Company',
    value: (l) => l.companyName,
    render: (l) => (
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <strong>{l.companyName}</strong>
        {l.isPilot && <Chip tone="neutral">Pilot</Chip>}
      </span>
    ),
    phone: 'title',
  },
  { id: 'licence', label: 'Licence', value: (l) => l.label, translate: true, phone: 'sub' },
  { id: 'expires', label: 'Expires', value: (l) => l.expiresOn, sort: 'date', render: (l) => (l.expiresOn ? dateLabel(l.expiresOn) : 'No record') },
  { id: 'days', label: 'Days left', value: (l) => l.daysLeft, sort: 'number', hideBelow: 900 },
  { id: 'status', label: 'Status', value: (l) => urgencyOf(l.status), sort: 'number', search: false, render: (l) => <ExpiryChip status={l.status} daysLeft={l.daysLeft} /> },
];
const LICENCE_FILTERS: DtFilter<Licence>[] = [
  { id: 'status', label: 'Status', value: (l) => l.status, options: URGENCY.map((u) => ({ value: u.status, label: u.title })) },
  { id: 'company', label: 'Company', value: (l) => l.companyName },
  { id: 'licence', label: 'Licence', value: (l) => l.label },
];

export function ComplianceView() {
  const { data, error } = useLoad(() => api.compliance(), []);
  const [show, setShow] = useState<'problems' | 'all'>('problems');
  const table = useTableState('gov.compliance.licences');
  const status = (table.state.f.status ?? '') as Status | '';
  // Most urgent first (expired, no record, due, valid), then the soonest expiry: the table's usual order.
  const rows = useMemo(
    () =>
      (data?.licences ?? [])
        .filter((l) => show === 'all' || l.status !== 'OK' || status === 'OK')
        .sort((x, y) => urgencyOf(x.status) - urgencyOf(y.status) || (x.daysLeft ?? 1e9) - (y.daysLeft ?? 1e9)),
    [data, show, status],
  );
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="licences" />
      </div>
    );
  const pick = (s: Status) => {
    table.set({ f: { status: status === s ? '' : s } });
    if (s === 'OK') setShow('all');
  };
  return (
    <div className="page">
      <PageHead
        title="Company licences"
        sub="KDN licence, MOF registration, group insurance and SSM annual return for every company you can see. Reminders start 120, 90, 90 and 60 days before expiry. Filing is done by a person; the app keeps the date and receipt."
        actions={
          <>
            <div className="seg" role="group" aria-label="Which licences">
              <button aria-pressed={show === 'problems'} onClick={() => setShow('problems')}>
                Needs action
              </button>
              <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>
                All
              </button>
            </div>
            <SopHelp id="gov-licence-record" />
            <ImportButton kind="licence" />
            <RecordButton kind="licence" primary label="Add licence" />
          </>
        }
      />
      <Stats>
        <Stat
          label="Expired"
          value={data.summary.overdue}
          tone={data.summary.overdue ? 'crit' : 'ok'}
          icon={<WarningOctagonIcon size={16} />}
          note={status === 'OVERDUE' ? 'Showing these only' : 'Renew now'}
          onClick={() => pick('OVERDUE')}
        />
        <Stat
          label="No record"
          value={data.summary.unknown}
          tone={data.summary.unknown ? 'unknown' : 'ok'}
          icon={<QuestionIcon size={16} />}
          note={status === 'UNKNOWN' ? 'Showing these only' : 'Counted as a problem until found'}
          onClick={() => pick('UNKNOWN')}
        />
        <Stat
          label="Due soon"
          value={data.summary.due}
          tone={data.summary.due ? 'warn' : 'ok'}
          icon={<ClockCountdownIcon size={16} />}
          note={status === 'DUE' ? 'Showing these only' : 'Inside the reminder window'}
          onClick={() => pick('DUE')}
        />
        <Stat
          label="Valid"
          value={data.summary.ok}
          tone="ok"
          icon={<SealCheckIcon size={16} />}
          note={status === 'OK' ? 'Showing these only' : undefined}
          onClick={() => pick('OK')}
        />
      </Stats>
      <section className="k-card">
        <DataTable
          details
          label="Company licences"
          control={table}
          rows={rows}
          rowKey={(l) => `${l.companyId}-${l.type}`}
          columns={LICENCE_COLUMNS}
          filters={LICENCE_FILTERS}
          searchPlaceholder="Search company or licence"
          rowTone={(l) => (l.status === 'OVERDUE' ? 'crit' : l.status === 'DUE' || l.status === 'UNKNOWN' ? 'warn' : undefined)}
          rowEnd={(l) =>
            l.id ? <RecordButton kind="licence" id={l.id} label="Update" /> : <RecordButton kind="licence" companyId={l.companyId} label="Add record" />
          }
          empty={<Empty title="Nothing needs action." />}
        />
      </section>
    </div>
  );
}
