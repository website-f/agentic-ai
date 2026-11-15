import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Kpi, useAction, useLoad } from '../ui';

/**
 * Part P19-P39 (Fitri package, Fauzan 14 Nov 2026): short stays on the homestay houses. One calendar per house for
 * direct homestay bookings, Airbnb and staff stays (Government Operations / HQ). BM first. Every button calls the
 * server, which decides who may act; this screen only shows what came back. Prima does not send WhatsApp, log in to
 * Airbnb or link a platform calendar.
 */

type Board = Awaited<ReturnType<typeof api.shortStays>>;
type FieldType = 'text' | 'number' | 'date' | 'datetime' | 'photo' | 'photos' | 'check' | 'select' | 'list' | 'ticks';
interface Field {
  name: string;
  label: string;
  type?: FieldType;
  options?: readonly string[];
}

const CHECKLIST = [
  'Building, doors and windows',
  'Living room',
  'Bedrooms and linen',
  'Toilets and water heater',
  'Kitchen and utensils',
  'Corridor and balcony',
  'Water and electricity',
  'Air-con, fans and Wi-Fi',
  'Keys / lock / access code',
  'Safety items (smoke detector, fire extinguisher, emergency card)',
  'Inventory against the house list',
  'Existing damage noted',
];

const fileToData = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

