import { api, type ArmsControl } from '../api';
import { useApp } from '../App';
import { useState } from 'react';
import { RecordButton } from './RecordForm';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, hhmm, useAction, useLoad, type Tone } from '../ui';

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
  | 'companies';

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
  { id: 'companies', label: 'Companies' },
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
      <div className="kpis">
        <Kpi
          label="Not cleared for armed duty"
          value={t.notReady}
          tone={t.notReady ? 'crit' : 'ok'}
          note={`${t.armedShiftsToday} armed duties, next 24 hours`}
        />
        <Kpi label="Firearms out now" value={t.out} tone={t.overdue ? 'crit' : 'ok'} note={t.overdue ? `${t.overdue} overdue` : 'All on time'} />
        <Kpi
          label="Armed jobs running"
          value={t.jobsActive}
          tone={t.jobsProblem ? 'warn' : 'ok'}
          note={t.jobsProblem ? `${t.jobsProblem} delayed or incident` : 'Bodyguard, CIT, CDM, vault'}
        />
        <Kpi
          label="Renewals due"
          value={t.renewalsDue}
          tone={t.renewalsOverdue ? 'crit' : t.renewalsDue ? 'warn' : 'ok'}
          note={t.renewalsOverdue ? `${t.renewalsOverdue} expired` : 'Licences, permits, vaults'}
        />
        <Kpi
          label="Servicing due"
          value={t.serviceDue}
          tone={t.serviceOverdue ? 'crit' : t.serviceDue ? 'warn' : 'ok'}
          note={t.serviceOverdue ? `${t.serviceOverdue} overdue` : 'Armourer service'}
        />
        <Kpi label="Vault exceptions" value={t.vaultExceptions} tone={t.vaultExceptions ? 'crit' : 'ok'} note="CCTV, recorder, alarm, door" />
        <Kpi label="Ammunition exceptions" value={t.ammoExceptions} tone={t.ammoExceptions ? 'crit' : 'ok'} note="Counts and rounds returned" />
        <Kpi label="CMS gaps now" value={t.cmsGapsNow} tone={t.cmsGapsNow ? 'crit' : 'ok'} note={`${t.cmsWeekGaps} shifts uncovered this week`} />
      </div>
      <div className="tabbar" role="tablist" aria-label="Arms control sections">
        {ARMS_TABS.map((x) => (
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
      {tab === 'requests' && <Requests data={data} />}
      {tab === 'renewals' && <Renewals data={data} />}
      {tab === 'clients' && <Agreements data={data} />}
      {tab === 'police' && <Police data={data} />}
      {tab === 'tenders' && <Tenders data={data} />}
      {tab === 'suppliers' && <Suppliers data={data} />}
    </>
  );
}

function Alerts({ data }: { data: ArmsControl }) {
  const { setCompanyId } = useApp();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>CMS arms alerts</h2>
        <span className="muted small">What the CMS arms desk is watching now</span>
      </div>
      <div className="list">
        {data.alerts.length === 0 && <div className="empty">No arms alerts.</div>}
        {data.alerts.map((a, i) => (
          <button key={i} className="list-item" onClick={() => setCompanyId(a.companyId)}>
            <div>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="muted small">{a.detail}</div>
              <div className="small">{a.companyName}</div>
            </div>
            <Chip tone={a.tone}>{a.kind}</Chip>
          </button>
        ))}
      </div>
    </section>
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
      <section className="panel">
        <div className="panel-head">
          <h2>Vaults, as CMS control sees them</h2>
          <span className="muted small">Day and night watch check in at least every {data.vaultCheckMin} minutes</span>
          <RecordButton kind="vault" label="Add vault" />
        </div>
        <div className="list">
          {data.vaults.map((v) => {
            const police = v.vault.kind === 'POLICE_STATION';
            const w = police ? { label: 'Kept by police', tone: 'neutral' as Tone } : WATCH_STATE[v.watchState];
            const c = v.current;
            return (
              <div key={v.vault.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{v.vault.name}</div>
                    <div className="muted small">{STORAGE_LABEL[v.vault.kind ?? 'COMPANY_ARMOURY']}</div>
                    {v.vault.authorisedUsers && <div className="muted small">Authorised: {v.vault.authorisedUsers.join(', ')}</div>}
                    <div className="small">{v.companyName}</div>
                    <div style={{ marginTop: 4 }}>
                      <RecordButton kind="vault" id={v.vault.id} label="Edit vault" />
                    </div>
                  </div>
                  <Chip tone={w.tone}>{w.label}</Chip>
                </div>
                <div className="muted small">
                  A licence: {v.vault.aLicenceHolder ?? 'not recorded'}
                  {v.vault.aLicenceRole ? ` (${v.vault.aLicenceRole.replace(/^A licence holder, /, '')})` : ''} · Amra: {v.vault.custodian}
                  {v.vault.custodianRole ? ` (${v.vault.custodianRole.replace(/^Amra, /, '')})` : ''}
                </div>
                <div className="muted small">
                  {v.inVault} in vault · {v.out} out now · today {v.outToday} out, {v.inToday} back · last count{' '}
                  {v.vault.lastCountAt ? hhmm(v.vault.lastCountAt) : 'never'}
                  {v.vault.lastCountOk === false ? ' (difference)' : ''}
                </div>
                {v.vault.kind !== 'POLICE_STATION' && (
                  <div className="muted small">
                    Register book and online register:{' '}
                    {v.vault.registerCheckedAt
                      ? `checked ${dateLabel(v.vault.registerCheckedAt.slice(0, 10))} ${hhmm(v.vault.registerCheckedAt)}`
                      : 'never checked'}
                  </div>
                )}
                <div className="muted small">
                  {c
                    ? `${c.shift === 'day' ? 'Day' : 'Night'} watch ${hhmm(c.start)}–${hhmm(c.end)}: ${c.watcher ?? 'nobody'}${c.clockIn ? `, in ${hhmm(c.clockIn)}` : ''}${c.lastCheckAt ? `, last check ${hhmm(c.lastCheckAt)}` : ''}`
                    : 'No watch now'}
                  {v.next ? ` · next ${v.next.shift} watch ${hhmm(v.next.start)}: ${v.next.watcher ?? 'nobody rostered'}` : ''}
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
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
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Vault door events, last 24 hours</h2>
          <span className="muted small">Each opening should match an issue, return or count within {data.doorMatchMin} minutes</span>
        </div>
        <div className="list">
          {data.doors.length === 0 && <div className="empty">No door events from the vault access systems.</div>}
          {data.doors.map((d) => (
            <div key={d.event.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {d.vaultName}: {d.event.kind === 'DOOR_FORCED' ? 'door forced' : d.event.kind === 'ACCESS_DENIED' ? 'access refused' : 'door opened'}
                </div>
                <div className="muted small">{d.event.by ?? 'Person not identified'}</div>
                <div className="small">{d.companyName}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="mono small">{hhmm(d.event.at)}</span>
                <Chip tone={d.matched ? 'ok' : d.event.kind === 'ACCESS_DENIED' ? 'warn' : 'crit'}>
                  {d.matched ? 'Matches a movement' : 'No matching record'}
                </Chip>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Log({ data }: { data: ArmsControl }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Firearms in and out, last 24 hours</h2>
        <span className="muted small">All companies, newest first</span>
      </div>
      <div className="list">
        {data.log.length === 0 && <div className="empty">No movements in the last 24 hours.</div>}
        {data.log.map((l, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                <span className="mono">{l.tag}</span> {l.dir === 'out' ? 'out to' : 'back from'} {l.person}
              </div>
              <div className="muted small">
                {l.place} · witness {l.witness || 'none'}
              </div>
              <div className="small">{l.companyName}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className="mono small">{hhmm(l.at)}</span>
              {l.dir === 'out' ? (
                <Chip tone={l.state === 'out' || l.state === 'returned' ? 'info' : 'crit'}>
                  {l.state === 'returned' ? 'Out, back' : l.state === 'out' ? 'Out' : 'Overdue'}
                </Chip>
              ) : (
                <Chip tone="ok">In</Chip>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Jobs({ data }: { data: ArmsControl }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Armed jobs, today and next 24 hours</h2>
        <span className="muted small">Close protection, cash-in-transit, cash deposit machines, cash vaulting</span>
      </div>
      <div className="list">
        {data.jobs.length === 0 && <div className="empty">No armed jobs.</div>}
        {data.jobs.map(({ job, companyName, crew, firearms, police }) => (
          <div key={job.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {JOB_LABEL[job.kind]} · {job.client}
              </div>
              <div className="muted small">
                {job.ref} · {hhmm(job.start)}–{hhmm(job.end)} · {job.detail}
              </div>
              <div className="muted small">
                Crew {crew.join(', ') || 'not named'} · firearms {firearms.join(', ') || 'none out'}
                {job.vehicle ? ` · ${job.vehicle}` : ''}
              </div>
              <div className="small">
                {companyName} · {job.lastUpdate} ({hhmm(job.lastUpdateAt)})
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <Chip tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Chip>
              <Chip tone={police.notice ? 'ok' : job.status === 'completed' ? 'neutral' : 'crit'}>
                {police.notice ? 'Police notified' : 'Police not notified'}
              </Chip>
              {police.needsApproval && (
                <Chip tone={police.approval ? 'ok' : job.status === 'completed' ? 'neutral' : 'crit'}>
                  {police.approval ? `Approved to ${police.away.join(', ')}` : `No approval for ${police.away.join(', ')}`}
                </Chip>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Renewals({ data }: { data: ArmsControl }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Renewals and servicing</h2>
        <span className="muted small">Firearm licences expire 30 June (Arms Act s.4). Unknown is never counted as fine.</span>
      </div>
      <div className="list">
        {data.renewals.length === 0 && <div className="empty">Nothing due.</div>}
        {data.renewals.map((r, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{r.what}</div>
              <div className="muted small">{r.item}</div>
              <div className="small">{r.companyName}</div>
            </div>
            <Chip tone={r.tone}>
              {r.due === null ? 'No record' : (r.daysLeft ?? 0) < 0 ? `${-(r.daysLeft ?? 0)} days late` : `${r.daysLeft} days · ${dateLabel(r.due)}`}
            </Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

function TenderList({ rows, empty }: { rows: ArmsControl['tenders']; empty: string }) {
  return (
    <div className="list">
      {rows.length === 0 && <div className="empty">{empty}</div>}
      {rows.map((t) => {
        const blocked = t.findings.filter((f) => f.level === 'block');
        const supply = t.tender.kind === 'ARMS_SUPPLY';
        return (
          <div key={t.tender.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{t.tender.title}</div>
              <div className="muted small">
                {t.tender.ref} · {t.tender.buyer}
                {supply ? '' : ` · ${t.tender.guards} guards`} · closes {dateLabel(t.tender.closesOn)}
              </div>
              {!supply && (
                <div className="muted small">
                  Company holds {t.firearmsHeld} firearms and {t.permitHolders} guards with a valid firearm permit
                </div>
              )}
              {blocked.length > 0 && (
                <div className="small" style={{ color: 'var(--crit)' }}>
                  {blocked.map((f) => f.message).join(' ')}
                </div>
              )}
              <div className="small">{t.companyName}</div>
            </div>
            <Chip tone={blocked.length ? 'crit' : t.tender.status === 'submitted' ? 'ok' : t.daysLeft <= 7 ? 'warn' : 'neutral'}>
              {t.tender.status === 'submitted' ? 'Submitted' : `${t.daysLeft} days left`}
            </Chip>
          </div>
        );
      })}
    </div>
  );
}

function Tenders({ data }: { data: ArmsControl }) {
  const supply = data.tenders.filter((t) => t.tender.kind === 'ARMS_SUPPLY');
  const guarding = data.tenders.filter((t) => t.tender.kind !== 'ARMS_SUPPLY');
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Tenders to supply arms-related items</h2>
          <span className="muted small">Bid under an arms dealer licence, priced from the supplier catalogue</span>
        </div>
        <TenderList rows={supply} empty="No supply tenders open." />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Guarding tenders that need arms</h2>
          <span className="muted small">Only armed work is shown. The company bids in its own name.</span>
        </div>
        <TenderList rows={guarding} empty="No armed guarding tenders open." />
      </section>
    </>
  );
}

function Suppliers({ data }: { data: ArmsControl }) {
  const d = data.dealer;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Arms dealer licence</h2>
          <Chip tone={d.rows.some((r) => r.licence.status === 'approved') ? 'ok' : 'warn'}>
            {d.rows.filter((r) => r.licence.status === 'approved').length} of {d.target} companies licensed
          </Chip>
        </div>
        <div className="panel-body">
          <p className="small" style={{ marginTop: 0 }}>
            {d.target} licensed security companies will hold a licence to buy and sell arms, and keep trade stock in their own vault to save on vaulting. Trade
            stock is registered apart from operational firearms and is never issued to a guard.
          </p>
          {d.rows.length === 0 ? (
            <div className="notice" data-tone="warn">
              The {d.target} companies are not chosen yet. Trade stock held: {d.tradeStockHeld}.
            </div>
          ) : (
            <div className="list">
              {d.rows.map((r) => (
                <div key={r.licence.id} className="list-item">
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.companyName}</div>
                    <div className="muted small">
                      {r.licence.reference ?? 'Not applied yet'} · {r.vault ? `vault ${r.vault}` : 'no vault on record yet'} · trade stock {r.tradeStock}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Chip tone={r.licence.status === 'approved' ? 'ok' : r.licence.status === 'refused' || r.licence.status === 'expired' ? 'crit' : 'warn'}>
                      {r.licence.status}
                    </Chip>
                    <RecordButton kind="dealerLicence" id={r.licence.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">
            To confirm with counsel and PDRM first: whether an armoury approved for a company's own firearms may also hold dealer stock (rule {d.rule.id},{' '}
            {d.rule.label}).
          </p>
          <RecordButton kind="dealerLicence" label="Add dealer licence" />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Suppliers and their items</h2>
          <span className="muted small">Specs and prices for every item from suppliers we have engaged</span>
          <div className="row" style={{ gap: 6 }}>
            <RecordButton kind="armsSupplier" label="Add supplier" />
            <RecordButton kind="supplierItem" label="Add item and price" />
          </div>
        </div>
        <div className="list">
          {data.suppliers.map(({ supplier, licence, items }) => (
            <div key={supplier.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{supplier.name}</div>
                  <div className="muted small">
                    {supplier.supplies.join(', ')} · {supplier.contact}
                    {supplier.lastOrderOn ? ` · last order ${dateLabel(supplier.lastOrderOn)}` : ''}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <RecordButton kind="armsSupplier" id={supplier.id} label="Edit supplier" />
                  </div>
                </div>
                <Chip tone={licence.status === 'OK' ? 'ok' : licence.status === 'OVERDUE' ? 'crit' : licence.status === 'UNKNOWN' ? 'neutral' : 'warn'}>
                  {licence.status === 'UNKNOWN'
                    ? 'Licence not on file'
                    : licence.status === 'OK'
                      ? 'Licence valid'
                      : licence.status === 'OVERDUE'
                        ? 'Licence expired'
                        : `Licence ${licence.daysLeft} days`}
                </Chip>
              </div>
              {items.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Item and spec</th>
                        <th className="num">Price (RM)</th>
                        <th className="hide-sm">Lead time</th>
                        <th>Price valid</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(({ item, priceStatus }) => (
                        <tr key={item.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{item.name}</div>
                            <div className="muted small">{item.spec}</div>
                          </td>
                          <td className="num">
                            {item.unitPrice.toLocaleString('en-MY')}
                            <div className="muted small">{item.unit}</div>
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
            </div>
          ))}
        </div>
      </section>
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
    <section className="panel">
      <div className="panel-head">
        <h2>Armed-duty readiness, now and next 24 hours</h2>
        <span className="muted small">Company licence, guard permit, range practice, client agreement, insurance, vault approval</span>
      </div>
      <div className="list">
        {rows.length === 0 && <div className="empty">No armed shifts or armed jobs in the next 24 hours.</div>}
        {rows.map((r) => (
          <div key={r.duty.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.person} · {r.siteName}
                </div>
                <div className="muted small">
                  {hhmm(r.duty.start)}–{hhmm(r.duty.end)}
                  {r.issued ? ` · firearm ${r.issued} issued` : ''}
                </div>
                <div className="small">{r.companyName}</div>
              </div>
              <Chip tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Chip>
            </div>
            {r.verdict !== 'go' && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {r.checks
                  .filter((c) => c.state !== 'ok')
                  .map((c) => (
                    <Chip key={c.label} tone={c.state === 'block' ? 'crit' : 'neutral'}>
                      {c.label}: {c.detail}
                    </Chip>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Ammunition ledger against the last physical count; differences are never adjusted silently (V14 s.208). */
function Ammo({ data }: { data: ArmsControl }) {
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Ammunition by vault</h2>
          <span className="muted small">Ledger against the last count. A difference opens a case; nobody edits the ledger to match.</span>
        </div>
        <div className="table-wrap">
          <table>
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
                    <div style={{ fontWeight: 600 }}>{a.vaultName}</div>
                    <div className="muted small">{a.stock.countedAt ? `Counted ${hhmm(a.stock.countedAt)}` : 'Never counted'}</div>
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
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Rounds not returned</h2>
          <span className="muted small">Returns with fewer rounds than issued and no case opened</span>
        </div>
        <div className="list">
          {data.roundsShort.length === 0 && <div className="empty">Every return matched the rounds issued.</div>}
          {data.roundsShort.map((r) => (
            <div key={r.movement.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  <span className="mono">{r.tag}</span> · {r.person}
                </div>
                <div className="muted small">
                  Issued {r.movement.rounds}, returned {r.movement.roundsReturned} at {hhmm(r.movement.returnedAt!)}
                </div>
                <div className="small">{r.companyName}</div>
              </div>
              <Chip tone="crit">{r.movement.rounds - (r.movement.roundsReturned ?? 0)} short</Chip>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const REQUEST_KIND: Record<ArmsControl['requests'][number]['request']['kind'], string> = {
  ACQUIRE: 'Buy',
  MOVE: 'Move',
  TRANSFER: 'Transfer between companies',
  SERVICE: 'Service',
  DISPOSE: 'Dispose',
  LOSS_REPORT: 'Loss report',
};

/** Arms requests on the ten-step path (V14 s.223). Arms Control reviews; the licensed company authorises. */
function Requests({ data }: { data: ArmsControl }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Arms requests</h2>
        <span className="muted small">Ten steps from draft to closed. Arms Control reviews; the company with the A licence authorises.</span>
      </div>
      <ErrorNotice error={error} />
      <div className="list">
        {data.requests.length === 0 && <div className="empty">No open requests.</div>}
        {data.requests.map((r) => {
          const step = data.requestSteps[r.step - 1];
          const mine = data.canReview && r.request.state === 'arms_review';
          return (
            <div key={r.request.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.request.title}</div>
                  <div className="muted small">
                    {r.request.ref} · {REQUEST_KIND[r.request.kind]} · raised by {r.request.raisedBy}
                    {r.request.needsLegal ? ' · needs legal check' : ''}
                  </div>
                  <div className="muted small">{r.request.note}</div>
                  {r.police.moving && (
                    <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {r.request.fromState && (
                        <span className="small">
                          {r.request.fromState} to {r.request.toState}
                        </span>
                      )}
                      <Chip tone={r.police.notice ? 'ok' : 'warn'}>
                        {r.police.notice ? `Police notified ${r.police.notice.ref}` : 'Police notice needed before moving'}
                      </Chip>
                      {r.police.interstate && (
                        <Chip tone={r.police.approval ? 'ok' : 'warn'}>
                          {r.police.approval ? `Police approval ${r.police.approval.ref}` : 'Police approval needed: another state'}
                        </Chip>
                      )}
                    </div>
                  )}
                  <div className="small">{r.companyName}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <Chip tone={mine ? 'warn' : 'info'}>
                    Step {r.step} of {data.requestSteps.length}
                  </Chip>
                  {r.daysLeft !== null && <Chip tone={r.daysLeft <= 2 ? 'crit' : 'warn'}>Due {dateLabel(r.request.dueBy!)}</Chip>}
                </div>
              </div>
              <div className="small">
                Now: <strong>{step.label}</strong> · with {step.owner}
              </div>
              <div style={{ display: 'flex', gap: 2 }} aria-hidden>
                {data.requestSteps.map((s, i) => (
                  <span key={s.id} title={s.label} style={{ flex: 1, height: 4, borderRadius: 2, background: i < r.step ? 'var(--accent)' : 'var(--line)' }} />
                ))}
              </div>
              {mine && (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    aria-label={`Note on ${r.request.ref}`}
                    placeholder="Note (needed to send back)"
                    value={note[r.request.id] ?? ''}
                    onChange={(e) => setNote({ ...note, [r.request.id]: e.target.value })}
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={() => run(() => api.reviewArmsRequest(r.request.id, 'pass', note[r.request.id] ?? ''), `${r.request.ref} passed to the company`)}
                  >
                    Pass to company
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy || !(note[r.request.id] ?? '').trim()}
                    onClick={() => run(() => api.reviewArmsRequest(r.request.id, 'return', note[r.request.id] ?? ''), `${r.request.ref} sent back`)}
                  >
                    Send back
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
    <section className="panel">
      <div className="panel-head">
        <h2>Client arms agreements</h2>
        <span className="muted small">
          Set-up: notify the police once, install the site vault if used, get police approval, then go live. Plus a signed agreement and current insurance.
        </span>
        <RecordButton kind="armsAgreement" label="Add arms agreement" />
      </div>
      <div className="list">
        {data.sitesWithoutAgreement.map((x) => (
          <div key={x.site.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{x.site.name}</div>
              <div className="muted small">{x.site.client} · armed site with no arms agreement on file</div>
              <div className="small">{x.companyName}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone="crit">No agreement</Chip>
              <RecordButton kind="armsAgreement" companyId={x.site.companyId} label="Add" />
            </div>
          </div>
        ))}
        {data.agreements.map((a) => (
          <div key={a.agreement.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {a.siteName ?? a.agreement.siteName ?? `${a.agreement.client} · ${a.agreement.jobKind ? JOB_LABEL[a.agreement.jobKind] : 'Armed job'}`}
              </div>
              <div className="muted small">
                {a.agreement.client} · {a.agreement.armedPosts} armed {a.agreement.siteId ? 'posts' : 'crew'}
                {a.agreement.endsOn ? ` · to ${dateLabel(a.agreement.endsOn)}` : ''}
              </div>
              <div className="muted small">
                Insurance {a.agreement.insurer ?? 'not recorded'}
                {a.agreement.policyRef ? ` · ${a.agreement.policyRef}` : ''}
                {a.agreement.insuranceExpiresOn ? ` · to ${dateLabel(a.agreement.insuranceExpiresOn)}` : ''}
              </div>
              <div className="small">{a.companyName}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <Chip tone={AGREEMENT_STATE[a.state].tone}>{AGREEMENT_STATE[a.state].label}</Chip>
              <Chip tone={SETUP_STEP[a.setupStep].tone}>{SETUP_STEP[a.setupStep].label}</Chip>
              <RecordButton kind="armsAgreement" id={a.agreement.id} />
              {a.insurance.status !== 'OK' && (
                <Chip tone={a.insurance.status === 'OVERDUE' ? 'crit' : a.insurance.status === 'UNKNOWN' ? 'neutral' : 'warn'}>
                  {a.insurance.status === 'UNKNOWN'
                    ? 'Insurance unknown'
                    : a.insurance.status === 'OVERDUE'
                      ? 'Insurance expired'
                      : `Insurance ${a.insurance.daysLeft} days`}
                </Chip>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** What the police check first (Arms Act 1960, KDN Circular 1/2006). The company files; Arms Control makes sure it happens. */
function Police({ data }: { data: ArmsControl }) {
  const p = data.police;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Police reports for missing firearms</h2>
          <span className="muted small">Arms Act s.7(1): within {p.reportDays} days of finding out, at the nearest police station</span>
        </div>
        <div className="list">
          {p.reports.length === 0 && <div className="empty">No firearm is missing.</div>}
          {p.reports.map((r) => (
            <div key={r.firearm.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  <span className="mono">{r.firearm.tag}</span> · {r.firearm.kind}
                </div>
                <div className="muted small">
                  Missing since {dateLabel(r.missingSince.slice(0, 10))} {hhmm(r.missingSince)}
                  {r.report ? ` · reported ${r.report.ref} on ${dateLabel(r.report.on)}` : ` · report by ${dateLabel(r.dueBy)}`}
                </div>
                <div className="small">{r.companyName}</div>
              </div>
              <Chip tone={r.report ? 'ok' : r.daysLeft <= 4 ? 'crit' : 'warn'}>
                {r.report ? 'Reported' : r.daysLeft < 0 ? `${-r.daysLeft} days late` : `${r.daysLeft} days left`}
              </Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Firearms to deposit with the police</h2>
          <span className="muted small">Arms Act s.27(1): licence expired or revoked, deposit without unnecessary delay</span>
        </div>
        <div className="list">
          {p.deposits.length === 0 && <div className="empty">Every firearm has a current licence.</div>}
          {p.deposits.map((d) => (
            <div key={d.firearm.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  <span className="mono">{d.firearm.tag}</span> · licence {d.firearm.licenceRef}
                </div>
                <div className="muted small">
                  Expired {dateLabel(d.expiredOn)}
                  {d.deposited ? ` · deposited at ${d.deposited.station} on ${dateLabel(d.deposited.on)}` : ' · still in the company vault'}
                </div>
                <div className="small">{d.companyName}</div>
              </div>
              <Chip tone={d.deposited ? 'ok' : 'crit'}>{d.deposited ? 'Deposited' : 'Not deposited'}</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Firearms out at once</h2>
          <span className="muted small">No limit on firearms per permit. Shown so Arms Control sees how many are out.</span>
        </div>
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
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Annual firearms return to KDN, {p.year}</h2>
          <span className="muted small">KDN Circular 1/2006: number and type every year. Prepared here; the company checks and files it.</span>
        </div>
        <div className="table-wrap">
          <table>
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
                  <td className="num hide-sm" style={r.lostOrUnverified ? { color: 'var(--crit)', fontWeight: 600 } : undefined}>
                    {r.lostOrUnverified}
                  </td>
                  <td className="num hide-sm">{r.permitHolders}</td>
                  <td className="num hide-sm">{r.ammo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
