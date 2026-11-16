import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * Panel firms (Central Admin 5D, Fauzan 2 Nov 2026: keyed in by staff). Central Admin keeps the audit and secretary
 * firms, PWVSB legal keeps the law firms. Law firm fees come from the legal matters already recorded, not keyed again.
 */
type Kind = 'AUDIT' | 'LAW' | 'SECRETARY';
const KIND: Record<Kind, string> = {
  AUDIT: 'Audit firm',
  LAW: 'Law firm',
  SECRETARY: 'Secretary firm',
};

const firmState = (r: FirmRow) => (r.firm.status === 'removed' ? 'Off the panel' : r.reviewDue ? 'Review due' : 'On the panel');
const FIRM_COLUMNS: DtColumn<FirmRow>[] = [
  { id: 'name', label: 'Firm', value: (r) => r.firm.name, render: (r) => <strong>{r.firm.name}</strong>, phone: 'title' },
  { id: 'kind', label: 'Kind', value: (r) => KIND[r.firm.kind], translate: true, phone: 'sub' },
  { id: 'reg', label: 'Registration', value: (r) => r.firm.regNo, hideBelow: 1200 },
  { id: 'contact', label: 'Contact', value: (r) => r.firm.contact, hideBelow: 1300 },
  { id: 'fee', label: 'How they charge', value: (r) => r.firm.feeBasis, sort: false, hideBelow: 1400 },
  { id: 'appointed', label: 'Appointed', value: (r) => r.firm.appointedOn, sort: 'date', hideBelow: 1100 },
  { id: 'review', label: 'Review', value: (r) => r.firm.reviewOn, sort: 'date' },
  { id: 'matters', label: 'Open matters', value: (r) => (r.firm.kind === 'LAW' ? r.openMatters : null), sort: 'number', hideBelow: 1200 },
  { id: 'fees', label: 'Fees this year', value: (r) => (r.firm.kind === 'LAW' ? r.feesThisYear : null), sort: 'money', hideBelow: 1200 },
  {
    id: 'status',
    label: 'Status',
    value: firmState,
    translate: true,
    render: (r) => <Chip tone={r.firm.status === 'removed' ? 'neutral' : r.reviewDue ? 'warn' : 'ok'}>{firmState(r)}</Chip>,
  },
];
const FIRM_FILTERS: DtFilter<FirmRow>[] = [
  { id: 'kind', label: 'Kind', value: (r) => r.firm.kind, optionLabel: (v) => KIND[v as Kind] ?? v },
  { id: 'status', label: 'Status', value: firmState },
];

