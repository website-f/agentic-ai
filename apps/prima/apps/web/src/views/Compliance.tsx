import { useMemo, useState, type ReactNode } from 'react';
import { ClockCountdownIcon, QuestionIcon, SealCheckIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { Empty, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, ErrorNotice, ExpiryChip, Loading, dateLabel, useLoad } from '../ui';
import { RecordButton } from './RecordForm';
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

export function ComplianceView() {
  const { data, error } = useLoad(() => api.compliance(), []);
  const [show, setShow] = useState<'problems' | 'all'>('problems');
  const [by, setBy] = useState<'urgency' | 'company'>('urgency');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      (data?.licences ?? []).filter(
        (l) =>
          (show === 'all' || l.status !== 'OK') &&
          (!status || l.status === status) &&
          (!needle || `${l.companyName} ${l.label}`.toLowerCase().includes(needle)),
      ),
    [data, show, status, needle],
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
    setStatus(status === s ? '' : s);
    if (s === 'OK') setShow('all');
  };
  const groups =
    by === 'urgency'
      ? URGENCY.map((u) => ({ key: u.status, title: u.title, tone: u.tone as string | undefined, rows: rows.filter((l) => l.status === u.status) }))
      : [...new Set(rows.map((l) => l.companyId))].map((id) => {
          const mine = rows.filter((l) => l.companyId === id);
          const worst = URGENCY.find((u) => mine.some((l) => l.status === u.status));
          return { key: id, title: mine[0].companyName, tone: worst?.tone as string | undefined, rows: mine };
        });
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
      <Toolbar
        end={
          <div className="seg" role="group" aria-label="Group by">
            <button aria-pressed={by === 'urgency'} onClick={() => setBy('urgency')}>
              By urgency
            </button>
            <button aria-pressed={by === 'company'} onClick={() => setBy('company')}>
              By company
            </button>
          </div>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search company or licence" label="Search licences" />
        {status && (
          <button className="btn btn-sm" onClick={() => setStatus('')}>
            Clear filter: {URGENCY.find((u) => u.status === status)?.title}
          </button>
        )}
      </Toolbar>
      {rows.length === 0 && (
        <section className="k-card">
          <Empty title="Nothing needs action.">{needle || status ? 'No licence matches the search or filter.' : undefined}</Empty>
        </section>
      )}
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <CalendarGroup key={g.key} title={g.title} count={g.rows.length} tone={g.tone}>
            {g.rows.map((l) => {
              const tone = URGENCY.find((u) => u.status === l.status)?.tone;
              return (
                <li key={`${l.companyId}-${l.type}`} className="hx-row rn-row" data-tone={l.status === 'OK' ? undefined : tone}>
                  <DateLeaf date={l.expiresOn} tone={tone} />
                  <div className="hx-row-main">
                    <span className="hx-row-title">{by === 'company' ? l.label : l.companyName}</span>
                    <span className="hx-row-meta">
                      {by === 'company' ? l.companyName : l.label}
                      {' · '}
                      {l.expiresOn ? `expires ${dateLabel(l.expiresOn)}` : 'No record'}
                    </span>
                  </div>
                  <div className="hx-row-side">
                    {l.isPilot && <Chip tone="neutral">Pilot</Chip>}
                    <ExpiryChip status={l.status} daysLeft={l.daysLeft} />
                    {l.id ? (
                      <RecordButton kind="licence" id={l.id} label="Update" />
                    ) : (
                      <RecordButton kind="licence" companyId={l.companyId} label="Add record" />
                    )}
                  </div>
                </li>
              );
            })}
          </CalendarGroup>
        ))}
    </div>
  );
}
