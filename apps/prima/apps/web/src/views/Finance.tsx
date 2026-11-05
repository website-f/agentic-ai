import { useState } from 'react';
import type { FinPackItem, FinPackStatus } from '@prima/core';
import { api, type FinBoard, type FinDesk } from '../api';
import { useApp } from '../App';
import { ManagementFeesPanel } from './ManagementFees';
import { takeFinTarget, type FinTarget } from '../finTarget';
import { CloseTab, FinPackPanel, PaymentsTab } from './FinanceDesk';
import { ChecksTab } from './FinanceChecks';
import { FinanceSettingsTab } from './FinanceSettings';
import { FinanceKpiTab } from './FinanceKpi';
import { FinanceDashboardTab } from './FinanceDashboard';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

/**
 * Finance (Fauzan, 27 Oct 2026). The Finance Director and 7 teams keep every company's books in SQL Account, which
 * stays. Prima does not keep accounts: it shows whether each company's books are complete, reconciled and closed, and
 * tracks the papers the teams prepare for the auditor and the tax agent. Figures are test data until SQL is connected.
 */

type Row = FinBoard['rows'][number];
type Tab = 'teams' | 'payments' | 'close' | 'checks' | 'banks' | 'books' | 'papers' | 'settings' | 'kpi' | 'dashboard';

