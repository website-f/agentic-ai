import { Select } from '../SearchSelect';
import { useState } from 'react';
import {
  ArrowRightIcon,
  BankIcon,
  CaretRightIcon,
  FilesIcon,
  PlusIcon,
  QuestionIcon,
  WarningOctagonIcon,
} from '@phosphor-icons/react';
import type { FinPackStatus } from '@prima/core';
import { api, type FinBoard, type FinDesk } from '../api';
import { useApp } from '../App';
import { ManagementFeesPanel } from './ManagementFees';
import { takeFinTarget, type FinTarget } from '../finTarget';
import { CloseTab, FinPackPanel, NewPayment, PaymentsTab } from './FinanceDesk';
import { ChecksTab } from './FinanceChecks';
import { FinanceSettingsTab } from './FinanceSettings';
import { FinanceKpiTab } from './FinanceKpi';
import { FinanceDashboardTab } from './FinanceDashboard';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import '../styles/finance.css';

/**
 * Finance (Fauzan, 27 Oct 2026). The Finance Director and 7 teams keep every company's books in SQL Account, which
 * stays. Prima does not keep accounts: it shows whether each company's books are complete, reconciled and closed, and
 * tracks the papers the teams prepare for the auditor and the tax agent. Figures are test data until SQL is connected.
 *
 * P75 layout: the overview puts what failed or is overdue first (status tiles and Today), then the cash position, then
 * every company by team; each other tab is its own set of cards.
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
  // P78: what the person is adding from the page head (the owner, the Finance Director and the teams enter these by hand).
  const [adding, setAdding] = useState<'payment' | 'bank' | 'paper' | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="finance" />;
  const count = (t: Row['tone']) => data.rows.filter((r) => r.tone === t).length;
  const banksLate = data.rows.reduce((n, r) => n + r.banksLate.length, 0);
  const papersOverdue = data.rows.reduce((n, r) => n + r.packsOverdue.length, 0);
  const row = data.rows.find((r) => r.status.companyId === open) ?? null;
  const payCos = desk ? desk.companies.filter((c) => c.canAct) : [];
  // A bank account is added by the team leader, the Finance Director or the CEO (the server checks it too).
  const bankCos = desk && ['ceo', 'director', 'leader'].includes(desk.actor.kind) ? payCos.map((c) => ({ companyId: c.companyId, companyName: c.companyName })) : [];
  const paperCos = data.rows.filter((r) => r.canSet).map((r) => ({ companyId: r.status.companyId, companyName: r.companyName }));
  const tabs: [Tab, string][] = [
    ['teams', 'Overview'],
    ...(desk
      ? ([
          ['dashboard', 'Dashboard'],
          ['payments', 'Payments'],
          ['close', 'Month-end close'],
        ] as [Tab, string][])
      : []),
    ['banks', 'Bank reconciliation'],
    ['books', 'Closing and posting'],
    ['papers', 'Auditor and tax'],
    ...(desk
      ? ([
          ['checks', 'Checks'],
          ...(['director', 'ceo', 'leader'].includes(desk.actor.kind) ? ([['kpi', 'KPIs']] as [Tab, string][]) : []),
          ['settings', 'Settings'],
        ] as [Tab, string][])
      : []),
  ];
  return (
    <div className="page fin">
      <PageHead
        title={`Finance${data.team ? `, Team ${data.team}` : ''}`}
        sub={
          <>
            The books stay in SQL Account. This shows whether each company&apos;s books are complete, reconciled and closed for {dateLabel(data.lastEnd)}, and
            the papers for the auditor and the tax agent. A company with no figures from SQL Account for {data.rule.staleHours} hours shows as unknown.
          </>
        }
        actions={
          payCos.length > 0 || bankCos.length > 0 || paperCos.length > 0 ? (
            <>
              {paperCos.length > 0 && (
                <button className="btn" onClick={() => setAdding('paper')}>
                  <PlusIcon size={16} aria-hidden="true" />
                  Add paper
                </button>
              )}
              {bankCos.length > 0 && (
                <button className="btn" onClick={() => setAdding('bank')}>
                  <PlusIcon size={16} aria-hidden="true" />
                  Add bank account
                </button>
              )}
              {payCos.length > 0 && (
                <button className="btn btn-primary" onClick={() => setAdding('payment')}>
                  <PlusIcon size={16} weight="bold" aria-hidden="true" />
                  New payment
                </button>
              )}
            </>
          ) : undefined
        }
      >
        <p className="notice" data-tone="info">
          Test data: SQL Account is not connected yet.
        </p>
        <div className="tabbar fin-tabs" role="tablist" aria-label="Finance">
          {tabs.map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
      </PageHead>
      {tab === 'teams' && (
        <div className="fin-body">
          <Stats>
            <Stat
              label="Companies to act on now"
              value={count('crit')}
              tone={count('crit') ? 'crit' : 'ok'}
              note={`of ${data.rows.length}`}
              icon={<WarningOctagonIcon size={18} />}
            />
            <Stat
              label="Unknown"
              value={count('unknown')}
              tone={count('unknown') ? 'unknown' : 'ok'}
              note="No recent SQL figures, or tests not run"
              icon={<QuestionIcon size={18} />}
            />
            <Stat
              label="Bank accounts not reconciled"
              value={banksLate}
              tone={banksLate ? 'crit' : 'ok'}
              note={`Due by the ${data.rule.reconcileByDay}th`}
              icon={<BankIcon size={18} />}
              onClick={() => setTab('banks')}
            />
            <Stat
              label="Papers overdue"
              value={papersOverdue}
              tone={papersOverdue ? 'crit' : 'ok'}
              note="Auditor and tax agent"
              icon={<FilesIcon size={18} />}
              onClick={() => setTab('papers')}
            />
          </Stats>
          {desk && (
            <div className="fin-top">
              <FinanceToday onGo={goTo} />
              <KeyNumbers onGo={() => setTab('dashboard')} />
            </div>
          )}
          {data.rows.length === 0 ? (
            <Card title="No company books yet" flush>
              <Empty title="No company has Finance books in Prima yet.">
                {data.role === 'lead' ? 'Start each company\'s books in Settings, under "Companies with no Finance books".' : 'The Finance Director starts each company\'s books.'}
              </Empty>
            </Card>
          ) : (
            <Teams data={data} onOpen={setOpen} />
          )}
        </div>
      )}
      {tab === 'payments' && desk && (
        <div className="fin-body">
          <PaymentsTab desk={desk} />
        </div>
      )}
      {tab === 'close' && desk && (
        <div className="fin-body">
          <CloseTab desk={desk} />
        </div>
      )}
      {tab === 'checks' && desk && (
        <div className="fin-body">
          <ChecksTab key={target?.n ?? 0} desk={desk} target={target} />
        </div>
      )}
      {tab === 'settings' && desk && (
        <div className="fin-body">
          <FinanceSettingsTab />
        </div>
      )}
      {tab === 'kpi' && desk && (
        <div className="fin-body">
          <FinanceKpiTab />
        </div>
      )}
      {tab === 'dashboard' && desk && (
        <div className="fin-body">
          <FinanceDashboardTab />
        </div>
      )}
      {tab === 'banks' && <Banks data={data} onOpen={setOpen} />}
      {tab === 'books' && <Books data={data} onOpen={setOpen} />}
      {tab === 'papers' && <Papers data={data} onOpen={setOpen} onAdd={paperCos.length ? () => setAdding('paper') : undefined} />}
      {(me.user.leadership === 'finance_director' || me.user.opsTier === 'ceo') && <ManagementFeesPanel />}
      {row && (
        <CompanyDrawer
          row={row}
          desk={desk}
          may={mayFor(data.financeRole)}
          canAddBank={bankCos.some((c) => c.companyId === row.status.companyId)}
          onClose={() => setOpen(null)}
        />
      )}
      {adding === 'payment' && desk && <NewPayment desk={desk} onClose={() => setAdding(null)} />}
      {adding === 'bank' && (
        <Drawer title="Add bank account" sub="A company's own bank account, kept on its books. Only the last 4 digits are kept." onClose={() => setAdding(null)}>
          <AddBankAccount companies={bankCos} onDone={() => setAdding(null)} />
        </Drawer>
      )}
      {adding === 'paper' && (
        <Drawer title="Add paper" sub="Something the auditor or the tax agent asked for, with its due date" onClose={() => setAdding(null)}>
          <AddPaper companies={paperCos} onDone={() => setAdding(null)} />
        </Drawer>
      )}
    </div>
  );
}

/** One company on a board: its name, what is wrong (each item a tag), and its state. */
function CompanyLine({ r, onOpen, detail }: { r: Row; onOpen: (id: string) => void; detail: string[] }) {
  return (
    <button type="button" className="fin-co" data-tone={r.tone} onClick={() => onOpen(r.status.companyId)}>
      <span className="fin-co-dot" aria-hidden="true" />
      <span className="fin-co-text">
        <span className="fin-co-name">{r.companyName}</span>
        <span className="fin-co-detail">
          {detail.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </span>
      </span>
      <Chip tone={TONE[r.tone][0]}>{TONE[r.tone][1]}</Chip>
      <CaretRightIcon className="fin-caret" size={14} aria-hidden="true" />
    </button>
  );
}

function reasons(r: Row): string[] {
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
  return out.length ? out : ['Closed, reconciled and posted'];
}

const RANK: Record<Row['tone'], number> = { crit: 0, unknown: 1, warn: 2, ok: 3 };

function Teams({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  return (
    <section className="fin-section" aria-labelledby="fin-teams-h">
      <div className="fin-section-head">
        <h2 id="fin-teams-h">{data.role === 'lead' ? 'Teams' : 'Companies'}</h2>
        <span className="muted small">Press a company for its banks, tests, postings and papers</span>
      </div>
      <div className="fin-teams">
        {data.teams.map((t) => (
          <Card
            key={t.team}
            title={`Team ${t.team}`}
            sub={`${t.leader ?? 'No leader set'} · ${t.companies} companies${t.members.length > 1 ? ` · ${t.members.length} people` : ''}`}
            actions={
              <span className="fin-chips">
                {t.crit > 0 && <Chip tone="crit">{t.crit} act now</Chip>}
                {t.unknown > 0 && <Chip tone="unknown">{t.unknown} unknown</Chip>}
                {t.warn > 0 && <Chip tone="warn">{t.warn} to finish</Chip>}
                {t.ok > 0 && <Chip tone="ok">{t.ok} in order</Chip>}
              </span>
            }
            flush
          >
            <div className="fin-cos">
              {data.rows
                .filter((r) => r.status.team === t.team)
                .sort((a, b) => RANK[a.tone] - RANK[b.tone])
                .map((r) => (
                  <CompanyLine key={r.status.id} r={r} onOpen={onOpen} detail={reasons(r)} />
                ))}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Banks({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  const rows = data.rows.filter((r) => r.banksBehind.length);
  return (
    <Card title={`Not reconciled to ${dateLabel(data.lastEnd)}`} sub={`Reconcile in SQL Account by the ${data.rule.reconcileByDay}th`} flush>
      {rows.length === 0 ? (
        <Empty title="Every bank account is reconciled." />
      ) : (
        <table className="fin-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Bank account</th>
              <th>Reconciled to</th>
              <th className="fin-num">Open items</th>
              <th className="fin-num">Difference</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) =>
              r.banksBehind.map((b, i) => (
                <tr key={`${r.status.id}-${b.id}`}>
                  {i === 0 && (
                    <td rowSpan={r.banksBehind.length}>
                      <button type="button" className="fin-link" onClick={() => onOpen(r.status.companyId)}>
                        {r.companyName}
                      </button>
                    </td>
                  )}
                  <td>
                    {b.bank} {b.accountMasked}
                  </td>
                  <td>{b.reconciledTo ? `reconciled to ${dateLabel(b.reconciledTo)}` : 'never reconciled'}</td>
                  <td className="fin-num">{b.openItems}</td>
                  <td className="fin-num">{rm(b.statementBalance - b.glBalance)}</td>
                  {i === 0 && (
                    <td rowSpan={r.banksBehind.length}>
                      <Chip tone={TONE[r.tone][0]}>{TONE[r.tone][1]}</Chip>
                    </td>
                  )}
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Books({ data, onOpen }: { data: FinBoard; onOpen: (id: string) => void }) {
  const rows = data.rows.filter((r) => r.closeBehind || r.testsFailed.length || r.testsNotRun.length || r.gaps.length || r.stale);
  return (
    <Card title={`Closing and posting for ${dateLabel(data.lastEnd)}`} sub={`Close by the ${data.rule.closeByDay}th · FS-01, FS-02 and FS-06 must be RM0.00`} flush>
      {rows.length === 0 ? (
        <Empty title="Every company is closed, posted and passes the tests." />
      ) : (
        <div className="fin-cos">
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
              ].filter(Boolean)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function Papers({ data, onOpen, onAdd }: { data: FinBoard; onOpen: (id: string) => void; onAdd?: () => void }) {
  const items = data.rows
    .flatMap((r) => [...r.packsOverdue.map((i) => ({ r, i, late: true })), ...r.packsDue.map((i) => ({ r, i, late: false }))])
    .sort((a, b) => a.i.dueOn.localeCompare(b.i.dueOn));
  return (
    <Card
      title={`Papers overdue or due within ${data.rule.packWarnDays} days`}
      sub="Data entry prepares, the leader or deputy reviews, the leader sends; reviewing and sending need a comment"
      actions={
        onAdd ? (
          <button type="button" className="btn btn-sm" onClick={onAdd}>
            <PlusIcon size={14} aria-hidden="true" />
            Add paper
          </button>
        ) : undefined
      }
      flush
    >
      {items.length === 0 ? (
        <Empty title="Nothing due.">{onAdd ? 'When the auditor or the tax agent asks for something, add it with its due date.' : undefined}</Empty>
      ) : (
        <table className="fin-table">
          <thead>
            <tr>
              <th>Paper</th>
              <th>Company</th>
              <th>For</th>
              <th>Due</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ r, i, late }) => (
              <tr key={`${r.status.id}-${i.id}`}>
                <td>
                  <button type="button" className="fin-link" onClick={() => onOpen(r.status.companyId)}>
                    {i.label}
                  </button>
                </td>
                <td>
                  {r.companyName} <span className="muted small">· Team {r.status.team}</span>
                </td>
                <td>{i.pack === 'audit' ? 'auditor' : 'tax agent'}</td>
                <td className="fin-nowrap">due {dateLabel(i.dueOn)}</td>
                <td>
                  <Chip tone={late ? 'crit' : PACK[i.status][0]}>{late ? 'Overdue' : PACK[i.status][1]}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CompanyDrawer({
  row: r,
  desk,
  may,
  canAddBank,
  onClose,
}: {
  row: Row;
  desk: FinDesk | null;
  may: FinPackStatus[];
  canAddBank: boolean;
  onClose: () => void;
}) {
  const [addingBank, setAddingBank] = useState(false);
  const [addingPaper, setAddingPaper] = useState(false);
  const f = r.status;
  const d = desk?.companies.find((c) => c.companyId === f.companyId) ?? null;
  const me = desk?.me ?? null;
  const p = f.posting;
  const closeTone = r.closeLate ? 'crit' : r.closeBehind ? 'warn' : 'ok';
  return (
    <Drawer title={r.companyName} sub={`Team ${f.team} · year ends ${f.fyEnd.split('-').reverse().join('/')}`} onClose={onClose}>
      <dl className="fin-figs">
        <div data-tone={closeTone}>
          <dt>Closed to</dt>
          <dd>{f.closedTo ? dateLabel(f.closedTo) : 'Never'}</dd>
        </div>
        <div data-tone={r.stale ? 'unknown' : 'ok'}>
          <dt>SQL figures</dt>
          <dd>{f.sqlLastAt ? dateTimeLabel(f.sqlLastAt) : 'Never'}</dd>
        </div>
        <div data-tone={f.arOver90 ? 'warn' : 'ok'}>
          <dt>Customers over 90 days</dt>
          <dd>{rm(f.arOver90)}</dd>
        </div>
        <div data-tone={f.apOverdue ? 'warn' : 'ok'}>
          <dt>Suppliers overdue</dt>
          <dd>{rm(f.apOverdue)}</dd>
        </div>
      </dl>
      <Card
        title="Bank accounts"
        actions={
          canAddBank && !addingBank ? (
            <button type="button" className="btn btn-sm" onClick={() => setAddingBank(true)}>
              <PlusIcon size={14} aria-hidden="true" />
              Add bank account
            </button>
          ) : undefined
        }
        flush
      >
        {addingBank && (
          <AddBankAccount
            companies={[{ companyId: f.companyId, companyName: r.companyName }]}
            fixed={f.companyId}
            onDone={() => setAddingBank(false)}
            onCancel={() => setAddingBank(false)}
          />
        )}
        {f.banks.length === 0 && !addingBank && (
          <Empty title="No bank accounts on the books yet.">{canAddBank ? 'Add each account the company pays from or is paid into.' : undefined}</Empty>
        )}
        {f.banks.length > 0 && (
          <table className="fin-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="fin-num">Books</th>
                <th className="fin-num">Statement</th>
                <th className="fin-num">Open items</th>
                <th>Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {f.banks.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="fin-strong">
                      {b.bank} {b.accountMasked}
                    </span>
                    <span className="muted small fin-block">{b.purpose}</span>
                  </td>
                  <td className="fin-num">{rm(b.glBalance)}</td>
                  <td className="fin-num">{rm(b.statementBalance)}</td>
                  <td className="fin-num">{b.openItems}</td>
                  <td>
                    <Chip tone={b.reconciledTo === r.lastEnd ? 'ok' : r.banksLate.some((x) => x.id === b.id) ? 'crit' : 'warn'}>
                      {b.reconciledTo ? `To ${dateLabel(b.reconciledTo)}` : 'Never reconciled'}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Integrity tests" flush>
        <div className="fin-rows">
          {f.tests.map((t) => (
            <div key={t.id} className="fin-kv">
              <span>
                <span className="fin-strong">{t.id}</span> {t.label}
              </span>
              <Chip tone={t.diff == null ? 'unknown' : Math.abs(t.diff) < 0.005 ? 'ok' : 'crit'}>{t.diff == null ? 'Not run' : rm(t.diff)}</Chip>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`Posted in SQL Account, ${p.period}`} flush>
        <div className="fin-rows">
          <div className="fin-kv">
            <span>Sales invoices against billing</span>
            <span className="fin-num">
              {rm(p.billedPosted)} of {rm(p.billed)}
            </span>
          </div>
          <div className="fin-kv">
            <span>Staff payroll journal</span>
            <Chip tone={!p.staffPayPaid ? 'neutral' : p.staffPayPosted ? 'ok' : 'warn'}>
              {!p.staffPayPaid ? 'No staff pay' : p.staffPayPosted ? 'Posted' : 'Not posted'}
            </Chip>
          </div>
          <div className="fin-kv">
            <span>Guard payroll journal (JA app)</span>
            <Chip tone={!p.guardPayPaid ? 'neutral' : p.guardPayPosted ? 'ok' : 'warn'}>
              {!p.guardPayPaid ? 'No guard pay' : p.guardPayPosted ? 'Posted' : 'Not posted'}
            </Chip>
          </div>
          <div className="fin-kv">
            <span>Supplier bills not posted</span>
            <span className="fin-num">{p.supplierBillsUnposted}</span>
          </div>
        </div>
      </Card>
      {r.canSet &&
        (addingPaper ? (
          <Card title="Add paper for the auditor or the tax agent" flush>
            <AddPaper
              companies={[{ companyId: f.companyId, companyName: r.companyName }]}
              fixed={f.companyId}
              onDone={() => setAddingPaper(false)}
              onCancel={() => setAddingPaper(false)}
            />
          </Card>
        ) : (
          <div className="fin-flexrow">
            <button type="button" className="btn btn-sm" onClick={() => setAddingPaper(true)}>
              <PlusIcon size={14} aria-hidden="true" />
              Add paper for the auditor or the tax agent
            </button>
          </div>
        ))}
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

/** Key numbers for the companies the person sees (Fauzan, 2 Nov 2026: A17): from the dashboard, never a ranking. */
function KeyNumbers({ onGo }: { onGo: () => void }) {
  const { data } = useLoad(() => api.finDashboard().catch(() => null), []);
  if (!data || !data.rows.length) return null;
  // P80: under RM1,000 is shown in full (RM0, RM450), not as "RM0k".
  const k = (n: number) => (Math.abs(n) < 1000 ? `RM${Math.round(n).toLocaleString('en-MY')}` : `RM${(n / 1000).toLocaleString('en-MY', { maximumFractionDigits: 0 })}k`);
  // No statement or ageing for the month is unknown, never zero.
  const cashUnknown = data.rows.filter((r) => r.cash == null).length;
  const ageUnknown = data.rows.filter((r) => r.over90 == null).length;
  const all = data.rows.length;
  const figs: { label: string; value: string | number; tone?: Tone; note: string }[] = [
    {
      label: 'Cash in the banks',
      value: cashUnknown === all ? 'UNKNOWN' : k(data.totals.cash),
      tone: cashUnknown === all ? 'unknown' : data.attention.shortOfCash ? 'warn' : 'ok',
      note: cashUnknown
        ? `${cashUnknown} of ${all} with no statement for ${data.period}`
        : data.attention.shortOfCash
          ? `${data.attention.shortOfCash} short within 13 weeks`
          : 'Last statements',
    },
    { label: 'Payments due in 7 days', value: k(data.due7), note: 'Approved, not yet released' },
    {
      label: 'Invoices over 90 days',
      value: ageUnknown === all ? 'UNKNOWN' : k(data.totals.over90),
      tone: ageUnknown === all ? 'unknown' : data.totals.over90 ? 'warn' : 'ok',
      note: ageUnknown ? `${ageUnknown} of ${all} with no ageing for ${data.period}` : `${data.attention.over90} companies`,
    },
    {
      label: `Not closed for ${data.period}`,
      value: data.attention.closeOpen,
      tone: data.attention.closeOpen ? 'warn' : 'ok',
      note: `of ${all} companies`,
    },
  ];
  return (
    <Card
      title="Cash position"
      sub={`${data.period}, from the dashboard`}
      actions={
        <button type="button" className="btn btn-sm" onClick={onGo}>
          Dashboard
          <ArrowRightIcon size={14} aria-hidden="true" />
        </button>
      }
      flush
    >
      <div className="fin-rows">
        {figs.map((x) => (
          <div key={x.label} className="fin-kv fin-kv-fig" data-tone={x.value === 'UNKNOWN' ? 'unknown' : x.tone}>
            <span className="fin-kv-label">
              <span>{x.label}</span>
              <span className="muted small">{x.note}</span>
            </span>
            <span className="fin-kv-value">{x.value === 'UNKNOWN' ? 'Unknown' : x.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Automation A13 (Fauzan, 2 Nov 2026): one list of what waits for this person today, urgent first. */
function FinanceToday({ onGo }: { onGo: (t: FinTarget) => void }) {
  const { data } = useLoad(() => api.financeToday().catch(() => []), []);
  if (!data || !data.length) return null;
  return (
    <Card title="Today" sub="What waits for you, urgent first" flush>
      <div className="fin-today">
        {data.map((t, i) => {
          const tone = t.tone === 'crit' ? 'crit' : t.tone === 'warn' ? 'warn' : 'info';
          const body = (
            <>
              <span className="fin-today-top">
                <Chip tone={tone}>{t.tone === 'crit' ? 'Urgent' : t.tone === 'warn' ? 'To do' : 'Note'}</Chip>
                <span className="fin-today-title" data-first={i === 0 ? 'yes' : undefined}>
                  {t.title}
                </span>
              </span>
              <span className="fin-today-detail">{t.detail}</span>
            </>
          );
          return t.go.tab ? (
            <button
              key={i}
              type="button"
              className="fin-today-item"
              data-tone={tone}
              onClick={() => onGo({ tab: t.go.tab!, section: t.go.section, companyId: t.go.companyId })}
            >
              {body}
              <CaretRightIcon className="fin-caret" size={14} aria-hidden="true" />
            </button>
          ) : (
            <div key={i} className="fin-today-item" data-tone={tone}>
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FormField({ label, help, error, children }: { label: string; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="help fin-warn" role="alert">
          {error}
        </span>
      ) : help ? (
        <span className="help">{help}</span>
      ) : null}
    </label>
  );
}

type FormCo = { companyId: string; companyName: string };

/**
 * P78: a company bank account added to its books (the team leader, the Finance Director or the CEO). Only the last four
 * digits are kept; balances and the reconciliation come from SQL Account and the bank statements afterwards.
 */
function AddBankAccount({ companies, fixed, onDone, onCancel }: { companies: FormCo[]; fixed?: string; onDone: () => void; onCancel?: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ companyId: fixed ?? companies[0]?.companyId ?? '', bank: '', last4: '', purpose: 'operating' });
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const bad = {
    bank: f.bank.trim().length < 2 ? 'Give the bank, such as Maybank.' : '',
    last4: /^\d{4}$/.test(f.last4.trim()) ? '' : 'Give the last 4 digits of the account number.',
  };
  const save = async () => {
    setTried(true);
    if (!f.companyId || bad.bank || bad.last4) return;
    const ok = await act.run(
      () => api.finAddBankAccount(f.companyId, { bank: f.bank.trim(), last4: f.last4.trim(), purpose: f.purpose }),
      'Bank account added. Its balances follow from SQL Account and the bank statements.',
    );
    if (ok) onDone();
  };
  return (
    <div className="fin-pad">
      <ErrorNotice error={act.error} />
      {!fixed && (
        <FormField label="Company">
          <Select className="select" value={f.companyId} onChange={set('companyId')}>
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField label="Bank" error={tried ? bad.bank : undefined}>
        <input className="input" value={f.bank} onChange={set('bank')} aria-invalid={tried && !!bad.bank} placeholder="Maybank" />
      </FormField>
      <FormField label="Account number, last 4 digits" help="Never the full number: Prima keeps only these." error={tried ? bad.last4 : undefined}>
        <input className="input" inputMode="numeric" maxLength={4} value={f.last4} onChange={set('last4')} aria-invalid={tried && !!bad.last4} placeholder="1234" />
      </FormField>
      <FormField label="Used for">
        <select className="select" value={f.purpose} onChange={set('purpose')}>
          <option value="operating">Operating: day-to-day payments</option>
          <option value="payroll">Payroll</option>
          <option value="collection">Collection: money in from clients</option>
        </select>
      </FormField>
      <div className="fin-flexrow">
        <button className="btn btn-primary" disabled={act.busy} onClick={() => void save()}>
          {act.busy ? 'Saving…' : 'Add bank account'}
        </button>
        {onCancel && (
          <button className="btn btn-ghost" disabled={act.busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** P78: a paper the auditor or the tax agent asked for, added with its due date by the company's team, the FD or the CEO. */
function AddPaper({ companies, fixed, onDone, onCancel }: { companies: FormCo[]; fixed?: string; onDone: () => void; onCancel?: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ companyId: fixed ?? companies[0]?.companyId ?? '', pack: 'audit', label: '', dueOn: '' });
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const bad = {
    label: f.label.trim().length < 3 ? 'Say what the paper is.' : '',
    dueOn: /^\d{4}-\d{2}-\d{2}$/.test(f.dueOn) ? '' : 'Give the due date.',
  };
  const save = async () => {
    setTried(true);
    if (!f.companyId || bad.label || bad.dueOn) return;
    const ok = await act.run(
      () => api.finAddPaper(f.companyId, f.pack === 'tax' ? 'tax' : 'audit', { label: f.label.trim(), dueOn: f.dueOn }),
      'Paper added as not started; the team prepares it next.',
    );
    if (ok) onDone();
  };
  return (
    <div className="fin-pad">
      <ErrorNotice error={act.error} />
      {!fixed && (
        <FormField label="Company">
          <Select className="select" value={f.companyId} onChange={set('companyId')}>
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField label="For">
        <select className="select" value={f.pack} onChange={set('pack')}>
          <option value="audit">The auditor</option>
          <option value="tax">The tax agent</option>
        </select>
      </FormField>
      <FormField label="What the paper is" error={tried ? bad.label : undefined}>
        <input className="input" value={f.label} onChange={set('label')} aria-invalid={tried && !!bad.label} placeholder="Schedule of other receivables" />
      </FormField>
      <FormField label="Due" error={tried ? bad.dueOn : undefined}>
        <input className="input" type="date" value={f.dueOn} onChange={set('dueOn')} aria-invalid={tried && !!bad.dueOn} />
      </FormField>
      <div className="fin-flexrow">
        <button className="btn btn-primary" disabled={act.busy} onClick={() => void save()}>
          {act.busy ? 'Saving…' : 'Add paper'}
        </button>
        {onCancel && (
          <button className="btn btn-ghost" disabled={act.busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
