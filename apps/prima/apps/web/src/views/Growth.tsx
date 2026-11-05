import { useState, type ReactNode } from 'react';
import {
  BankIcon,
  BriefcaseIcon,
  CalendarIcon,
  CalendarXIcon,
  CertificateIcon,
  ClockCountdownIcon,
  CoinsIcon,
  CrosshairIcon,
  FileTextIcon,
  FunnelIcon,
  GaugeIcon,
  GavelIcon,
  GlobeIcon,
  HandCoinsIcon,
  HourglassIcon,
  IdentificationCardIcon,
  InvoiceIcon,
  LaptopIcon,
  ListChecksIcon,
  MoneyIcon,
  ProhibitIcon,
  QuestionIcon,
  ReceiptIcon,
  ScalesIcon,
  SignatureIcon,
  SirenIcon,
  StampIcon,
  TrendUpIcon,
  UmbrellaIcon,
  UserMinusIcon,
  UsersThreeIcon,
  WalletIcon,
} from '@phosphor-icons/react';
import type { GrowthCompany, GrowthMargin } from '@prima/core';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, n, useLoad, type Tone } from '../ui';
import { Card, Stat, Stats } from '../kit';

// Growth panel on the leaders' home (Fauzan, 3 Nov 2026, "Recommended set"): is the group growing, and which company
// is pulling it down. Read only. A figure with no source recorded shows Unknown, never zero; never a ranking of people.

const rmK = (n: number | null | undefined) => (n == null ? 'UNKNOWN' : `RM${Math.round(n / 1000).toLocaleString('en-MY')}k`);
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n == null ? 'Unknown' : `${n > 0 ? '+' : ''}${n}%`);

/** A picture for a tile, a tag or a growth figure, read from its words. Only decoration: the words carry the meaning. */
const ICONS: [RegExp, ReactNode][] = [
  [/decision|approv/i, <ListChecksIcon key="a" />],
  [/bid|tender/i, <GavelIcon key="b" />],
  [/foreign worker|paper|permit|passport/i, <IdentificationCardIcon key="c" />],
  [/case|incident|speak up|siren/i, <SirenIcon key="d" />],
  [/firearm|arms/i, <CrosshairIcon key="e" />],
  [/licen|certif/i, <CertificateIcon key="f" />],
  [/not allowed|termination|movement/i, <UserMinusIcon key="g" />],
  [/insur|guarantee/i, <UmbrellaIcon key="h" />],
  [/no-show|unfilled|shift|no guard|roster/i, <CalendarXIcon key="i" />],
  [/without data|unknown/i, <QuestionIcon key="j" />],
  [/bank|cash/i, <BankIcon key="k" />],
  [/payment|claim/i, <WalletIcon key="l" />],
  [/invoice/i, <ReceiptIcon key="m" />],
  [/billed/i, <InvoiceIcon key="n" />],
  [/not closed|close/i, <HourglassIcon key="o" />],
  [/collection/i, <ClockCountdownIcon key="p" />],
  [/pipeline|lead/i, <FunnelIcon key="q" />],
  [/margin|growth/i, <TrendUpIcon key="r" />],
  [/contract/i, <FileTextIcon key="s" />],
  [/payroll|salary/i, <MoneyIcon key="t" />],
  [/credit/i, <HandCoinsIcon key="u" />],
  [/finance/i, <CoinsIcon key="v" />],
  [/legal|policy|pdpa/i, <ScalesIcon key="w" />],
  [/audit/i, <StampIcon key="x" />],
  [/secretary|mandate|delegation/i, <SignatureIcon key="y" />],
  [/renewal|leave|probation|retirement/i, <CalendarIcon key="z" />],
  [/website|domain/i, <GlobeIcon key="aa" />],
  [/\bIT\b|system access|login/, <LaptopIcon key="ab" />],
  [/blocked|prohibit/i, <ProhibitIcon key="ac" />],
  [/staff|people|guard|\bhr\b|appraisal|vacancy/i, <UsersThreeIcon key="ad" />],
  [/office|branch|company/i, <BriefcaseIcon key="ae" />],
];
export function iconFor(text: string): ReactNode {
  return ICONS.find(([re]) => re.test(text))?.[1] ?? <GaugeIcon />;
}