const TONE: Record<Row['tone'], [Tone, string]> = {
  crit: ['crit', 'Act now'],
  unknown: ['unknown', 'Unknown'],
  warn: ['warn', 'To finish'],
  ok: ['ok', 'In order'],
};
const PACK: Record<FinPackStatus, [Tone, string]> = {
  todo: ['neutral', 'Not started'],
  prepared: ['warn', 'Prepared'],
  reviewed: ['info', 'Reviewed'],
  sent: ['ok', 'Sent'],
};
/** Data entry prepares, the deputy also reviews, the team leader and the Finance Director also send. */
const mayFor = (role: FinBoard['financeRole']): FinPackStatus[] =>
  role === 'leader' || role === 'director' ? ['prepared', 'reviewed', 'sent'] : role === 'deputy' ? ['prepared', 'reviewed'] : ['prepared'];
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FinanceView() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.finBoard(), []);
  // Phase 2 (31 Oct 2026): payments, the month-end close and the bank and payment packs.
  const { data: desk } = useLoad(() => api.finDesk(), []);
  // A home or Today item opens the right tab, section and company (staff-eye review, Fauzan 2 Nov 2026).
  const [target, setTarget] = useState<(FinTarget & { n: number }) | null>(() => {
    const t = takeFinTarget();
    return t ? { ...t, n: 0 } : null;
  });
  const [tab, setTab] = useState<Tab>(target?.tab ?? 'teams');
  const goTo = (t: FinTarget) => {
    setTarget((x) => ({ ...t, n: (x?.n ?? 0) + 1 }));
    setTab(t.tab);
  };
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="finance" />;
  const count = (t: Row['tone']) => data.rows.filter((r) => r.tone === t).length;
  const banksLate = data.rows.reduce((n, r) => n + r.banksLate.length, 0);
  const papersOverdue = data.rows.reduce((n, r) => n + r.packsOverdue.length, 0);
  const row = data.rows.find((r) => r.status.companyId === open) ?? null;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Finance{data.team ? `, Team ${data.team}` : ''}</h1>
        <p className="muted">
          The books stay in SQL Account. This shows whether each company's books are complete, reconciled and closed for {dateLabel(data.lastEnd)}, and the
          papers for the auditor and the tax agent. A company with no figures from SQL Account for {data.rule.staleHours} hours shows as unknown.
        </p>
        <p className="notice" data-tone="info">
          Test data: SQL Account is not connected yet.
        </p>
      </div>
      {desk && <FinanceToday onGo={goTo} />}
      {desk && <KeyNumbers onGo={() => setTab('dashboard')} />}
      <div className="kpis">
        <Kpi label="Companies to act on now" value={count('crit')} tone={count('crit') ? 'crit' : 'ok'} note={`of ${data.rows.length}`} />
        <Kpi label="Unknown" value={count('unknown')} tone={count('unknown') ? 'unknown' : 'ok'} note="No recent SQL figures, or tests not run" />
        <Kpi label="Bank accounts not reconciled" value={banksLate} tone={banksLate ? 'crit' : 'ok'} note={`Due by the ${data.rule.reconcileByDay}th`} />
        <Kpi label="Papers overdue" value={papersOverdue} tone={papersOverdue ? 'crit' : 'ok'} note="Auditor and tax agent" />
      </div>
      <div className="tabbar" role="tablist" aria-label="Finance">
        {(
          [
            ['teams', data.role === 'lead' ? 'Teams' : 'Companies'],
            ...(desk
              ? ([
                  ['dashboard', 'Dashboard'],
                  ['payments', 'Payments'],
                  ['close', 'Month-end close'],
                  ['checks', 'Checks'],
                  ['settings', 'Settings'],
                  ...(['director', 'ceo', 'leader'].includes(desk.actor.kind) ? ([['kpi', 'KPIs']] as [Tab, string][]) : []),
                ] as [Tab, string][])
              : []),
            ['banks', 'Bank reconciliation'],
            ['books', 'Closing and posting'],
            ['papers', 'Auditor and tax'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'teams' && <Teams data={data} onOpen={setOpen} />}
      {tab === 'payments' && desk && <PaymentsTab desk={desk} />}
      {tab === 'close' && desk && <CloseTab desk={desk} />}
      {tab === 'checks' && desk && <ChecksTab key={target?.n ?? 0} desk={desk} target={target} />}
      {tab === 'settings' && desk && <FinanceSettingsTab />}
      {tab === 'kpi' && desk && <FinanceKpiTab />}
      {tab === 'dashboard' && desk && <FinanceDashboardTab />}
      {tab === 'banks' && <Banks data={data} onOpen={setOpen} />}
      {tab === 'books' && <Books data={data} onOpen={setOpen} />}
      {tab === 'papers' && <Papers data={data} onOpen={setOpen} />}
      {(me.user.leadership === 'finance_director' || me.user.opsTier === 'ceo') && <ManagementFeesPanel />}
      {row && <CompanyDrawer row={row} desk={desk} may={mayFor(data.financeRole)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CompanyLine({ r, onOpen, detail }: { r: Row; onOpen: (id: string) => void; detail: string }) {
  return (
    <button className="list-item" style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }} onClick={() => onOpen(r.status.companyId)}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{r.companyName}</div>
        <div className="muted small">{detail}</div>
      </div>
      <Chip tone={TONE[r.tone][0]}>{TONE[r.tone][1]}</Chip>
    </button>
  );
}

function reasons(r: Row): string {
  const out: string[] = [];
  if (r.stale) out.push('no recent SQL figures');
  if (r.closeLate) out.push('month not closed');
  else if (r.closeBehind) out.push('month not closed yet');
  if (r.banksBehind.length) out.push(`${r.banksBehind.length} bank account${r.banksBehind.length === 1 ? '' : 's'} not reconciled`);
  if (r.testsFailed.length) out.push(`${r.testsFailed.map((t) => t.id).join(', ')} failing`);
  if (r.testsNotRun.length && !r.testsFailed.length) out.push('tests not run');
  if (r.gaps.length) out.push(`${r.gaps.length} posting gap${r.gaps.length === 1 ? '' : 's'}`);
  if (r.packsOverdue.length) out.push(`${r.packsOverdue.length} paper${r.packsOverdue.length === 1 ? '' : 's'} overdue`);
  else if (r.packsDue.length) out.push(`${r.packsDue.length} paper${r.packsDue.length === 1 ? '' : 's'} due soon`);
  return out.join(' · ') || 'Closed, reconciled and posted';
}

function Teams({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  return (
    <>
      {data.teams.map((t) => (
        <section key={t.team} className="panel">
          <div className="panel-head">
            <h3>Team {t.team}</h3>
            <span className="muted small">
              {t.leader ?? 'No leader set'} · {t.companies} companies
              {t.members.length > 1 ? ` · ${t.members.length} people` : ''}
            </span>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {t.crit > 0 && <Chip tone="crit">{t.crit} act now</Chip>}
            {t.unknown > 0 && <Chip tone="unknown">{t.unknown} unknown</Chip>}
            {t.warn > 0 && <Chip tone="warn">{t.warn} to finish</Chip>}
            {t.ok > 0 && <Chip tone="ok">{t.ok} in order</Chip>}
          </div>
          <div className="list">
            {data.rows
              .filter((r) => r.status.team === t.team)
              .map((r) => (
                <CompanyLine key={r.status.id} r={r} onOpen={onOpen} detail={reasons(r)} />
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

function Banks({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  const rows = data.rows.filter((r) => r.banksBehind.length);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Not reconciled to {dateLabel(data.lastEnd)}</h3>
        <span className="muted small">Reconcile in SQL Account by the {data.rule.reconcileByDay}th</span>
      </div>
      <div className="list">
        {rows.length === 0 && <div className="empty">Every bank account is reconciled.</div>}
        {rows.map((r) => (
          <CompanyLine
            key={r.status.id}
            r={r}
            onOpen={onOpen}
            detail={r.banksBehind
              .map(
                (b) =>
                  `${b.bank} ${b.accountMasked}: ${b.reconciledTo ? `reconciled to ${dateLabel(b.reconciledTo)}` : 'never reconciled'}, ${b.openItems} open items, difference ${rm(b.statementBalance - b.glBalance)}`,
              )
              .join(' · ')}
          />
        ))}
      </div>
    </section>
  );
}

function Books({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  const rows = data.rows.filter((r) => r.closeBehind || r.testsFailed.length || r.testsNotRun.length || r.gaps.length || r.stale);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Closing and posting for {dateLabel(data.lastEnd)}</h3>
        <span className="muted small">Close by the {data.rule.closeByDay}th · FS-01, FS-02 and FS-06 must be RM0.00</span>
      </div>
      <div className="list">
        {rows.length === 0 && <div className="empty">Every company is closed, posted and passes the tests.</div>}
        {rows.map((r) => (
          <CompanyLine
            key={r.status.id}
            r={r}
            onOpen={onOpen}
            detail={[
              r.stale ? `SQL figures ${r.status.sqlLastAt ? `last received ${dateTimeLabel(r.status.sqlLastAt)}` : 'never received'}` : '',
              r.closeBehind ? `closed to ${r.status.closedTo ? dateLabel(r.status.closedTo) : 'never'}` : '',
              ...r.testsFailed.map((t) => `${t.id} off by ${rm(t.diff ?? 0)}`),
              r.testsNotRun.length ? 'tests not run' : '',
              ...r.gaps,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </div>
    </section>
  );
}

function Papers({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  const items = data.rows
    .flatMap((r) => [...r.packsOverdue.map((i) => ({ r, i, late: true })), ...r.packsDue.map((i) => ({ r, i, late: false }))])
    .sort((a, b) => a.i.dueOn.localeCompare(b.i.dueOn));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Papers overdue or due within {data.rule.packWarnDays} days</h3>
        <span className="muted small">Data entry prepares, the leader or deputy reviews, the leader sends; reviewing and sending need a comment</span>
      </div>
      <div className="list">
        {items.length === 0 && <div className="empty">Nothing due.</div>}
        {items.map(({ r, i, late }) => (
          <button
            key={`${r.status.id}-${i.id}`}
            className="list-item"
            style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }}
            onClick={() => onOpen(r.status.companyId)}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{i.label}</div>
              <div className="muted small">
                {r.companyName} · Team {r.status.team} · {i.pack === 'audit' ? 'auditor' : 'tax agent'} · due {dateLabel(i.dueOn)}
              </div>
            </div>
            <Chip tone={late ? 'crit' : PACK[i.status][0]}>{late ? 'Overdue' : PACK[i.status][1]}</Chip>
          </button>
        ))}
      </div>
    </section>
  );
}

function CompanyDrawer({ row: r, desk, may, onClose }: { row: Row; desk: FinDesk | null; may: FinPackStatus[]; onClose: () => void }) {
  const f = r.status;
  const d = desk?.companies.find((c) => c.companyId === f.companyId) ?? null;
  const me = desk?.me ?? null;
  const p = f.posting;
  return (
    <Drawer title={r.companyName} sub={`Team ${f.team} · year ends ${f.fyEnd.split('-').reverse().join('/')}`} onClose={onClose}>
      <div className="kpis">
        <Kpi label="Closed to" value={f.closedTo ? dateLabel(f.closedTo) : 'Never'} tone={r.closeLate ? 'crit' : r.closeBehind ? 'warn' : 'ok'} />
        <Kpi label="SQL figures" value={f.sqlLastAt ? dateTimeLabel(f.sqlLastAt) : 'Never'} tone={r.stale ? 'unknown' : 'ok'} />
        <Kpi label="Customers over 90 days" value={rm(f.arOver90)} tone={f.arOver90 ? 'warn' : 'ok'} />
        <Kpi label="Suppliers overdue" value={rm(f.apOverdue)} tone={f.apOverdue ? 'warn' : 'ok'} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Bank accounts</h3>
        </div>
        <div className="list">
          {f.banks.map((b) => (
            <div key={b.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {b.bank} {b.accountMasked} · {b.purpose}
                </div>
                <div className="muted small">
                  Books {rm(b.glBalance)} · statement {rm(b.statementBalance)} · {b.openItems} open items
                </div>
              </div>
              <Chip tone={b.reconciledTo === r.lastEnd ? 'ok' : r.banksLate.some((x) => x.id === b.id) ? 'crit' : 'warn'}>
                {b.reconciledTo ? `To ${dateLabel(b.reconciledTo)}` : 'Never reconciled'}
              </Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Integrity tests</h3>
        </div>
        <div className="list">
          {f.tests.map((t) => (
            <div key={t.id} className="list-item">
              <span>
                {t.id} {t.label}
              </span>
              <Chip tone={t.diff == null ? 'unknown' : Math.abs(t.diff) < 0.005 ? 'ok' : 'crit'}>{t.diff == null ? 'Not run' : rm(t.diff)}</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Posted in SQL Account, {p.period}</h3>
        </div>
        <div className="list">
          <div className="list-item">
            <span>Sales invoices against billing</span>
            <span>
              {rm(p.billedPosted)} of {rm(p.billed)}
            </span>
          </div>
          <div className="list-item">
            <span>Staff payroll journal</span>
            <Chip tone={!p.staffPayPaid ? 'neutral' : p.staffPayPosted ? 'ok' : 'warn'}>
              {!p.staffPayPaid ? 'No staff pay' : p.staffPayPosted ? 'Posted' : 'Not posted'}
            </Chip>
          </div>
          <div className="list-item">
            <span>Guard payroll journal (JA app)</span>
            <Chip tone={!p.guardPayPaid ? 'neutral' : p.guardPayPosted ? 'ok' : 'warn'}>
              {!p.guardPayPaid ? 'No guard pay' : p.guardPayPosted ? 'Posted' : 'Not posted'}
            </Chip>
          </div>
          <div className="list-item">
            <span>Supplier bills not posted</span>
            <span>{p.supplierBillsUnposted}</span>
          </div>
        </div>
      </section>
      <FinPackPanel title="For the auditor" companyId={f.companyId} pack="audit" items={f.audit} canSet={r.canSet} may={may} meId={me} />
      <FinPackPanel title="For the tax agent" companyId={f.companyId} pack="tax" items={f.tax} canSet={r.canSet} may={may} meId={me} />
      {d && (
        <>
          <FinPackPanel title={`Bank pack, ${desk!.period}`} companyId={f.companyId} pack="bank" items={d.bank} canSet={d.canAct} may={may} meId={me} />
          <FinPackPanel title={`Payment pack, ${desk!.period}`} companyId={f.companyId} pack="payment" items={d.payment} canSet={d.canAct} may={may} meId={me} />
          <FinPackPanel title={`Monthly audit file, ${desk!.period}`} companyId={f.companyId} pack="monthly" items={d.monthly} canSet={d.canAct} may={may} meId={me} />
        </>
      )}
    </Drawer>
  );
}

/** Automation A13 (Fauzan, 2 Nov 2026): one list of what waits for this person today, urgent first. */
/** Key numbers for the companies the person sees (Fauzan, 2 Nov 2026: A17): from the dashboard, never a ranking. */
function KeyNumbers({ onGo }: { onGo: () => void }) {
  const { data } = useLoad(() => api.finDashboard().catch(() => null), []);
  if (!data || !data.rows.length) return null;
  const k = (n: number) => `RM${(n / 1000).toLocaleString('en-MY', { maximumFractionDigits: 0 })}k`;
  // No statement or ageing for the month is unknown, never zero.
  const cashUnknown = data.rows.filter((r) => r.cash == null).length;
  const ageUnknown = data.rows.filter((r) => r.over90 == null).length;
  const all = data.rows.length;
  return (
    <div className="kpis" role="button" tabIndex={0} onClick={onGo} onKeyDown={(e) => e.key === 'Enter' && onGo()} style={{ cursor: 'pointer' }}>
      <Kpi
        label="Cash in the banks"
        value={cashUnknown === all ? 'UNKNOWN' : k(data.totals.cash)}
        tone={cashUnknown === all ? 'unknown' : data.attention.shortOfCash ? 'warn' : 'ok'}
        note={cashUnknown ? `${cashUnknown} of ${all} with no statement for ${data.period}` : data.attention.shortOfCash ? `${data.attention.shortOfCash} short within 13 weeks` : 'Last statements'}
      />
      <Kpi label="Payments due in 7 days" value={k(data.due7)} note="Approved, not yet released" />
      <Kpi
        label="Invoices over 90 days"
        value={ageUnknown === all ? 'UNKNOWN' : k(data.totals.over90)}
        tone={ageUnknown === all ? 'unknown' : data.totals.over90 ? 'warn' : 'ok'}
        note={ageUnknown ? `${ageUnknown} of ${all} with no ageing for ${data.period}` : `${data.attention.over90} companies`}
      />
      <Kpi label={`Not closed for ${data.period}`} value={data.attention.closeOpen} tone={data.attention.closeOpen ? 'warn' : 'ok'} note={`of ${all} companies`} />
    </div>
  );
}

function FinanceToday({ onGo }: { onGo: (t: FinTarget) => void }) {
  const { data } = useLoad(() => api.financeToday().catch(() => []), []);
  if (!data || !data.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Today</h3>
      </div>
      <div className="list">
        {data.map((t, i) => (
          <div key={i} className="list-item" style={{ display: 'block' }}>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone={t.tone === 'crit' ? 'crit' : t.tone === 'warn' ? 'warn' : 'info'}>{t.tone === 'crit' ? 'Urgent' : t.tone === 'warn' ? 'To do' : 'Note'}</Chip>
              {t.go.tab ? (
                <button className="link-button" style={{ fontWeight: i === 0 ? 600 : 500 }} onClick={() => onGo({ tab: t.go.tab!, section: t.go.section, companyId: t.go.companyId })}>
                  {t.title}
                </button>
              ) : (
                <span style={{ fontWeight: i === 0 ? 600 : 500 }}>{t.title}</span>
              )}
            </div>
            <div className="muted small">{t.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
