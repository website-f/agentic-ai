import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateTimeLabel, useAction, type Tone } from '../ui';

/**
 * The ledger side of Finance (Fauzan, 3 Nov 2026; masterplan section 08 items 71, 72, 76): the twelve statement tests
 * worked out from the month's SQL Account figures, the chart of accounts mapping, and the SQL Account connector, which
 * is read-only and switched off. The server checks who may do each step.
 */

type Co = FinDesk['companies'][number];
type L = FinControls['ledger'];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const SCHEDULE: Record<string, string> = {
  income_tax: 'Income tax',
  payroll_deductions: 'Payroll deductions (EPF, PERKESO, PCB)',
  sst: 'SST',
  loans: 'Loans',
  deposits: 'Deposits',
  provisions: 'Provisions',
};

function testTone(t: L['tests'][number]): [Tone, string] {
  if (t.na) return ['info', 'Not applicable'];
  if (t.diff == null) return ['warn', 'Not run'];
  return Math.abs(t.diff) < 0.005 ? ['ok', 'RM0.00'] : ['crit', `Off ${rm(t.diff)}`];
}

export function LedgerPanels({ v, co, lead, me, reviewer }: { v: FinControls; co: Co; lead: boolean; me: string; reviewer: boolean }) {
  return (
    <>
      <StatementTests l={v.ledger} co={co} me={me} reviewer={reviewer} />
      <ChartOfAccounts l={v.ledger} co={co} lead={lead} />
      <SqlConnector l={v.ledger} co={co} lead={lead} />
    </>
  );
}

const n = (s: string) => (s.trim() === '' ? '' : Number(s.replace(/,/g, '')));