export function PanelFirmsPanel() {
  const { data, error, reload } = useLoad(() => api.panelBoard(), []);
  const act = useAction();
  const [kind, setKind] = useState<Kind>('AUDIT');
  const [name, setName] = useState('');
  const [regNo, setRegNo] = useState('');
  const [contact, setContact] = useState('');
  const [feeBasis, setFeeBasis] = useState('');
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="panel firms" />;
  const kinds = (Object.keys(KIND) as Kind[]).filter((k) => data.canKeep[k]);
  const r = data.firms.find((x) => x.firm.id === openId);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Panel firms</h3>
      </div>
      {!data.installed && (
        <p className="notice" data-tone="warn">
          The panel list is not set up on this database yet; audits are checked against the starting list until it is.
        </p>
      )}
      {data.installed && kinds.length > 0 && (
        <div className="row">
          <Select aria-label="Kind of firm" value={kinds.includes(kind) ? kind : kinds[0]} onChange={(e) => setKind(e.target.value as Kind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND[k]}
              </option>
            ))}
          </Select>
          <input aria-label="Firm name" placeholder="Firm name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Registration" placeholder="AF number or licence" value={regNo} onChange={(e) => setRegNo(e.target.value)} />
          <input aria-label="Contact" placeholder="Contact person" value={contact} onChange={(e) => setContact(e.target.value)} />
          <input aria-label="Fee basis" placeholder="How they charge" value={feeBasis} onChange={(e) => setFeeBasis(e.target.value)} />
          <input aria-label="Appointed on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () =>
                  api
                    .addPanelFirm({
                      kind: kinds.includes(kind) ? kind : kinds[0],
                      name,
                      regNo,
                      contact,
                      feeBasis,
                      appointedOn: on,
                    })
                    .then(() => {
                      setName('');
                      setRegNo('');
                      reload();
                    }),
                'Firm added.',
              )
            }
          >
            Add firm
          </button>
        </div>
      )}
      {data.canKeep.LAW && data.lawyersNotOnPanel.length > 0 && (
        <p className="small">
          Lawyers on matters but not on the panel:{' '}
          {data.lawyersNotOnPanel.map((l) => (
            <button
              key={l}
              className="btn btn-sm"
              onClick={() => {
                setKind('LAW');
                setName(l);
              }}
            >
              {l}
            </button>
          ))}
        </p>
      )}
      {act.error && <p className="error small">{act.error.message}</p>}
      <DataTable
        label="Panel firms"
        stateKey="board.corporate.panel"
        rows={data.firms}
        rowKey={(r) => r.firm.id}
        columns={FIRM_COLUMNS}
        filters={FIRM_FILTERS}
        onView={(r) => setOpenId(r.firm.id)}
        rowTone={(r) => (r.firm.status !== 'removed' && r.reviewDue ? 'warn' : undefined)}
        actions={(r) => [{ label: r.canKeep && r.firm.status === 'active' ? 'Review' : 'Open', onClick: () => setOpenId(r.firm.id) }]}
        empty={<div className="empty">No firms keyed in yet.</div>}
      />
      {r && (
        <Drawer title={r.firm.name} sub={`${KIND[r.firm.kind]} · ${firmState(r)}`} onClose={() => setOpenId(null)}>
          <div className="item-main">
            <div className="muted small">
              {KIND[r.firm.kind]} · {r.firm.regNo}
              {r.firm.contact ? ` · ${r.firm.contact}` : ''}
              {r.firm.feeBasis ? ` · ${r.firm.feeBasis}` : ''} · appointed {dateLabel(r.firm.appointedOn)} · review {dateLabel(r.firm.reviewOn)}
              {r.firm.kind === 'LAW' ? ` · ${r.openMatters} open matters · fees this year RM${r.feesThisYear}` : ''}
            </div>
            {r.firm.removed && <div className="small">Taken off: {r.firm.removed.note}</div>}
            <AdviserMoney r={r} year={data.year} canAgree={data.canAgreeBudget} reload={reload} />
            {r.canKeep && r.firm.status === 'active' && (
              <div className="row">
                <input aria-label="Note" placeholder="Review note or reason" value={note} onChange={(e) => setNote(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.panelFirmStep(r.firm.id, 'review', note).then(reload), 'Reviewed.')}
                >
                  Record review
                </button>
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.panelFirmStep(r.firm.id, 'remove', note).then(reload), 'Taken off.')}
                >
                  Take off the panel
                </button>
              </div>
            )}
          </div>
          {act.error && <p className="error small">{act.error.message}</p>}
        </Drawer>
      )}
    </section>
  );
}

type FirmRow = NonNullable<Awaited<ReturnType<typeof api.panelBoard>>>['firms'][number];

/**
 * Masterplan §126 (Fauzan 3 Nov 2026): the adviser's yearly budget and, for audit and secretary firms, its invoices.
 * The keeper proposes the budget, the Finance Director agrees it; invoices are keyed once and checked by someone else,
 * then passed to Finance or queried. Law fees come from the legal matters. Prima never pays.
 */
