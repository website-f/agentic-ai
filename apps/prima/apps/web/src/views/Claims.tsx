import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CameraIcon,
  CarIcon,
  EyeglassesIcon,
  FirstAidKitIcon,
  HourglassMediumIcon,
  PlusIcon,
  StethoscopeIcon,
  ToothIcon,
  UploadSimpleIcon,
  WalletIcon,
} from '@phosphor-icons/react';
import type { ClaimVehicle, ProofInput, StaffClaimKind } from '@prima/core';
import { api, type MyReceipts, type StaffClaims, type StaffClaimInput } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { Avatar, Card, Empty, Facts, PageHead, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { ProofPicker, readAsDataUrl, shrinkImage } from './Proof';
import { readReceiptOnPhone } from '../ocr';
import '../styles/leave.css';

/**
 * Staff claims (Fauzan, 26 Oct 2026). Staff are everyone except guards, patrolling officers and officers. Medical
 * with dental up to RM1,000 a year, optical RM500 every 2 years, the yearly check-up separately, and travel at the
 * rate the Chief of Staff publishes each month. A trip is asked before it is made; one not approved beforehand, or more than 10% off the system km, goes to
 * the Chief of Staff first; HR checks every claim and the COO approves it.
 *
 * P71 layout: an approval inbox. Each claim is a card with the person, what and how much, the trail of who decided and
 * who decides next, and the one decision this person can make.
 */

type Claim = StaffClaims['mine'][number];
type QueueRow = StaffClaims['queue'][number];
type Trip = StaffClaims['myTrips'][number];
type Receipt = MyReceipts['receipts'][number];
/** What a receipt from the wallet fills in on a new claim. */
type FromWallet = {
  kind: StaffClaimKind;
  date: string;
  amount: number;
  walletIds: string[];
  names: string[];
};

const KIND_LABEL: Record<StaffClaimKind, string> = {
  MEDICAL: 'Medical',
  DENTAL: 'Dental',
  OPTICAL: 'Optical',
  CHECKUP: 'Yearly check-up',
  TRAVEL: 'Travel',
};
const KIND_ICON: Record<StaffClaimKind, ReactNode> = {
  MEDICAL: <FirstAidKitIcon size={18} />,
  DENTAL: <ToothIcon size={18} />,
  OPTICAL: <EyeglassesIcon size={18} />,
  CHECKUP: <StethoscopeIcon size={18} />,
  TRAVEL: <CarIcon size={18} />,
};
const VEHICLE_LABEL: Record<ClaimVehicle, string> = {
  CAR: 'Own car',
  MOTORCYCLE: 'Own motorcycle',
  COMPANY_CAR: 'Company car',
};
// P80: amounts with thousands commas (RM1,234.50), like every other screen.
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function ClaimsView() {
  const { data, error } = useLoad(() => api.staffClaims(), []);
  const [tab, setTab] = useState<'mine' | 'queue' | 'enter' | 'rates' | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="claims" />;
  const view = tab ?? (data.role ? (data.role === 'cos' && data.missingRates.length ? 'rates' : 'queue') : data.toVerify ? 'queue' : 'mine');
  const waiting =
    data.queue.filter((r) => r.canCos || r.canHr || r.canCoo || r.canPay || r.canHead).length + data.tripQueue.filter((t) => t.status === 'pending').length;
  const hasQueue = !!data.role || data.queue.length > 0;
  return (
    <div className="page lv-page">
      <PageHead
        title="Claims"
        sub="Medical with dental up to RM1,000 a year, optical RM500 every 2 years, the yearly check-up at a panel clinic separately, and travel at the published rate per km. Valet parking cannot be claimed."
      >
        {data.canSetRates && data.missingRates.length > 0 && (
          <div className="notice" data-tone="warn" role="status">
            Publish the {data.thisMonth} mileage rates: {data.missingRates.map((v) => VEHICLE_LABEL[v]).join(', ')} still missing. Staff cannot claim travel
            this month until they are published.
          </div>
        )}
      </PageHead>
      {data.limits && (
        <Stats>
          <Stat label="Medical and dental left" value={rm(data.limits.medicalLeft)} note="This year, of RM1,000" icon={<FirstAidKitIcon />} tone="info" />
          <Stat label="Optical left" value={rm(data.limits.opticalLeft)} note="Over 2 years, of RM500" icon={<EyeglassesIcon />} tone="info" />
          {hasQueue && (
            <Stat
              label="Waiting for you"
              value={waiting}
              tone={waiting ? 'warn' : 'ok'}
              icon={<HourglassMediumIcon />}
              note={waiting ? 'Open to decide' : 'Nothing to decide'}
              onClick={() => setTab('queue')}
            />
          )}
        </Stats>
      )}
      <div className="tabbar" role="tablist" aria-label="Claim sections">
        {data.canClaim && (
          <button role="tab" aria-selected={view === 'mine'} onClick={() => setTab('mine')}>
            My claims
          </button>
        )}
        {hasQueue && (
          <button role="tab" aria-selected={view === 'queue'} onClick={() => setTab('queue')}>
            {data.role === 'cos' ? 'For the Chief of Staff' : data.role === 'coo' ? 'For the COO' : data.role ? 'All claims' : 'To verify as company head'}
            {waiting > 0 && <span className="tab-count">{waiting}</span>}
          </button>
        )}
        {data.enterFor.length > 0 && (
          <button role="tab" aria-selected={view === 'enter'} onClick={() => setTab('enter')}>
            Enter for staff
          </button>
        )}
        <button role="tab" aria-selected={view === 'rates'} onClick={() => setTab('rates')}>
          Mileage rates
          {data.canSetRates && data.missingRates.length > 0 && <span className="tab-count">{data.missingRates.length}</span>}
        </button>
      </div>
      {view === 'mine' && data.canClaim && <Mine data={data} />}
      {view === 'mine' && !data.canClaim && (
        <Card>
          <Empty title="Nothing to claim here">Staff claims are for office and management staff.</Empty>
        </Card>
      )}
      {view === 'queue' && <Inbox data={data} />}
      {view === 'enter' && <EnterFor data={data} />}
      {view === 'rates' && <Rates data={data} />}
    </div>
  );
}

function Mine({ data }: { data: StaffClaims }) {
  const [adding, setAdding] = useState(false);
  const [fromWallet, setFromWallet] = useState<FromWallet | null>(null);
  const done = () => {
    setAdding(false);
    setFromWallet(null);
  };
  return (
    <div className="lv-mine">
      <div className="lv-col">
        <Card
          title="My claims"
          sub={`${data.mine.length} claim${data.mine.length === 1 ? '' : 's'}`}
          flush
          actions={
            !adding && (
              <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                <PlusIcon size={16} aria-hidden="true" /> New claim
              </button>
            )
          }
        >
          {adding && (
            <div className="lv-pad">
              <NewClaim data={data} onDone={done} fromWallet={fromWallet} key={fromWallet?.walletIds.join() ?? 'new'} />
            </div>
          )}
          <div className="lv-rows">
            {data.mine.length === 0 && <Empty title="No claims yet.">Keep a receipt in your wallet, or start a new claim.</Empty>}
            {data.mine.map((c) => (
              <ClaimLine key={c.id} c={c} self />
            ))}
          </div>
        </Card>
      </div>
      <div className="lv-col">
        <Wallet
          onClaim={(w) => {
            setFromWallet(w);
            setAdding(true);
          }}
        />
        <Trips data={data} />
      </div>
    </div>
  );
}

function tripChip(t: Trip) {
  if (t.claimId) return <Chip tone="neutral">Claimed</Chip>;
  if (t.status === 'approved') return <Chip tone="ok">Approved</Chip>;
  if (t.status === 'rejected') return <Chip tone="crit">Rejected</Chip>;
  return <Chip tone="warn">Chief of Staff to approve</Chip>;
}

/** The three fields of a trip asked before it is made; used by the staff member and by HR entering for them. */
function TripFields({ form, setForm }: { form: { date: string; destination: string; purpose: string }; setForm: (f: { date: string; destination: string; purpose: string }) => void }) {
  return (
    <>
      <label className="field">
        <span className="label">Trip date</span>
        <input className="input" type="date" aria-label="Trip date" min={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Where to</span>
        <input
          className="input"
          aria-label="Where to"
          placeholder="Where to"
          value={form.destination}
          onChange={(e) => setForm({ ...form, destination: e.target.value })}
        />
      </label>
      <label className="field lv-full">
        <span className="label">Why</span>
        <input className="input" aria-label="Why" placeholder="Why" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
      </label>
    </>
  );
}

/** Trips are asked before they are made; the claim then picks the approved trip (insider abuse audit, 27 Oct 2026). */
function Trips({ data }: { data: StaffClaims }) {
  const [form, setForm] = useState({
    date: today(),
    destination: '',
    purpose: '',
  });
  const act = useAction();
  return (
    <Card title="Trips to approve before you go" sub="Ask the Chief of Staff before the trip. A travel claim for an approved trip goes straight to HR." flush>
      <div className="lv-pad">
        <div className="lv-form">
          <TripFields form={form} setForm={setForm} />
          <div className="lv-form-foot">
            <ErrorNotice error={act.error} />
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !form.destination.trim() || form.purpose.trim().length < 3}
              onClick={() =>
                act
                  .run(() => api.requestTrip(form), 'Sent to the Chief of Staff.')
                  .then((x) => {
                    if (x) setForm({ date: today(), destination: '', purpose: '' });
                  })
              }
            >
              Ask to travel
            </button>
          </div>
        </div>
      </div>
      {data.myTrips.length > 0 && (
        <div className="lv-rows">
          {data.myTrips.map((t) => (
            <div key={t.id} className="lv-row">
              <span className="lv-kind" aria-hidden="true">
                <CarIcon size={18} />
              </span>
              <div className="lv-row-text">
                <div className="lv-req-title">
                  {t.destination} · {dateLabel(t.date)}
                </div>
                <div className="lv-req-sub">
                  {t.purpose}
                  {t.decision ? ` · ${t.decision.by}${t.decision.note ? `: ${t.decision.note}` : ''}` : ''}
                </div>
              </div>
              {tripChip(t)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

type Filter = 'waiting' | 'open' | 'done' | 'all';
const FILTERS: [Filter, string][] = [
  ['waiting', 'Waiting for me'],
  ['open', 'In progress'],
  ['done', 'Decided'],
  ['all', 'All'],
];
const mayAct = (r: QueueRow) => r.canCos || r.canHr || r.canCoo || r.canPay || r.canHead;
const isClosed = (c: Claim) => c.status === 'approved' || c.status === 'rejected';

/** The claims and trips this person decides on: filters and search above, one card per request. */
function Inbox({ data }: { data: StaffClaims }) {
  const waitingCount = data.queue.filter(mayAct).length + data.tripQueue.filter((t) => t.status === 'pending').length;
  const [filter, setFilter] = useState<Filter>(waitingCount ? 'waiting' : 'all');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const claimHit = (c: Claim) =>
    !needle || `${c.personName} ${KIND_LABEL[c.kind]} ${c.note} ${c.travel?.destination ?? ''}`.toLowerCase().includes(needle);
  const tripHit = (t: Trip) => !needle || `${t.personName} ${t.destination} ${t.purpose}`.toLowerCase().includes(needle);
  const rows = data.queue.filter(
    (r) =>
      claimHit(r.claim) &&
      (filter === 'all' || (filter === 'waiting' ? mayAct(r) : filter === 'open' ? !isClosed(r.claim) : isClosed(r.claim))),
  );
  const trips = data.tripQueue.filter(
    (t) => tripHit(t) && (filter === 'all' || (filter === 'done' ? t.status !== 'pending' : t.status === 'pending')),
  );
  const count = (f: Filter) =>
    f === 'all'
      ? data.queue.length + data.tripQueue.length
      : f === 'waiting'
        ? waitingCount
        : f === 'open'
          ? data.queue.filter((r) => !isClosed(r.claim)).length + data.tripQueue.filter((t) => t.status === 'pending').length
          : data.queue.filter((r) => isClosed(r.claim)).length + data.tripQueue.filter((t) => t.status !== 'pending').length;
  return (
    <div className="lv-inbox">
      <Toolbar end={<span className="muted small">{rows.length + trips.length} shown</span>}>
        <div className="seg lv-seg" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label} <span className="lv-seg-n">{count(f)}</span>
            </button>
          ))}
        </div>
        <Search value={q} onChange={setQ} placeholder="Search name, kind or place" />
      </Toolbar>
      {data.tripQueue.length > 0 && trips.length > 0 && <TripQueue trips={trips} />}
      <Queue rows={rows} total={data.queue.length} />
    </div>
  );
}

function TripQueue({ trips }: { trips: Trip[] }) {
  return (
    <section className="lv-group" aria-label="Trips asked before they are made">
      <h2 className="lv-group-title">Trips asked before they are made</h2>
      <div className="lv-stack">
        {trips.map((t) => (
          <TripLine key={t.id} t={t} />
        ))}
      </div>
    </section>
  );
}

function TripLine({ t }: { t: Trip }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <article className="lv-req">
      <header className="lv-req-head">
        <Avatar name={t.personName} size={40} />
        <div className="lv-req-who">
          <div className="lv-req-title">{t.personName}</div>
          <div className="lv-req-sub">
            Trip to {t.destination} · {dateLabel(t.date)}
          </div>
        </div>
        <div className="lv-req-status">{tripChip(t)}</div>
      </header>
      <p className="lv-req-text">{t.purpose}</p>
      {t.decision && (
        <div className="lv-trail">
          {t.decision.by}
          {t.decision.note ? `: ${t.decision.note}` : ''}
        </div>
      )}
      {t.status === 'pending' && (
        <div className="lv-req-act">
          <div className="lv-decide">
            <input className="input" aria-label="Note" placeholder="Comment (needed to approve or reject)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="lv-decide-btns">
              <button
                className="btn btn-sm"
                disabled={act.busy || note.trim().length < 3}
                onClick={() => act.run(() => api.decideTrip(t.id, false, note), 'Trip rejected.')}
              >
                Reject
              </button>
              <button className="btn btn-primary btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.decideTrip(t.id, true, note), 'Trip approved.')}>
                Approve
              </button>
            </div>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </article>
  );
}

function statusChip(c: Claim) {
  if (c.status === 'approved') return c.paid ? <Chip tone="ok">Paid</Chip> : <Chip tone="ok">Approved, Finance to pay</Chip>;
  if (c.status === 'rejected') return <Chip tone="crit">Rejected</Chip>;
  if (c.travel?.cosReasons.length && !c.cosApproval) return <Chip tone="warn">Chief of Staff to approve</Chip>;
  const headWaits = !!c.headIds?.length && !c.headCheck;
  if (c.status === 'hr_checked') return <Chip tone="warn">{headWaits ? 'Company head to verify' : 'COO to approve'}</Chip>;
  return <Chip tone="warn">{headWaits ? 'HR and company head to check' : 'HR to decide'}</Chip>;
}

/** Where the claim is: who has decided and who decides next, read from the claim's own records. */
function claimSteps(c: Claim): { label: string; state: StepState; note?: string }[] {
  type Rec = { by: string; at: string } | null | undefined;
  const raw: { label: string; group: number; rec: Rec; done: boolean; waitNote?: string }[] = [];
  if (c.travel?.cosReasons.length) raw.push({ label: 'Chief of Staff', group: 1, rec: c.cosApproval, done: !!c.cosApproval });
  raw.push({ label: 'HR checks', group: 2, rec: c.hrDecision, done: !!c.hrDecision || c.status === 'hr_checked' || c.status === 'approved' });
  if (c.headIds?.length)
    raw.push({ label: 'Company head', group: 2, rec: c.headCheck, done: !!c.headCheck, waitNote: c.headNames?.length ? c.headNames.join(' or ') : undefined });
  raw.push({ label: 'COO approves', group: 3, rec: c.cooDecision, done: c.status === 'approved' });
  raw.push({ label: 'Finance pays', group: 4, rec: c.paid, done: !!c.paid });
  const sent = { label: 'Sent', state: 'done' as StepState, note: dateLabel(c.createdAt.slice(0, 10)) };
  if (c.status === 'rejected') {
    // The last decision on record is the one that stopped it.
    let stop = -1;
    raw.forEach((s, i) => {
      if (s.rec && (stop < 0 || s.rec.at > raw[stop].rec!.at)) stop = i;
    });
    return [sent, ...raw.map((s, i) => ({ label: s.label, state: (i === stop ? 'stopped' : s.rec ? 'done' : 'todo') as StepState, note: s.rec?.by }))];
  }
  return [
    sent,
    ...raw.map((s) => {
      const open = raw.filter((o) => o.group < s.group).every((o) => o.done);
      return { label: s.label, state: (s.done ? 'done' : open ? 'now' : 'todo') as StepState, note: s.rec?.by ?? (!s.done && open ? s.waitNote : undefined) };
    }),
  ];
}

function ClaimLine({ c, children, self }: { c: Claim; children?: ReactNode; self?: boolean }) {
  const t = c.travel;
  const meta = [c.note, c.enteredBy ? `entered by HR (${c.enteredBy.by})` : '', c.paid ? `paid by ${c.paid.by}, ${c.paid.ref}` : ''].filter(Boolean);
  const trail = [
    c.cosApproval?.note ? `Chief of Staff: ${c.cosApproval.by}, ${c.cosApproval.note}` : '',
    c.headCheck?.note ? `Company head: ${c.headCheck.by}, ${c.headCheck.note}` : '',
    c.hrDecision?.note ? `HR: ${c.hrDecision.by}, ${c.hrDecision.note}` : '',
  ].filter(Boolean);
  const facts: [ReactNode, ReactNode][] = t
    ? [
        ['Trip', `${t.destination} (${t.preApproved ? 'pre-approved' : 'not pre-approved'})`],
        ['Vehicle', `${VEHICLE_LABEL[t.vehicle]} · ${t.kmClaimed} km claimed`],
        ['Mileage', self ? rm(t.mileage) : `System ${t.kmSystem === null ? 'unknown' : `${t.kmSystem} km`} × ${rm(t.perKm)} = ${rm(t.mileage)}`],
        ...(t.toll ? [['Toll', rm(t.toll)] as [ReactNode, ReactNode]] : []),
        ...(t.parking ? [['Parking', rm(t.parking)] as [ReactNode, ReactNode]] : []),
        ...(t.overnightNights ? [['Overnight', `${t.overnightNights} night(s), hotel ${rm(t.hotel)}`] as [ReactNode, ReactNode]] : []),
        ...(t.food ? [['Food', rm(t.food)] as [ReactNode, ReactNode]] : []),
      ]
    : [];
  return (
    <article className="lv-req">
      <header className="lv-req-head">
        {self ? (
          <span className="lv-kind lv-kind-lg" aria-hidden="true">
            {KIND_ICON[c.kind]}
          </span>
        ) : (
          <Avatar name={c.personName} size={40} />
        )}
        <div className="lv-req-who">
          <div className="lv-req-title">{self ? KIND_LABEL[c.kind] : c.personName}</div>
          <div className="lv-req-sub">{self ? `${c.personName} · ${dateLabel(c.date)}` : `${KIND_LABEL[c.kind]} · ${dateLabel(c.date)}`}</div>
        </div>
        <div className="lv-req-amt">
          <strong>{rm(c.allowed)}</strong>
          {c.allowed < c.amount ? <span className="muted small">of {rm(c.amount)}</span> : null}
        </div>
        <div className="lv-req-status">{statusChip(c)}</div>
      </header>
      {meta.length > 0 && <p className="lv-req-text">{meta.join(' · ')}</p>}
      {t && (
        <div className="lv-trip">
          <Facts items={facts} />
          {t.cosReasons.length > 0 && (
            <div className="notice small" data-tone="warn">
              Needs the Chief of Staff: {t.cosReasons.join('; ')}.
            </div>
          )}
        </div>
      )}
      <div className="lv-steps">
        <Steps steps={claimSteps(c)} />
      </div>
      {trail.length > 0 && (
        <ul className="lv-trail">
          {trail.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {children && <div className="lv-req-act">{children}</div>}
    </article>
  );
}

/** Pilot phase 1 (Fauzan, 28 Oct 2026): the HR administrator enters claims and trips for IT staff who are not signed in. */
function EnterFor({ data }: { data: StaffClaims }) {
  const [personId, setPersonId] = useState('');
  const [what, setWhat] = useState<'claim' | 'trip' | null>(null);
  const [trip, setTrip] = useState({
    date: today(),
    destination: '',
    purpose: '',
  });
  const act = useAction();
  const who = data.enterFor.find((p) => p.id === personId);
  return (
    <Card
      title="Enter for staff"
      sub="During the pilot the staff member gives you the receipt or the trip details on Teams, email or in person, and you enter it here for them. The record shows it was entered by HR. Another person checks and approves it as usual."
    >
      <div className="lv-enter">
        <div className="lv-form">
          <label className="field">
            <span className="label">Staff member</span>
            <select className="select" aria-label="Staff member" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Choose the staff member…</option>
              {data.enterFor.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="label">What to enter</span>
            <div className="seg lv-seg" role="group" aria-label="What to enter">
              <button type="button" disabled={!personId} aria-pressed={what === 'claim'} onClick={() => setWhat('claim')}>
                New claim
              </button>
              <button type="button" disabled={!personId} aria-pressed={what === 'trip'} onClick={() => setWhat('trip')}>
                Ask to travel
              </button>
            </div>
          </div>
        </div>
        {who && what === 'claim' && <NewClaim data={data} forPersonId={who.id} key={who.id} onDone={() => setWhat(null)} />}
        {who && what === 'trip' && (
          <div className="lv-formbox">
            <h3 className="lv-formbox-title">Trip for {who.name}</h3>
            <div className="lv-form">
              <TripFields form={trip} setForm={setTrip} />
              <div className="lv-form-foot">
                <button
                  className="btn btn-primary"
                  disabled={act.busy || !trip.destination.trim() || trip.purpose.trim().length < 3}
                  onClick={() =>
                    act
                      .run(() => api.requestTrip({ ...trip, forPersonId: who.id }), 'Sent for approval.')
                      .then((x) => {
                        if (x) {
                          setTrip({ date: today(), destination: '', purpose: '' });
                          setWhat(null);
                        }
                      })
                  }
                >
                  Send for {who.name}
                </button>
              </div>
            </div>
          </div>
        )}
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}

function NewClaim({ data, onDone, forPersonId, fromWallet }: { data: StaffClaims; onDone: () => void; forPersonId?: string; fromWallet?: FromWallet | null }) {
  const [kind, setKind] = useState<StaffClaimKind>(fromWallet?.kind ?? 'MEDICAL');
  const [date, setDate] = useState(fromWallet?.date ?? today());
  const [amount, setAmount] = useState(fromWallet && fromWallet.kind !== 'TRAVEL' ? fromWallet.amount : 0);
  const walletIds = fromWallet?.walletIds ?? [];
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [trip, setTrip] = useState({
    destination: '',
    tripId: null as string | null,
    vehicle: 'CAR' as ClaimVehicle,
    kmClaimed: 0,
    toll: 0,
    parking: 0,
    overnightNights: 0,
    hotel: 0,
  });
  const act = useAction();
  const box = useRef<HTMLDivElement>(null);
  // A claim started from a receipt in the wallet opens above it: bring it into view.
  useEffect(() => {
    if (fromWallet) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fromWallet]);
  const travel = kind === 'TRAVEL';
  const earliest = new Date(Date.parse(today()) - data.claimMaxAgeDays * 86_400_000).toISOString().slice(0, 10);
  const usable = forPersonId ? [] : data.myTrips.filter((t) => t.status === 'approved' && !t.claimId && t.date <= today());
  const receiptsNeeded = (!travel || trip.toll + trip.parking + trip.hotel > 0) && !walletIds.length;
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const input: StaffClaimInput = travel ? { kind, date, note, travel: trip, forPersonId, walletIds } : { kind, date, amount, note, forPersonId, walletIds };
  return (
    <div className="lv-formbox" ref={box}>
      <h3 className="lv-formbox-title">New claim</h3>
      <div className="lv-form">
        <label className="field">
          <span className="label">Kind of claim</span>
          <select className="select" aria-label="Kind of claim" value={kind} onChange={(e) => setKind(e.target.value as StaffClaimKind)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{travel ? 'Trip date' : 'Receipt date'}</span>
          <input className="input" type="date" aria-label="Date" value={date} min={earliest} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        {!travel && (
          <label className="field">
            <span className="label">Receipt amount (RM)</span>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              aria-label="Receipt amount RM"
              placeholder="Receipt RM"
              value={amount || ''}
              onChange={(e) => setAmount(num(e.target.value))}
            />
          </label>
        )}
        <p className="lv-hint lv-full">
          Claims are made within {data.claimMaxAgeDays} days of the receipt or trip. The same receipt or trip cannot be claimed twice.
        </p>
        {travel && (
          <>
            <label className="field lv-full">
              <span className="label">Approved trip</span>
              <select
                className="select"
                aria-label="Approved trip"
                value={trip.tripId ?? ''}
                onChange={(e) => {
                  const t = usable.find((x) => x.id === e.target.value);
                  setTrip({
                    ...trip,
                    tripId: t?.id ?? null,
                    destination: t ? t.destination : trip.destination,
                  });
                  if (t) setDate(t.date);
                }}
              >
                <option value="">No approved trip (goes to the Chief of Staff)</option>
                {usable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {dateLabel(t.date)} · {t.destination}
                  </option>
                ))}
              </select>
            </label>
            <label className="field lv-full">
              <span className="label">Where you went and why</span>
              <input
                className="input"
                aria-label="Where you went"
                placeholder="Where you went and why"
                value={trip.destination}
                onChange={(e) => setTrip({ ...trip, destination: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Vehicle</span>
              <select className="select" aria-label="Vehicle" value={trip.vehicle} onChange={(e) => setTrip({ ...trip, vehicle: e.target.value as ClaimVehicle })}>
                {Object.entries(VEHICLE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Km, office there and back</span>
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Km, office there and back"
                placeholder="Km"
                value={trip.kmClaimed || ''}
                onChange={(e) => setTrip({ ...trip, kmClaimed: num(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="label">Toll (RM)</span>
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Toll RM"
                placeholder="Toll RM"
                value={trip.toll || ''}
                onChange={(e) => setTrip({ ...trip, toll: num(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="label">Parking (RM, no valet)</span>
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Parking RM (no valet)"
                placeholder="Parking RM (no valet)"
                value={trip.parking || ''}
                onChange={(e) => setTrip({ ...trip, parking: num(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="label">Nights away</span>
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Nights away"
                placeholder="Nights away"
                value={trip.overnightNights || ''}
                onChange={(e) => setTrip({ ...trip, overnightNights: num(e.target.value) })}
              />
            </label>
            {trip.overnightNights > 0 && (
              <label className="field">
                <span className="label">Hotel (RM)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  aria-label="Hotel RM"
                  placeholder="Hotel RM (up to RM200 a night)"
                  value={trip.hotel || ''}
                  onChange={(e) => setTrip({ ...trip, hotel: num(e.target.value) })}
                />
              </label>
            )}
            <p className="lv-hint lv-full">
              Food: RM25 when over 90 km one way, or RM50 a night when you stay overnight. The app checks the km against your location while clocked in; more
              than 10% apart, or a trip not approved before it was made, goes to the Chief of Staff. Toll, parking and hotel need their receipts.
            </p>
          </>
        )}
        {walletIds.length > 0 && (
          <div className="notice small lv-full" data-tone="info">
            From your wallet: {fromWallet!.names.join(', ')}
          </div>
        )}
        <div className="lv-full">
          <ProofPicker site={null} refText="Receipt" items={proof} onChange={setProof} documentsOnly required={receiptsNeeded} />
        </div>
        {kind === 'CHECKUP' && <p className="lv-hint lv-full">Upload the panel clinic receipt and the result. Only HR sees the result.</p>}
        <label className="field lv-full">
          <span className="label">Note</span>
          <input className="input" aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="lv-form-foot">
          <ErrorNotice error={act.error} />
          <button className="btn btn-ghost" onClick={onDone}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={
              act.busy ||
              (travel ? !trip.destination.trim() || !trip.kmClaimed || (receiptsNeeded && !proof.length) : !amount || (!proof.length && !walletIds.length))
            }
            onClick={async () => {
              if (await act.run(() => api.submitStaffClaim(input, proof), 'Claim sent.')) onDone();
            }}
          >
            Send the claim
          </button>
        </div>
      </div>
    </div>
  );
}

function Queue({ rows, total }: { rows: QueueRow[]; total: number }) {
  return (
    <section className="lv-group" aria-label="Claims">
      {rows.length > 0 && <h2 className="lv-group-title">Claims</h2>}
      <div className="lv-stack">
        {total === 0 && (
          <Card>
            <Empty title="No claims." />
          </Card>
        )}
        {total > 0 && rows.length === 0 && (
          <Card>
            <Empty title="No claims match">Try another filter or search.</Empty>
          </Card>
        )}
        {rows.map((r) => (
          <ClaimLine key={r.claim.id} c={r.claim}>
            {r.canHead && <HeadVerify r={r} />}
            {(r.canCos || r.canHr || r.canCoo) && <Decide r={r} />}
            {r.canPay && <Pay r={r} />}
          </ClaimLine>
        ))}
      </div>
    </section>
  );
}

function Decide({ r }: { r: QueueRow }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const by = r.canCos ? 'cos' : r.canCoo ? 'coo' : 'hr';
  return (
    <>
      <div className="lv-decide">
        <input className="input" aria-label="Decision note" placeholder="Comment (needed to approve or reject)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="lv-decide-btns">
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() => act.run(() => api.decideStaffClaim(r.claim.id, by, false, note), 'Rejected.')}
          >
            Reject
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() => act.run(() => api.decideStaffClaim(r.claim.id, by, true, note), by === 'hr' ? 'Checked, sent to the COO.' : 'Approved.')}
          >
            {by === 'hr' ? 'Checked, to COO' : 'Approve'}
          </button>
        </div>
      </div>
      <ErrorNotice error={act.error} />
    </>
  );
}

/** The company head verifies the claim with a comment (Fauzan, 2 Nov 2026); a rejection ends it. */
function HeadVerify({ r }: { r: QueueRow }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <>
      <p className="lv-hint">You are this staff member's company head. Check it is a real expense on a day you know of.</p>
      <div className="lv-decide">
        <input className="input" aria-label="Verification comment" placeholder="Comment (required)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="lv-decide-btns">
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() => act.run(() => api.headVerifyClaim(r.claim.id, false, note), 'Rejected.')}
          >
            Reject
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() => act.run(() => api.headVerifyClaim(r.claim.id, true, note), 'Verified.')}
          >
            Verify
          </button>
        </div>
      </div>
      <ErrorNotice error={act.error} />
    </>
  );
}

/** Finance pays the approved claim and records the reference; the Finance Director in the pilot (Fauzan, 28 Oct 2026). */
function Pay({ r }: { r: QueueRow }) {
  const [ref, setRef] = useState('');
  const act = useAction();
  return (
    <>
      <div className="lv-decide">
        <input className="input" aria-label="Payment reference" placeholder="Payment reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        <div className="lv-decide-btns">
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || ref.trim().length < 3}
            onClick={() => act.run(() => api.decideStaffClaim(r.claim.id, 'finance', true, ref), 'Payment recorded.')}
          >
            Record payment
          </button>
        </div>
      </div>
      <ErrorNotice error={act.error} />
    </>
  );
}

function Rates({ data }: { data: StaffClaims }) {
  const [vehicle, setVehicle] = useState<ClaimVehicle>(data.missingRates[0] ?? 'CAR');
  const [perKm, setPerKm] = useState(0);
  const act = useAction();
  return (
    <div className="lv-rates">
      {data.canSetRates && (
        <Card title={`Publish for ${data.thisMonth}`} sub="The Chief of Staff sets and publishes the approved rate per km for each vehicle every month.">
          <div className="lv-form">
            <label className="field">
              <span className="label">Vehicle</span>
              <select className="select" aria-label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value as ClaimVehicle)}>
                {Object.entries(VEHICLE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">RM per km</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                aria-label="RM per km"
                placeholder="RM per km"
                value={perKm || ''}
                onChange={(e) => setPerKm(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <div className="lv-form-foot">
              <ErrorNotice error={act.error} />
              <button
                className="btn btn-primary"
                disabled={act.busy || !perKm}
                onClick={() => act.run(() => api.setClaimRate(data.thisMonth, vehicle, perKm), `Published for ${data.thisMonth}.`)}
              >
                Publish for {data.thisMonth}
              </button>
            </div>
          </div>
        </Card>
      )}
      <Card
        title="Mileage rates"
        sub={data.canSetRates ? 'Published rates, newest first.' : 'The Chief of Staff sets and publishes the approved rate per km for each vehicle every month.'}
        flush
      >
        {data.rates.length === 0 ? (
          <Empty title="No rates published yet." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Vehicle</th>
                  <th className="num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.rates.map((r) => (
                  <tr key={r.id}>
                    <td>{r.month}</td>
                    <td>{VEHICLE_LABEL[r.vehicle]}</td>
                    <td className="num">{rm(r.perKm)} a km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ----- Receipt wallet (Fauzan, 2 Nov 2026) -----
// "staff can upload receipts when they get it, upload or phone camera scanner. Then system automatically read it. Staff
// have the power to push claim now or later. A place to store all receipt for claim."

const RECEIPT_LABEL: Record<string, string> = {
  ...KIND_LABEL,
  TOLL: 'Toll (travel)',
  PARKING: 'Parking (travel)',
  HOTEL: 'Hotel (travel)',
  FUEL: 'Fuel (travel)',
  OTHER: 'Other',
};
const CLAIM_KINDS: string[] = ['MEDICAL', 'DENTAL', 'OPTICAL', 'CHECKUP'];
let testReceipts = 0;

function Wallet({ onClaim }: { onClaim: (w: FromWallet) => void }) {
  const { data, error } = useLoad(() => api.myReceipts(), []);
  const act = useAction();
  const [err, setErr] = useState<string | null>(null);
  const [showClaimed, setShowClaimed] = useState(false);
  const [reading, setReading] = useState(false);
  const add = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    try {
      const type = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg');
      if (!/^(application\/pdf|image\/(jpeg|png|heic|heif))$/.test(type)) throw new Error('Take a photo, or choose a PDF, JPEG or PNG.');
      let body = await readAsDataUrl(f);
      if (type === 'application/pdf') {
        if (f.size > 700_000) throw new Error('The PDF is over 700 KB. Take a photo of the receipt instead.');
      } else if (f.size > 700_000 || type !== 'image/jpeg') body = await shrinkImage(body);
      const name = f.name && f.name !== 'image.jpg' ? f.name : `Receipt ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.jpg`;
      let read = null;
      if (api.mode !== 'demo' && type !== 'application/pdf') {
        setReading(true);
        try {
          read = await readReceiptOnPhone(body, new Date().toISOString());
        } finally {
          setReading(false);
        }
      }
      await act.run(() => api.addReceipts([{ kind: 'document', name, data: body }], read ? [read] : []), 'Kept in your wallet.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The receipt could not be kept.');
    }
  };
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="receipts" />;
  const open = data.receipts.filter((r) => !r.claimId);
  const claimed = data.receipts.filter((r) => r.claimId);
  return (
    <Card
      title={
        <span className="lv-title-icon">
          <WalletIcon size={18} aria-hidden="true" /> My receipts
        </span>
      }
      sub={
        <>
          Keep each receipt here when you get it, then claim now or later (within {data.maxAgeDays} days of the receipt).{' '}
          {data.reader === 'test'
            ? 'Test link: the receipt is "read" from its file name, for example "Klinik 28-10-2026 RM85.00.jpg".'
            : data.reader === 'phone'
              ? 'Your phone reads the date, total and shop from the photo (the photo is not sent anywhere to be read); check them before you claim. For a PDF, type the figures.'
              : 'Prima reads the date, total and shop; check them before you claim.'}
        </>
      }
      flush
    >
      <div className="lv-pad lv-wallet-top">
        <div className="lv-wallet-btns">
          <label className="btn btn-primary btn-sm lv-filebtn">
            <CameraIcon size={16} aria-hidden="true" /> Scan with camera
            {/* Opens the phone's back camera; on a computer it opens the file picker. */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Scan receipt with camera"
              disabled={act.busy || reading}
              onChange={(e) => {
                void add(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <label className="btn btn-sm lv-filebtn">
            <UploadSimpleIcon size={16} aria-hidden="true" /> Upload file
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              aria-label="Upload receipt file"
              disabled={act.busy || reading}
              onChange={(e) => {
                void add(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {api.mode === 'demo' && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={act.busy || reading}
              onClick={() => {
                testReceipts += 1;
                const d = new Date(Date.now() + 8 * 3_600_000 - testReceipts * 86_400_000).toISOString().slice(0, 10);
                const dmy = `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
                const name =
                  testReceipts % 2 ? `Klinik Sejahtera ${dmy} RM${(40 + testReceipts * 5).toFixed(2)}.jpg` : `PLUS Toll ${dmy} RM${(7.4).toFixed(2)}.jpg`;
                void act.run(
                  () =>
                    api.addReceipts([
                      {
                        kind: 'document',
                        name,
                        data: `data:image/jpeg;base64,${btoa(`test receipt ${name} ${Date.now()}`)}`,
                      },
                    ]),
                  'Kept in your wallet.',
                );
              }}
            >
              Use a test receipt
            </button>
          )}
        </div>
        {data.dueSoon > 0 && (
          <div className="notice small" data-tone="warn" role="status">
            {data.dueSoon} receipt(s) must be claimed within 7 days or they can no longer be claimed.
          </div>
        )}
        {reading && (
          <div className="notice small" role="status">
            Reading the receipt on your phone… The first scan downloads the reader once (about 7 MB).
          </div>
        )}
        {err && (
          <div className="notice small" data-tone="warn">
            {err}
          </div>
        )}
        <ErrorNotice error={act.error} />
      </div>
      <div className="lv-rows">
        {open.length === 0 && <div className="empty">No receipts waiting to be claimed.</div>}
        {open.map((r) => (
          <ReceiptLine key={r.id} r={r} kinds={data.kinds} onClaim={onClaim} />
        ))}
      </div>
      {claimed.length > 0 && (
        <div className="lv-pad lv-claimed">
          <button className="btn btn-ghost btn-sm" aria-expanded={showClaimed} onClick={() => setShowClaimed(!showClaimed)}>
            {showClaimed ? 'Hide' : 'Show'} {claimed.length} claimed receipt(s)
          </button>
        </div>
      )}
      {showClaimed && (
        <div className="lv-rows">
          {claimed.map((r) => (
            <div key={r.id} className="lv-row">
              <div className="lv-row-text">
                <div className="lv-req-title">{r.confirmed?.merchant ?? r.read?.merchant ?? r.name}</div>
                <div className="lv-req-sub">
                  {r.confirmed ? `${dateLabel(r.confirmed.date)} · ${rm(r.confirmed.amount)}` : r.name} · claim {r.claimId}
                </div>
              </div>
              <Chip tone={r.claimStatus === 'rejected' ? 'crit' : r.claimStatus === 'approved' ? 'ok' : 'warn'}>{r.claimStatus ?? 'claimed'}</Chip>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function readChip(r: Receipt) {
  if (r.confirmed) return <Chip tone="ok">Checked by you</Chip>;
  if (r.readState === 'read')
    return <Chip tone="neutral">{r.read?.by === 'phone' ? 'Read on your phone' : r.read?.by === 'test' ? 'Read (test)' : 'Read from the text'}, check it</Chip>;
  if (r.readState === 'failed') return <Chip tone="warn">Could not read, type it</Chip>;
  if (r.readState === 'waiting') return <Chip tone="neutral">Reading…</Chip>;
  return <Chip tone="neutral">Type the figures</Chip>;
}

function ReceiptLine({ r, kinds, onClaim }: { r: Receipt; kinds: string[]; onClaim: (w: FromWallet) => void }) {
  const seen = r.confirmed ?? r.read;
  const [form, setForm] = useState({
    date: seen?.date ?? '',
    amount: seen?.amount ?? 0,
    merchant: seen?.merchant ?? '',
    kind: (seen?.kind as string | null) ?? '',
  });
  const [why, setWhy] = useState('');
  const [removing, setRemoving] = useState(false);
  const act = useAction();
  const c = r.confirmed;
  const changed = !c || c.date !== form.date || c.amount !== form.amount || c.merchant !== form.merchant || c.kind !== form.kind;
  const claimKind: StaffClaimKind | null = c ? (CLAIM_KINDS.includes(c.kind) ? (c.kind as StaffClaimKind) : c.kind === 'OTHER' ? null : 'TRAVEL') : null;
  return (
    <div className="lv-receipt">
      <div className="lv-receipt-head">
        {r.mime.startsWith('image/') ? (
          <img className="lv-thumb" src={r.data} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        ) : (
          <span className="lv-kind lv-kind-lg" aria-hidden="true">
            PDF
          </span>
        )}
        <div className="lv-row-text">
          <div className="lv-req-title lv-break">{r.name}</div>
          <div className="lv-req-sub">
            Kept {dateLabel(r.receivedAt.slice(0, 10))}
            {r.read && r.readState === 'read'
              ? ` · read: ${r.read.date ? dateLabel(r.read.date) : 'no date'}, ${r.read.amount != null ? rm(r.read.amount) : 'no total'}${r.read.merchant ? `, ${r.read.merchant}` : ''}`
              : ''}
            {r.daysLeft != null ? ` · claim by ${dateLabel(r.claimBy!)} (${r.daysLeft < 0 ? 'too late' : `${r.daysLeft} days left`})` : ''}
          </div>
        </div>
        <div className="lv-req-status">{readChip(r)}</div>
      </div>
      <div className="lv-fields">
        <label className="field">
          <span className="label">Date</span>
          <input className="input" type="date" aria-label="Receipt date" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Total (RM)</span>
          <input
            className="input"
            type="number"
            min={0}
            step="0.01"
            aria-label="Receipt total RM"
            placeholder="Total RM"
            value={form.amount || ''}
            onChange={(e) =>
              setForm({
                ...form,
                amount: Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </label>
        <label className="field">
          <span className="label">Shop or clinic</span>
          <input
            className="input"
            aria-label="Shop or clinic"
            placeholder="Shop or clinic"
            value={form.merchant}
            onChange={(e) => setForm({ ...form, merchant: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">What it is for</span>
          <select className="select" aria-label="What it is for" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="">What is it for…</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {RECEIPT_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="lv-receipt-act">
        {!removing ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(true)}>
            Remove
          </button>
        ) : (
          <div className="lv-remove">
            <input
              className="input"
              aria-label="Why remove"
              placeholder="Why (for example: blurry, took again)"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
            <button className="btn btn-sm btn-danger" disabled={act.busy} onClick={() => act.run(() => api.receiptAction(r.id, 'remove', { why }), 'Removed.')}>
              Remove it
            </button>
          </div>
        )}
        <span className="lv-spacer" />
        {c && !changed && !claimKind && <span className="muted small">Not a staff claim kind; keep it or remove it.</span>}
        {changed && (
          <button
            className="btn btn-sm"
            disabled={act.busy || !form.date || !form.amount || form.merchant.trim().length < 2 || !form.kind}
            onClick={() => act.run(() => api.receiptAction(r.id, 'confirm', form), 'Saved. Claim now or later.')}
          >
            {c ? 'Save the correction' : 'These are right'}
          </button>
        )}
        {c && !changed && claimKind && (
          <button
            className="btn btn-primary btn-sm"
            disabled={r.daysLeft != null && r.daysLeft < 0}
            onClick={() =>
              onClaim({
                kind: claimKind,
                date: c.date,
                amount: c.amount,
                walletIds: [r.id],
                names: [r.name],
              })
            }
          >
            Claim now
          </button>
        )}
      </div>
    </div>
  );
}
