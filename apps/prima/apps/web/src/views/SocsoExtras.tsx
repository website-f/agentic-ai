/**
 * E4 SOCSO extras (Fauzan, 11 Nov 2026: "Tell Fitri to build"). Added to the SOCSO claim's own tabs, never a second
 * copy: the LINDUNG claim form (HR prepares, a second HR person checks, then it is printed for the worker), the
 * company's own payments to the family abroad (HR raises, the Finance Director or CEO approves, Finance pays, HR
 * confirms receipt), and a filled JKKP 6 / JKKP 7 draft printed from the case. The server checks every step.
 */
import { Select } from '../SearchSelect';
import { useState } from 'react';
import { PAY_ABROAD_ROUTE_LABEL, PAY_ABROAD_STATUS_LABEL, PAY_ABROAD_WHAT_LABEL, lindungFormGaps, type PayAbroad, type PayAbroadRoute, type PayAbroadWhat, type ProofInput } from '@prima/core';
import { api, type SocsoClaimDetail, type SocsoPayAbroadBoard } from '../api';
import { Card, Empty } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { useApp } from '../App';
import { ProofPicker } from './Proof';
import { Decide, PaperSheet, rm, todayMyt } from './newa-shared';

const STATUS_TONE: Record<PayAbroad['status'], Tone> = { waiting: 'warn', approved: 'info', refused: 'neutral', paid: 'info', received: 'ok' };

function useCompanyName(id: string): string {
  const { me } = useApp();
  return me.companies.find((c) => c.id === id)?.name ?? id;
}

// ---------- LINDUNG claim form ----------