function AdviserMoney({ r, year, canAgree, reload }: { r: FirmRow; year: string; canAgree: boolean; reload: () => void }) {
  const act = useAction();
  const [b, setB] = useState({ amount: '', reason: '', note: '' });
  const [inv, setInv] = useState({ no: '', on: '', amount: '', forWhat: '' });
  const [check, setCheck] = useState<Record<string, string>>({});
  const [accept, setAccept] = useState<Record<string, { ref: string; note: string }>>({});
  const [ap, setAp] = useState<Record<string, { apRef: string; postedOn: string }>>({});
  const f = r.firm;
  const active = f.status === 'active';
  return (
    <div className="small" aria-label={`Adviser money ${f.name}`} style={{ marginTop: 4 }}>
      <div>
        Budget {year}: {r.budget == null ? 'not agreed' : `RM${r.budget.toFixed(2)}`} · spent RM{r.spent.toFixed(2)}
        {f.kind === 'LAW' ? ' (from legal matter fees)' : ''}
        {r.overBudget ? ' · over budget' : ''}
        {r.proposedBudget ? ` · proposed RM${r.proposedBudget.amount.toFixed(2)} by ${r.proposedBudget.by}, waiting for the Finance Director` : ''}
      </div>
      {r.canKeep && active && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            aria-label="Budget amount"
            placeholder={`Budget ${year} (RM)`}
            inputMode="decimal"
            value={b.amount}
            onChange={(e) => setB({ ...b, amount: e.target.value })}
          />
          <input aria-label="Budget basis" placeholder="What it is based on" value={b.reason} onChange={(e) => setB({ ...b, reason: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !b.amount || b.reason.trim().length < 5}
            onClick={() =>
              act.run(() => api.adviserMoneyStep(f.id, 'budget', { year, amount: Number(b.amount), reason: b.reason }).then(reload), 'Budget proposed.')
            }
          >
            Propose budget
          </button>
        </div>
      )}
      {canAgree && r.canAgree && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input aria-label="Budget agreement note" placeholder="Reason for agreeing" value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !b.note.trim()}
            onClick={() => act.run(() => api.adviserMoneyStep(f.id, 'agree', { year, note: b.note }).then(reload), 'Budget agreed.')}
          >
            Agree budget
          </button>
        </div>
      )}
      {f.kind !== 'LAW' && r.canKeep && active && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input aria-label="Invoice number" placeholder="Invoice number" value={inv.no} onChange={(e) => setInv({ ...inv, no: e.target.value })} />
          <input aria-label="Invoice date" type="date" value={inv.on} onChange={(e) => setInv({ ...inv, on: e.target.value })} />
          <input
            aria-label="Invoice amount"
            placeholder="Amount (RM)"
            inputMode="decimal"
            value={inv.amount}
            onChange={(e) => setInv({ ...inv, amount: e.target.value })}
          />
          <input aria-label="Invoice for" placeholder="What it is for" value={inv.forWhat} onChange={(e) => setInv({ ...inv, forWhat: e.target.value })} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !inv.no.trim() || !inv.on || !inv.amount || inv.forWhat.trim().length < 3}
            onClick={() =>
              act.run(
                () =>
                  api
                    .adviserMoneyStep(f.id, 'invoice', { no: inv.no, on: inv.on, amount: Number(inv.amount), forWhat: inv.forWhat, companyId: null })
                    .then(() => {
                      setInv({ no: '', on: '', amount: '', forWhat: '' });
                      reload();
                    }),
                'Invoice recorded.',
              )
            }
          >
            Record invoice
          </button>
        </div>
      )}
      {r.invoices.length > 0 && (
        <ul aria-label={`Invoices ${f.name}`} style={{ margin: '2px 0 0 16px' }}>
          {r.invoices.map(({ invoice: i, entityId, canAccept, canCheck, canResubmit, canPostAp }) => (
            <li key={i.id}>
              {canResubmit && (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={act.busy}
                  onClick={() =>
                    inv.no && inv.on && inv.amount
                      ? act.run(
                          () =>
                            api
                              .adviserMoneyStep(f.id, 'resubmit', {
                                invoiceId: i.id,
                                no: inv.no,
                                on: inv.on,
                                amount: Number(inv.amount),
                                forWhat: inv.forWhat,
                                companyId: i.companyId,
                              })
                              .then(reload),
                          'Invoice corrected and sent again.',
                        )
                      : setInv({ no: i.no, on: i.on, amount: String(i.amount), forWhat: i.forWhat })
                  }
                >
                  {inv.no ? 'Send again with the details above' : 'Fix and send again'}
                </button>
              )}{' '}
              {i.no} · {dateLabel(i.on)} · RM{i.amount.toFixed(2)} · {i.forWhat} · keyed by {i.by} ·{' '}
              {i.acceptance ? `service confirmed by ${i.acceptance.by} (${i.acceptance.evidenceRef}): ${i.acceptance.note} · ` : 'service not confirmed yet · '}
              {i.check ? `${i.check.result === 'passed' ? 'passed to Finance' : 'queried'} by ${i.check.by}: ${i.check.note}` : 'waiting for a check'}
              {i.ap
                ? ` · SQL Account ${i.ap.apRef} in the books of ${i.ap.entityId === 'pwvsb' ? 'PWVSB' : i.ap.entityId}, posted ${dateLabel(i.ap.postedOn)}`
                : ''}
              {canAccept && (
                <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                  <input
                    aria-label={`Service evidence ${i.no}`}
                    placeholder="Evidence, e.g. signed report ref"
                    value={accept[i.id]?.ref ?? ''}
                    onChange={(e) => setAccept({ ...accept, [i.id]: { note: accept[i.id]?.note ?? '', ref: e.target.value } })}
                  />
                  <input
                    aria-label={`What was delivered ${i.no}`}
                    placeholder="What was delivered"
                    value={accept[i.id]?.note ?? ''}
                    onChange={(e) => setAccept({ ...accept, [i.id]: { ref: accept[i.id]?.ref ?? '', note: e.target.value } })}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || !(accept[i.id]?.ref ?? '').trim() || (accept[i.id]?.note ?? '').trim().length < 5}
                    onClick={() =>
                      act.run(
                        () => api.adviserMoneyStep(f.id, 'accept', { invoiceId: i.id, evidenceRef: accept[i.id].ref, note: accept[i.id].note }).then(reload),
                        'Service confirmed.',
                      )
                    }
                  >
                    Confirm service
                  </button>
                </span>
              )}
              {canPostAp && (
                <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                  <input
                    aria-label={`SQL Account document ${i.no}`}
                    placeholder={`SQL Account payables no. (${entityId === 'pwvsb' ? 'PWVSB' : entityId} books)`}
                    value={ap[i.id]?.apRef ?? ''}
                    onChange={(e) => setAp({ ...ap, [i.id]: { postedOn: ap[i.id]?.postedOn ?? '', apRef: e.target.value } })}
                  />
                  <input
                    aria-label={`Posted on ${i.no}`}
                    type="date"
                    value={ap[i.id]?.postedOn ?? ''}
                    onChange={(e) => setAp({ ...ap, [i.id]: { apRef: ap[i.id]?.apRef ?? '', postedOn: e.target.value } })}
                  />
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={act.busy || !(ap[i.id]?.apRef ?? '').trim() || !ap[i.id]?.postedOn}
                    onClick={() =>
                      act.run(
                        () => api.adviserMoneyStep(f.id, 'ap', { invoiceId: i.id, entityId, apRef: ap[i.id].apRef, postedOn: ap[i.id].postedOn }).then(reload),
                        'Linked to SQL Account.',
                      )
                    }
                  >
                    Link SQL Account entry
                  </button>
                </span>
              )}
              {canCheck && (
                <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                  <input
                    aria-label={`Check note ${i.no}`}
                    placeholder="Note (required)"
                    value={check[i.id] ?? ''}
                    onChange={(e) => setCheck({ ...check, [i.id]: e.target.value })}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || !(check[i.id] ?? '').trim()}
                    onClick={() =>
                      act.run(
                        () => api.adviserMoneyStep(f.id, 'check', { invoiceId: i.id, result: 'passed', note: check[i.id] }).then(reload),
                        'Passed to Finance.',
                      )
                    }
                  >
                    Pass to Finance
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={act.busy || !(check[i.id] ?? '').trim()}
                    onClick={() =>
                      act.run(
                        () => api.adviserMoneyStep(f.id, 'check', { invoiceId: i.id, result: 'queried', note: check[i.id] }).then(reload),
                        'Invoice queried.',
                      )
                    }
                  >
                    Query
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {act.error && <p className="error small">{act.error.message}</p>}
    </div>
  );
}
