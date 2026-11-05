import { ArrowRightIcon, CalendarCheckIcon, FirstAidKitIcon, ShieldCheckIcon, UserCheckIcon, UserMinusIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { RecordButton } from './RecordForm';
import { useState } from 'react';
import { useApp } from '../App';
import { Chip, ExpiryChip, Loading, ErrorNotice, n, useLoad, type Tone } from '../ui';
import { PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import '../styles/leadership.css';

type Num = number | 'UNKNOWN';
const some = (v: Num) => v !== 'UNKNOWN' && v > 0;

/** One figure on a company card; Unknown stays Unknown and is never coloured as fine. */
function Fig({ label, value, tone }: { label: string; value: Num; tone?: Tone }) {
  return (
    <div className="ld-fig" data-tone={value === 'UNKNOWN' ? 'unknown' : tone}>
      <dt>{label}</dt>
      <dd>{n(value)}</dd>
    </div>
  );
}

/** The grid opens with this many cards (pilot companies first); the rest are one click away. */
const CARDS = 12;

type Show = 'all' | 'pilot' | 'expired' | 'due' | 'unknown';
const SHOW: [Show, string][] = [
  ['all', 'All'],
  ['pilot', 'Pilot'],
  ['expired', 'Licence expired'],
  ['due', 'Licence due'],
  ['unknown', 'No licence record'],
];

export function Overview() {
  const { go, setCompanyId } = useApp();
  const { data, error } = useLoad(() => api.overview(), []);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [allCards, setAllCards] = useState(false);
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
  const needle = q.trim().toLowerCase();
  const shown = data.filter(
    (r) =>
      (!needle || `${r.company.name} ${r.company.state}`.toLowerCase().includes(needle)) &&
      (show === 'all' ||
        (show === 'pilot' && r.hasDetail) ||
        (show === 'expired' && r.licenceStatus === 'OVERDUE') ||
        (show === 'due' && r.licenceStatus === 'DUE') ||
        (show === 'unknown' && r.licenceStatus === 'UNKNOWN')),
  );
  // Pilot companies first: they carry live figures.
  const ordered = [...shown.filter((r) => r.hasDetail), ...shown.filter((r) => !r.hasDetail)];

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
        <Toolbar
          end={
            <div className="seg ld-seg" role="group" aria-label="Show companies">
              {SHOW.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <Search value={q} onChange={setQ} placeholder="Search companies or states" />
        </Toolbar>
        {ordered.length === 0 && <div className="empty">No company matches.</div>}
        <ul className="ld-grid">
          {(allCards || needle || show !== 'all' ? ordered : ordered.slice(0, CARDS)).map((r) => {
            const figures = [r.guards, r.sites, r.presentNow, r.noShowToday, r.openCases, r.credentialIssues];
            const allUnknown = figures.every((v) => v === 'UNKNOWN');
            const bad = r.licences.filter((l) => l.status !== 'OK');
            // The card's edge carries its worst state: red for an expired licence, a P1 or a no-show; amber for papers or a licence due.
            const tone: Tone =
              r.licenceStatus === 'OVERDUE' || some(r.p1Open) || some(r.noShowToday)
                ? 'crit'
                : r.licenceStatus === 'DUE' || some(r.credentialIssues)
                  ? 'warn'
                  : !r.hasDetail || r.licenceStatus === 'UNKNOWN'
                    ? 'unknown'
                    : 'ok';
            const openIt = () => {
              setCompanyId(r.company.id);
              go({ view: 'company' });
            };
            return (
              <li key={r.company.id} className="ld-co" data-tone={tone} data-pilot={r.hasDetail}>
                <div className="ld-co-head">
                  <div className="ld-co-name">
                    {r.hasDetail ? (
                      <button type="button" className="ld-co-link" onClick={openIt}>
                        {r.company.name}
                      </button>
                    ) : (
                      <h3>{r.company.name}</h3>
                    )}
                    <span className="ld-co-sub">
                      {r.company.isPilot ? 'Pilot' : 'Summary only'} · {r.company.state}
                    </span>
                  </div>
                  {r.canAct ? <Chip tone="info">Act</Chip> : <Chip tone="neutral">Monitor</Chip>}
                </div>

                <div className="ld-co-licence">
                  <span className="label">Licences</span>
                  <ExpiryChip status={r.licenceStatus} />
                  <span className="ld-co-licence-text">{bad.map((l) => l.label).join(', ') || 'All valid'}</span>
                </div>

                {allUnknown ? (
                  <p className="ld-co-unknown">Guards, sites, duty, cases and papers: Unknown until connected</p>
                ) : (
                <dl className="ld-figs">
                  <Fig label="Guards" value={r.guards} />
                  <Fig label="Sites" value={r.sites} />
                  <Fig label="On duty" value={r.presentNow} tone={some(r.presentNow) ? 'ok' : undefined} />
                  <Fig label="No-shows" value={r.noShowToday} tone={some(r.noShowToday) ? 'crit' : undefined} />
                  <Fig label="Open cases" value={r.openCases} tone={some(r.p1Open) ? 'crit' : undefined} />
                  <Fig label="Papers to fix" value={r.credentialIssues} tone={some(r.credentialIssues) ? 'warn' : undefined} />
                </dl>
                )}

                {r.p1Open !== 'UNKNOWN' && r.p1Open > 0 && (
                  <div className="ld-co-flags">
                    <Chip tone="crit">{r.p1Open} P1</Chip>
                  </div>
                )}

                <div className="ld-co-foot">
                  <RecordButton kind="company" companyId={r.company.id} label="Company record" />
                  {r.hasDetail && (
                    <button type="button" className="btn btn-sm btn-ghost ld-go" onClick={openIt}>
                      Open company
                      <ArrowRightIcon size={14} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!needle && show === 'all' && ordered.length > CARDS && (
          <button type="button" className="btn ld-more-cards" aria-expanded={allCards} onClick={() => setAllCards(!allCards)}>
            {allCards ? 'Show fewer companies' : `Show all ${ordered.length} companies`}
          </button>
        )}
      </section>
    </div>
  );
}
