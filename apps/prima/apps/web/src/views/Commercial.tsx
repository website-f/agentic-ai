import { JointTenders } from './JointTenders';
import { LeadsPanel } from './Leads';
import { useState } from 'react';
import type { Quotation, QuotationStatus, TenderStatus } from '@prima/core';
import { api, type Commercial, type QuotationAction } from '../api';
import { useApp } from '../App';
import { ProtocolPanel, TenderSteps, stepsMissing } from './TenderProtocol';
import { PriorityChip, TenderBidFiles, TenderChecklist, TenderChecks, TenderDecisionPanel, TenderPapers, TenderQueries, TenderRecordPanel } from './TenderFlow';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Findings, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tenders and quotations</h1>
          <p>
            Every bid and quotation is in {company?.name ?? 'this company'}'s own name, so its own papers decide whether it can bid. Government tenders are
            tracked by the Director Office Administrator, private ones by the COO / Private Sector team or a branch. The admin team prepares; the Company
            Manager approves.
          </p>
        </div>
        {data.can.prepare && (
          <button className="btn btn-primary" onClick={() => setNewQuote({ tenderId: null, client: '' })}>
            New quotation
          </button>
        )}
      </div>

      {(me.user.role === 'company_manager' || me.user.role === 'admin_exec') && <JointTenders />}

      <section className="panel">
        <div className="panel-head">
          <h3>Can this company bid today?</h3>
          <span className="muted small">Government tenders also need MOF</span>
        </div>
        <div className="list">
          {data.biddingPapers.map((p) => (
            <div key={p.type} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div className="muted small">{p.expiresOn ? `Expires ${dateLabel(p.expiresOn)}` : 'No record'}</div>
              </div>
              <ExpiryChip status={p.status} daysLeft={p.daysLeft} />
            </div>
          ))}
        </div>
      </section>

      <LeadsPanel companyId={companyId} />

      <div className="kpis">
        <Kpi label="Tenders to work on" value={live.length} />
        <Kpi label="Closing in 14 days" value={live.filter((t) => t.daysLeft <= 14).length} tone={live.some((t) => t.daysLeft <= 7) ? 'warn' : undefined} />
        <Kpi
          label="Cannot bid yet"
          value={live.filter((t) => t.findings.some((f) => f.level === 'block')).length}
          tone={live.some((t) => t.findings.some((f) => f.level === 'block')) ? 'crit' : 'ok'}
          note="Papers block the bid"
        />
        <Kpi label="Quotes waiting approval" value={data.quotations.filter((q) => q.status === 'awaiting_approval').length} tone="warn" />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Tenders</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tender</th>
                <th className="hide-sm">Type</th>
                <th>Closes</th>
                <th className="hide-sm">Guards</th>
                <th>Can bid?</th>
              </tr>
            </thead>
            <tbody>
              {data.tenders.map((t) => (
                <tr key={t.tender.id} className="clickable" onClick={() => setOpenTender(t.tender.id)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.tender.title}</div>
                    <div className="muted small">
                      {t.tender.buyer} · <span className="mono">{t.tender.ref}</span>
                    </div>
                    <div className="row" style={{ marginTop: 4, gap: 6, flexWrap: 'wrap' }}>
                      <Chip tone={TENDER_STATUS[t.tender.status].tone}>{TENDER_STATUS[t.tender.status].label}</Chip>
                      {(t.tender.status === 'open' || t.tender.status === 'preparing') && <span className="muted small">{t.stage}</span>}
                      <PriorityChip p={t.priority} />
                    </div>
                  </td>
                  <td className="hide-sm">
                    <div>{t.tender.channel === 'GOVERNMENT' ? 'Government' : 'Private'}</div>
                    <div className="muted small">{t.tender.owner}</div>
                  </td>
                  <td className="num">
                    <div>{dateLabel(t.tender.closesOn)}</div>
                    {(t.tender.status === 'open' || t.tender.status === 'preparing') && (
                      <div className="muted small">{t.daysLeft >= 0 ? `${t.daysLeft} days left` : 'Closed'}</div>
                    )}
                  </td>
                  <td className="num hide-sm">{t.tender.guards}</td>
                  <td>
                    <EligibilityChip row={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.tenders.length === 0 && <div className="empty">No tenders recorded for this company yet.</div>}
        </div>
      </section>

      <ProtocolPanel p={data.protocol} />

      <section className="panel">
        <div className="panel-head">
          <h3>Quotations</h3>
          <span className="muted small">Prices are typed in by the admin team until costing rules are approved</span>
        </div>
        <div className="list">
          {data.quotations.map((q) => (
            <button key={q.id} className="list-item list-button" onClick={() => setOpenQuote(q.id)}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {q.client} <span className="muted small mono">{q.ref}</span>
                </div>
                <div className="muted small">
                  {q.siteName ? `${q.siteName} · ` : ''}
                  {q.guards} guards × {q.hoursPerDay}h · {rm(q.monthlyTotal)} a month · valid to {dateLabel(q.validUntil)}
                </div>
              </div>
              <Chip tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Chip>
            </button>
          ))}
          {data.quotations.length === 0 && <div className="empty">No quotations yet.</div>}
        </div>
      </section>

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

function EligibilityChip({ row }: { row: TenderRow }) {
  if (row.tender.status !== 'open' && row.tender.status !== 'preparing') return <span className="muted small">–</span>;
  if (row.findings.some((f) => f.level === 'block')) return <Chip tone="crit">Blocked</Chip>;
  if (row.findings.length) return <Chip tone="warn">Check papers</Chip>;
  return <Chip tone="ok">Yes</Chip>;
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
      <div className="grid-2">
        <div>
          <div className="label">Type</div>
          <div>{t.channel === 'GOVERNMENT' ? 'Government' : 'Private'}</div>
        </div>
        <div>
          <div className="label">Source</div>
          <div>{t.source}</div>
        </div>
        <div>
          <div className="label">Leads the pursuit</div>
          <div>{t.owner}</div>
        </div>
        <div>
          <div className="label">Closes</div>
          <div>{dateLabel(t.closesOn)}</div>
        </div>
        <div>
          <div className="label">Size</div>
          <div>
            {t.guards} guards, {t.sites} site{t.sites === 1 ? '' : 's'}
          </div>
        </div>
        <div>
          <div className="label">Estimated value</div>
          <div>{t.estMonthly ? `${rm(t.estMonthly)} a month` : 'Not known'}</div>
        </div>
      </div>
      <section>
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
      <section>
        <h3>Quotations for this tender</h3>
        {quotations.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="list">
            {quotations.map((q) => (
              <div key={q.id} className="list-item">
                <span>
                  {q.ref} · {rm(q.monthlyTotal)} a month
                </span>
                <Chip tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Chip>
              </div>
            ))}
          </div>
        )}
      </section>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
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
  return (
    <Drawer title={`${q.ref} · ${q.client}`} sub={<Chip tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Chip>} onClose={onClose}>
      <div className="grid-2">
        <div>
          <div className="label">Site</div>
          <div>{q.siteName || '–'}</div>
        </div>
        <div>
          <div className="label">Tender</div>
          <div>{tenderTitle ?? 'Direct quotation'}</div>
        </div>
        <div>
          <div className="label">Guards</div>
          <div>
            {q.guards} × {q.hoursPerDay}-hour shifts
          </div>
        </div>
        <div>
          <div className="label">Rate per guard</div>
          <div>{rm(q.ratePerGuard)} a month</div>
        </div>
        <div>
          <div className="label">Total</div>
          <div style={{ fontWeight: 600 }}>{rm(q.monthlyTotal)} a month</div>
        </div>
        <div>
          <div className="label">Valid until</div>
          <div>{dateLabel(q.validUntil)}</div>
        </div>
        <div>
          <div className="label">Prepared by</div>
          <div>
            {q.preparedBy}, {dateTimeLabel(q.preparedAt)}
          </div>
        </div>
        <div>
          <div className="label">Approved by</div>
          <div>{q.approvedBy ? `${q.approvedBy}, ${dateTimeLabel(q.approvedAt!)}` : '–'}</div>
        </div>
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
      <ErrorNotice error={act.error} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
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
      <div className="field">
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
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="nq-guards">
            Guards
          </label>
          <input id="nq-guards" className="input num" inputMode="numeric" value={guards} onChange={(e) => setGuards(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Shift length</span>
          <div className="seg">
            <button aria-pressed={hours === 12} onClick={() => setHours(12)}>
              12 hours
            </button>
            <button aria-pressed={hours === 8} onClick={() => setHours(8)}>
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
      <button className="btn btn-primary" disabled={act.busy || !client.trim() || !rate} onClick={save}>
        Save draft
      </button>
    </Drawer>
  );
}
