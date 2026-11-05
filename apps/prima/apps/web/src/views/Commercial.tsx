import { JointTenders } from './JointTenders';
import { LeadsPanel } from './Leads';
import { useState } from 'react';
import type { Quotation, QuotationStatus, TenderStatus } from '@prima/core';
import { api, type Commercial, type QuotationAction } from '../api';
import { useApp } from '../App';
import { ProtocolPanel, TenderSteps, stepsMissing } from './TenderProtocol';
import { PriorityChip, TenderBidFiles, TenderChecklist, TenderChecks, TenderDecisionPanel, TenderPapers, TenderQueries, TenderRecordPanel } from './TenderFlow';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Findings, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, Facts, PageHead, Stat, Stats } from '../kit';
import { CalendarBlankIcon, FileTextIcon, HourglassIcon, PlusIcon, ProhibitIcon } from '@phosphor-icons/react';
import '../styles/biz.css';

const TENDER_STATUS: Record<TenderStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'neutral' },
  won: { label: 'Won', tone: 'ok' },
  lost: { label: 'Lost', tone: 'neutral' },
  no_bid: { label: 'No bid', tone: 'neutral' },
};

const QUOTE_STATUS: Record<QuotationStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  awaiting_approval: { label: 'Waiting for approval', tone: 'warn' },
  returned: { label: 'Returned for changes', tone: 'crit' },
  approved: { label: 'Approved, not sent', tone: 'info' },
  sent: { label: 'Sent to client', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

type TenderRow = Commercial['tenders'][number];

export function rm(n: number | null): string {
  return n === null ? '–' : `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Company admin desk for bidding papers, tenders and quotations (V3 tenders, V4 admin roles, V12 quotation authority). */
export function CommercialView({ openTenderId }: { openTenderId?: string } = {}) {
  const { companyId, company, me } = useApp();
  const { data, error } = useLoad(() => api.commercial(companyId), [companyId]);
  const [openTender, setOpenTender] = useState<string | null>(openTenderId ?? null);
  const [openQuote, setOpenQuote] = useState<string | null>(null);
  const [newQuote, setNewQuote] = useState<{ tenderId: string | null; client: string } | null>(null);

  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="tenders and quotations" />
      </div>
    );

  const live = data.tenders.filter((t) => t.tender.status === 'open' || t.tender.status === 'preparing');
  const tender = data.tenders.find((t) => t.tender.id === openTender);
  const quote = data.quotations.find((q) => q.id === openQuote);

  const blocked = live.filter((t) => t.findings.some((f) => f.level === 'block')).length;
  const awaitingQuotes = data.quotations.filter((q) => q.status === 'awaiting_approval').length;
  const byClose = (a: TenderRow, b: TenderRow) => a.tender.closesOn.localeCompare(b.tender.closesOn);
  const stages: { key: string; label: string; rows: TenderRow[] }[] = [
    { key: 'open', label: 'Open', rows: data.tenders.filter((t) => t.tender.status === 'open').sort(byClose) },
    { key: 'preparing', label: 'Preparing', rows: data.tenders.filter((t) => t.tender.status === 'preparing').sort(byClose) },
    { key: 'submitted', label: 'Submitted', rows: data.tenders.filter((t) => t.tender.status === 'submitted').sort(byClose) },
    {
      key: 'decided',
      label: 'Decided',
      rows: data.tenders.filter((t) => t.tender.status === 'won' || t.tender.status === 'lost' || t.tender.status === 'no_bid').sort((a, b) => byClose(b, a)),
    },
  ];

  return (
    <div className="page bz-tn-page">
      <PageHead
        title="Tenders and quotations"
        sub={
          <>
            Every bid and quotation is in {company?.name ?? 'this company'}'s own name, so its own papers decide whether it can bid. Government tenders are tracked by
            the Director Office Administrator, private ones by the COO / Private Sector team or a branch. The admin team prepares; the Company Manager approves.
          </>
        }
        actions={
          data.can.prepare && (
            <button className="btn btn-primary" onClick={() => setNewQuote({ tenderId: null, client: '' })}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              New quotation
            </button>
          )
        }
      />

      <Stats>
        <Stat label="Tenders to work on" value={live.length} note="Open or being prepared" icon={<FileTextIcon size={16} />} tone="info" />
        <Stat
          label="Closing in 14 days"
          value={live.filter((t) => t.daysLeft <= 14).length}
          note={live.some((t) => t.daysLeft <= 7) ? 'At least one closes within a week' : 'Nothing closes within a week'}
          tone={live.some((t) => t.daysLeft <= 7) ? 'warn' : undefined}
          icon={<CalendarBlankIcon size={16} />}
        />
        <Stat label="Cannot bid yet" value={blocked} note="Papers block the bid" tone={blocked ? 'crit' : 'ok'} icon={<ProhibitIcon size={16} />} />
        <Stat
          label="Quotes waiting approval"
          value={awaitingQuotes}
          note="With the Company Manager"
          tone={awaitingQuotes ? 'warn' : undefined}
          icon={<HourglassIcon size={16} />}
        />
      </Stats>

      <Card title="Tender pipeline" sub="Closing date first. Open a tender to work on its papers, steps and bid files." actions={<span className="bz-count">{data.tenders.length}</span>}>
        {data.tenders.length === 0 ? (
          <Empty title="No tenders recorded for this company yet." />
        ) : (
          <div className="bz-board" aria-label="Tenders by stage">
            {stages.map((st) => (
              <section key={st.key} className="bz-col" aria-label={st.label}>
                <div className="bz-col-head">
                  <span>{st.label}</span>
                  <span className="bz-count">{st.rows.length}</span>
                </div>
                {st.rows.length === 0 && <div className="bz-col-empty">None</div>}
                {st.rows.map((t) => (
                  <TenderTile key={t.tender.id} t={t} onOpen={() => setOpenTender(t.tender.id)} />
                ))}
              </section>
            ))}
          </div>
        )}
      </Card>

      <div className="bz-two">
        <Card title="Can this company bid today?" sub="Government tenders also need MOF" flush>
          <ul className="bz-rows">
            {data.biddingPapers.map((p) => (
              <li key={p.type} className="bz-row">
                <span className="bz-row-main">
                  <span className="bz-row-title">{p.label}</span>
                  <span className="bz-row-meta">{p.expiresOn ? `Expires ${dateLabel(p.expiresOn)}` : 'No record'}</span>
                </span>
                <span className="bz-row-side">
                  <ExpiryChip status={p.status} daysLeft={p.daysLeft} />
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Quotations" sub="Prices are typed in by the admin team until costing rules are approved" flush>
          {data.quotations.length === 0 ? (
            <Empty title="No quotations yet." />
          ) : (
            <ul className="bz-rows">
              {data.quotations.map((q) => (
                <li key={q.id}>
                  <button className="bz-row" data-tone={q.status === 'returned' ? 'crit' : q.status === 'awaiting_approval' ? 'warn' : undefined} onClick={() => setOpenQuote(q.id)}>
                    <span className="bz-row-main">
                      <span className="bz-row-title">
                        {q.client} <span className="muted small mono">{q.ref}</span>
                      </span>
                      <span className="bz-row-meta">
                        {q.siteName ? `${q.siteName} · ` : ''}
                        {q.guards} guards × {q.hoursPerDay}h · valid to {dateLabel(q.validUntil)}
                      </span>
                    </span>
                    <span className="bz-row-side">
                      <span className="bz-amt">{rm(q.monthlyTotal)}</span>
                      <span className="bz-sub">a month</span>
                      <Chip tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Chip>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(me.user.role === 'company_manager' || me.user.role === 'admin_exec') && <JointTenders />}

      <LeadsPanel companyId={companyId} />

      <ProtocolPanel p={data.protocol} />

      {tender && (
        <TenderDrawer
          row={tender}
          can={data.can}
          doa={data.doa}
          reader={data.reader}
          quotations={data.quotations.filter((q) => q.tenderId === tender.tender.id)}
          onClose={() => setOpenTender(null)}
          onQuote={() => {
            setOpenTender(null);
            setNewQuote({ tenderId: tender.tender.id, client: tender.tender.buyer });
          }}
        />
      )}
      {quote && (
        <QuoteDrawer
          q={quote}
          can={data.can}
          tenderTitle={data.tenders.find((t) => t.tender.id === quote.tenderId)?.tender.title}
          onClose={() => setOpenQuote(null)}
        />
      )}
      {newQuote && <NewQuoteDrawer companyId={companyId} initial={newQuote} tenders={live} onClose={() => setNewQuote(null)} />}
    </div>
  );
}

/** One tender on the pipeline: the closing date is what matters most while it is live. */
function TenderTile({ t, onOpen }: { t: TenderRow; onOpen: () => void }) {
  const tn = t.tender;
  const isLive = tn.status === 'open' || tn.status === 'preparing';
  const tone = !isLive ? undefined : t.findings.some((f) => f.level === 'block') || t.daysLeft <= 7 ? 'crit' : t.daysLeft <= 14 ? 'warn' : undefined;
  return (
    <button type="button" className="bz-tile" data-tone={tone} onClick={onOpen}>
      <span className="bz-row-main">
        <span className="bz-row-title">{tn.title}</span>
        <span className="bz-row-meta">
          {tn.buyer} · <span className="mono">{tn.ref}</span>
        </span>
      </span>
      <span className="bz-tn-close" data-tone={tone}>
        <span className="bz-tn-close-date">
          <span className="bz-sub">Closes</span>
          <strong>{dateLabel(tn.closesOn)}</strong>
        </span>
        {isLive && <span className="bz-tn-days">{t.daysLeft >= 0 ? `${t.daysLeft} days left` : 'Closed'}</span>}
      </span>
      {isLive && <span className="bz-row-meta">{t.stage}</span>}
      <span className="bz-chips">
        {!isLive && <Chip tone={TENDER_STATUS[tn.status].tone}>{TENDER_STATUS[tn.status].label}</Chip>}
        {isLive && <EligibilityChip row={t} />}
        <PriorityChip p={t.priority} />
      </span>
      <span className="bz-tile-foot">
        <span>
          {tn.channel === 'GOVERNMENT' ? 'Government' : 'Private'} · {tn.owner}
        </span>
        <span>{tn.guards} guards</span>
      </span>
    </button>
  );
}

function EligibilityChip({ row }: { row: TenderRow }) {
  if (row.tender.status !== 'open' && row.tender.status !== 'preparing') return <span className="muted small">–</span>;
  if (row.findings.some((f) => f.level === 'block')) return <Chip tone="crit">Blocked</Chip>;
  if (row.findings.length) return <Chip tone="warn">Check papers</Chip>;
  return <Chip tone="ok">Can bid</Chip>;
}

function TenderDrawer({
  row,
  can,
  doa,
  reader,
  quotations,
  onClose,
  onQuote,
}: {
  row: TenderRow;
  can: Commercial['can'];
  doa: boolean;
  reader: Commercial['reader'];
  quotations: Quotation[];
  onClose: () => void;
  onQuote: () => void;
}) {
  const t = row.tender;
  const { me } = useApp();
  const role = me.user.role;
  const act = useAction();
  const set = async (status: TenderStatus) => {
    const r = await act.run(() => api.updateTender(t.id, status), `${t.ref} marked ${TENDER_STATUS[status].label.toLowerCase()}.`);
    if (r) onClose();
  };
  return (
    <Drawer title={t.title} sub={`${t.buyer} · ${t.ref}`} onClose={onClose}>
      <div className="bz-chips">
        <Chip tone={TENDER_STATUS[t.status].tone}>{TENDER_STATUS[t.status].label}</Chip>
        {(t.status === 'open' || t.status === 'preparing') && <EligibilityChip row={row} />}
        <PriorityChip p={row.priority} />
      </div>
      <div className="bz-facts">
        <Facts
          items={[
            ['Closes', <strong key="c">{dateLabel(t.closesOn)}{(t.status === 'open' || t.status === 'preparing') && row.daysLeft >= 0 ? ` · ${row.daysLeft} days left` : ''}</strong>],
            ['Estimated value', t.estMonthly ? `${rm(t.estMonthly)} a month` : 'Not known'],
            ['Size', `${t.guards} guards, ${t.sites} site${t.sites === 1 ? '' : 's'}`],
            ['Type', t.channel === 'GOVERNMENT' ? 'Government' : 'Private'],
            ['Source', t.source],
            ['Leads the pursuit', t.owner],
          ]}
        />
      </div>
      <section className="bz-sec">
        <h3>Can this company bid?</h3>
        {t.status !== 'open' && t.status !== 'preparing' ? (
          <p className="muted">This tender is {TENDER_STATUS[t.status].label.toLowerCase()}.</p>
        ) : row.findings.length === 0 ? (
          <div className="notice" data-tone="ok">
            Yes. The papers this tender needs are valid to the closing date.
          </div>
        ) : (
          <Findings items={row.findings} />
        )}
      </section>
      <TenderRecordPanel row={row} canEdit={can.prepare || row.canConfirmNa} />
      <TenderDecisionPanel row={row} />
      <TenderPapers row={row} canUpload={can.prepare || doa} />
      <TenderQueries row={row} canEdit={can.prepare || row.canConfirmNa} />
      <TenderSteps row={row} canPrepare={can.prepare} isManager={can.approve && role === 'company_manager'} />
      <TenderChecklist row={row} canPrepare={can.prepare} doa={doa} reader={reader} />
      <TenderBidFiles row={row} canPrepare={can.prepare} doa={doa} />
      <TenderChecks row={row} canPrepare={can.prepare} missing={[...stepsMissing(row, 'submitted'), ...row.bidFileGaps]} />
      <section className="bz-sec">
        <h3>Quotations for this tender</h3>
        {quotations.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="bz-rows bz-tn-boxed">
            {quotations.map((q) => (
              <li key={q.id} className="bz-row">
                <span className="bz-row-main">
                  <span className="bz-row-title mono">{q.ref}</span>
                  <span className="bz-row-meta">{rm(q.monthlyTotal)} a month</span>
                </span>
                <span className="bz-row-side">
                  <Chip tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Chip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ErrorNotice error={act.error} />
      <div className="bz-actions bz-tn-foot">
        {can.prepare && (t.status === 'open' || t.status === 'preparing') && (
          <button className="btn" onClick={onQuote}>
            Prepare quotation
          </button>
        )}
        {can.prepare && t.status === 'open' && (
          <button className="btn" disabled={act.busy || stepsMissing(row, 'preparing').length > 0} onClick={() => set('preparing')}>
            Start preparing
          </button>
        )}
        {can.approve && (t.status === 'open' || t.status === 'preparing') && (
          <button className="btn" disabled={act.busy} onClick={() => set('no_bid')}>
            Decide no bid
          </button>
        )}
        {can.approve && t.status === 'submitted' && (
          <>
            <button className="btn" disabled={act.busy} onClick={() => set('won')}>
              Mark won
            </button>
            <button className="btn" disabled={act.busy} onClick={() => set('lost')}>
              Mark lost
            </button>
          </>
        )}
      </div>
      {can.prepare && t.status === 'open' && stepsMissing(row, 'preparing').length > 0 && (
        <p className="muted small">Follow the protocol first. Still to do: {stepsMissing(row, 'preparing').join(', ')}.</p>
      )}
      {!can.prepare && <p className="muted small">You can view this tender. The company's admin team and manager update it.</p>}
      <p className="muted small">The bid itself is lodged by an authorised person on the portal. The app records it and keeps the evidence.</p>
    </Drawer>
  );
}

function QuoteDrawer({ q, can, tenderTitle, onClose }: { q: Quotation; can: Commercial['can']; tenderTitle?: string; onClose: () => void }) {
  const { me } = useApp();
  const act = useAction();
  const [note, setNote] = useState('');
  const run = async (action: QuotationAction) => {
    const r = await act.run(
      () => api.quotationAction(q.id, action, note),
      (x) => `${x.ref}: ${QUOTE_STATUS[x.status].label.toLowerCase()}.`,
    );
    if (r) onClose();
  };
  const ownQuote = q.preparedById === me.user.id;
  // A draft or returned quotation's numbers can be corrected with a reason; every change is audited (review, 2 Nov 2026).
  const [fix, setFix] = useState<null | { guards: string; hoursPerDay: 8 | 12; ratePerGuard: string; validUntil: string; reason: string }>(null);
  const saveFix = async () => {
    if (!fix) return;
    const r = await act.run(
      () =>
        api.correctQuotation(q.id, {
          guards: Number(fix.guards),
          hoursPerDay: fix.hoursPerDay,
          ratePerGuard: Number(fix.ratePerGuard),
          validUntil: fix.validUntil,
          reason: fix.reason,
        }),
      (x) => `${x.ref} corrected.`,
    );
    if (r) onClose();
  };
  return (
    <Drawer title={`${q.ref} · ${q.client}`} sub={<Chip tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Chip>} onClose={onClose}>
      <div className="bz-tn-total">
        <span className="bz-sub">Total</span>
        <strong className="bz-amt">{rm(q.monthlyTotal)}</strong>
        <span className="bz-sub">a month</span>
      </div>
      <div className="bz-facts">
        <Facts
          items={[
            ['Site', q.siteName || '–'],
            ['Tender', tenderTitle ?? 'Direct quotation'],
            ['Guards', `${q.guards} × ${q.hoursPerDay}-hour shifts`],
            ['Rate per guard', `${rm(q.ratePerGuard)} a month`],
            ['Valid until', dateLabel(q.validUntil)],
            ['Prepared by', `${q.preparedBy}, ${dateTimeLabel(q.preparedAt)}`],
            ['Approved by', q.approvedBy ? `${q.approvedBy}, ${dateTimeLabel(q.approvedAt!)}` : '–'],
          ]}
        />
      </div>
      {q.note && (
        <div className="notice" data-tone={q.status === 'returned' ? 'warn' : 'info'}>
          {q.note}
        </div>
      )}
      <div className="notice" data-tone="info">
        Price check is manual for now. Automatic cost checks (minimum wage, overtime, EPF, SOCSO, EIS) start once the costing rules are approved.
      </div>
      {(can.prepare || can.approve) && ['draft', 'returned', 'awaiting_approval', 'approved', 'sent'].includes(q.status) && (
        <div className="field">
          <label className="label" htmlFor="q-note">
            Note {q.status === 'awaiting_approval' && can.approve ? '(needed to return it)' : '(optional)'}
          </label>
          <textarea id="q-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {can.prepare && (q.status === 'draft' || q.status === 'returned') && !fix && (
        <button
          className="btn btn-sm"
          onClick={() => setFix({ guards: String(q.guards), hoursPerDay: q.hoursPerDay, ratePerGuard: String(q.ratePerGuard), validUntil: q.validUntil, reason: '' })}
        >
          Correct guards, rate or date
        </button>
      )}
      {fix && (
        <div className="bz-act">
          <h3 className="bz-tn-act-title">Correct guards, rate or date</h3>
          <div className="bz-form">
            <label className="field">
              <span className="label">Guards</span>
              <input className="input" type="number" min={1} max={1000} value={fix.guards} onChange={(e) => setFix({ ...fix, guards: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Hours a day</span>
              <select className="select" value={fix.hoursPerDay} onChange={(e) => setFix({ ...fix, hoursPerDay: Number(e.target.value) === 8 ? 8 : 12 })}>
                <option value={8}>8</option>
                <option value={12}>12</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Rate per guard (RM a month)</span>
              <input className="input" type="number" min={1} step="0.01" value={fix.ratePerGuard} onChange={(e) => setFix({ ...fix, ratePerGuard: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Valid until</span>
              <input className="input" type="date" value={fix.validUntil} onChange={(e) => setFix({ ...fix, validUntil: e.target.value })} />
            </label>
            <label className="field bz-span">
              <span className="label">Reason for the correction (needed)</span>
              <input className="input" value={fix.reason} maxLength={500} onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
            </label>
          </div>
          <div className="bz-actions">
            <button className="btn btn-sm btn-primary" disabled={act.busy || !fix.reason.trim()} onClick={saveFix}>
              Save correction
            </button>
            <button className="btn btn-sm" onClick={() => setFix(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div className="bz-actions bz-tn-foot">
        {can.prepare && (q.status === 'draft' || q.status === 'returned') && (
          <button className="btn btn-primary" disabled={act.busy} onClick={() => run('submit')}>
            Send to manager for approval
          </button>
        )}
        {can.approve && q.status === 'awaiting_approval' && (
          <>
            <button className="btn btn-primary" disabled={act.busy || ownQuote} onClick={() => run('approve')}>
              Approve
            </button>
            <button className="btn" disabled={act.busy} onClick={() => run('return')}>
              Return for changes
            </button>
          </>
        )}
        {can.prepare && q.status === 'approved' && (
          <button className="btn btn-primary" disabled={act.busy} onClick={() => run('sent')}>
            Mark sent to client
          </button>
        )}
        {can.prepare && q.status === 'sent' && (
          <>
            <button className="btn" disabled={act.busy} onClick={() => run('accepted')}>
              Client accepted
            </button>
            <button className="btn" disabled={act.busy} onClick={() => run('rejected')}>
              Client rejected
            </button>
          </>
        )}
      </div>
      {ownQuote && q.status === 'awaiting_approval' && <p className="muted small">You prepared this quotation, so another person must approve it.</p>}
      {q.status === 'awaiting_approval' && !can.approve && <p className="muted small">Waiting for the Company Manager.</p>}
      {q.status === 'accepted' && <p className="muted small">Next: the signed contract and client onboarding (Wave 2).</p>}
    </Drawer>
  );
}

function NewQuoteDrawer({
  companyId,
  initial,
  tenders,
  onClose,
}: {
  companyId: string;
  initial: { tenderId: string | null; client: string };
  tenders: TenderRow[];
  onClose: () => void;
}) {
  const act = useAction();
  const [client, setClient] = useState(initial.client);
  const [siteName, setSiteName] = useState('');
  const [tenderId, setTenderId] = useState(initial.tenderId ?? '');
  const [guards, setGuards] = useState('4');
  const [hours, setHours] = useState<8 | 12>(12);
  const [rate, setRate] = useState('');
  const [validDays, setValidDays] = useState('30');
  const total = (Number(guards) || 0) * (Number(rate) || 0);
  const save = async () => {
    const r = await act.run(
      () =>
        api.createQuotation(companyId, {
          client,
          siteName,
          tenderId: tenderId || null,
          guards: Number(guards),
          hoursPerDay: hours,
          ratePerGuard: Number(rate),
          validDays: Number(validDays),
        }),
      (q) => `${q.ref} saved as a draft.`,
    );
    if (r) onClose();
  };
  return (
    <Drawer title="New quotation" sub="Saved as a draft. The Company Manager approves it before it goes to the client." onClose={onClose}>
      <div className="bz-form">
        <div className="field bz-span">
          <label className="label" htmlFor="nq-client">
            Client
          </label>
          <input id="nq-client" className="input" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nq-site">
            Site
          </label>
          <input id="nq-site" className="input" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nq-tender">
            For tender
          </label>
          <select id="nq-tender" className="select" value={tenderId} onChange={(e) => setTenderId(e.target.value)}>
            <option value="">Direct quotation (no tender)</option>
            {tenders.map((t) => (
              <option key={t.tender.id} value={t.tender.id}>
                {t.tender.ref} · {t.tender.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="nq-guards">
            Guards
          </label>
          <input id="nq-guards" className="input num" inputMode="numeric" value={guards} onChange={(e) => setGuards(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Shift length</span>
          <div className="seg" role="group" aria-label="Shift length">
            <button type="button" aria-pressed={hours === 12} onClick={() => setHours(12)}>
              12 hours
            </button>
            <button type="button" aria-pressed={hours === 8} onClick={() => setHours(8)}>
              8 hours
            </button>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="nq-rate">
            RM per guard a month
          </label>
          <input id="nq-rate" className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 3200" />
        </div>
        <div className="field">
          <label className="label" htmlFor="nq-valid">
            Valid for (days)
          </label>
          <input id="nq-valid" className="input num" inputMode="numeric" value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </div>
      </div>
      <div className="notice" data-tone="info">
        Total {rm(total)} a month. Check the rate against wages, overtime and statutory contributions before sending it for approval.
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button className="btn btn-primary" disabled={act.busy || !client.trim() || !rate} onClick={save}>
          Save draft
        </button>
      </div>
    </Drawer>
  );
}