function StatementTests({ l, co, me, reviewer }: { l: L; co: Co; me: string; reviewer: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [sch, setSch] = useState<{ kind: string; gl: string; schedule: string; doc: string }[]>([]);
  const [comment, setComment] = useState('');
  const g = (k: string) => f[k] ?? '';
  const inp = (k: string, label: string) => (
    <label className="field" key={k}>
      <span>{label}</span>
      <input className="input" inputMode="decimal" aria-label={label} value={g(k)} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  const save = () =>
    act.run(
      () =>
        api.finControlAction(co.companyId, 'figures', 'record', {
          period: l.period,
          source: g('source'),
          tb: { debit: n(g('tbDebit')), credit: n(g('tbCredit')) },
          bs: { assets: n(g('assets')), liabilities: n(g('liabilities')), equity: n(g('equity')) },
          pl: {
            result: n(g('result')),
            reOpening: n(g('reOpening')),
            reClosing: n(g('reClosing')),
            dividends: n(g('dividends')) || 0,
            otherMovements: n(g('other')) || 0,
            otherNote: g('otherNote'),
          },
          cf: {
            opening: n(g('cfOpening')),
            operating: n(g('operating')),
            investing: n(g('investing')),
            financing: n(g('financing')),
            fx: n(g('fx')) || 0,
            closing: n(g('cfClosing')),
            bsCash: n(g('bsCash')),
            adjustment: n(g('adj')) || 0,
            adjustmentNote: g('adjNote'),
          },
          ...(f.faNa
            ? { faNa: g('faNa') }
            : { fa: { regCost: n(g('regCost')), regAccDep: n(g('regAccDep')), glCost: n(g('glCost')), glAccDep: n(g('glAccDep')) } }),
          ...(f.stockNa ? { stockNa: g('stockNa') } : { stock: { value: n(g('stockValue')), gl: n(g('stockGl')) } }),
          schedules: sch.map((s) => ({ kind: s.kind, gl: n(s.gl), schedule: n(s.schedule), doc: s.doc })),
          note: g('note'),
        }),
      'Figures saved. Someone else reviews them before the close uses them.',
    );
  const fig = l.figures;
  return (
    <section className="panel" data-panel="statement-tests">
      <div className="panel-head">
        <div>
          <h3>Statement checks FS-01 to FS-12 ({l.period})</h3>
          <div className="muted small">
            Copy the month&apos;s totals from the SQL Account reports (trial balance, balance sheet, profit and loss, cash-flow statement, asset register, stock
            valuation, schedules). Prima works out each test. Someone else reviews the figures; only reviewed figures count for the close. FS-01, FS-02 and
            FS-06 must be RM0.00; any other test that does not agree is explained at the close. The cash-flow statement is the historical report, not the
            13-week forecast.
          </div>
        </div>
      </div>
      <ErrorNotice error={act.error} />
      <table className="table small">
        <thead>
          <tr>
            <th>Test</th>
            <th>Result</th>
            <th>From</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {l.tests.map((t) => {
            const [tone, label] = testTone(t);
            return (
              <tr key={t.id}>
                <td>
                  <strong>{t.id}</strong> {t.label}
                </td>
                <td>
                  <Chip tone={tone}>{label}</Chip>
                </td>
                <td className="muted">
                  {
                    { figures: 'Reviewed figures', reconciliation: 'Bank reconciliation', intercompany: 'Intercompany', reported: 'Reported', none: '–' }[
                      t.from
                    ]
                  }
                </td>
                <td className="muted">{t.na ?? t.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {fig && (
        <div className="small fin-mt">
          Figures for {fig.period} from {fig.origin === 'connector' ? 'the SQL Account connector' : fig.source}, recorded by {fig.prepared.by} ·{' '}
          {fig.reviewed ? (
            <Chip tone="ok">Reviewed by {fig.reviewed.by}</Chip>
          ) : !reviewer || fig.prepared.byId === me ? (
            <Chip tone="warn">Waiting for review by someone else (deputy, team leader, FD or CEO)</Chip>
          ) : (
            <span className="row fin-inline">
              <Chip tone="warn">Waiting for review</Chip>
              <input className="input" aria-label="Review comment" placeholder="Review comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button
                className="btn"
                disabled={act.busy}
                onClick={() => act.run(() => api.finControlAction(co.companyId, 'figures', 'review', { period: fig.period, comment }), 'Figures reviewed.')}
              >
                Review figures
              </button>
            </span>
          )}
        </div>
      )}
      <details className="fin-mt" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Record the {l.period} figures</summary>
        <div className="grid-2 fin-gap fin-mt">
          <label className="field">
            <span>SQL Account reports filed (file name or SharePoint link)</span>
            <input className="input" aria-label="SQL Account reports filed" value={g('source')} onChange={(e) => setF({ ...f, source: e.target.value })} />
          </label>
          {inp('tbDebit', 'Trial balance: total debits')}
          {inp('tbCredit', 'Trial balance: total credits')}
          {inp('assets', 'Total assets')}
          {inp('liabilities', 'Total liabilities')}
          {inp('equity', 'Total equity')}
          {inp('result', 'Profit or loss for the month')}
          {inp('reOpening', 'Retained earnings, start of month')}
          {inp('reClosing', 'Retained earnings, end of month')}
          {inp('dividends', 'Dividends')}
          {inp('other', 'Other approved equity movements')}
          {g('other') && Number(g('other')) !== 0 && (
            <label className="field">
              <span>What the other movements are</span>
              <input
                className="input"
                aria-label="What the other movements are"
                value={g('otherNote')}
                onChange={(e) => setF({ ...f, otherNote: e.target.value })}
              />
            </label>
          )}
          {inp('cfOpening', 'Cash-flow statement: opening cash')}
          {inp('operating', 'Operating cash flow')}
          {inp('investing', 'Investing cash flow')}
          {inp('financing', 'Financing cash flow')}
          {inp('fx', 'Exchange differences')}
          {inp('cfClosing', 'Cash-flow statement: closing cash')}
          {inp('bsCash', 'Cash and bank in the balance sheet')}
          {inp('adj', 'Classification adjustment (restricted cash, overdraft)')}
          {g('adj') && Number(g('adj')) !== 0 && (
            <label className="field">
              <span>Why the adjustment</span>
              <input className="input" aria-label="Why the adjustment" value={g('adjNote')} onChange={(e) => setF({ ...f, adjNote: e.target.value })} />
            </label>
          )}
          <label className="field">
            <span>Fixed assets not applicable? Say why (leave empty if the company has them)</span>
            <input className="input" aria-label="Fixed assets not applicable" value={g('faNa')} onChange={(e) => setF({ ...f, faNa: e.target.value })} />
          </label>
          {!g('faNa') && (
            <>
              {inp('regCost', 'Asset register: cost')}
              {inp('regAccDep', 'Asset register: accumulated depreciation')}
              {inp('glCost', 'Ledger: fixed asset cost')}
              {inp('glAccDep', 'Ledger: accumulated depreciation')}
            </>
          )}
          <label className="field">
            <span>Stock not applicable? Say why (leave empty if the company keeps stock)</span>
            <input className="input" aria-label="Stock not applicable" value={g('stockNa')} onChange={(e) => setF({ ...f, stockNa: e.target.value })} />
          </label>
          {!g('stockNa') && (
            <>
              {inp('stockValue', 'Stock valuation')}
              {inp('stockGl', 'Inventory in the ledger')}
            </>
          )}
        </div>
        <div className="stack fin-gap fin-mt">
          <strong className="small">Schedules (FS-12)</strong>
          {sch.map((s, i) => (
            <div className="row" key={i}>
              <Select
                className="select"
                aria-label={`Schedule ${i + 1} kind`}
                value={s.kind}
                onChange={(e) => setSch(sch.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
              >
                {l.scheduleKinds.map((k) => (
                  <option key={k} value={k}>
                    {SCHEDULE[k] ?? k}
                  </option>
                ))}
              </Select>
              <input
                className="input"
                aria-label={`Schedule ${i + 1} ledger balance`}
                placeholder="Ledger balance"
                value={s.gl}
                onChange={(e) => setSch(sch.map((x, j) => (j === i ? { ...x, gl: e.target.value } : x)))}
              />
              <input
                className="input"
                aria-label={`Schedule ${i + 1} schedule total`}
                placeholder="Schedule total"
                value={s.schedule}
                onChange={(e) => setSch(sch.map((x, j) => (j === i ? { ...x, schedule: e.target.value } : x)))}
              />
              <input
                className="input"
                aria-label={`Schedule ${i + 1} document`}
                placeholder="Schedule filed"
                value={s.doc}
                onChange={(e) => setSch(sch.map((x, j) => (j === i ? { ...x, doc: e.target.value } : x)))}
              />
              <button className="btn ghost" onClick={() => setSch(sch.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button
            className="btn ghost fin-self-start"
            onClick={() => setSch([...sch, { kind: 'payroll_deductions', gl: '', schedule: '', doc: '' }])}
          >
            Add a schedule
          </button>
        </div>
        <label className="field fin-mt">
          <span>Note (optional)</span>
          <input className="input" aria-label="Figures note" value={g('note')} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </label>
        <button className="btn primary fin-mt" disabled={act.busy} onClick={save}>
          Save figures
        </button>
      </details>
    </section>
  );
}

function ChartOfAccounts({ l, co, lead }: { l: L; co: Co; lead: boolean }) {
  const act = useAction();
  const [f, setF] = useState({ from: l.period, accounts: '', na: '', banks: l.banks.map((b) => `${b.id}, `).join('\n'), projects: '', note: '' });
  const [comment, setComment] = useState('');
  const p = l.coaPending;
  return (
    <section className="panel" data-panel="chart-of-accounts">
      <div className="panel-head">
        <div>
          <h3>Chart of accounts mapping</h3>
          <div className="muted small">
            This company&apos;s own SQL Account codes, each put in one group reporting line; each bank account&apos;s own ledger code; and sites or contracts to
            SQL Account project codes. Finance proposes; the Finance Director or the CEO approves (never the person who proposed). A new version starts from a
            month that is not closed.
          </div>
        </div>
      </div>
      <ErrorNotice error={act.error} />
      <div className="small">
        In force for {l.period}:{' '}
        {l.coa ? (
          <Chip tone="ok">
            Version {l.coa.version} from {l.coa.from}, {l.coa.accounts.length} accounts, approved by {l.coa.approved?.by}
          </Chip>
        ) : (
          <Chip tone="warn">None approved</Chip>
        )}
      </div>
      {p && (
        <div className="panel fin-mt">
          <div className="small">
            Version {p.version} from {p.from}, proposed by {p.proposed.by}: {p.accounts.length} accounts, {p.banks.length} bank account(s), {p.projects.length}{' '}
            project(s).
          </div>
          {p.gaps.length > 0 && (
            <ul className="small">
              {p.gaps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {lead && (
            <div className="row fin-mt">
              <input
                className="input"
                aria-label="Mapping comment"
                placeholder="Comment (a reason to return)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                className="btn primary"
                disabled={act.busy || p.gaps.length > 0}
                onClick={() => act.run(() => api.finControlAction(co.companyId, 'coa', 'approve', { version: p.version, comment }), 'Mapping approved.')}
              >
                Approve mapping
              </button>
              <button
                className="btn"
                disabled={act.busy}
                onClick={() => act.run(() => api.finControlAction(co.companyId, 'coa', 'return', { version: p.version, comment }), 'Mapping returned.')}
              >
                Return
              </button>
            </div>
          )}
        </div>
      )}
      {!p && (
        <details className="fin-mt">
          <summary>Propose a mapping</summary>
          <div className="stack fin-gap fin-mt">
            <label className="field">
              <span>First month it applies (YYYY-MM)</span>
              <input className="input" aria-label="First month it applies" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </label>
            <label className="field">
              <span>Accounts: one per line, &quot;code, name, group&quot;. Groups: {l.categories.join(', ')}</span>
              <textarea className="input" rows={6} aria-label="Accounts" value={f.accounts} onChange={(e) => setF({ ...f, accounts: e.target.value })} />
            </label>
            <label className="field">
              <span>Required groups this company does not have: one per line, &quot;group, reason&quot; (required: {l.required.join(', ')})</span>
              <textarea className="input" rows={2} aria-label="Not applicable groups" value={f.na} onChange={(e) => setF({ ...f, na: e.target.value })} />
            </label>
            <label className="field">
              <span>Bank accounts: &quot;bank account, ledger code&quot; ({l.banks.map((b) => `${b.id} = ${b.label}`).join('; ')})</span>
              <textarea
                className="input"
                rows={Math.max(2, l.banks.length)}
                aria-label="Bank ledger codes"
                value={f.banks}
                onChange={(e) => setF({ ...f, banks: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Projects: &quot;contract, SQL Account project code&quot; (optional)</span>
              <textarea className="input" rows={2} aria-label="Projects" value={f.projects} onChange={(e) => setF({ ...f, projects: e.target.value })} />
            </label>
            <button
              className="btn primary"
              disabled={act.busy}
              onClick={() => act.run(() => api.finControlAction(co.companyId, 'coa', 'propose', f), 'Mapping proposed for approval.')}
            >
              Propose mapping
            </button>
          </div>
        </details>
      )}
      {l.coaHistory.length > 0 && (
        <details className="fin-mt">
          <summary className="small">All versions</summary>
          <ul className="small">
            {l.coaHistory.map((m) => (
              <li key={m.version}>
                v{m.version} from {m.from}, {m.accounts} accounts, proposed by {m.proposed.by}:{' '}
                {m.approved
                  ? `approved by ${m.approved.by} (${m.approved.comment})`
                  : m.returned
                    ? `returned by ${m.returned.by} (${m.returned.comment})`
                    : 'waiting'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function SqlConnector({ l, co, lead }: { l: L; co: Co; lead: boolean }) {
  const act = useAction();
  const d = l.sql.discovery;
  const [f, setF] = useState({
    companyFile: '',
    deployment: 'unknown',
    version: '',
    partnerDoc: '',
    restApi: 'unknown',
    asset: 'unknown',
    project: 'unknown',
    consolidation: 'unknown',
    bankFeed: 'unknown',
  });
  const [comment, setComment] = useState('');
  const yn = (k: 'restApi' | 'asset' | 'project' | 'consolidation' | 'bankFeed', label: string) => (
    <label className="field" key={k}>
      <span>{label}</span>
      <select className="select" aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="unknown">Unknown</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
  return (
    <section className="panel" data-panel="sql-connector">
      <div className="panel-head">
        <div>
          <h3>SQL Account connection</h3>
          <div className="muted small">
            Read-only: Prima would only read the month&apos;s figures, never write to SQL Account. It is switched off. Until it is on, Finance records the
            figures above from the SQL Account reports. The Finance Director owns and makes the connection.
          </div>
        </div>
        <Chip tone="warn">Off</Chip>
      </div>
      <ErrorNotice error={act.error} />
      <ul className="small">
        {l.sql.blockers.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {d && (
        <div className="small">
          Set-up: {d.companyFile}, {d.deployment.replace('_', ' ')}, version {d.version}; API {d.modules.restApi}, asset module {d.modules.asset}, project
          module {d.modules.project}, consolidation {d.modules.consolidation}, bank feed {d.modules.bankFeed}. Recorded by {d.recorded.by}.{' '}
          {d.confirmed ? (
            <Chip tone="ok">Confirmed by {d.confirmed.by}</Chip>
          ) : lead ? (
            <span className="row fin-inline">
              <input className="input" aria-label="Set-up comment" placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button
                className="btn"
                disabled={act.busy}
                onClick={() => act.run(() => api.finControlAction(co.companyId, 'sql', 'confirm', { comment }), 'Set-up confirmed.')}
              >
                Confirm set-up
              </button>
            </span>
          ) : (
            <Chip tone="warn">Waiting for the FD or CEO to confirm</Chip>
          )}
        </div>
      )}
      <details className="fin-mt">
        <summary className="small">Record the SQL Account set-up (team leader, FD or CEO)</summary>
        <div className="grid-2 fin-gap fin-mt">
          <label className="field">
            <span>Company file or database name</span>
            <input
              className="input"
              aria-label="Company file or database name"
              value={f.companyFile}
              onChange={(e) => setF({ ...f, companyFile: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Where it runs</span>
            <select className="select" aria-label="Where it runs" value={f.deployment} onChange={(e) => setF({ ...f, deployment: e.target.value })}>
              <option value="unknown">Unknown</option>
              <option value="cloud">Cloud</option>
              <option value="on_premises">In-house server</option>
              <option value="offline">Offline</option>
            </select>
          </label>
          <label className="field">
            <span>SQL Account version</span>
            <input className="input" aria-label="SQL Account version" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
          </label>
          {yn('restApi', 'API access')}
          {yn('asset', 'Asset module')}
          {yn('project', 'Project module')}
          {yn('consolidation', 'Consolidation add-on')}
          {yn('bankFeed', 'Bank feed')}
          <label className="field">
            <span>SQL Account partner&apos;s confirmation (file name or link)</span>
            <input className="input" aria-label="Partner confirmation" value={f.partnerDoc} onChange={(e) => setF({ ...f, partnerDoc: e.target.value })} />
          </label>
        </div>
        <button
          className="btn primary fin-mt"
          disabled={act.busy}
          onClick={() =>
            act.run(
              () =>
                api.finControlAction(co.companyId, 'sql', 'record', {
                  companyFile: f.companyFile,
                  deployment: f.deployment,
                  version: f.version,
                  partnerDoc: f.partnerDoc,
                  modules: { restApi: f.restApi, asset: f.asset, project: f.project, consolidation: f.consolidation, bankFeed: f.bankFeed },
                }),
              'Set-up recorded. The FD or CEO confirms it.',
            )
          }
        >
          Save set-up
        </button>
      </details>
      {l.sql.syncs.length > 0 && (
        <ul className="small">
          {l.sql.syncs.map((s) => (
            <li key={s.id}>
              {dateTimeLabel(s.at)} read {s.externalId} for {s.period}: {s.status}
              {s.reasons.length ? ` (${s.reasons.join(' ')})` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
