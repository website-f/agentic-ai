import { api, type ArmsControl } from '../api';
import { useApp } from '../App';
import { useState } from 'react';
import {
  BriefcaseIcon,
  CalendarCheckIcon,
  ClockCountdownIcon,
  HeadsetIcon,
  PackageIcon,
  ShieldWarningIcon,
  VaultIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
import { RecordButton } from './RecordForm';
import { OpsGuide } from './OpsGuide';
import { Card, Empty, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import '../styles/ops.css';

export type ArmsTab =
  | 'alerts'
  | 'ready'
  | 'vaults'
  | 'log'
  | 'ammo'
  | 'jobs'
  | 'requests'
  | 'renewals'
  | 'clients'
  | 'police'
  | 'tenders'
  | 'suppliers'
  | 'trading'
  | 'companies'
  | 'legal';

export const ARMS_TABS: { id: ArmsTab; label: string }[] = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'ready', label: 'Readiness' },
  { id: 'vaults', label: 'Vaults' },
  { id: 'log', label: 'In and out' },
  { id: 'ammo', label: 'Ammunition' },
  { id: 'jobs', label: 'Armed jobs' },
  { id: 'requests', label: 'Requests' },
  { id: 'renewals', label: 'Renewals' },
  { id: 'clients', label: 'Client agreements' },
  { id: 'police', label: 'Police and KDN' },
  { id: 'tenders', label: 'Tenders' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'trading', label: 'Trading' },
  { id: 'companies', label: 'Companies' },
  { id: 'legal', label: 'Legal points (directors)' },
];

const JOB_LABEL: Record<ArmsControl['jobs'][number]['job']['kind'], string> = {
  BODYGUARD: 'Close protection',
  CIT: 'Cash-in-transit',
  CDM: 'Cash deposit machines',
  CASH_VAULT: 'Cash vaulting',
};

const JOB_STATUS: Record<ArmsControl['jobs'][number]['job']['status'], { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  in_progress: { label: 'On the job', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  delayed: { label: 'Delayed', tone: 'warn' },
  incident: { label: 'Incident', tone: 'crit' },
};

/**
 * What Arms Control monitors across every company (Fauzan, 25 Oct 2026): firearms in and out,
 * CMS arms alerts, renewals and servicing, armed jobs, tenders that need arms, and CMS staffing.
 */
export function ArmsControlBoard({ tab, onTab }: { tab: ArmsTab; onTab: (t: ArmsTab) => void }) {
  const { data, error } = useLoad(() => api.armsControl(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="arms control" />;
  const t = data.tiles;
  return (
    <>
      <Stats>
        <Stat
          label="Not cleared for armed duty"
          value={t.notReady}
          tone={t.notReady ? 'crit' : 'ok'}
          note={`${t.armedShiftsToday} armed duties, next 24 hours`}
          icon={<ShieldWarningIcon size={16} />}
          onClick={() => onTab('ready')}
        />
        <Stat
          label="Firearms out now"
          value={t.out}
          tone={t.overdue ? 'crit' : 'ok'}
          note={t.overdue ? `${t.overdue} overdue` : 'All on time'}
          icon={<ClockCountdownIcon size={16} />}
          onClick={() => onTab('log')}
        />
        <Stat
          label="Armed jobs running"
          value={t.jobsActive}
          tone={t.jobsProblem ? 'warn' : 'ok'}
          note={t.jobsProblem ? `${t.jobsProblem} delayed or incident` : 'Bodyguard, CIT, CDM, vault'}
          icon={<BriefcaseIcon size={16} />}
          onClick={() => onTab('jobs')}
        />
        <Stat
          label="Renewals due"
          value={t.renewalsDue}
          tone={t.renewalsOverdue ? 'crit' : t.renewalsDue ? 'warn' : 'ok'}
          note={t.renewalsOverdue ? `${t.renewalsOverdue} expired` : 'Licences, permits, vaults'}
          icon={<CalendarCheckIcon size={16} />}
          onClick={() => onTab('renewals')}
        />
        <Stat
          label="Servicing due"
          value={t.serviceDue}
          tone={t.serviceOverdue ? 'crit' : t.serviceDue ? 'warn' : 'ok'}
          note={t.serviceOverdue ? `${t.serviceOverdue} overdue` : 'Armourer service'}
          icon={<WrenchIcon size={16} />}
          onClick={() => onTab('renewals')}
        />
        <Stat
          label="Vault exceptions"
          value={t.vaultExceptions}
          tone={t.vaultExceptions ? 'crit' : 'ok'}
          note="CCTV, recorder, alarm, door"
          icon={<VaultIcon size={16} />}
          onClick={() => onTab('vaults')}
        />
        <Stat
          label="Ammunition exceptions"
          value={t.ammoExceptions}
          tone={t.ammoExceptions ? 'crit' : 'ok'}
          note="Counts and rounds returned"
          icon={<PackageIcon size={16} />}
          onClick={() => onTab('ammo')}
        />
        <Stat
          label="CMS gaps now"
          value={t.cmsGapsNow}
          tone={t.cmsGapsNow ? 'crit' : 'ok'}
          note={`${t.cmsWeekGaps} shifts uncovered this week`}
          icon={<HeadsetIcon size={16} />}
        />
      </Stats>
      <div className="tabbar op-tabs" role="tablist" aria-label="Arms control sections">
        {ARMS_TABS.filter((x) => x.id !== 'legal' || data.canSeeLegalFlags).map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => onTab(x.id)}>
            {x.label}
            {x.id === 'alerts' && data.alerts.length > 0 && <span className="tab-count">{data.alerts.length}</span>}
            {x.id === 'tenders' && t.armedTenders > 0 && <span className="tab-count">{t.armedTenders}</span>}
            {x.id === 'ready' && t.notReady > 0 && <span className="tab-count">{t.notReady}</span>}
            {x.id === 'requests' && t.requestsForReview > 0 && <span className="tab-count">{t.requestsForReview}</span>}
          </button>
        ))}
      </div>
      {tab === 'alerts' && <Alerts data={data} />}
      {tab === 'ready' && <Readiness data={data} />}
      {tab === 'vaults' && <Vaults data={data} />}
      {tab === 'log' && <Log data={data} />}
      {tab === 'ammo' && <Ammo data={data} />}
      {tab === 'jobs' && <Jobs data={data} />}
      {tab === 'requests' && (
        <>
          <Requests data={data} />
          <OpsGuide area="arms" />
        </>
      )}
      {tab === 'renewals' && <Renewals data={data} />}
      {tab === 'clients' && <Agreements data={data} />}
      {tab === 'police' && <Police data={data} />}
      {tab === 'tenders' && <Tenders data={data} />}
      {tab === 'suppliers' && <Suppliers data={data} />}
      {tab === 'trading' && <Trading />}
      {tab === 'legal' && data.canSeeLegalFlags && <LegalFlags />}
    </>
  );
}

