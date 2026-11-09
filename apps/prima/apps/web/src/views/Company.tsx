import { ArrowRightIcon, CalendarCheckIcon, CheckCircleIcon, ClockIcon, UserCheckIcon, UserMinusIcon, WarningIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, ExpiryChip, Loading, Sev, dateLabel, hhmm, useLoad } from '../ui';
import { Card, Empty, PageHead, Person, Stat, Stats } from '../kit';
import { VacanciesPanel } from './HrJoinLeave';
import { StaffMovementPanel } from './HrMovement';
import { RecordButton, useRecordKinds } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import '../styles/leadership.css';

export function CompanyView() {
  const { companyId, go, me } = useApp();
  // HR asks the company head to sign vacancies and to accept staff moving in; the head cannot open the HR screen.
  const headHr = me.user.role === 'company_manager' ? (
    <>
      <VacanciesPanel />
      <StaffMovementPanel onlyIfAny />
    </>
  ) : null;
  const { data, error } = useLoad(() => api.dashboard(companyId), [companyId]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="today's picture" />
      </div>
    );
  const { row, today, attention, cases, branches } = data;

  if (!row.hasDetail) {
    return (
      <div className="page ld">
        <PageHead
          title={data.company.name}
          sub="No detailed data for this company yet. Only licence dates are held. Operational figures show Unknown until the company is connected."
          actions={<LicenceAdd companyId={data.company.id} />}
        />
        <Licences licences={row.licences} companyId={data.company.id} onAll={() => go({ view: 'compliance' })} />
        {headHr}
      </div>
    );
  }

  const open = cases.filter((c) => c.status !== 'resolved');
  return (
    <div className="page ld">
      <PageHead title={data.company.name} sub={<>Head of company: {data.company.headOfCompany || 'not recorded yet'}</>} actions={<LicenceAdd companyId={data.company.id} />}>
        {branches.length > 0 && (
          <div className="ld-branches" aria-label="Branches">
            <span className="label">Branches</span>
            {branches.map((b) => (
              <span key={b.name} className="ld-branch">
                {b.name} <span className="muted">Model {b.model}</span>
              </span>
            ))}
          </div>
        )}
      </PageHead>

      <Stats>
        <Stat label="Shifts today" value={today.total} icon={<CalendarCheckIcon />} tone="info" />
        <Stat
          label="On duty"
          value={today.onDuty + today.lateOnDuty}
          tone="ok"
          note={today.lateOnDuty ? `${today.lateOnDuty} came late` : 'All on time'}
          icon={<UserCheckIcon />}
        />
        <Stat
          label="No-shows"
          value={today.noShow}
          tone={today.noShow ? 'crit' : 'ok'}
          note={today.awaiting ? `${today.awaiting} starting now` : undefined}
          icon={<UserMinusIcon />}
        />
        <Stat
          label="Unfilled today"
          value={today.unfilled}
          tone={today.unfilled ? 'warn' : 'ok'}
          note={`${attention.unfilledNext7} in next 7 days`}
          icon={<WarningIcon />}
        />
        <Stat label="Later today" value={today.upcoming} icon={<ClockIcon />} />
        <Stat label="Finished" value={today.done} icon={<CheckCircleIcon />} />
      </Stats>

      <section className="ld-section" aria-labelledby="ld-people-now">
        <div className="ld-section-head">
          <h2 id="ld-people-now">People on duty</h2>
        </div>
        <div className="ld-cols">
          <Card
            title="No-shows right now"
            actions={<Chip tone={attention.noShows.length ? 'crit' : 'ok'}>{attention.noShows.length}</Chip>}
            flush
          >
            {attention.noShows.length === 0 ? (
              <Empty title="Everyone due on duty has clocked in." />
            ) : (
              <ul className="ld-rows">
                {attention.noShows.slice(0, 12).map((s) => (
                  <li key={s.id} className="ld-row" data-tone="crit">
                    {s.personName ? (
                      <Person name={s.personName} sub={`${s.siteName} · ${s.postName}`} size={32} />
                    ) : (
                      <span className="ld-row-main">
                        <span className="ld-row-meta">
                          {s.siteName} · {s.postName}
                        </span>
                      </span>
                    )}
                    <span className="ld-row-aside mono small">from {hhmm(s.start)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Rostered but not allowed to work"
            actions={<Chip tone={attention.blockedRostered.length ? 'crit' : 'ok'}>{attention.blockedRostered.length}</Chip>}
            flush
          >
            {attention.blockedRostered.length === 0 ? (
              <Empty title="Every rostered guard has valid papers for the next 7 days." />
            ) : (
              <ul className="ld-rows ld-scroll">
                {attention.blockedRostered.slice(0, 12).map((b) => (
                  <li key={b.personId}>
                    <button type="button" className="ld-row" data-tone="crit" onClick={() => go({ view: 'people', personId: b.personId })}>
                      <span className="ld-row-main">
                        <span className="ld-row-title">
                          {b.name} <span className="mono muted small">{b.staffNo}</span>
                        </span>
                        <span className="ld-row-crit">{b.reasons.join(' ')}</span>
                        <span className="ld-row-meta">
                          Next: {b.siteName}, {dateLabel(b.shiftStart)} {hhmm(b.shiftStart)}
                        </span>
                      </span>
                      <ArrowRightIcon className="ld-row-go" size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <section className="ld-section" aria-labelledby="ld-incidents">
        <div className="ld-section-head">
          <h2 id="ld-incidents">Incidents and papers</h2>
        </div>
        <div className="ld-cols">
          <Card
            title="Open cases"
            actions={
              <>
                <Chip tone={open.some((c) => c.severity === 'P1') ? 'crit' : open.length ? 'warn' : 'ok'}>{open.length}</Chip>
                <button className="btn btn-sm" onClick={() => go({ view: 'cases' })}>
                  All cases
                </button>
              </>
            }
            flush
          >
            {open.length === 0 ? (
              <Empty title="No open cases." />
            ) : (
              <ul className="ld-rows">
                {open.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <button type="button" className="ld-row ld-row-sev" onClick={() => go({ view: 'cases', caseId: c.id })}>
                      <Sev s={c.severity} />
                      <span className="ld-row-main">
                        <span className="ld-row-title">{c.title}</span>
                        <span className="ld-row-meta">{c.siteName}</span>
                      </span>
                      <span className="ld-row-aside">
                        {c.sla === 'breached' ? <Chip tone="crit">Response late</Chip> : <Chip tone="neutral">{c.status}</Chip>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Guard papers to fix"
            actions={<Chip tone={attention.credentialIssues.length ? 'warn' : 'ok'}>{attention.credentialIssues.length}</Chip>}
            flush
          >
            {attention.credentialIssues.length === 0 ? (
              <Empty title="No guard papers to fix." />
            ) : (
              <ul className="ld-rows">
                {attention.credentialIssues.slice(0, 10).map((c, i) => (
                  <li key={i}>
                    <button type="button" className="ld-row" onClick={() => go({ view: 'people', personId: c.personId })}>
                      <span className="ld-row-main">
                        <span className="ld-row-title">{c.name}</span>
                        <span className="ld-row-meta">{c.message}</span>
                      </span>
                      <span className="ld-row-aside">
                        <ExpiryChip status={c.status} daysLeft={c.daysLeft} text={c.chip} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <Licences licences={row.licences} companyId={data.company.id} onAll={() => go({ view: 'compliance' })} />
      {headHr}
    </div>
  );
}

/** P91: the company's licences are the records kept from this screen; Add and Import sit at the top for those who keep them. */
function LicenceAdd({ companyId }: { companyId: string }) {
  if (!useRecordKinds().has('licence')) return null;
  return (
    <>
      <RecordButton kind="licence" companyId={companyId} label="Add licence" primary />
      <ImportButton kind="licence" companyId={companyId} />
    </>
  );
}

function Licences({
  licences,
  companyId,
  onAll,
}: {
  licences: { type: string; label: string; expiresOn: string | null; status: 'OK' | 'DUE' | 'OVERDUE' | 'UNKNOWN'; daysLeft: number | null }[];
  companyId: string;
  onAll: () => void;
}) {
  return (
    <Card
      title="Company licences"
      sub="Reminders start: KDN 120 days, MOF 90, insurance 90, SSM 60"
      flush
      actions={
        <>
          <RecordButton kind="licence" companyId={companyId} label="Add licence" />
          <ImportButton kind="licence" companyId={companyId} />
          <button className="btn btn-sm" onClick={onAll}>
            All licences
          </button>
        </>
      }
    >
      <ul className="ld-licences">
        {licences.map((l) => (
          <li key={l.type} className="ld-licence" data-status={l.status}>
            <span className="ld-licence-name">{l.label}</span>
            <span className="ld-licence-date">
              <span className="label">Expires</span>
              {l.expiresOn ? dateLabel(l.expiresOn) : 'No record'}
            </span>
            <ExpiryChip status={l.status} daysLeft={l.daysLeft} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