export function LindungFormPanel({ d }: { d: SocsoClaimDetail }) {
  const c = d.claim;
  const form = c.socsoExtras?.lindungForm ?? null;
  const manage = d.can.manage && c.status !== 'CLOSED';
  const [edit, setEdit] = useState(!form);
  const [f, setF] = useState({ how: form?.fields.how ?? c.description ?? '', injury: form?.fields.injury ?? '', treatedAt: form?.fields.treatedAt ?? '', policeReportNo: form?.fields.policeReportNo ?? '' });
  const act = useAction();
  const employer = useCompanyName(c.companyId);
  const gaps = lindungFormGaps(c, form);
  if (!d.can.manage) return null;
  const tone: Tone = !form ? 'neutral' : form.checked ? 'ok' : 'warn';
  return (
    <Card
      title="LINDUNG claim form"
      sub="Prima fills the form from the claim. HR adds how it happened; a second HR person checks it; then print it for the worker to take to PERKESO or key into Portal LINDUNG Faedah."
      actions={<Chip tone={tone}>{!form ? 'Not prepared' : form.checked ? 'Checked' : 'Waiting for a check'}</Chip>}
    >
      <div className="nw-stack">
        {manage && edit && (
          <div className="nw-form">
            <label className="field nw-wide">
              <span className="label">How it happened</span>
              <textarea className="input" rows={3} value={f.how} onChange={(e) => setF({ ...f, how: e.target.value })} aria-label="How it happened" />
            </label>
            <label className="field">
              <span className="label">Injury and part of the body</span>
              <input className="input" value={f.injury} onChange={(e) => setF({ ...f, injury: e.target.value })} aria-label="Injury and part of the body" />
            </label>
            <label className="field">
              <span className="label">Clinic or hospital</span>
              <input className="input" value={f.treatedAt} onChange={(e) => setF({ ...f, treatedAt: e.target.value })} aria-label="Clinic or hospital" />
            </label>
            <label className="field">
              <span className="label">Police report number (if any)</span>
              <input className="input" value={f.policeReportNo} onChange={(e) => setF({ ...f, policeReportNo: e.target.value })} aria-label="Police report number (if any)" />
            </label>
            <div className="nw-actions nw-wide">
              <button
                className="btn btn-primary"
                disabled={act.busy}
                onClick={async () => {
                  const ok = await act.run(() => api.socsoExtraAct('lindung_form', { claimId: c.id, ...f }), form ? 'Form corrected. It needs checking again.' : 'Form prepared. Another HR person checks it.');
                  if (ok) setEdit(false);
                }}
              >
                {form ? 'Save the correction' : 'Prepare the form'}
              </button>
              {form && (
                <button className="btn" onClick={() => setEdit(false)}>
                  Close
                </button>
              )}
            </div>
          </div>
        )}
        {form && (
          <div className="nw-spread">
            <span className="nw-note">
              <span>Prepared by</span> {form.prepared.by}, {dateTimeLabel(form.prepared.at)}
              {form.checked && (
                <>
                  {' · '}
                  <span>Checked by</span> {form.checked.by}: “{form.checked.note}”
                </>
              )}
            </span>
            {manage && !edit && (
              <button className="btn btn-sm" onClick={() => setEdit(true)}>
                Correct the form
              </button>
            )}
          </div>
        )}
        {manage && form && !form.checked && (
          <Decide
            busy={act.busy}
            approveLabel="Checked against the papers"
            refuseLabel={null}
            placeholder="Comment (needed to check)"
            onDecide={(_ok, note) => void act.run(() => api.socsoExtraAct('lindung_check', { claimId: c.id, note }), 'Form checked. Print it for the worker.')}
          />
        )}
        <ErrorNotice error={act.error} />
        {form && (
          <PaperSheet
            file="LINDUNG-form"
            draft={gaps.length ? 'DRAF · BELUM DISEMAK / DRAFT · NOT CHECKED' : null}
            titleMs="Borang tuntutan LINDUNG 24 Jam (kemalangan bukan kerja)"
            titleEn="LINDUNG 24 Jam claim form (non-work accident)"
            sub={`Disediakan oleh majikan untuk pekerja / Prepared by the employer for the worker · ${c.id}`}
            rows={[
              { ms: 'Nama pekerja', en: 'Worker', value: `${d.person.name} (${d.person.staffNo})` },
              { ms: 'No. KP / pasport', en: 'IC / passport', value: d.person.idMasked ?? '—' },
              { ms: 'No. PERKESO', en: 'SOCSO no.', value: d.person.socsoNo ?? '—' },
              { ms: 'Majikan', en: 'Employer', value: employer },
              { ms: 'Tarikh dan masa kemalangan', en: 'Date and time', value: dateTimeLabel(c.incidentAt) },
              { ms: 'Tempat', en: 'Place', value: c.place },
              { ms: 'Bagaimana berlaku', en: 'How it happened', value: form.fields.how },
              { ms: 'Kecederaan', en: 'Injury', value: form.fields.injury },
              { ms: 'Dirawat di', en: 'Treated at', value: form.fields.treatedAt },
              { ms: 'No. laporan polis', en: 'Police report no.', value: form.fields.policeReportNo || 'Tiada / None' },
              { ms: 'Hari MC', en: 'MC days', value: c.mcs.length ? c.mcs.map((m) => `${dateLabel(m.from)} – ${dateLabel(m.to)}`).join('; ') : '—' },
              {
                ms: 'Pengesahan pekerjaan',
                en: 'Employment confirmed to PERKESO',
                value: c.lindung?.verify ? `${c.lindung.verify.answer} · ${dateTimeLabel(c.lindung.verify.at)}` : 'Belum diminta / Not asked yet',
              },
            ]}
            sign={[
              [`Disediakan / Prepared: ${form.prepared.by}`, dateTimeLabel(form.prepared.at)],
              [`Disemak / Checked: ${form.checked?.by ?? '—'}`, form.checked ? dateTimeLabel(form.checked.at) : ''],
            ]}
          />
        )}
      </div>
    </Card>
  );
}

// ---------- Company payments to the family abroad ----------

function PayLine({ p, dependant }: { p: PayAbroad; dependant: string }) {
  return (
    <div className="nw-item-main">
      <strong>
        {PAY_ABROAD_WHAT_LABEL[p.what]} · <span className="nw-amount">{rm(p.amount)}</span>
      </strong>
      <span className="nw-note">
        {dependant} · {PAY_ABROAD_ROUTE_LABEL[p.route]}
      </span>
      <span className="nw-note" data-no-translate>
        {p.payTo}
      </span>
      <div className="nw-steps">
        <span data-done="true">
          <span>Raised by</span> {p.raised.by}
        </span>
        {p.decided && (
          <span data-done={p.decided.approve}>
            <span>{p.decided.approve ? 'Approved by' : 'Refused by'}</span> {p.decided.by} · “{p.decided.note}”
          </span>
        )}
        {p.paid && (
          <span data-done="true">
            <span>Sent</span> {dateLabel(p.paid.on)} · {p.paid.ref}
          </span>
        )}
        {p.received && (
          <span data-done="true">
            <span>Received</span> {dateLabel(p.received.on)}
          </span>
        )}
      </div>
    </div>
  );
}