function Alerts({ data }: { data: ArmsControl }) {
  const { setCompanyId } = useApp();
  return (
    <Card title="CMS arms alerts" sub="What the CMS arms desk is watching now. Open one to switch to that company." flush>
      {data.alerts.length === 0 && <Empty title="No arms alerts." />}
      <ul className="op-list">
        {data.alerts.map((a, i) => (
          <li key={i}>
            <button className="op-item cm-q" data-tone={a.tone} onClick={() => setCompanyId(a.companyId)}>
              <span className="cm-q-bar" aria-hidden="true" />
              <span className="op-main">
                <span className="op-title">{a.title}</span>
                <span className="op-meta">{a.detail}</span>
                <span className="op-co">{a.companyName}</span>
              </span>
              <Chip tone={a.tone}>{a.kind}</Chip>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const STORAGE_LABEL: Record<NonNullable<ArmsControl['vaults'][number]['vault']['kind']>, string> = {
  COMPANY_ARMOURY: 'Company armoury, police approved',
  POLICE_STATION: 'Stored at a police station, police approved. Watch, alarm and CCTV are the police’s.',
  CLIENT_SAFE: 'Company-owned arms safe (peti besi) at the client site, police approved. Only authorised company staff may use it.',
};

const WATCH_STATE: Record<ArmsControl['vaults'][number]['watchState'], { label: string; tone: Tone }> = {
  ok: { label: 'Watch checked in', tone: 'ok' },
  check_late: { label: 'Check-in late', tone: 'crit' },
  not_in: { label: 'Watch not clocked in', tone: 'crit' },
  no_watcher: { label: 'Nobody on watch', tone: 'crit' },
  none: { label: 'No watch now', tone: 'neutral' },
};

function Vaults({ data }: { data: ArmsControl }) {
  return (
    <>
      <Card
        title="Vaults, as CMS control sees them"
        sub={`Day and night watch check in at least every ${data.vaultCheckMin} minutes`}
        actions={<RecordButton kind="vault" label="Add vault" />}
      >
        <div className="ar-vaults">
          {data.vaults.map((v) => {
            const police = v.vault.kind === 'POLICE_STATION';
            const w = police ? { label: 'Kept by police', tone: 'neutral' as Tone } : WATCH_STATE[v.watchState];
            const c = v.current;
            return (
              <article key={v.vault.id} className="ar-vault">
                <div className="ar-vault-head">
                  <div className="op-main">
                    <h3>{v.vault.name}</h3>
                    <span className="op-co">{v.companyName}</span>
                  </div>
                  <Chip tone={w.tone}>{w.label}</Chip>
                </div>
                <span className="op-meta">{STORAGE_LABEL[v.vault.kind ?? 'COMPANY_ARMOURY']}</span>
                <div className="ar-vault-figs">
                  <div>
                    <span>In vault</span>
                    <strong>{v.inVault}</strong>
                  </div>
                  <div>
                    <span>Out now</span>
                    <strong>{v.out}</strong>
                  </div>
                  <div>
                    <span>Today out / back</span>
                    <strong>
                      {v.outToday} / {v.inToday}
                    </strong>
                  </div>
                  <div>
                    <span>Last count</span>
                    <strong className={v.vault.lastCountOk === false ? 'op-crit' : undefined}>
                      {v.vault.lastCountAt ? hhmm(v.vault.lastCountAt) : 'never'}
                      {v.vault.lastCountOk === false ? ' (difference)' : ''}
                    </strong>
                  </div>
                </div>
                {v.vault.authorisedUsers && <span className="op-meta">Authorised: {v.vault.authorisedUsers.join(', ')}</span>}
                <span className="op-meta">
                  A licence: {v.vault.aLicenceHolder ?? 'not recorded'}
                  {v.vault.aLicenceRole ? ` (${v.vault.aLicenceRole.replace(/^A licence holder, /, '')})` : ''} · Amra: {v.vault.custodian}
                  {v.vault.custodianRole ? ` (${v.vault.custodianRole.replace(/^Amra, /, '')})` : ''}
                </span>
                {v.vault.kind !== 'POLICE_STATION' && (
                  <span className="op-meta">
                    Register book and online register:{' '}
                    {v.vault.registerCheckedAt
                      ? `checked ${dateLabel(v.vault.registerCheckedAt.slice(0, 10))} ${hhmm(v.vault.registerCheckedAt)}`
                      : 'never checked'}
                  </span>
                )}
                <span className="op-meta">
                  {c
                    ? `${c.shift === 'day' ? 'Day' : 'Night'} watch ${hhmm(c.start)}–${hhmm(c.end)}: ${c.watcher ?? 'nobody'}${c.clockIn ? `, in ${hhmm(c.clockIn)}` : ''}${c.lastCheckAt ? `, last check ${hhmm(c.lastCheckAt)}` : ''}`
                    : 'No watch now'}
                  {v.next ? ` · next ${v.next.shift} watch ${hhmm(v.next.start)}: ${v.next.watcher ?? 'nobody rostered'}` : ''}
                </span>
                <div className="op-chips">
                  {!police && (
                    <>
                      <Chip tone={v.vault.alarmOnline === true ? 'ok' : v.vault.alarmOnline === false ? 'crit' : 'warn'}>
                        {v.vault.alarmOnline === true ? 'Alarm online' : v.vault.alarmOnline === false ? 'Alarm offline' : 'Alarm not connected'}
                      </Chip>
                      <Chip
                        tone={v.vault.cctvOnline === true ? (v.vault.recordingOk === true ? 'ok' : 'crit') : v.vault.cctvOnline === false ? 'crit' : 'warn'}
                      >
                        {v.vault.cctvOnline === true
                          ? v.vault.recordingOk === true
                            ? 'CCTV live, recording'
                            : v.vault.recordingOk === false
                              ? 'CCTV live, not recording'
                              : 'CCTV live, recording not confirmed'
                          : v.vault.cctvOnline === false
                            ? 'CCTV offline'
                            : 'CCTV not connected'}
                      </Chip>
                    </>
                  )}
                  <Chip tone={v.approval.status === 'OK' ? 'ok' : v.approval.status === 'OVERDUE' ? 'crit' : 'warn'}>
                    {v.approval.status === 'OK'
                      ? 'PDRM approval valid'
                      : v.approval.status === 'UNKNOWN'
                        ? 'Approval not recorded'
                        : `Approval ${v.approval.daysLeft} days`}
                  </Chip>
                </div>
                <div className="ar-vault-foot">
                  <RecordButton kind="vault" id={v.vault.id} label="Edit vault" />
                </div>
              </article>
            );
          })}
        </div>
      </Card>
      <Card title="Vault door events, last 24 hours" sub={`Each opening should match an issue, return or count within ${data.doorMatchMin} minutes`} flush>
        {data.doors.length === 0 && <Empty title="No door events from the vault access systems." />}
        <ul className="op-list">
          {data.doors.map((d) => (
            <li key={d.event.id} className="op-item ar-log" data-tone={d.matched ? undefined : d.event.kind === 'ACCESS_DENIED' ? 'warn' : 'crit'}>
              <span className="op-time">{hhmm(d.event.at)}</span>
              <span className="op-main">
                <span className="op-title">
                  {d.vaultName}: {d.event.kind === 'DOOR_FORCED' ? 'door forced' : d.event.kind === 'ACCESS_DENIED' ? 'access refused' : 'door opened'}
                </span>
                <span className="op-meta">{d.event.by ?? 'Person not identified'}</span>
                <span className="op-co">{d.companyName}</span>
              </span>
              <Chip tone={d.matched ? 'ok' : d.event.kind === 'ACCESS_DENIED' ? 'warn' : 'crit'}>
                {d.matched ? 'Matches a movement' : 'No matching record'}
              </Chip>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** The custody log: every firearm out and back, newest first, with who holds it and who witnessed. */
function Log({ data }: { data: ArmsControl }) {
  return (
    <Card title="Firearms in and out, last 24 hours" sub="All companies, newest first" flush>
      {data.log.length === 0 && <Empty title="No movements in the last 24 hours." />}
      <ul className="op-list">
        {data.log.map((l, i) => {
          const late = l.dir === 'out' && l.state !== 'out' && l.state !== 'returned';
          return (
            <li key={i} className="op-item ar-log" data-tone={late ? 'crit' : undefined}>
              <span className="op-time">{hhmm(l.at)}</span>
              <span className="op-main">
                <span className="op-title">
                  <span className="mono">{l.tag}</span> {l.dir === 'out' ? 'out to' : 'back from'} {l.person}
                </span>
                <span className="op-meta">
                  {l.place} · witness {l.witness || 'none'}
                </span>
                <span className="op-co">{l.companyName}</span>
              </span>
              {l.dir === 'out' ? (
                <Chip tone={l.state === 'out' || l.state === 'returned' ? 'info' : 'crit'}>
                  {l.state === 'returned' ? 'Out, back' : l.state === 'out' ? 'Out' : 'Overdue'}
                </Chip>
              ) : (
                <Chip tone="ok">In</Chip>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Jobs({ data }: { data: ArmsControl }) {
  return (
    <Card title="Armed jobs, today and next 24 hours" sub="Close protection, cash-in-transit, cash deposit machines, cash vaulting" flush>
      {data.jobs.length === 0 && <Empty title="No armed jobs." />}
      <ul className="op-list">
        {data.jobs.map(({ job, companyName, crew, firearms, police }) => (
          <li key={job.id} className="op-item" data-tone={JOB_STATUS[job.status].tone}>
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">
                  {JOB_LABEL[job.kind]} · {job.client}
                </span>
                <span className="op-meta">
                  {job.ref} · {hhmm(job.start)}–{hhmm(job.end)} · {job.detail}
                </span>
                <span className="op-meta">
                  Crew {crew.join(', ') || 'not named'} · firearms {firearms.join(', ') || 'none out'}
                  {job.vehicle ? ` · ${job.vehicle}` : ''}
                </span>
                <span className="op-co">
                  {companyName} · {job.lastUpdate} ({hhmm(job.lastUpdateAt)})
                </span>
              </div>
              <div className="op-side">
                <Chip tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Chip>
                {/* The police reference is a task to record here; whether it is legally in order is for the directors' view. */}
                <Chip tone={police.notice ? 'ok' : 'neutral'}>{police.notice ? `Police notice ${police.notice.ref}` : 'Police notice: to record'}</Chip>
                {police.needsApproval && (
                  <Chip tone={police.approval ? 'ok' : 'neutral'}>
                    {police.approval ? `Approval to ${police.away.join(', ')} ${police.approval.ref}` : `Approval to ${police.away.join(', ')}: to record`}
                  </Chip>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Renewals({ data }: { data: ArmsControl }) {
  return (
    <Card title="Renewals and servicing" sub="Firearm licences run to 30 June. Unknown is never counted as fine." flush>
      {data.renewals.length === 0 && <Empty title="Nothing due." />}
      <ul className="op-list">
        {data.renewals.map((r, i) => (
          <li key={i} className="op-item" data-tone={r.tone}>
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">{r.what}</span>
                <span className="op-meta">{r.item}</span>
                <span className="op-co">{r.companyName}</span>
              </div>
              <Chip tone={r.tone}>
                {r.due === null ? 'No record' : (r.daysLeft ?? 0) < 0 ? `${-(r.daysLeft ?? 0)} days late` : `${r.daysLeft} days · ${dateLabel(r.due)}`}
              </Chip>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TenderList({ rows, empty }: { rows: ArmsControl['tenders']; empty: string }) {
  return (
    <>
      {rows.length === 0 && <Empty title={empty} />}
      <ul className="op-list">
        {rows.map((t) => {
          const blocked = t.findings.filter((f) => f.level === 'block');
          const supply = t.tender.kind === 'ARMS_SUPPLY';
          return (
            <li key={t.tender.id} className="op-item" data-tone={blocked.length ? 'crit' : undefined}>
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">{t.tender.title}</span>
                  <span className="op-meta">
                    {t.tender.ref} · {t.tender.buyer}
                    {supply ? '' : ` · ${t.tender.guards} guards`} · closes {dateLabel(t.tender.closesOn)}
                  </span>
                  {!supply && (
                    <span className="op-meta">
                      Company holds {t.firearmsHeld} firearms and {t.permitHolders} guards with a valid firearm permit
                    </span>
                  )}
                  {blocked.length > 0 && <span className="small op-crit">{blocked.map((f) => f.message).join(' ')}</span>}
                  <span className="op-co">{t.companyName}</span>
                </div>
                <Chip tone={blocked.length ? 'crit' : t.tender.status === 'submitted' ? 'ok' : t.daysLeft <= 7 ? 'warn' : 'neutral'}>
                  {t.tender.status === 'submitted' ? 'Submitted' : `${t.daysLeft} days left`}
                </Chip>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Tenders({ data }: { data: ArmsControl }) {
  const supply = data.tenders.filter((t) => t.tender.kind === 'ARMS_SUPPLY');
  const guarding = data.tenders.filter((t) => t.tender.kind !== 'ARMS_SUPPLY');
  return (
    <div className="op-grid-2">
      <Card title="Tenders to supply arms-related items" sub="Bid under an arms dealer licence, priced from the supplier catalogue" flush>
        <TenderList rows={supply} empty="No supply tenders open." />
      </Card>
      <Card title="Guarding tenders that need arms" sub="Only armed work is shown. The company bids in its own name." flush>
        <TenderList rows={guarding} empty="No armed guarding tenders open." />
      </Card>
    </div>
  );
}

function Suppliers({ data }: { data: ArmsControl }) {
  const d = data.dealer;
  return (
    <>
      <Card
        title="Arms dealer licence"
        actions={
          <>
            <Chip tone={d.rows.some((r) => r.licence.status === 'approved') ? 'ok' : 'warn'}>
              {d.rows.filter((r) => r.licence.status === 'approved').length} of {d.target} companies licensed
            </Chip>
            <RecordButton kind="dealerLicence" label="Add dealer licence" />
          </>
        }
      >
        <div className="op-form">
          <p className="op-note">
            {d.target} licensed security companies will hold a licence to buy and sell arms, and keep trade stock in their own vault to save on vaulting. Trade
            stock is registered apart from operational firearms and is never issued to a guard.
          </p>
          {d.rows.length === 0 ? (
            <div className="notice" data-tone="warn">
              The {d.target} companies are not chosen yet. Trade stock held: {d.tradeStockHeld}.
            </div>
          ) : (
            <div className="op-box">
              {d.rows.map((r) => (
                <div key={r.licence.id} className="op-item">
                  <div className="op-line">
                    <div className="op-main">
                      <span className="op-title">{r.companyName}</span>
                      <span className="op-meta">
                        {r.licence.reference ?? 'Not applied yet'} · {r.vault ? `vault ${r.vault}` : 'no vault on record yet'} · trade stock {r.tradeStock}
                      </span>
                    </div>
                    <div className="op-chips">
                      <Chip tone={r.licence.status === 'approved' ? 'ok' : r.licence.status === 'refused' || r.licence.status === 'expired' ? 'crit' : 'warn'}>
                        {r.licence.status}
                      </Chip>
                      <RecordButton kind="dealerLicence" id={r.licence.id} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="op-note">
            To confirm with counsel and PDRM first: whether an armoury approved for a company&apos;s own firearms may also hold dealer stock (rule {d.rule.id},{' '}
            {d.rule.label}).
          </p>
        </div>
      </Card>
      <Card
        title="Suppliers and their items"
        sub="Specs and prices for every item from suppliers we have engaged"
        actions={
          <>
            <RecordButton kind="armsSupplier" label="Add supplier" />
            <RecordButton kind="supplierItem" label="Add item and price" />
          </>
        }
        flush
      >
        <ul className="op-list">
          {data.suppliers.map(({ supplier, licence, items }) => (
            <li key={supplier.id} className="op-item">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">{supplier.name}</span>
                  <span className="op-meta">
                    {supplier.supplies.join(', ')} · {supplier.contact}
                    {supplier.lastOrderOn ? ` · last order ${dateLabel(supplier.lastOrderOn)}` : ''}
                  </span>
                </div>
                <div className="op-chips">
                  <Chip tone={licence.status === 'OK' ? 'ok' : licence.status === 'OVERDUE' ? 'crit' : licence.status === 'UNKNOWN' ? 'neutral' : 'warn'}>
                    {licence.status === 'UNKNOWN'
                      ? 'Licence not on file'
                      : licence.status === 'OK'
                        ? 'Licence valid'
                        : licence.status === 'OVERDUE'
                          ? 'Licence expired'
                          : `Licence ${licence.daysLeft} days`}
                  </Chip>
                  <RecordButton kind="armsSupplier" id={supplier.id} label="Edit supplier" />
                </div>
              </div>
              {items.length > 0 && (
                <div className="table-wrap op-box">
                  <table>
                    <thead>
                      <tr>
                        <th>Item and spec</th>
                        <th className="num">Price (RM)</th>
                        <th className="hide-sm">Lead time</th>
                        <th>Price valid</th>
                        <th aria-label="Edit" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(({ item, priceStatus }) => (
                        <tr key={item.id}>
                          <td>
                            <div className="op-company">
                              {item.name}
                              <span>{item.spec}</span>
                            </div>
                          </td>
                          <td className="num">
                            <div className="op-company">
                              {item.unitPrice.toLocaleString('en-MY')}
                              <span>{item.unit}</span>
                            </div>
                          </td>
                          <td className="hide-sm small">{item.leadTimeDays ? `${item.leadTimeDays} days` : '-'}</td>
                          <td>
                            <Chip
                              tone={
                                priceStatus.status === 'OK'
                                  ? 'ok'
                                  : priceStatus.status === 'OVERDUE'
                                    ? 'crit'
                                    : priceStatus.status === 'UNKNOWN'
                                      ? 'neutral'
                                      : 'warn'
                              }
                            >
                              {item.priceValidUntil ? (priceStatus.status === 'OVERDUE' ? 'Expired' : dateLabel(item.priceValidUntil)) : 'No date'}
                            </Chip>
                          </td>
                          <td>
                            <RecordButton kind="supplierItem" id={item.id} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const VERDICT: Record<ArmsControl['readiness'][number]['verdict'], { label: string; tone: Tone }> = {
  go: { label: 'Cleared', tone: 'ok' },
  no_go: { label: 'Not cleared', tone: 'crit' },
  unknown: { label: 'Not confirmed', tone: 'neutral' },
};

/** Go or no-go for every armed shift today, before the guard draws a firearm (V14 s.206). */
function Readiness({ data }: { data: ArmsControl }) {
  const rows = [...data.readiness].sort(
    (a, b) => (a.verdict === 'no_go' ? 0 : a.verdict === 'unknown' ? 1 : 2) - (b.verdict === 'no_go' ? 0 : b.verdict === 'unknown' ? 1 : 2),
  );
  return (
    <Card
      title="Armed-duty readiness, now and next 24 hours"
      sub="Company licence, guard permit, range practice, client agreement, insurance, vault approval"
      flush
    >
      {rows.length === 0 && <Empty title="No armed shifts or armed jobs in the next 24 hours." />}
      <ul className="op-list">
        {rows.map((r) => (
          <li key={r.duty.id} className="op-item" data-tone={r.verdict === 'no_go' ? 'crit' : undefined}>
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">
                  {r.person} · {r.siteName}
                </span>
                <span className="op-meta">
                  {hhmm(r.duty.start)}–{hhmm(r.duty.end)}
                  {r.issued ? ` · firearm ${r.issued} issued` : ''}
                </span>
                <span className="op-co">{r.companyName}</span>
              </div>
              <Chip tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Chip>
            </div>
            {r.verdict !== 'go' && (
              <div className="op-chips">
                {r.checks
                  .filter((c) => c.state !== 'ok')
                  .map((c) => (
                    <Chip key={c.label} tone={c.state === 'block' ? 'crit' : 'neutral'}>
                      {c.label}: {c.detail}
                    </Chip>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Ammunition ledger against the last physical count; differences are never adjusted silently (V14 s.208). */
function Ammo({ data }: { data: ArmsControl }) {
  return (
    <>
      <Card title="Ammunition by vault" sub="Ledger against the last count. A difference opens a case; nobody edits the ledger to match." flush>
        <div className="table-wrap">
          <table className="op-sticky-first">
            <thead>
              <tr>
                <th>Vault</th>
                <th>Calibre</th>
                <th className="num">Ledger</th>
                <th className="num">Counted</th>
                <th className="hide-sm">Counted by / checked by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.ammo.map((a) => (
                <tr key={a.stock.id}>
                  <td>
                    <div className="op-company">
                      {a.vaultName}
                      <span>{a.stock.countedAt ? `Counted ${hhmm(a.stock.countedAt)}` : 'Never counted'}</span>
                    </div>
                  </td>
                  <td>{a.stock.calibre}</td>
                  <td className="num">{a.stock.ledger}</td>
                  <td className="num">{a.stock.counted ?? '—'}</td>
                  <td className="hide-sm small">
                    {a.stock.countedBy ?? '—'} / {a.stock.checkedBy ?? '—'}
                  </td>
                  <td>
                    <Chip tone={a.difference === null ? 'neutral' : a.difference !== 0 ? 'crit' : a.sameCounter ? 'warn' : 'ok'}>
                      {a.difference === null
                        ? 'Not counted'
                        : a.difference !== 0
                          ? `${a.difference > 0 ? 'Over' : 'Short'} ${Math.abs(a.difference)}`
                          : a.sameCounter
                            ? 'Same person checked'
                            : 'Matches'}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Rounds not returned" sub="Returns with fewer rounds than issued and no case opened" flush>
        {data.roundsShort.length === 0 && <Empty title="Every return matched the rounds issued." />}
        <ul className="op-list">
          {data.roundsShort.map((r) => (
            <li key={r.movement.id} className="op-item" data-tone="crit">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    <span className="mono">{r.tag}</span> · {r.person}
                  </span>
                  <span className="op-meta">
                    Issued {r.movement.rounds}, returned {r.movement.roundsReturned} at {hhmm(r.movement.returnedAt!)}
                  </span>
                  <span className="op-co">{r.companyName}</span>
                </div>
                <Chip tone="crit">{r.movement.rounds - (r.movement.roundsReturned ?? 0)} short</Chip>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export const REQUEST_KIND: Record<ArmsControl['requests'][number]['request']['kind'], string> = {
  ACQUIRE: 'Buy',
  MOVE: 'Move',
  TRANSFER: 'Transfer between companies',
  SERVICE: 'Service',
  DISPOSE: 'Dispose',
  LOSS_REPORT: 'Loss report',
  TRADE_BUY: 'Trade: buy stock',
  TRADE_SELL: 'Trade: sell',
  IMPORT: 'Import',
};

/** Arms requests on the ten-step path (V14 s.223). Arms Control reviews; the licensed company authorises. */
function Requests({ data }: { data: ArmsControl }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  return (
    <Card title="Arms requests" sub="Ten steps from draft to closed. Arms Control reviews; the company with the A licence authorises." flush>
      {error && (
        <div className="op-pad">
          <ErrorNotice error={error} />
        </div>
      )}
      {data.requests.length === 0 && <Empty title="No open requests." />}
      <ul className="op-list">
        {data.requests.map((r) => {
          const step = data.requestSteps[r.step - 1];
          const mine = data.canReview && r.request.state === 'arms_review';
          return (
            <li key={r.request.id} className="op-item" data-tone={mine ? 'warn' : undefined}>
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">{r.request.title}</span>
                  <span className="op-meta">
                    {r.request.ref} · {REQUEST_KIND[r.request.kind]} · raised by {r.request.raisedBy}
                    {r.request.needsLegal ? ' · needs legal check' : ''}
                  </span>
                  <span className="op-meta">{r.request.note}</span>
                  <span className="op-co">{r.companyName}</span>
                </div>
                <div className="op-side">
                  <Chip tone={mine ? 'warn' : 'info'}>
                    Step {r.step} of {data.requestSteps.length}
                  </Chip>
                  {r.daysLeft !== null && <Chip tone={r.daysLeft <= 2 ? 'crit' : 'warn'}>Due {dateLabel(r.request.dueBy!)}</Chip>}
                </div>
              </div>
              {r.police.moving && (
                <div className="op-chips">
                  {r.request.fromState && (
                    <span className="small">
                      {r.request.fromState} to {r.request.toState}
                    </span>
                  )}
                  <Chip tone={r.police.notice ? 'ok' : 'neutral'}>{r.police.notice ? `Police notice ${r.police.notice.ref}` : 'Police notice: to record'}</Chip>
                  {r.police.interstate && (
                    <Chip tone={r.police.approval ? 'ok' : 'neutral'}>{r.police.approval ? `Police approval ${r.police.approval.ref}` : 'Police approval: to record'}</Chip>
                  )}
                </div>
              )}
              <div className="op-main">
                <span className="small">
                  Now: <strong>{step.label}</strong> · with {step.owner}
                </span>
                <div className="op-ladder" aria-hidden>
                  {data.requestSteps.map((s, i) => (
                    <span key={s.id} title={s.label} data-on={i < r.step} />
                  ))}
                </div>
              </div>
              {r.request.state === 'draft' && <Resubmit id={r.request.id} label={r.request.ref} quantity={r.request.quantity ?? null} estCost={r.request.estCost ?? null} busy={busy} run={run} />}
              {r.request.state !== 'closed' && r.request.state !== 'draft' && (
                <StepActions
                  id={r.request.id}
                  label={r.request.ref}
                  state={r.request.state}
                  note={note[r.request.id] ?? ''}
                  onNote={(v) => setNote({ ...note, [r.request.id]: v })}
                  busy={busy}
                  run={run}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

type Step = ArmsControl['requests'][number]['request']['state'];
type StepAction = Parameters<typeof api.armsRequestStep>[1];

/**
 * The buttons for the step a request is at. Anyone who sees the request sees them; the server decides who may press
 * (Arms Control reviews, the licensed company authorises, Legal clears, the COO or CEO approves spend, someone other
 * than the requester verifies). Every decision takes a reason.
 */
const STEP_ACTIONS: Partial<Record<Step, { action: StepAction; label: string; primary?: boolean; needsReason?: boolean; police?: boolean }[]>> = {
  submitted: [
    { action: 'pass', label: 'Pass to company', primary: true, needsReason: true },
    { action: 'return', label: 'Send back', needsReason: true },
  ],
  arms_review: [
    { action: 'pass', label: 'Pass to company', primary: true, needsReason: true },
    { action: 'return', label: 'Send back', needsReason: true },
  ],
  company_auth: [
    { action: 'authorise', label: 'Authorise', primary: true, needsReason: true },
    { action: 'refuse', label: 'Refuse', needsReason: true },
  ],
  legal_check: [
    { action: 'legal_ok', label: 'Legal: clear', primary: true, needsReason: true },
    { action: 'legal_stop', label: 'Legal: stop', needsReason: true },
  ],
  regulator_pending: [
    { action: 'police', label: 'Record PDRM / KDN reference', primary: true, police: true },
    { action: 'spend', label: 'Approve the spend', needsReason: true },
  ],
  approved: [{ action: 'verify', label: 'Verify (not the requester)', primary: true, needsReason: true }],
  verified: [{ action: 'reconcile', label: 'Reconcile the register', primary: true }],
  reconciled: [{ action: 'close', label: 'Close', primary: true }],
};

export function StepActions(props: { id: string; label: string; state: Step; note: string; onNote: (v: string) => void; busy: boolean; run: ReturnType<typeof useAction>['run'] }) {
  const { id, label, state, note, onNote, busy, run } = props;
  const actions = STEP_ACTIONS[state] ?? [];
  if (!actions.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="op-act">
      <input
        className="input"
        aria-label={`Reason or reference for ${label}`}
        placeholder={actions.some((a) => a.police) ? 'Reason, or the PDRM / KDN reference' : 'Reason (needed for a decision)'}
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
      {actions.map((a) => (
        <button
          key={a.action}
          className={`btn btn-sm${a.primary ? ' btn-primary' : ''}`}
          disabled={busy || ((a.needsReason || a.police) && note.trim().length < 3)}
          onClick={() =>
            run(
              () => api.armsRequestStep(id, a.action, a.police ? '' : note, a.police ? { policeApproval: { ref: note.trim(), on: today } } : {}),
              `${label}: ${a.label.toLowerCase()} recorded`,
            )
          }
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** A request Arms Control sent back: the requester corrects it and sends it again, saying what changed. */
export function Resubmit(props: { id: string; label: string; quantity: number | null; estCost: number | null; busy: boolean; run: ReturnType<typeof useAction>['run'] }) {
  const { id, label, busy, run } = props;
  const [why, setWhy] = useState('');
  const [qty, setQty] = useState(props.quantity == null ? '' : String(props.quantity));
  const [cost, setCost] = useState(props.estCost == null ? '' : String(props.estCost));
  const changes = {
    ...(qty !== (props.quantity == null ? '' : String(props.quantity)) ? { quantity: qty === '' ? null : Number(qty) } : {}),
    ...(cost !== (props.estCost == null ? '' : String(props.estCost)) ? { estCost: cost === '' ? null : Number(cost) } : {}),
  };
  return (
    <div className="op-main">
      <span className="small op-warn">Sent back for correction.</span>
      <div className="op-act">
        <input className="input op-narrow" type="number" min={1} aria-label={`Quantity for ${label}`} placeholder="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input className="input op-narrow" type="number" min={0} aria-label={`Cost for ${label}`} placeholder="Cost RM" value={cost} onChange={(e) => setCost(e.target.value)} />
        <input className="input" aria-label={`What was corrected on ${label}`} placeholder="What you corrected" value={why} onChange={(e) => setWhy(e.target.value)} />
        <button className="btn btn-sm btn-primary" disabled={busy || why.trim().length < 3} onClick={() => run(() => api.armsRequestStep(id, 'resubmit', why, { changes }), `${label} sent again to Arms Control`)}>
          Correct and resubmit
        </button>
      </div>
    </div>
  );
}

/**
 * Legal points for the directors only (Fauzan, 2 Nov 2026). Staff screens show the task; here each open point has its
 * source, the records it touches, the responsible director, its status and history. Open is never shown as compliant.
 */
function LegalFlags() {
  const { data, error } = useLoad(() => api.specialOpsLegalFlags(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="legal points" />;
  return (
    <Card title="Legal points for the directors" sub={`${data.totals.open} open. Seen only by the group directors; staff screens show the task without legal notices.`} flush>
      {data.rows.length === 0 && <Empty title="No open legal points from Special Ops." />}
      <ul className="op-list">
        {data.rows.map((f) => (
          <li key={f.id} className="op-item" data-tone="warn">
            <div className="op-line">
              <span className="op-title">{f.title}</span>
              <Chip tone="warn">Open, not verified</Chip>
            </div>
            <div className="op-main">
              <span className="op-meta">
                {f.companyName} · since {dateLabel(f.since)} · responsible: {f.responsible}
                {f.responsibleAssumed ? ' (assumed, to confirm)' : ''}
              </span>
              <span className="small">Source: {f.source}</span>
              <span className="small">Records: {f.records.map((r) => r.label).join('; ')}</span>
              <span className="small">{f.detail}</span>
            </div>
            {f.history.length > 0 && (
              <details className="ar-history">
                <summary>History ({f.history.length})</summary>
                <ul>
                  {f.history.map((h, i) => (
                    <li key={i}>
                      {h.at.slice(0, 16).replace('T', ' ')} · {h.actor}: {h.summary}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Arms trading and import (4H): built, off until the CEO switches it on with an approved dealer licence. */
function Trading() {
  const { data, error, reload } = useLoad(() => api.armsTrading(), []);
  const [reason, setReason] = useState('');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="arms trading" />;
  return (
    <Card title="Arms trading and import" actions={<Chip tone={data.on ? 'warn' : 'neutral'}>{data.on ? 'On' : 'Off'}</Chip>}>
      <div className="op-form">
        <p className="op-note">
          Buying and selling trade stock and importing (Port Klang or KLIA, after the CPO, with KDN papers) are built but stay off until the CEO switches them on. While off, every trading
          request is refused and the refusal is logged.
        </p>
        {data.by && (
          <span className="small">
            Last switched by {data.by}
            {data.at ? ` on ${dateLabel(data.at.slice(0, 10))}` : ''}: {data.reason}
          </span>
        )}
        <ErrorNotice error={act.error} />
        {data.canSwitch && (
          <div className="op-act">
            <input className="input" aria-label="Reason" placeholder="Reason, for example the dealer licence reference" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || reason.trim().length < 5}
              onClick={() => act.run(() => api.setArmsTrading(!data.on, reason).then(() => { setReason(''); reload(); }), data.on ? 'Arms trading switched off' : 'Arms trading switched on')}
            >
              {data.on ? 'Switch off' : 'Switch on'}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

const SETUP_STEP: Record<ArmsControl['agreements'][number]['setupStep'], { label: string; tone: Tone }> = {
  notify: { label: 'Police not notified', tone: 'crit' },
  install: { label: 'Site vault to install', tone: 'warn' },
  approval: { label: 'Waiting police approval', tone: 'warn' },
  live: { label: 'Police notified, live', tone: 'ok' },
};

const AGREEMENT_STATE: Record<ArmsControl['agreements'][number]['state'], { label: string; tone: Tone }> = {
  signed: { label: 'Signed', tone: 'ok' },
  unsigned: { label: 'Not signed', tone: 'crit' },
  expired: { label: 'Expired', tone: 'crit' },
  missing: { label: 'None', tone: 'crit' },
};

/** Client arms agreements and armed-service insurance for every armed site and armed job (V14 s.212, s.224). */
function Agreements({ data }: { data: ArmsControl }) {
  return (
    <Card
      title="Client arms agreements"
      sub="Set-up: notify the police once, install the site vault if used, get police approval, then go live. Plus a signed agreement and current insurance."
      actions={<RecordButton kind="armsAgreement" label="Add arms agreement" />}
      flush
    >
      <ul className="op-list">
        {data.sitesWithoutAgreement.map((x) => (
          <li key={x.site.id} className="op-item" data-tone="crit">
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">{x.site.name}</span>
                <span className="op-meta">{x.site.client} · armed site with no arms agreement on file</span>
                <span className="op-co">{x.companyName}</span>
              </div>
              <div className="op-chips">
                <Chip tone="crit">No agreement</Chip>
                <RecordButton kind="armsAgreement" companyId={x.site.companyId} label="Add" />
              </div>
            </div>
          </li>
        ))}
        {data.agreements.map((a) => (
          <li key={a.agreement.id} className="op-item">
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">
                  {a.siteName ?? a.agreement.siteName ?? `${a.agreement.client} · ${a.agreement.jobKind ? JOB_LABEL[a.agreement.jobKind] : 'Armed job'}`}
                </span>
                <span className="op-meta">
                  {a.agreement.client} · {a.agreement.armedPosts} armed {a.agreement.siteId ? 'posts' : 'crew'}
                  {a.agreement.endsOn ? ` · to ${dateLabel(a.agreement.endsOn)}` : ''}
                </span>
                <span className="op-meta">
                  Insurance {a.agreement.insurer ?? 'not recorded'}
                  {a.agreement.policyRef ? ` · ${a.agreement.policyRef}` : ''}
                  {a.agreement.insuranceExpiresOn ? ` · to ${dateLabel(a.agreement.insuranceExpiresOn)}` : ''}
                </span>
                <span className="op-co">{a.companyName}</span>
              </div>
              <div className="op-side">
                <Chip tone={AGREEMENT_STATE[a.state].tone}>{AGREEMENT_STATE[a.state].label}</Chip>
                <Chip tone={SETUP_STEP[a.setupStep].tone}>{SETUP_STEP[a.setupStep].label}</Chip>
                {a.insurance.status !== 'OK' && (
                  <Chip tone={a.insurance.status === 'OVERDUE' ? 'crit' : a.insurance.status === 'UNKNOWN' ? 'neutral' : 'warn'}>
                    {a.insurance.status === 'UNKNOWN'
                      ? 'Insurance unknown'
                      : a.insurance.status === 'OVERDUE'
                        ? 'Insurance expired'
                        : `Insurance ${a.insurance.daysLeft} days`}
                  </Chip>
                )}
                <RecordButton kind="armsAgreement" id={a.agreement.id} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Police and KDN tasks. The company files; Arms Control makes sure it happens. Legal citations stay in the directors' view. */
function Police({ data }: { data: ArmsControl }) {
  const p = data.police;
  return (
    <>
      <div className="op-grid-2">
        <Card title="Police reports for missing firearms" sub={`Report within ${p.reportDays} days of finding out, at the nearest police station`} flush>
          {p.reports.length === 0 && <Empty title="No firearm is missing." />}
          <ul className="op-list">
            {p.reports.map((r) => (
              <li key={r.firearm.id} className="op-item" data-tone={r.report ? undefined : 'crit'}>
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">
                      <span className="mono">{r.firearm.tag}</span> · {r.firearm.kind}
                    </span>
                    <span className="op-meta">
                      Missing since {dateLabel(r.missingSince.slice(0, 10))} {hhmm(r.missingSince)}
                      {r.report ? ` · reported ${r.report.ref} on ${dateLabel(r.report.on)}` : ` · report by ${dateLabel(r.dueBy)}`}
                    </span>
                    <span className="op-co">{r.companyName}</span>
                  </div>
                  <Chip tone={r.report ? 'ok' : r.daysLeft <= 4 ? 'crit' : 'warn'}>
                    {r.report ? 'Reported' : r.daysLeft < 0 ? `${-r.daysLeft} days late` : `${r.daysLeft} days left`}
                  </Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Firearms to deposit with the police" sub="Licence expired or revoked: deposit without delay" flush>
          {p.deposits.length === 0 && <Empty title="Every firearm has a current licence." />}
          <ul className="op-list">
            {p.deposits.map((d) => (
              <li key={d.firearm.id} className="op-item" data-tone={d.deposited ? undefined : 'crit'}>
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">
                      <span className="mono">{d.firearm.tag}</span> · licence {d.firearm.licenceRef}
                    </span>
                    <span className="op-meta">
                      Expired {dateLabel(d.expiredOn)}
                      {d.deposited ? ` · deposited at ${d.deposited.station} on ${dateLabel(d.deposited.on)}` : ' · still in the company vault'}
                    </span>
                    <span className="op-co">{d.companyName}</span>
                  </div>
                  <Chip tone={d.deposited ? 'ok' : 'crit'}>{d.deposited ? 'Deposited' : 'Not deposited'}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Firearms out at once" sub="No limit on firearms per permit. Shown so Arms Control sees how many are out." flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Out now</th>
                <th className="num">Most at once, 24 h</th>
              </tr>
            </thead>
            <tbody>
              {p.outByCompany.map((r) => (
                <tr key={r.companyId}>
                  <td>{r.companyName}</td>
                  <td className="num">{r.outNow}</td>
                  <td className="num">{r.peak24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`Annual firearms return to KDN, ${p.year}`} sub="Number and type every year. Prepared here; the company checks and files it." flush>
        <div className="table-wrap">
          <table className="op-sticky-first">
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Shotgun</th>
                <th className="num">Revolver</th>
                <th className="num">Pistol</th>
                <th className="num hide-sm">Trade stock</th>
                <th className="num hide-sm">Missing</th>
                <th className="num hide-sm">Permit holders</th>
                <th className="num hide-sm">Rounds (ledger)</th>
              </tr>
            </thead>
            <tbody>
              {p.kdnReturn.map((r) => (
                <tr key={r.companyId}>
                  <td>{r.companyName}</td>
                  <td className="num">{r.shotgun}</td>
                  <td className="num">{r.revolver}</td>
                  <td className="num">{r.pistol}</td>
                  <td className="num hide-sm">{r.trade}</td>
                  <td className="num hide-sm op-num" data-tone={r.lostOrUnverified ? 'crit' : undefined}>
                    {r.lostOrUnverified}
                  </td>
                  <td className="num hide-sm">{r.permitHolders}</td>
                  <td className="num hide-sm">{r.ammo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