/** A small form: the fields it shows, then one button that sends them with the fixed values. */
function ActForm({ title, fields, fixed, action, onDone, busy, run }: { title: string; fields: Field[]; fixed: Record<string, unknown>; action: string; onDone: () => void; busy: boolean; run: (action: string, body: Record<string, unknown>, ok: string) => Promise<unknown> }) {
  const [v, setV] = useState<Record<string, unknown>>({});
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }));
  return (
    <div className="card" style={{ padding: 8, display: 'grid', gap: 6 }}>
      <strong>{title}</strong>
      {fields.map((f) => (
        <label key={f.name} className="field">
          <span>{f.label}</span>
          {f.type === 'check' ? (
            <input type="checkbox" checked={v[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} />
          ) : f.type === 'select' ? (
            <Select className="input" value={String(v[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">—</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : f.type === 'photo' || f.type === 'photos' ? (
            <input
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              multiple={f.type === 'photos'}
              onChange={async (e) => {
                const list = await Promise.all([...(e.target.files ?? [])].map(fileToData));
                set(f.name, f.type === 'photo' ? list[0] : list);
              }}
            />
          ) : f.type === 'ticks' ? (
            <span style={{ display: 'grid', gap: 2 }}>
              {CHECKLIST.map((c) => (
                <label key={c} className="small">
                  <input
                    type="checkbox"
                    checked={((v[f.name] as string[]) ?? []).includes(c)}
                    onChange={(e) => set(f.name, e.target.checked ? [...((v[f.name] as string[]) ?? []), c] : ((v[f.name] as string[]) ?? []).filter((x) => x !== c))}
                  />{' '}
                  {c}
                </label>
              ))}
            </span>
          ) : (
            <input
              className="input"
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text'}
              value={String(v[f.name] ?? '')}
              onChange={(e) => set(f.name, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : f.type === 'list' ? e.target.value : e.target.value)}
            />
          )}
        </label>
      ))}
      <span className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => {
            const body: Record<string, unknown> = { ...fixed };
            for (const f of fields) {
              const x = v[f.name];
              body[f.name] = f.type === 'list' && typeof x === 'string' ? x.split(',').map((s) => s.trim()).filter(Boolean) : x;
            }
            void run(action, body, `${title}: done`).then((r) => r && onDone());
          }}
        >
          Hantar / Send
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Batal / Cancel
        </button>
      </span>
    </div>
  );
}

const STEPS: Record<string, { label: string; fields: Field[] }> = {
  checked: { label: 'Semak / Check', fields: [{ name: 'ok', label: 'Lulus / Approved', type: 'check' }, { name: 'note', label: 'Ulasan / Note' }] },
  answer: { label: 'Jawab Airbnb / Answer', fields: [{ name: 'accepted', label: 'Accepted on Airbnb', type: 'check' }, { name: 'note', label: 'Why declined' }] },
  block: { label: 'Disekat di platform / Blocked', fields: [{ name: 'platform', label: 'Platform' }] },
  pay: { label: 'Rekod bayaran / Record payment', fields: [{ name: 'amount', label: 'RM', type: 'number' }, { name: 'method', label: 'Method', type: 'select', options: ['TRANSFER', 'CASH', 'CARD', 'ONLINE'] }, { name: 'ref', label: 'Reference' }, { name: 'proof', label: 'Proof', type: 'photo' }] },
  customer: { label: 'Pelanggan sahkan / Customer confirms', fields: [{ name: 'confirmed', label: 'Confirmed', type: 'check' }, { name: 'note', label: 'Note' }] },
  followup: { label: 'Susulan 7 hari / Follow-up', fields: [{ name: 'arrival', label: 'Arrival time' }, { name: 'note', label: 'Note' }] },
  prepare: { label: 'Sediakan rumah / Prepare', fields: [{ name: 'ticks', label: 'Checklist', type: 'ticks' }, { name: 'photos', label: 'Photos (2+)', type: 'photos' }] },
  code: { label: 'Kod akses / Access code', fields: [{ name: 'code', label: 'New code for this stay' }] },
  keyException: { label: 'Lepas kunci (Pengarah) / Release keys', fields: [{ name: 'reason', label: 'Reason' }] },
  checkin: { label: 'Serah kunci / Check in', fields: [{ name: 'to', label: 'Received by (name)' }, { name: 'keys', label: 'Keys handed', type: 'number' }, { name: 'idType', label: 'ID type', type: 'select', options: ['MYKAD', 'PASSPORT', 'OTHER'] }, { name: 'idNo', label: 'ID number' }, { name: 'nationality', label: 'Nationality' }] },
  checkout: { label: 'Terima kunci / Check out', fields: [{ name: 'keysBack', label: 'Keys back', type: 'number' }, { name: 'lost', label: 'Keys lost', type: 'number' }, { name: 'note', label: 'Note' }] },
  after: { label: 'Pemeriksaan selepas / After-stay inspection', fields: [{ name: 'ticks', label: 'Checklist', type: 'ticks' }, { name: 'photos', label: 'Photos (2+)', type: 'photos' }, { name: 'missing', label: 'Missing or damaged (comma list)', type: 'list' }] },
  codeChanged: { label: 'Kod ditukar / Code changed', fields: [] },
  late: { label: 'Malam lewat / Late nights', fields: [{ name: 'waive', label: 'Waive (Asset Director)', type: 'check' }, { name: 'reason', label: 'Reason' }] },
  damage: { label: 'Kerosakan (Pengarah) / Damage', fields: [{ name: 'what', label: 'What' }, { name: 'amount', label: 'RM', type: 'number' }, { name: 'inventoryItem', label: 'Inventory line' }, { name: 'staffUserId', label: 'Staff member (staff stay)' }, { name: 'reason', label: 'Finding' }, { name: 'photo', label: 'Photo', type: 'photo' }] },
  claim: { label: 'Tuntutan Airbnb / Claim', fields: [{ name: 'damageId', label: 'Damage line id' }, { name: 'caseNo', label: 'Airbnb case no.' }, { name: 'filedOn', label: 'Filed on', type: 'date' }] },
  claimOutcome: { label: 'Keputusan tuntutan / Claim outcome', fields: [{ name: 'damageId', label: 'Damage line id' }, { name: 'outcome', label: 'Outcome', type: 'select', options: ['paid', 'part', 'refused'] }, { name: 'received', label: 'RM received', type: 'number' }] },
  goodwill: { label: 'Bayaran balik muhibah / Goodwill', fields: [{ name: 'amount', label: 'RM', type: 'number' }, { name: 'reason', label: 'Reason' }] },
  cancel: { label: 'Batal / Cancel', fields: [{ name: 'reason', label: 'Reason' }, { name: 'host', label: 'Host cancellation (Asset Director)', type: 'check' }] },
  close: { label: 'Tutup / Close', fields: [] },
};

/** Next steps a booking may take, by status and channel (the server still decides). */
function stepsFor(k: Board['bookings'][number], role: string) {
  const out: string[] = [];
  const team = role === 'team' || role === 'director';
  if (!team || k.closed || ['cancelled', 'no_show'].includes(k.status)) return out;
  if (k.status === 'held' && k.channel === 'AIRBNB') out.push('answer');
  if (k.status === 'held' && k.channel !== 'AIRBNB') out.push(k.ss.checked ? 'customer' : 'checked', 'pay', 'block');
  if (k.status === 'confirmed') out.push('followup', 'prepare', 'code', 'checkin', 'block');
  if (k.status === 'confirmed' && k.channel !== 'AIRBNB' && !k.internal) out.push('pay', 'keyException');
  if (k.status === 'checked_in') out.push('checkout', 'damage');
  if (k.status === 'checked_out') out.push(k.ss.after ? 'close' : 'after', 'damage', 'late', 'codeChanged');
  if (k.channel === 'AIRBNB' && k.ss.damages.length) out.push('claim', 'claimOutcome');
  if (['held', 'confirmed'].includes(k.status)) out.push('cancel');
  out.push('goodwill');
  return [...new Set(out)];
}

export function ShortStaysPanel() {
  const v = useLoad(() => api.shortStays(), []);
  const act = useAction();
  const [tab, setTab] = useState<'bookings' | 'new' | 'houses' | 'requests' | 'money' | 'complaints' | 'care'>('bookings');
  const [form, setForm] = useState<string | null>(null);
  if (v.error) return null;
  const d = v.data as Board | undefined;
  if (!d || d.role === 'requester') return null;
  const run = (action: string, body: Record<string, unknown>, ok: string) => act.run(() => api.shortStayAct(action, body), ok).then((r) => (r && v.reload(), r));
  const t = d.tiles!;
  const team = d.role === 'team' || d.role === 'director';
  const done = () => setForm(null);
  const F = (key: string, title: string, action: string, fields: Field[], fixed: Record<string, unknown> = {}) =>
    form === key ? <ActForm title={title} fields={fields} fixed={fixed} action={action} onDone={done} busy={act.busy} run={run} /> : null;
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3>Penginapan singkat / Short stays (homestay, Airbnb, staff stays)</h3>
      </div>
      {!d.installed && <div className="notice">Short stays are not installed in this database yet (module short-stays-v1, run by the CEO).</div>}
      <ErrorNotice error={act.error} />
      <div className="kpis">
        <Kpi label="Permohonan staf / Staff requests" value={t.staffRequestsWaiting} tone={t.staffRequestsWaiting ? 'warn' : 'ok'} />
        <Kpi label="Tunggu deposit / Held for deposit" value={t.heldForDeposit} />
        <Kpi label="Airbnb to answer" value={t.airbnbToAnswer} tone={t.airbnbToAnswer ? 'crit' : 'ok'} />
        <Kpi label="Sediakan rumah / To prepare" value={t.housesToPrepare} tone={t.housesToPrepare ? 'warn' : 'ok'} />
        <Kpi label="Bayaran penuh / Full payments due" value={t.fullPaymentsDue} tone={t.fullPaymentsDue ? 'warn' : 'ok'} />
        <Kpi label="Masuk / keluar hari ini" value={`${t.checkInsToday} / ${t.checkOutsToday}`} />
        <Kpi label="Kunci belum pulang / Keys not back" value={t.keysNotBack} tone={t.keysNotBack ? 'crit' : 'ok'} />
        <Kpi label="Payouts not matched" value={t.payoutsNotMatched} tone={t.payoutsNotMatched ? 'warn' : 'ok'} />
        <Kpi label="Aduan / Complaints open" value={t.complaintsOpen} tone={t.complaintsLate ? 'crit' : t.complaintsOpen ? 'warn' : 'ok'} note={t.reviewScore != null ? `Review score ${t.reviewScore}` : undefined} />
        <Kpi label="Airbnb fees this month" value={`RM${t.airbnbFeesThisMonth}`} />
      </div>
      <div className="tabbar" role="tablist" aria-label="Short stays" style={{ flexWrap: 'wrap' }}>
        {(
          [
            ['bookings', 'Tempahan / Bookings'],
            ...(team ? ([['new', 'Tempahan baru / New']] as const) : []),
            ['houses', 'Rumah / Houses'],
            ['requests', 'Rumah pekerja / Staff stays'],
            ['money', 'Wang / Money'],
            ['complaints', 'Aduan / Complaints'],
            ...(team ? ([['care', 'Cuci & kira / Cleaning & counts']] as const) : []),
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'bookings' && (
        <div className="list">
          {d.bookings.length === 0 && <div className="empty">No short stays yet.</div>}
          {d.bookings.map((k) => (
            <div key={k.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <strong>
                  {k.ref} · {d.houses.find((h) => h.id === k.propertyId)?.name}
                </strong>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <Chip tone="info">{k.channel}</Chip>
                  <Chip tone={k.closed ? 'ok' : 'warn'}>{k.closed ? 'closed' : k.status}</Chip>
                  {k.flags.map((f) => (
                    <Chip key={f} tone={/Keys|deadline|answered|deposit/.test(f) ? 'crit' : 'warn'}>
                      {f}
                    </Chip>
                  ))}
                </span>
              </div>
              <div className="muted small">
                {k.guest} · {k.checkIn} to {k.checkOut} · {k.persons} guest(s) · bill RM{k.bill.total} · Finance-confirmed RM{k.banked}
                {k.internal ? ` · billed to ${k.billTo}` : ''}
                {k.ss.accessCode ? ` · code ${k.ss.accessCode}` : ''}
                {k.ss.airbnb ? ` · Airbnb ${k.ss.airbnb.code}, payout RM${k.ss.airbnb.expectedPayout}${k.ss.airbnb.payoutId ? ' (matched)' : ''}` : ''}
              </div>
              {k.ss.damages.length > 0 && (
                <div className="small">
                  {k.ss.damages.map((x) => (
                    <div key={x.id}>
                      Damage {x.id}: {x.what} RM{x.amount} — {x.reason}
                      {x.claim ? ` · Airbnb claim by ${x.claim.deadline} ${x.claim.caseNo ? `(case ${x.claim.caseNo}, ${x.claim.outcome})` : ''}` : ''}
                      {x.staffUserId ? (x.ack ? ' · acknowledged' : ' · waiting for the staff member') : ''}
                    </div>
                  ))}
                </div>
              )}
              {k.closeBlocks.length > 0 && k.status === 'checked_out' && <div className="muted small">To close: {k.closeBlocks.join('; ')}</div>}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {stepsFor(k, d.role).map((s) => (
                  <button key={s} className="btn btn-sm" onClick={() => setForm(`${s}:${k.id}`)}>
                    {STEPS[s].label}
                  </button>
                ))}
                {d.role === 'finance' &&
                  k.payments
                    .filter((p) => !p.banked && p.amount > 0)
                    .map((p) => (
                      <button key={p.id} className="btn btn-sm btn-primary" onClick={() => setForm(`receipt:${k.id}:${p.id}`)}>
                        Sahkan RM{p.amount} & resit / Confirm & receipt
                      </button>
                    ))}
              </div>
              {stepsFor(k, d.role).map((s) => F(`${s}:${k.id}`, STEPS[s].label, 'step', STEPS[s].fields, { id: k.id, step: s, version: k.version }))}
              {k.payments.map((p) =>
                F(`receipt:${k.id}:${p.id}`, 'Finance confirms and issues the receipt', 'finance', [{ name: 'on', label: 'Bank date', type: 'date' }, { name: 'slipRef', label: 'Statement reference' }, { name: 'receiptNo', label: 'Official receipt no.' }], { id: k.id, what: 'receipt', paymentId: p.id }),
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'new' && team && (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => setForm('book')}>
              Borang tempahan homestay / Booking form
            </button>
            <button className="btn btn-sm" onClick={() => setForm('airbnb')}>
              Rekod tempahan Airbnb / Airbnb reservation
            </button>
            <button className="btn btn-sm" onClick={() => setForm('enquiry')}>
              Log pertanyaan / Enquiry
            </button>
          </span>
          {F('book', 'Borang tempahan / Booking form', 'book', [
            { name: 'propertyId', label: 'House', type: 'select', options: d.houses.filter((h) => h.house).map((h) => h.id) },
            { name: 'guest', label: 'Customer name' },
            { name: 'phone', label: 'Phone' },
            { name: 'checkIn', label: 'Check-in', type: 'date' },
            { name: 'checkOut', label: 'Check-out', type: 'date' },
            { name: 'persons', label: 'Guests', type: 'number' },
            { name: 'channel', label: 'Channel', type: 'select', options: ['DIRECT', 'OTHER'] },
            { name: 'platform', label: 'Platform (if other)' },
            { name: 'platformRef', label: 'Platform booking ref' },
            { name: 'purpose', label: 'Purpose (optional)' },
            { name: 'needs', label: 'Special needs' },
            { name: 'rate', label: 'Price per night (blank = list)', type: 'number' },
            { name: 'discountReason', label: 'Why below the list' },
            { name: 'consent', label: 'Written PDPA consent taken', type: 'check' },
          ])}
          {F('airbnb', 'Tempahan Airbnb / Airbnb reservation', 'airbnb', [
            { name: 'propertyId', label: 'House', type: 'select', options: d.houses.filter((h) => h.house?.airbnb?.listed).map((h) => h.id) },
            { name: 'code', label: 'Airbnb confirmation code' },
            { name: 'guestName', label: 'Guest name on Airbnb' },
            { name: 'persons', label: 'Guests', type: 'number' },
            { name: 'checkIn', label: 'Check-in', type: 'date' },
            { name: 'checkOut', label: 'Check-out', type: 'date' },
            { name: 'guestTotal', label: 'Guest paid (RM)', type: 'number' },
            { name: 'hostFee', label: 'Airbnb host fee (RM)', type: 'number' },
            { name: 'taxKept', label: 'Tax Airbnb kept (RM)', type: 'number' },
            { name: 'accepted', label: 'Already accepted / instant', type: 'check' },
            { name: 'copy', label: 'Reservation copy (screenshot)', type: 'photo' },
          ])}
          {F('enquiry', 'Pertanyaan / Enquiry', 'enquiry', [
            { name: 'propertyId', label: 'House', type: 'select', options: d.houses.map((h) => h.id) },
            { name: 'channel', label: 'Channel (WhatsApp, phone, platform, walk-in)' },
            { name: 'from', label: 'From', type: 'date' },
            { name: 'to', label: 'To', type: 'date' },
            { name: 'guests', label: 'Guests', type: 'number' },
            { name: 'answer', label: 'Answer', type: 'select', options: ['available', 'not_available', 'other_dates'] },
            { name: 'wentOn', label: 'Went on to a booking', type: 'check' },
          ])}
          <div className="muted small">Prima prepares the BM / English message for you to copy into WhatsApp or Airbnb messages; it does not send it.</div>
        </div>
      )}

      {tab === 'houses' && (
        <div className="list">
          {d.houses.map((h) => (
            <div key={h.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <strong>
                  {h.name} · {h.town}
                </strong>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {h.house ? <Chip tone={h.house.hk === 'inspected' ? 'ok' : 'warn'}>{h.house.hk}</Chip> : <Chip tone="warn">not set up</Chip>}
                  {h.house?.use === 'RENTAL' && <Chip tone="info">rental tenancy</Chip>}
                  {h.house?.safetyDefect && <Chip tone="crit">safety defect</Chip>}
                  {h.unblocked.length > 0 && <Chip tone="crit">platform not blocked</Chip>}
                  {h.deepDue && <Chip tone="warn">deep clean due</Chip>}
                  {h.countDue && <Chip tone="warn">full count due</Chip>}
                  {h.licenceWarn && <Chip tone="warn">licence expiring</Chip>}
                </span>
              </div>
              <div className="muted small">
                {h.rate != null ? `RM${h.rate} a night · ` : ''}
                {h.house ? `${h.house.beds} beds · ${h.house.keys} keys (${h.house.keyMethod}) · platforms ${h.house.platforms.join(', ') || 'none'} · occupancy ${h.occupancyPct}% · income RM${h.income} (Finance-confirmed)` : 'The Asset Director sets it up.'}
              </div>
              {team && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {d.role === 'director' && (
                    <button className="btn btn-sm" onClick={() => setForm(`setup:${h.id}`)}>
                      Tetapan rumah / Set up
                    </button>
                  )}
                  {d.role === 'director' && h.house && (
                    <button className="btn btn-sm" onClick={() => setForm(`use:${h.id}`)}>
                      Guna / Use
                    </button>
                  )}
                  {h.house && (
                    <button className="btn btn-sm" onClick={() => setForm(`hk:${h.id}`)}>
                      Status rumah
                    </button>
                  )}
                  {h.house && (
                    <button className="btn btn-sm" onClick={() => setForm(`defect:${h.id}`)}>
                      Kecacatan / Defect
                    </button>
                  )}
                </div>
              )}
              {F(`setup:${h.id}`, 'Tetapan rumah / House set-up', 'house.setup', [
                { name: 'rate', label: 'Price per night (RM)', type: 'number' },
                { name: 'beds', label: 'Beds', type: 'number' },
                { name: 'maxGuests', label: 'Most guests', type: 'number' },
                { name: 'keys', label: 'Keys', type: 'number' },
                { name: 'keyMethod', label: 'Key method', type: 'select', options: ['KEY', 'LOCKBOX', 'SMART_LOCK'] },
                { name: 'depositPct', label: 'Deposit %', type: 'number' },
                { name: 'damageDeposit', label: 'Damage deposit RM (blank = off)', type: 'number' },
                { name: 'platforms', label: 'Platforms (comma list)', type: 'list' },
                { name: 'checkInTime', label: 'Check-in HH:MM' },
                { name: 'checkOutTime', label: 'Check-out HH:MM' },
              ], { id: h.id })}
              {F(`use:${h.id}`, 'Guna rumah / House use', 'house.use', [{ name: 'use', label: 'Use', type: 'select', options: ['SHORT_STAY', 'RENTAL'] }, { name: 'reason', label: 'Reason' }], { id: h.id })}
              {F(`hk:${h.id}`, 'Status rumah / House status', 'house.status', [{ name: 'hk', label: 'Status', type: 'select', options: ['dirty', 'clean', 'inspected'] }, { name: 'photos', label: 'Photos (inspected)', type: 'photos' }], { id: h.id })}
              {F(`defect:${h.id}`, 'Kecacatan / Defect', 'house.defect', [{ name: 'note', label: 'What' }, { name: 'safety', label: 'Safety defect (blocks hand-over)', type: 'check' }], { id: h.id, step: 'raise' })}
            </div>
          ))}
        </div>
      )}

      {tab === 'requests' && (
        <div className="list">
          {d.requests.length === 0 && <div className="empty">No staff stay requests.</div>}
          {d.requests.map((r) => (
            <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <strong>
                  {r.ref} · {r.department}
                </strong>
                <Chip tone={r.status === 'submitted' ? 'warn' : 'info'}>{r.status}</Chip>
              </div>
              <div className="muted small">
                {r.checkIn} to {r.checkOut} · {r.persons} occupant(s) · RM{r.price}
              </div>
              {team && r.status === 'submitted' && (
                <button className="btn btn-sm" onClick={() => setForm(`rq:${r.id}`)}>
                  Semak permohonan / Check
                </button>
              )}
              {team && r.status === 'held' && (
                <button className="btn btn-sm" onClick={() => void run('request.paid', { id: r.id }, 'Confirmed')}>
                  Sahkan (Finance sudah sahkan) / Confirm paid
                </button>
              )}
              {F(`rq:${r.id}`, 'Semak permohonan / Check request', 'request.check', [{ name: 'outcome', label: 'Outcome', type: 'select', options: ['confirm', 'return', 'not_available'] }, { name: 'propertyId', label: 'House', type: 'select', options: d.houses.map((h) => h.id) }, { name: 'note', label: 'Note' }], { id: r.id })}
            </div>
          ))}
        </div>
      )}

      {tab === 'money' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {d.role === 'finance' && (
            <button className="btn btn-sm btn-primary" onClick={() => setForm('payout')}>
              Rekod bayaran Airbnb / Record Airbnb payout
            </button>
          )}
          {F('payout', 'Airbnb payout', 'finance', [
            { name: 'on', label: 'Date received', type: 'date' },
            { name: 'amount', label: 'Amount RM', type: 'number' },
            { name: 'bankRef', label: 'Bank reference' },
            { name: 'account', label: 'Company bank account' },
            { name: 'lines', label: 'Booking ids (comma list)', type: 'list' },
            { name: 'reportFile', label: 'Airbnb earnings report (photo or screenshot)', type: 'photo' },
          ], { what: 'payout' })}
          <div className="list">
            {d.payouts.map((p) => (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <strong>
                  Payout {p.on} RM{p.amount} · {p.lines.length} booking(s)
                </strong>
                <span className="muted small">
                  Difference RM{p.diff} {p.explained ? `· ${p.explained}` : ''} · {p.status}
                </span>
                {d.role === 'finance' && p.status === 'recorded' && (
                  <button className="btn btn-sm" onClick={() => setForm(`poc:${p.id}`)}>
                    Sahkan / Confirm
                  </button>
                )}
                {F(`poc:${p.id}`, 'Confirm payout', 'finance', [{ name: 'slipRef', label: 'Statement reference' }, { name: 'explained', label: 'Difference explained' }], { id: p.id, what: 'payoutConfirm' })}
              </div>
            ))}
          </div>
          {d.recoveries.length > 0 && (
            <div className="list">
              {d.recoveries.map((r) => (
                <div key={r.id} className="list-item">
                  Staff stay damage RM{r.amount} · {r.name} · {r.status}
                  {r.recovered ? ` (${r.recovered.period})` : ' (next staff pay)'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'complaints' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {team && (
            <button className="btn btn-sm btn-primary" onClick={() => setForm('complaint')}>
              Log aduan / Log complaint
            </button>
          )}
          {F('complaint', 'Aduan / Complaint', 'complaint', [
            { name: 'level', label: 'Level', type: 'select', options: ['URGENT', 'NORMAL', 'REVIEW'] },
            { name: 'bookingId', label: 'Booking id' },
            { name: 'channel', label: 'Channel' },
            { name: 'from', label: 'From' },
            { name: 'what', label: 'What' },
            { name: 'stars', label: 'Stars (review)', type: 'number' },
            { name: 'aboutUserId', label: 'Staff member complained about (id)' },
            { name: 'fromRequestId', label: 'From a department request (id)' },
          ])}
          <div className="list">
            {d.complaints.map((c) => (
              <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                  <strong>
                    {c.ref} · {c.level}
                  </strong>
                  <Chip tone={c.status === 'closed' ? 'ok' : c.late ? 'crit' : 'warn'}>{c.status}</Chip>
                </div>
                <div className="muted small">{c.what}</div>
                {team && c.status === 'open' && (
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setForm(`ca:${c.id}`)}>
                      Jawab / Answer
                    </button>
                    <button className="btn btn-sm" onClick={() => setForm(`ci:${c.id}`)}>
                      Siasat / Act
                    </button>
                    <button className="btn btn-sm" onClick={() => setForm(`cc:${c.id}`)}>
                      Tutup / Close
                    </button>
                  </span>
                )}
                {F(`ca:${c.id}`, 'Answer', 'complaint.step', [{ name: 'note', label: 'What the complainant was told' }], { id: c.id, step: 'answer' })}
                {F(`ci:${c.id}`, 'Look into it and act', 'complaint.step', [{ name: 'action', label: 'What was done' }], { id: c.id, step: 'investigate' })}
                {F(`cc:${c.id}`, 'Close', 'complaint.step', [{ name: 'note', label: 'How it was closed' }], { id: c.id, step: 'close' })}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'care' && team && (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => setForm('clean')}>
              Rekod cucian / Record a clean
            </button>
            <button className="btn btn-sm" onClick={() => setForm('count')}>
              Kiraan penuh / Full count
            </button>
            <button className="btn btn-sm" onClick={() => setForm('cleaner')}>
              Banding kos cucian / Compare cleaning costs
            </button>
          </span>
          {F('clean', 'Cucian / Clean', 'clean', [
            { name: 'propertyId', label: 'House', type: 'select', options: d.houses.map((h) => h.id) },
            { name: 'bookingId', label: 'Booking id (turnover)' },
            { name: 'type', label: 'Type', type: 'select', options: ['TURNOVER', 'FINAL', 'DEEP', 'NEEDED'] },
            { name: 'cleaner', label: 'Cleaner' },
            { name: 'vendor', label: 'Vendor (if any)' },
            { name: 'start', label: 'Start', type: 'datetime' },
            { name: 'finish', label: 'Finish', type: 'datetime' },
            { name: 'ticks', label: 'Areas', type: 'ticks' },
            { name: 'photos', label: 'Photos (2+)', type: 'photos' },
          ])}
          {d.cleaners.map((c) => (
            <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <strong>{c.area}</strong>
              <table className="table small">
                <tbody>
                  {c.options.map((o) => (
                    <tr key={o.name}>
                      <td>
                        {o.name}
                        {o.own ? ' (own team)' : ''}
                      </td>
                      <td>Turnover RM{o.turnover}</td>
                      <td>Deep RM{o.deep}</td>
                      <td>Linen RM{o.linen}</td>
                      <td>Travel RM{o.travel}</td>
                      <td>{o.responseHours} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.picked ? <span className="small">Chosen: {c.picked.name} — {c.picked.reason}</span> : d.role === 'director' && <button className="btn btn-sm" onClick={() => setForm(`pick:${c.id}`)}>Pilih / Pick</button>}
              {F(`pick:${c.id}`, 'Pick who cleans', 'cleaner', [{ name: 'name', label: 'Option', type: 'select', options: c.options.map((o) => o.name) }, { name: 'reason', label: 'Reason' }], { id: c.id })}
            </div>
          ))}
          {d.counts.map((c) => (
            <div key={c.id} className="list-item">
              Count {c.propertyId} · difference RM{c.diffValue}
              {c.toFinanceAct ? ' (to Finance and ACT)' : ''} · {c.verified ? 'verified' : 'waiting for a second person'}
              {!c.verified && (
                <button className="btn btn-sm" onClick={() => void run('count', { id: c.id }, 'Verified')}>
                  Sahkan / Verify
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Staff stay requests for Government Operations and HQ departments ("Mohon rumah pekerja"), and damage acknowledgement. */
export function StayRequestPanel() {
  const v = useLoad(() => api.shortStays(), []);
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, unknown>>({ persons: 1, work: true });
  if (v.error) return null;
  const d = v.data as Board | undefined;
  if (!d || !d.installed) return null;
  const run = (action: string, body: Record<string, unknown>, ok: string) => act.run(() => api.shortStayAct(action, body), ok).then((r) => (r && v.reload(), r));
  const set = (k: string, x: unknown) => setF((o) => ({ ...o, [k]: x }));
  const houses = d.houses.filter((h) => h.house && h.house.use === 'SHORT_STAY');
  const rate = d.settings?.staffRates?.[d.settings.staffRates.length - 1];
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3>Mohon rumah pekerja / Staff house stay</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setOpen(!open)}>
          Mohon / Ask
        </button>
      </div>
      <ErrorNotice error={act.error} />
      {open && (
        <div className="card" style={{ padding: 8, display: 'grid', gap: 6 }}>
          <label className="field">
            <span>Rumah / House</span>
            <Select className="input" value={String(f.propertyId ?? '')} onChange={(e) => set('propertyId', e.target.value)}>
              <option value="">Any free house in the town</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.town})
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>Bandar / Town (if any house)</span>
            <input className="input" value={String(f.town ?? '')} onChange={(e) => set('town', e.target.value)} />
          </label>
          <label className="field">
            <span>Masuk / Check-in</span>
            <input className="input" type="date" onChange={(e) => set('checkIn', e.target.value)} />
          </label>
          <label className="field">
            <span>Keluar / Check-out</span>
            <input className="input" type="date" onChange={(e) => set('checkOut', e.target.value)} />
          </label>
          <label className="field">
            <span>Tujuan / Purpose</span>
            <input className="input" onChange={(e) => set('purpose', e.target.value)} />
          </label>
          <label className="field">
            <span>Penghuni (ID pengguna staf, dipisah koma) / Occupants (staff user ids, comma list)</span>
            <input className="input" onChange={(e) => set('occupantIds', e.target.value)} />
          </label>
          <label className="field">
            <span>Penerima kunci / Key receiver</span>
            <input className="input" onChange={(e) => set('keyReceiver', e.target.value)} />
          </label>
          <label className="small">
            <input type="checkbox" checked={f.work !== false} onChange={(e) => set('work', e.target.checked)} /> Urusan kerja (dibil kepada jabatan) / Work stay, billed to the department
          </label>
          {rate && (
            <div className="muted small">
              Kadar / Rate: RM{rate.amount} {rate.basis.toLowerCase().replace(/_/g, ' ')}. The price is shown when you send; send again to confirm it.
            </div>
          )}
          {(() => {
            const ids = String(f.occupantIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
            const n = f.checkIn && f.checkOut ? Math.max(0, Math.round((Date.parse(String(f.checkOut)) - Date.parse(String(f.checkIn))) / 86_400_000)) : 0;
            const units = !rate ? 0 : rate.basis === 'PER_PERSON_NIGHT' ? ids.length * n : rate.basis === 'PER_PERSON_STAY' ? ids.length : rate.basis === 'PER_PERSON_MONTH' ? ids.length * Math.max(1, Math.ceil(n / 30)) : n;
            const price = Math.round((rate?.amount ?? 0) * units * 100) / 100;
            return (
              <>
                <div>
                  <strong>Harga / Price: RM{price}</strong>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !ids.length}
                  onClick={() =>
                    void run('request', { ...f, persons: ids.length, occupants: ids.map((userId) => ({ userId })), priceSeen: price }, 'Sent').then((r) => {
                      if (r) setOpen(false);
                    })
                  }
                >
                  Hantar / Send
                </button>
              </>
            );
          })()}
        </div>
      )}
      <div className="list">
        {d.myRequests.length === 0 && <div className="empty">Tiada permohonan / No requests.</div>}
        {d.myRequests.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
              <strong>{r.ref}</strong>
              <Chip tone={r.status === 'returned' ? 'warn' : 'info'}>{r.status}</Chip>
            </div>
            <div className="muted small">
              {r.checkIn} to {r.checkOut} · {r.persons} occupant(s) · RM{r.price} {r.note ? `· ${r.note}` : ''}
            </div>
            {r.damages
              .filter((x) => x.mine && !x.ack)
              .map((x) => (
                <div key={x.id} className="card" style={{ padding: 6 }}>
                  <div>
                    Kerosakan / Damage: {x.what} — RM{x.amount}. {x.reason}
                  </div>
                  <div className="small">{d.consent}</div>
                  <button className="btn btn-sm btn-primary" onClick={() => void run('ack', { id: r.id, damageId: x.id, consent: true }, 'Acknowledged')}>
                    Saya akui dan setuju / I acknowledge and agree
                  </button>
                </div>
              ))}
            <span className="row" style={{ gap: 6 }}>
              {['returned', 'not_available'].includes(r.status) && (
                <button className="btn btn-sm" onClick={() => void run('request.resubmit', { id: r.id }, 'Sent again')}>
                  Hantar semula / Send again
                </button>
              )}
              {['submitted', 'held', 'confirmed'].includes(r.status) && (
                <button className="btn btn-sm" onClick={() => void run('request.cancel', { id: r.id, reason: 'No longer needed' }, 'Cancelled')}>
                  Batal / Cancel
                </button>
              )}
              {r.bookingId && (
                <>
                  <input className="input" aria-label="Complaint" placeholder="Aduan / Complaint" value={String(f[`c-${r.id}`] ?? '')} onChange={(e) => set(`c-${r.id}`, e.target.value)} />
                  <button className="btn btn-sm" onClick={() => void run('complaint', { requestId: r.id, level: 'NORMAL', what: f[`c-${r.id}`] }, 'Sent')}>
                    Hantar aduan / Send complaint
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