function ReceivedForm({ claimId, p }: { claimId: string; p: PayAbroad }) {
  const [on, setOn] = useState(todayMyt());
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Date the family received it</span>
          <input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="Date the family received it" />
        </label>
      </div>
      <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button className="btn btn-sm btn-primary" disabled={act.busy || !proof.length} onClick={() => act.run(() => api.socsoExtraAct('pay_received', { claimId, paymentId: p.id, on, proof }), 'Receipt recorded.')}>
          The family received it
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

export function PayAbroadPanel({ d }: { d: SocsoClaimDetail }) {
  const c = d.claim;
  const people = (d.dependants?.record.people ?? []).filter((p) => p.country.trim().toLowerCase() !== 'malaysia');
  const list = c.socsoExtras?.payAbroad ?? [];
  const manage = d.can.manage && c.status !== 'CLOSED';
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ dependantId: people[0]?.id ?? '', what: 'FINAL_WAGES' as PayAbroadWhat, route: 'BANK_ABROAD' as PayAbroadRoute, amount: '', payTo: '', reason: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  if (!d.dependants) return null;
  const nameOf = (id: string) => d.dependants!.record.people.find((p) => p.id === id)?.name ?? id;
  return (
    <Card
      title="Company payments to the family abroad"
      sub="The company's own money for the family (final wages, insurance, ex gratia), separate from PERKESO's payments. The Finance Director or the CEO approves; Finance sends it; HR records that it arrived."
      actions={
        manage && people.length > 0 && !open ? (
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            Raise a payment
          </button>
        ) : undefined
      }
    >
      <div className="nw-stack">
        {manage && open && (
          <div className="nw-stack">
            <div className="nw-form">
              <label className="field">
                <span className="label">Dependant</span>
                <Select className="input" aria-label="Dependant" value={f.dependantId} onChange={(e) => setF({ ...f, dependantId: e.target.value })}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.country})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">What it is for</span>
                <Select className="input" aria-label="What it is for" value={f.what} onChange={(e) => setF({ ...f, what: e.target.value as PayAbroadWhat })}>
                  {(Object.keys(PAY_ABROAD_WHAT_LABEL) as PayAbroadWhat[]).map((k) => (
                    <option key={k} value={k}>
                      {PAY_ABROAD_WHAT_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">How it goes</span>
                <Select className="input" aria-label="How it goes" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value as PayAbroadRoute })}>
                  {(Object.keys(PAY_ABROAD_ROUTE_LABEL) as PayAbroadRoute[]).map((k) => (
                    <option key={k} value={k}>
                      {PAY_ABROAD_ROUTE_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">Amount (RM)</span>
                <input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="Amount (RM)" />
              </label>
              <label className="field nw-wide">
                <span className="label">Where it goes: bank, branch, last 4 digits of the account</span>
                <input className="input" value={f.payTo} onChange={(e) => setF({ ...f, payTo: e.target.value })} aria-label="Where it goes" />
              </label>
              <label className="field nw-wide">
                <span className="label">Why the company owes it</span>
                <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Why the company owes it" />
              </label>
            </div>
            <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
            <div className="nw-actions">
              <button
                className="btn btn-primary"
                disabled={act.busy || !proof.length}
                onClick={async () => {
                  const ok = await act.run(() => api.socsoExtraAct('pay_raise', { claimId: c.id, ...f, amount: Number(f.amount), proof }), 'Sent to the Finance Director and the CEO for approval.');
                  if (ok) {
                    setOpen(false);
                    setProof([]);
                  }
                }}
              >
                Send for approval
              </button>
              <button className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        )}
        <ErrorNotice error={act.error} />
        {list.length === 0 ? (
          <Empty title="No company payment to the family yet">{people.length ? 'Raise one with the family’s bank or embassy letter.' : 'Add the dependants who live abroad first.'}</Empty>
        ) : (
          <div className="nw-list">
            {list.map((p) => (
              <div key={p.id} className="nw-item">
                <PayLine p={p} dependant={nameOf(p.dependantId)} />
                <div className="nw-item-side">{dateTimeLabel(p.raised.at)}</div>
                <div className="nw-item-end">
                  <Chip tone={STATUS_TONE[p.status]}>{PAY_ABROAD_STATUS_LABEL[p.status]}</Chip>
                </div>
                {manage && p.status === 'paid' && <ReceivedForm claimId={c.id} p={p} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- The approvers' and Finance's list (Payment requests screen) ----------

function PaidForm({ row }: { row: SocsoPayAbroadBoard['rows'][number] }) {
  const [on, setOn] = useState(todayMyt());
  const [ref, setRef] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Date sent</span>
          <input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="Date sent" />
        </label>
        <label className="field">
          <span className="label">Transfer reference</span>
          <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Transfer reference" />
        </label>
      </div>
      <ProofPicker site={null} refText="Transfer" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !proof.length || ref.trim().length < 3}
          onClick={() => act.run(() => api.socsoExtraAct('pay_paid', { claimId: row.claimId, paymentId: row.payment.id, on, ref, proof }), 'Transfer recorded. HR confirms when the family has it.')}
        >
          Money sent
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

export function PayAbroadBoard() {
  const { data, error } = useLoad(() => api.socsoPaymentsAbroad(), []);
  const act = useAction();
  if (error) return null;
  if (!data) return <Loading what="payments abroad" />;
  const open = data.rows.filter((r) => r.payment.status === 'waiting' || r.payment.status === 'approved' || r.payment.status === 'paid');
  if (!data.rows.length) return null;
  return (
    <Card title="Payments to a worker's family abroad" sub="Raised by HR from a SOCSO death claim. The Finance Director or the CEO approves with a comment; Finance sends it with the bank slip. Nobody approves or pays what they raised.">
      <div className="nw-stack">
        <ErrorNotice error={act.error} />
        {open.length === 0 && <p className="nw-note">Nothing waiting.</p>}
        <div className="nw-list">
          {data.rows.map((r) => (
            <div key={r.payment.id} className="nw-item">
              <PayLine p={r.payment} dependant={r.dependant ? `${r.dependant.name}, ${r.dependant.country}` : '—'} />
              <div className="nw-item-side">
                <span>{r.companyName}</span>
                {r.worker && (
                  <span>
                    {r.worker.name} ({r.worker.staffNo})
                  </span>
                )}
                <span>{r.payment.reason}</span>
              </div>
              <div className="nw-item-end">
                <Chip tone={STATUS_TONE[r.payment.status]}>{r.statusLabel}</Chip>
              </div>
              {r.canDecide && (
                <div className="nw-item-act">
                  <Decide busy={act.busy} onDecide={(approve, note) => void act.run(() => api.socsoExtraAct('pay_decide', { claimId: r.claimId, paymentId: r.payment.id, approve, note }), approve ? 'Approved. Finance sends it.' : 'Refused. HR is told.')} />
                </div>
              )}
              {r.canPay && <PaidForm row={r} />}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------- JKKP draft from the case ----------

export function DoshDraftPanel({ d }: { d: SocsoClaimDetail }) {
  const c = d.claim;
  const n = d.dosh?.record;
  const employer = useCompanyName(c.companyId);
  if (!d.can.manage || !n || n.kind === 'MINOR') return null;
  const form = n.kind === 'DISEASE' ? 'JKKP 7' : 'JKKP 6';
  return (
    <Card title={form === 'JKKP 7' ? 'JKKP 7 draft from the case' : 'JKKP 6 draft from the case'} sub="Filled from the claim to copy into the DOSH form or the online notice. Prima never sends anything to DOSH; record what was sent above.">
      <PaperSheet
        file={`${form.replace(' ', '')}-draft`}
        draft="DRAF UNTUK DISALIN / DRAFT TO COPY"
        titleMs={`Draf ${form}: pemberitahuan kemalangan kepada JKKP`}
        titleEn={`${form} draft: accident notice to DOSH`}
        sub={`${c.id} · ${employer}`}
        rows={[
          { ms: 'Majikan', en: 'Employer', value: employer },
          { ms: 'Pekerja', en: 'Employee', value: `${d.person.name} (${d.person.staffNo})` },
          { ms: 'Tarikh dan masa', en: 'Date and time', value: dateTimeLabel(c.incidentAt) },
          { ms: 'Tempat kejadian', en: 'Place', value: c.place },
          { ms: 'Apa yang berlaku', en: 'What happened', value: c.description },
          { ms: 'Saksi', en: 'Witnesses', value: c.witnesses || '—' },
          { ms: 'Tahap (dinilai HR)', en: 'Level (HR assessed)', value: `${n.kind} · ${n.why}` },
          { ms: 'Hari tidak bekerja', en: 'Days off (MC)', value: c.mcs.length ? c.mcs.map((m) => `${dateLabel(m.from)} – ${dateLabel(m.to)}`).join('; ') : '—' },
          { ms: 'Notis segera', en: 'Immediate notice', value: n.immediate ? `${n.immediate.means}, ${n.immediate.office}, ${dateTimeLabel(n.immediate.at)}` : '—' },
          { ms: 'Tarikh akhir borang', en: 'Form due by', value: d.dosh?.clock?.formDue ? dateLabel(d.dosh.clock.formDue) : '—' },
        ]}
        sign={[
          ['Disediakan oleh / Prepared by', ''],
          ['Tarikh dihantar / Date sent', ''],
        ]}
      />
    </Card>
  );
}
