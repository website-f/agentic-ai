// E6 (P100, Fauzan 11 Nov 2026): moving a vehicle to another group company's use. Managed by the Transport department,
// monitored by the COO. Three steps: Transport asks (company, date, reason); a second Transport member or the COO
// approves or returns it with a comment, never the person who asked; Transport records the handover, and only then does
// the vehicle move (the rent goes to the company using it at month end). Phone first: one list, a drawer per move.
import { useState } from 'react';
import { ArrowRightIcon, CarIcon } from '@phosphor-icons/react';
import { Select } from '../SearchSelect';
import { api } from '../api';
import type { VehicleTransferBoard } from '../api/p100-newb';
import { Card, Empty, Facts, Search, Steps, Toolbar, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { FilterChips, TabIntro, hasText } from './items/shared';
import '../styles/items.css';
import '../styles/p100-newb.css';

type Move = VehicleTransferBoard['moves'][number];

const STATUS: Record<Move['status'], [Tone, string]> = {
  requested: ['warn', 'Waiting for approval'],
  approved: ['info', 'Approved, to hand over'],
  returned: ['neutral', 'Returned'],
  cancelled: ['neutral', 'Cancelled'],
  handed_over: ['ok', 'Handed over'],
};
const OPEN = (m: Move) => m.status === 'requested' || m.status === 'approved';

export function VehicleTransfersPanel() {
  const { data, error, reload } = useLoad(() => api.vehicleTransferBoard(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [show, setShow] = useState<'open' | 'done' | 'all'>('open');
  const [q, setQ] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="vehicle moves" />;
  const m = data.moves.find((x) => x.id === open) ?? null;
  const list = data.moves.filter(
    (x) => (show === 'open' ? OPEN(x) : show === 'done' ? !OPEN(x) : true) && hasText(q, x.ref, x.plate, x.fromName, x.toName, x.reason, x.requestedBy),
  );
  const askButton = data.canRequest && !asking && (
    <button className="btn btn-primary" type="button" onClick={() => setAsking(true)}>
      <CarIcon size={16} aria-hidden="true" /> Ask to move a vehicle
    </button>
  );
  return (
    <div className="it-stack">
      <TabIntro
        title="Move between companies"
        sub="A vehicle owned by one company can be used by another. Transport asks, a second Transport member or the COO approves with a comment (never the person who asked), and the vehicle moves only when Transport records the handover. The owner does not change; the rent goes to the company using it at month end."
        actions={askButton || undefined}
      />
      {asking && <AskForm data={data} onDone={(id) => (setAsking(false), reload(), id && setOpen(id))} />}
      <Card title="Vehicle moves" flush>
        <div className="it-pad">
          <Toolbar>
            <Search value={q} onChange={setQ} placeholder="Search plate, company or reference" />
          </Toolbar>
          <FilterChips
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              ['open', 'Open', data.moves.filter(OPEN).length],
              ['done', 'Done', data.moves.filter((x) => !OPEN(x)).length],
              ['all', 'All', data.moves.length],
            ]}
          />
        </div>
        {!data.moves.length ? (
          <Empty title="No vehicle moves yet." action={askButton || undefined}>
            {data.canRequest ? 'Ask to move a vehicle when another company needs it.' : 'Moves the Transport department asks for show here.'}
          </Empty>
        ) : !list.length ? (
          <Empty title="Nothing matches.">Change the search or choose another filter.</Empty>
        ) : (
          <ul className="it-rows">
            {list.map((x) => (
              <li key={x.id}>
                <button className="it-row it-row-btn" type="button" data-tone={x.canDecide || x.canHandOver ? 'warn' : undefined} onClick={() => setOpen(x.id)}>
                  <span className="it-row-main">
                    <strong>
                      {x.plate} · {x.ref}
                    </strong>
                    <span className="muted">
                      {x.fromName} <ArrowRightIcon size={12} aria-hidden="true" /> {x.toName} · from {dateLabel(x.wantedOn)}
                    </span>
                    {x.canDecide && <span className="nb-due">For you to approve</span>}
                    {x.canHandOver && <span className="nb-due">Record the handover</span>}
                  </span>
                  <Chip tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Chip>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {m && (
        <Drawer title={`${m.plate} · ${m.ref}`} sub={`${m.fromName} → ${m.toName}`} onClose={() => setOpen(null)}>
          <MoveDetail data={data} m={m} onChange={() => reload()} />
        </Drawer>
      )}
    </div>
  );
}

function AskForm({ data, onDone }: { data: VehicleTransferBoard; onDone: (id?: string) => void }) {
  const act = useAction();
  const [vehicleId, setVehicleId] = useState('');
  const [to, setTo] = useState('');
  const [on, setOn] = useState(data.today);
  const [reason, setReason] = useState('');
  const v = data.vehicles.find((x) => x.id === vehicleId);
  const ok = !!vehicleId && !!to && !!on && reason.trim().length >= 5 && to !== v?.usedById;
  return (
    <Card title="Ask to move a vehicle" sub="Another person approves it. Nothing moves until the handover is recorded.">
      <div className="it-form nb-grid">
        <label className="isc-field">
          Vehicle
          <Select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Choose a vehicle</option>
            {data.vehicles.map((x) => (
              <option key={x.id} value={x.id}>
                {x.plate} · {x.model} · used by {x.usedByName}
              </option>
            ))}
          </Select>
        </label>
        <label className="isc-field">
          Company that will use it
          <Select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose the company</option>
            {data.companies
              .filter((c) => c.id !== v?.usedById)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </label>
        <label className="isc-field">
          From (date)
          <input className="input" type="date" min={data.earliest} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
        <label className="isc-field nb-span">
          Reason (required)
          <textarea className="input" rows={2} value={reason} placeholder="Why the vehicle moves" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      {v && (
        <p className="muted small">
          Owner: {v.ownerName}. Used now by {v.usedByName}.
        </p>
      )}
      <div className="nb-actions">
        <button className="btn" type="button" onClick={() => onDone()}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={act.busy || !ok}
          onClick={async () => {
            const r = (await act.run(() => api.requestVehicleTransfer({ vehicleId, toCompanyId: to, wantedOn: on, reason }), 'Move asked for. Another person approves it.')) as { id?: string } | undefined;
            if (r) onDone(r.id);
          }}
        >
          Send for approval
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </Card>
  );
}

function MoveDetail({ data, m, onChange }: { data: VehicleTransferBoard; m: Move; onChange: () => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const steps: { label: string; state: StepState; note?: string }[] = [
    { label: 'Asked by Transport', state: 'done', note: `${m.requestedBy}, ${dateTimeLabel(m.requestedAt)}` },
    {
      label: 'Approved by another person',
      state: m.decision ? (m.decision.approve ? 'done' : 'stopped') : m.status === 'cancelled' ? 'stopped' : 'now',
      note: m.decision ? `${m.decision.by}: ${m.decision.note}` : undefined,
    },
    {
      label: 'Handover recorded',
      state: m.handover ? 'done' : m.status === 'approved' ? 'now' : m.status === 'requested' ? 'todo' : 'stopped',
      note: m.handover ? `${dateLabel(m.handover.on)}, ${m.handover.handedBy} to ${m.handover.receivedBy}` : undefined,
    },
  ];
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    const r = await act.run(fn, msg);
    if (r) {
      setNote('');
      onChange();
    }
  };
  return (
    <div className="it-stack">
      <Steps steps={steps} />
      <Facts
        items={[
          ['Status', <Chip key="s" tone={STATUS[m.status][0]}>{STATUS[m.status][1]}</Chip>],
          ['Owner (stays)', m.ownerName],
          ['From', m.fromName],
          ['To', m.toName],
          ['Wanted from', dateLabel(m.wantedOn)],
          ['Reason', m.reason],
          ...(m.cancelled ? ([['Cancelled', `${m.cancelled.by}: ${m.cancelled.reason}`]] as [string, string][]) : []),
          ...(m.handover
            ? ([
                ['Odometer', `${m.handover.odometerKm.toLocaleString('en-MY')} km`],
                ['Condition', m.handover.condition],
                ['Handed over with', m.handover.items.map((k) => data.handoverItems.find((h) => h.key === k)?.label ?? k).join(', ')],
                ...(m.handover.note ? ([['Note', m.handover.note]] as [string, string][]) : []),
                ['Recorded by', `${m.handover.by}, ${dateTimeLabel(m.handover.at)}`],
              ] as [string, string][])
            : []),
        ]}
      />
      {m.canDecide && (
        <Card title="Your decision" sub="Write a comment either way. It is kept with the move.">
          <label className="isc-field">
            Comment (required)
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="nb-actions">
            <button className="btn" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => run(() => api.decideVehicleTransfer(m.id, false, note), 'Returned to Transport.')}>
              Return
            </button>
            <button className="btn btn-primary" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => run(() => api.decideVehicleTransfer(m.id, true, note), 'Approved. Transport records the handover.')}>
              Approve
            </button>
          </div>
        </Card>
      )}
      {m.status === 'requested' && m.mine && <p className="muted small">You asked for this move, so someone else approves it.</p>}
      {m.canHandOver && <HandoverForm data={data} m={m} onDone={onChange} />}
      {m.canCancel && (
        <details className="nb-more">
          <summary>Cancel this move</summary>
          <label className="isc-field">
            Reason (required)
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="btn" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => run(() => api.cancelVehicleTransfer(m.id, note), 'Move cancelled.')}>
            Cancel the move
          </button>
        </details>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function HandoverForm({ data, m, onDone }: { data: VehicleTransferBoard; m: Move; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ on: data.today, km: '', handedBy: '', receivedBy: '', condition: '', note: '' });
  const [items, setItems] = useState<string[]>(['keys']);
  const ok = f.on && f.km.trim() !== '' && Number(f.km) >= 0 && f.handedBy.trim().length >= 2 && f.receivedBy.trim().length >= 2 && f.condition.trim().length >= 3 && items.includes('keys');
  return (
    <Card title="Record the handover" sub={`The vehicle moves to ${m.toName} from this date.`}>
      <div className="it-form nb-grid">
        <label className="isc-field">
          Handover date
          <input className="input" type="date" max={data.today} min={data.earliest} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
        </label>
        <label className="isc-field">
          Odometer (km)
          <input className="input" inputMode="numeric" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value.replace(/[^\d]/g, '') })} />
        </label>
        <label className="isc-field">
          Handed over by
          <input className="input" value={f.handedBy} placeholder="Name" onChange={(e) => setF({ ...f, handedBy: e.target.value })} />
        </label>
        <label className="isc-field">
          Received by
          <input className="input" value={f.receivedBy} placeholder="Name" onChange={(e) => setF({ ...f, receivedBy: e.target.value })} />
        </label>
        <label className="isc-field nb-span">
          Condition (required)
          <textarea className="input" rows={2} value={f.condition} placeholder="Body, tyres, fuel level, any damage" onChange={(e) => setF({ ...f, condition: e.target.value })} />
        </label>
      </div>
      <fieldset className="nb-checks">
        <legend>Handed over with</legend>
        {data.handoverItems.map((h) => (
          <label key={h.key} className="isc-choice">
            <input type="checkbox" checked={items.includes(h.key)} onChange={(e) => setItems(e.target.checked ? [...items, h.key] : items.filter((x) => x !== h.key))} />
            {h.label}
          </label>
        ))}
      </fieldset>
      <label className="isc-field">
        Note (optional)
        <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      <div className="nb-actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={act.busy || !ok}
          onClick={async () => {
            const r = await act.run(
              () => api.handOverVehicleTransfer(m.id, { on: f.on, odometerKm: Number(f.km), handedBy: f.handedBy, receivedBy: f.receivedBy, condition: f.condition, items, note: f.note }),
              'Handover recorded. The vehicle has moved.',
            );
            if (r) onDone();
          }}
        >
          Save the handover
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </Card>
  );
}