/** One growth figure as a tile; UNKNOWN reads as Unknown in its own colour, never as zero. */
function Fig({ label, value, tone, note }: { label: string; value: number | string; tone: Tone; note?: string }) {
  const unknown = value === 'UNKNOWN';
  return (
    <Stat
      label={label}
      value={typeof value === 'number' || unknown ? n(value as number | 'UNKNOWN') : value}
      tone={unknown ? 'unknown' : tone}
      note={note}
      icon={iconFor(label)}
    />
  );
}

export function GrowthPanel() {
  const { setCompanyId, go } = useApp();
  const { data, error } = useLoad(() => api.growth(), []);
  const [margin, setMargin] = useState<GrowthMargin | null>(null);
  const [marginErr, setMarginErr] = useState<string | null>(null);
  const [marginBusy, setMarginBusy] = useState(false);
  const [showUnknown, setShowUnknown] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="growth figures" />;
  const g = data.group;
  const known = data.rows.filter((r) => r.contractValue != null);
  const unknown = data.rows.filter((r) => r.contractValue == null);
  const loadMargin = () => {
    setMarginBusy(true);
    setMarginErr(null);
    api.growthMargin().then(setMargin, (e) => setMarginErr(e.message)).finally(() => setMarginBusy(false));
  };
  const open = (r: GrowthCompany, view: 'contracts' | 'roster' | 'clients') => {
    setCompanyId(r.companyId);
    go({ view });
  };
  const of = (n: number) => `${n} of ${g.known.of} companies`;
  return (
    <Card
      title={<span id="growth-title">Growth</span>}
      sub="Is the group growing, and where it is not. Figures come from what the companies already keep in Prima (contracts, sales leads, roster) and from Finance's month-end ageing. A company with nothing recorded shows Unknown, never zero."
      actions={<Chip tone={g.changePct == null ? 'unknown' : g.changePct < 0 ? 'warn' : 'ok'}>{data.month}</Chip>}
    >
      <div className="growth">
      <Stats>
        <Fig
          label="Contract value a month"
          value={rmK(g.contractValue)}
          tone={g.changePct == null ? 'neutral' : g.changePct < 0 ? 'warn' : 'ok'}
          note={`${pct(g.changePct)} on ${data.prevMonth} · ${of(g.known.contracts)}`}
        />
        <Fig
          label="Contracts ending in 90 days"
          value={g.ending90Count ?? 'UNKNOWN'}
          tone={g.ending90Count == null ? 'neutral' : g.ending90Count ? 'warn' : 'ok'}
          note={g.ending90Count == null ? 'No contracts recorded in Prima yet' : `${rmK(g.ending90Monthly)} a month to renew or replace · ${of(g.known.contracts)}`}
        />
        <Fig
          label="Sales pipeline"
          value={rmK(g.pipelineMonthly)}
          tone="neutral"
          note={g.pipelineCount == null ? 'No sales leads recorded yet' : `${g.pipelineCount} open leads · ${of(g.known.pipeline)}`}
        />
        <Fig
          label={`Under-billed in ${data.prevMonth}`}
          value={rmK(g.underBilled)}
          tone={g.underContracts == null ? 'neutral' : g.underContracts || g.missingInvoices ? 'crit' : 'ok'}
          note={
            g.underContracts == null
              ? `No contract billed the whole of ${data.prevMonth} to check`
              : `${g.underContracts} contracts billed below the contract · ${g.missingInvoices} invoices not recorded · ${of(g.known.billing)}`
          }
        />
        <Fig label="Unfilled shifts, next 7 days" value={g.unfilled7 ?? 'UNKNOWN'} tone={g.unfilled7 ? 'warn' : g.unfilled7 === 0 ? 'ok' : 'neutral'} note={of(g.known.roster) + ' keep a roster here'} />
        <Fig
          label="Collection days"
          value={g.collectionDays ?? 'UNKNOWN'}
          tone={g.collectionDays == null ? 'neutral' : g.collectionDays > 60 ? 'crit' : g.collectionDays > 45 ? 'warn' : 'ok'}
          note={g.known.collection ? `Debtors over a month's billing · ${of(g.known.collection)}` : 'Waits for Finance to record the SQL Account ageing'}
        />
      </Stats>

      <div className="growth-margin">
        <div className="growth-sub">
          <h3>Site margin</h3>
          {!margin && (
            <button className="btn btn-sm" onClick={loadMargin} disabled={marginBusy}>
              {marginBusy ? 'Loading…' : 'Load site margin'}
            </button>
          )}
          {marginErr && <span className="muted small">{marginErr}</span>}
        </div>
        {margin && (
          <Stats>
            {margin.sectors.map((s) => (
              <Fig
                key={s.sector}
                label={`${s.sector === 'government' ? 'Government' : 'Private'} sites margin, ${margin.month}`}
                value={s.error ? s.error : s.known ? (s.marginPct == null ? 'UNKNOWN' : `${s.marginPct}%`) : 'UNKNOWN'}
                tone={s.error || !s.known ? 'neutral' : s.lossSites ? 'warn' : 'ok'}
                note={s.error ? undefined : `${s.known} of ${s.sites} sites complete${s.known ? ` · ${rmK(s.margin)} on ${rmK(s.revenue)} · ${s.lossSites} losing money` : ''}`}
              />
            ))}
          </Stats>
        )}
      </div>

      <div className="growth-companies">
      <h3>By company</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Contract value a month</th>
              <th>Change</th>
              <th>Ending in 90 days</th>
              <th>Pipeline</th>
              <th>Under-billed {data.prevMonth}</th>
              <th>Unfilled, 7 days</th>
              <th>Collection days</th>
            </tr>
          </thead>
          <tbody>
            {[...known, ...(showUnknown ? unknown : [])].map((r) => (
              <tr key={r.companyId}>
                <td>{r.companyName}</td>
                <td>
                  <button className="btn btn-sm btn-ghost" onClick={() => open(r, 'contracts')}>
                    {r.contractValue == null ? 'Unknown' : rm(r.contractValue)}
                  </button>
                </td>
                <td>
                  <Chip tone={r.changePct == null ? 'unknown' : r.changePct < 0 ? 'warn' : 'ok'}>{pct(r.changePct)}</Chip>
                </td>
                <td>{r.ending90 ? `${r.ending90.count} · ${rm(r.ending90.monthly)}` : 'Unknown'}</td>
                <td>
                  {r.pipeline ? (
                    <button className="btn btn-sm btn-ghost" onClick={() => open(r, 'clients')}>
                      {`${r.pipeline.count} · ${rm(r.pipeline.monthly)}${r.pipeline.unpriced ? ` (${r.pipeline.unpriced} not priced)` : ''}`}
                    </button>
                  ) : (
                    'Unknown'
                  )}
                </td>
                <td>{r.billing ? `${rm(r.billing.underBilled)} · ${r.billing.underContracts} under, ${r.billing.missing} missing` : 'Unknown'}</td>
                <td>
                  {r.unfilled7 == null ? (
                    'Unknown'
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => open(r, 'roster')}>
                      {r.unfilled7}
                    </button>
                  )}
                </td>
                <td title={r.collectionNote}>{r.collectionDays ?? 'Unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unknown.length > 0 && (
        <button className="btn btn-sm btn-ghost growth-more" aria-expanded={showUnknown} onClick={() => setShowUnknown((x) => !x)}>
          {showUnknown ? 'Hide' : 'Show'} {unknown.length} companies with no contracts recorded in Prima yet
        </button>
      )}
      </div>
      </div>
    </Card>
  );
}
