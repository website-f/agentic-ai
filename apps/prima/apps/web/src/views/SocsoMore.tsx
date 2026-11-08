import { Select } from '../SearchSelect';
import { useState } from 'react';
import {
  DEPENDANT_PAY_LABEL,
  DEPENDANT_RELATION_LABEL,
  DEPENDANT_ROUTE_LABEL,
  DOSH_KIND_DETAIL,
  DOSH_KIND_LABEL,
  LINDUNG_CHANNEL_LABEL,
  LINDUNG_VERIFY_LABEL,
  type DependantPayKind,
  type DependantPayRoute,
  type DependantRelation,
  type DoshKind,
  type LindungChannel,
  type ProofInput,
} from '@prima/core';
import { api, type SocsoClaimDetail } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { DocList, ProofPicker } from './Proof';

/**
 * The parts of a SOCSO claim built on 5 Nov 2026 (Fauzan: "Build all that still not build"): LINDUNG 24 Jam claims,
 * the dependants of a worker who died (payment abroad for foreign workers), and the separate DOSH accident notice.
 * The rules live in packages/core/src/socso.ts; PERKESO and DOSH have no connection to the app, so HR records what was
 * sent and keeps the copies.
 */

const local = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
const iso = (v: string) => `${v}:00+08:00`;
const today = () => local().slice(0, 10);

function Docs({ d, ids }: { d: SocsoClaimDetail; ids: string[] }) {
  return <DocList docs={d.extraDocs.filter((x) => ids.includes(x.id))} />;
}

// ---------- LINDUNG 24 Jam ----------

export function LindungPanel({ d }: { d: SocsoClaimDetail }) {
  const l = d.lindung!;
  const r = l.record;
  const c = d.claim;
  const manage = d.can.manage && c.status !== 'CLOSED';
  const [channel, setChannel] = useState<LindungChannel | ''>(r.channel ?? '');
  const [appliedOn, setAppliedOn] = useState(r.appliedOn ?? '');
  const [askedAt, setAskedAt] = useState('');
  const [answer, setAnswer] = useState<keyof typeof LINDUNG_VERIFY_LABEL>('EMPLOYED');
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>How LINDUNG 24 Jam is claimed</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>The worker applies, online at Portal LINDUNG Faedah or with Form 34 (non-work accident notice) at a PERKESO office. HR helps if needed.</li>
          <li>The worker attaches the MC and a bank statement of their own account, and a police report if there is one.</li>
          <li>PERKESO emails the company to confirm the worker is employed. HR answers only that: employed, not employed, or on unpaid leave.</li>
          <li>PERKESO pays the worker directly. MC of 4 days or more: temporary disablement; the company does not pay those days.</li>
        </ol>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Not covered: accidents outside Malaysia, a foreign worker in breach of the work pass, unpaid leave, a month with no contribution.
        </p>
      </section>
      {d.lindungChecks && (
        <section>
          <h3>Checks from the app</h3>
          <div className="list">
            {d.lindungChecks.map((x, k) => (
              <div key={k} className="list-item small" style={{ justifyContent: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0 }}>
                  <Chip tone={x.level === 'ok' ? 'ok' : x.level === 'block' ? 'crit' : 'warn'}>{x.level === 'ok' ? 'OK' : x.level === 'block' ? 'Not covered' : 'Check'}</Chip>
                </span>
                <span>{x.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Application</h3>
        <div className="small">
          {r.channel ? LINDUNG_CHANNEL_LABEL[r.channel] : 'Not applied yet'}
          {r.appliedOn ? `, ${dateLabel(r.appliedOn)}` : ''}
          {c.perkesoRef ? ` · PERKESO no. ${c.perkesoRef}` : ''}
        </div>
        {manage && (
          <div className="grid-2" style={{ marginTop: 6 }}>
            <label className="field">
              <span className="label">How the worker applied</span>
              <Select className="input" aria-label="How the worker applied" value={channel} onChange={(e) => setChannel(e.target.value as LindungChannel)}>
                <option value="">Choose</option>
                {(Object.keys(LINDUNG_CHANNEL_LABEL) as LindungChannel[]).map((k) => (
                  <option key={k} value={k}>
                    {LINDUNG_CHANNEL_LABEL[k]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">Date applied</span>
              <input className="input" type="date" aria-label="Date applied" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} />
            </label>
            <div>
              <button
                className="btn btn-sm"
                disabled={act.busy || !channel}
                onClick={() => act.run(() => api.recordLindung(c.id, { channel: channel as LindungChannel, appliedOn: appliedOn || null }), 'Application recorded.')}
              >
                Save application
              </button>
            </div>
          </div>
        )}
      </section>
      <section>
        <h3>Employment confirmation for PERKESO</h3>
        {r.verify ? (
          <div className="small">
            Answered: {LINDUNG_VERIFY_LABEL[r.verify.answer]}
            {r.verify.note ? `. ${r.verify.note}` : ''} ({r.verify.by}, {dateTimeLabel(r.verify.at)})
          </div>
        ) : r.verifyAskedAt ? (
          <div className="small">
            PERKESO asked on {dateTimeLabel(r.verifyAskedAt)}.{' '}
            {l.verifyClock && <Chip tone={l.verifyClock.overdue ? 'crit' : 'info'}>Answer by {dateLabel(l.verifyClock.due)}</Chip>}
          </div>
        ) : (
          <div className="muted small">PERKESO has not asked yet. The email goes to the address registered in ASSIST.</div>
        )}
        {manage && !r.verifyAskedAt && (
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <input className="input" type="datetime-local" aria-label="When PERKESO asked" value={askedAt} onChange={(e) => setAskedAt(e.target.value)} />
            <button className="btn btn-sm" disabled={act.busy || !askedAt} onClick={() => act.run(() => api.recordLindung(c.id, { verifyAskedAt: iso(askedAt) }), 'Recorded.')}>
              PERKESO's email came
            </button>
          </div>
        )}
        {manage && r.verifyAskedAt && !r.verify && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <Select className="input" aria-label="Answer to PERKESO" value={answer} onChange={(e) => setAnswer(e.target.value as keyof typeof LINDUNG_VERIFY_LABEL)}>
              {(Object.keys(LINDUNG_VERIFY_LABEL) as (keyof typeof LINDUNG_VERIFY_LABEL)[]).map((k) => (
                <option key={k} value={k}>
                  {LINDUNG_VERIFY_LABEL[k]}
                </option>
              ))}
            </Select>
            <input className="input" aria-label="Note" placeholder="Note (needed unless the answer is employed)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div>
              <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.verifyLindung(c.id, answer, note), 'Answer recorded.')}>
                Record the answer given to PERKESO
              </button>
            </div>
          </div>
        )}
      </section>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Dependants of a worker who died ----------

const RELATIONS = Object.keys(DEPENDANT_RELATION_LABEL) as DependantRelation[];
const ROUTES = Object.keys(DEPENDANT_ROUTE_LABEL) as DependantPayRoute[];
const PAYS = Object.keys(DEPENDANT_PAY_LABEL) as DependantPayKind[];

export function FamilyPanel({ d }: { d: SocsoClaimDetail }) {
  const fam = d.dependants;
  if (!fam) return <div className="muted small">The family's details are kept by HR.</div>;
  const r = fam.record;
  const c = d.claim;
  const foreign = d.person.nationality !== 'MY';
  const manage = d.can.manage && c.status !== 'CLOSED';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>What PERKESO pays the family</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Death from work: dependants' benefit, 90% of the daily wage, shared by the husband or wife and the children.</li>
          <li>Death from other causes: survivors' pension. Funeral benefit in both cases, paid against the receipts.</li>
          <li>Foreign worker who died in Malaysia and is buried at home: up to RM4,500 to whoever paid to send the body home, and RM3,000 to the family.</li>
          <li>PERKESO pays the family directly. The company does not collect or hold the money.</li>
        </ul>
        {foreign && (
          <p className="small" style={{ marginBottom: 0 }}>
            Family abroad: confirm with PERKESO how it pays them and whether the papers need a certified translation, and record who confirmed it.
          </p>
        )}
      </section>
      {fam.gaps.length > 0 && (
        <section>
          <h3>Still needed</h3>
          <div className="list">
            {fam.gaps.map((g, k) => (
              <div key={k} className="list-item small" style={{ justifyContent: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0 }}>
                  <Chip tone="warn">Needed</Chip>
                </span>
                <span>{g}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <NoticeRow d={d} who="family" label="Family told" at={r.familyToldAt} manage={manage} />
      {foreign && <NoticeRow d={d} who="embassy" label="Embassy told" at={r.embassyToldAt} manage={manage} />}
      {foreign && <NoticeRow d={d} who="immigration" label="Immigration told" at={r.immigrationToldAt} manage={manage} />}
      <section>
        <h3>Dependants</h3>
        <p className="muted small">{fam.shareNote}</p>
        <div className="list">
          {r.people.length === 0 && <div className="empty">No dependant recorded.</div>}
          {r.people.map((p) => (
            <DependantRow key={p.id} d={d} p={p} share={fam.shares.find((s) => s.id === p.id)?.share ?? null} manage={manage} />
          ))}
        </div>
        {manage && <AddDependant claimId={c.id} />}
      </section>
      <section>
        <h3>Payments from PERKESO</h3>
        <div className="muted small">Total recorded: RM{fam.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        <div className="list">
          {r.payments.length === 0 && <div className="empty">No payment recorded.</div>}
          {r.payments.map((p) => (
            <PaymentRow key={p.id} d={d} p={p} manage={manage} />
          ))}
        </div>
        {manage && <AddPayment d={d} />}
      </section>
    </div>
  );
}

function NoticeRow({ d, who, label, at, manage }: { d: SocsoClaimDetail; who: 'family' | 'embassy' | 'immigration'; label: string; at: string | null; manage: boolean }) {
  const [v, setV] = useState(local());
  const act = useAction();
  return (
    <div className="list-item small" style={{ flexWrap: 'wrap', gap: 6 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {at ? <Chip tone="ok">{dateTimeLabel(at)}</Chip> : <Chip tone="warn">Not yet</Chip>}
      {manage && !at && (
        <>
          <input className="input" type="datetime-local" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.recordDeathNotice(d.claim.id, who, iso(v)), 'Recorded.')}>
            Save
          </button>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

type Dep = NonNullable<SocsoClaimDetail['dependants']>['record']['people'][number];
type Pay = NonNullable<SocsoClaimDetail['dependants']>['record']['payments'][number];

function DependantRow({ d, p, share, manage }: { d: SocsoClaimDetail; p: Dep; share: number | null; manage: boolean }) {
  const [mode, setMode] = useState<'relation' | 'translation' | 'route' | null>(null);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [route, setRoute] = useState<DependantPayRoute>('PERKESO_OVERSEAS_BANK');
  const [officer, setOfficer] = useState('');
  const [on, setOn] = useState(today());
  const act = useAction();
  const done = () => {
    setMode(null);
    setProof([]);
  };
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {p.name} · {DEPENDANT_RELATION_LABEL[p.relation]}
          </div>
          <div className="muted small">
            {p.country}
            {p.bornOn ? ` · born ${dateLabel(p.bornOn)}` : ''}
            {share != null ? ` · guide share ${Math.round(share * 1000) / 10}%` : ''}
          </div>
          <div className="muted small">
            {p.routeConfirmed
              ? `${DEPENDANT_ROUTE_LABEL[p.route!]} (confirmed by ${p.routeConfirmed.perkesoOfficer}, ${dateLabel(p.routeConfirmed.on)})`
              : 'Payment route not confirmed with PERKESO'}
          </div>
        </div>
        <Chip tone={p.relationDocIds.length ? 'ok' : 'warn'}>{p.relationDocIds.length ? 'Papers in' : 'Papers missing'}</Chip>
      </div>
      <Docs d={d} ids={[...p.relationDocIds, ...p.translationDocIds]} />
      {manage && !mode && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => setMode('relation')}>
            Add birth or marriage certificate
          </button>
          {p.country !== 'Malaysia' && (
            <button className="btn btn-sm" onClick={() => setMode('translation')}>
              Add certified translation
            </button>
          )}
          {!p.routeConfirmed && (
            <button className="btn btn-sm" onClick={() => setMode('route')}>
              Record how PERKESO pays
            </button>
          )}
        </div>
      )}
      {(mode === 'relation' || mode === 'translation') && (
        <>
          <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length}
              onClick={async () => {
                if (await act.run(() => api.addDependantPaper(d.claim.id, p.id, mode, proof), 'Paper added.')) done();
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={done}>
              Cancel
            </button>
          </div>
        </>
      )}
      {mode === 'route' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Select className="input" aria-label="How PERKESO pays" value={route} onChange={(e) => setRoute(e.target.value as DependantPayRoute)}>
            {ROUTES.map((k) => (
              <option key={k} value={k}>
                {DEPENDANT_ROUTE_LABEL[k]}
              </option>
            ))}
          </Select>
          <input className="input" aria-label="PERKESO officer" placeholder="PERKESO officer or letter that confirmed it" value={officer} onChange={(e) => setOfficer(e.target.value)} />
          <input className="input" type="date" aria-label="Date confirmed" value={on} onChange={(e) => setOn(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={async () => {
                if (await act.run(() => api.confirmDependantRoute(d.claim.id, p.id, { route, perkesoOfficer: officer, on }), 'Payment route recorded.')) done();
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={done}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AddDependant({ claimId }: { claimId: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', relation: 'SPOUSE' as DependantRelation, country: 'Nepal', bornOn: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        Add dependant
      </button>
    );
  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <input className="input" aria-label="Name" placeholder="Name as on the papers" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="grid-2">
        <Select className="input" aria-label="Relationship" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value as DependantRelation })}>
          {RELATIONS.map((k) => (
            <option key={k} value={k}>
              {DEPENDANT_RELATION_LABEL[k]}
            </option>
          ))}
        </Select>
        <input className="input" aria-label="Country" placeholder="Country they live in" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />
        <label className="field">
          <span className="label">Date of birth (children)</span>
          <input className="input" type="date" aria-label="Date of birth" value={f.bornOn} onChange={(e) => setF({ ...f, bornOn: e.target.value })} />
        </label>
      </div>
      <span className="muted small">Birth or marriage certificate (can be added later)</span>
      <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(
              () => api.addSocsoDependant(claimId, { name: f.name, relation: f.relation, country: f.country, bornOn: f.bornOn || null, relationProof: proof }),
              'Dependant added.',
            );
            if (r) {
              setOpen(false);
              setProof([]);
              setF({ name: '', relation: 'CHILD', country: f.country, bornOn: '' });
            }
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PaymentRow({ d, p, manage }: { d: SocsoClaimDetail; p: Pay; manage: boolean }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(today());
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const who = d.dependants!.record.people.find((x) => x.id === p.dependantId);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {DEPENDANT_PAY_LABEL[p.kind]} · RM{p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="muted small">
            Paid {dateLabel(p.paidOn)} · ref {p.perkesoRef}
            {who ? ` · to ${who.name}` : ''}
          </div>
        </div>
        <Chip tone={p.received ? 'ok' : 'warn'}>{p.received ? `Received ${dateLabel(p.received.on)}` : 'Receipt not confirmed'}</Chip>
      </div>
      <Docs d={d} ids={[...p.docIds, ...(p.received?.docIds ?? [])]} />
      {manage && !p.received && !open && (
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Family confirmed receipt
          </button>
        </div>
      )}
      {open && (
        <>
          <input className="input" type="date" aria-label="Date received" value={on} onChange={(e) => setOn(e.target.value)} />
          <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length}
              onClick={async () => {
                if (await act.run(() => api.confirmDependantReceived(d.claim.id, p.id, { on, proof }), 'Receipt recorded.')) setOpen(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AddPayment({ d }: { d: SocsoClaimDetail }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ dependantId: '', kind: 'FUNERAL' as DependantPayKind, amount: '', paidOn: today(), ref: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        Record a PERKESO payment
      </button>
    );
  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <div className="grid-2">
        <Select className="input" aria-label="What PERKESO paid" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DependantPayKind })}>
          {PAYS.map((k) => (
            <option key={k} value={k}>
              {DEPENDANT_PAY_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select className="input" aria-label="Paid to" value={f.dependantId} onChange={(e) => setF({ ...f, dependantId: e.target.value })}>
          <option value="">The family / the person who paid</option>
          {d.dependants!.record.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <input className="input" type="number" min={0} step="0.01" aria-label="Amount (RM)" placeholder="Amount (RM)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <input className="input" type="date" aria-label="Date paid" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} />
        <input className="input" aria-label="PERKESO payment reference" placeholder="PERKESO payment reference" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
      </div>
      <span className="muted small">PERKESO's payment advice or the bank slip</span>
      <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length || !f.amount}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.addDependantPayment(d.claim.id, {
                  dependantId: f.dependantId || null,
                  kind: f.kind,
                  amount: Number(f.amount),
                  paidOn: f.paidOn,
                  perkesoRef: f.ref,
                  proof,
                }),
              'Payment recorded.',
            );
            if (r) {
              setOpen(false);
              setProof([]);
            }
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- DOSH accident notice ----------

const KINDS: DoshKind[] = ['DEATH', 'SERIOUS', 'OVER_4_DAYS', 'DISEASE', 'MINOR'];

export function DoshPanel({ d }: { d: SocsoClaimDetail }) {
  const x = d.dosh!;
  const n = x.record;
  const c = d.claim;
  const manage = d.can.manage;
  const [kind, setKind] = useState<DoshKind>(n?.kind ?? x.suggested ?? 'OVER_4_DAYS');
  const [why, setWhy] = useState('');
  const [imm, setImm] = useState({ at: local(), means: 'Phone', office: '', ref: '' });
  const [form, setForm] = useState({ on: today(), ref: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [clientAt, setClientAt] = useState(local());
  const act = useAction();
  const clock = x.clock;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>DOSH notice (separate from the SOCSO claim)</h3>
        <p className="small" style={{ margin: 0 }}>
          The law on safety at work asks the employer to tell DOSH (JKKP) about serious workplace accidents. Every accident also goes in the company's yearly
          register (JKKP 8), sent to DOSH before 31 January and kept for 5 years. On a client's premises the client reports too; the company still sends its own.
        </p>
      </section>
      <section>
        <h3>What DOSH needs</h3>
        {n ? (
          <div className="small">
            <div style={{ fontWeight: 600 }}>
              {DOSH_KIND_LABEL[n.kind]}{' '}
              <Chip tone={clock?.overdue ? 'crit' : clock?.owed.length ? 'warn' : 'ok'}>{clock?.overdue ? 'Overdue' : clock?.owed.length ? 'Owed' : 'Done'}</Chip>
            </div>
            <div>{n.why}</div>
            <div className="muted">{DOSH_KIND_DETAIL[n.kind]}</div>
            {clock && clock.owed.length > 0 && (
              <div style={{ marginTop: 4 }}>
                Still owed: {clock.owed.join('; ')}
                {clock.formDue && !clock.formDone ? ` (form due ${dateLabel(clock.formDue)})` : ''}.
              </div>
            )}
            {clock && clock.owed.length === 0 && <div style={{ marginTop: 4 }}>Nothing more owed to DOSH for this accident.</div>}
          </div>
        ) : (
          <div className="small">
            Not assessed yet.{x.suggested ? ` From the claim: ${DOSH_KIND_LABEL[x.suggested].toLowerCase()}.` : ''}
          </div>
        )}
        {manage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <Select className="input" aria-label="DOSH level" value={kind} onChange={(e) => setKind(e.target.value as DoshKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {DOSH_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            {kind !== n?.kind && <span className="muted small">{DOSH_KIND_DETAIL[kind]}</span>}
            <input className="input" aria-label="Reason" placeholder="Reason: the injury, the MC days, the doctor's finding" value={why} onChange={(e) => setWhy(e.target.value)} />
            <div>
              <button className="btn btn-sm" disabled={act.busy || (n?.kind === kind)} onClick={() => act.run(() => api.assessDosh(c.id, kind, why), 'DOSH level saved.')}>
                {n ? 'Change the level' : 'Save the level'}
              </button>
            </div>
          </div>
        )}
      </section>
      {n && clock?.immediateNeeded && (
        <section>
          <h3>Told DOSH at once</h3>
          {n.immediate ? (
            <div className="small">
              {dateTimeLabel(n.immediate.at)} by {n.immediate.means} to {n.immediate.office} ({n.immediate.ref})
            </div>
          ) : manage ? (
            <div className="grid-2">
              <input className="input" type="datetime-local" aria-label="When DOSH was told" value={imm.at} onChange={(e) => setImm({ ...imm, at: e.target.value })} />
              <input className="input" aria-label="How" placeholder="Phone, email, fax, online" value={imm.means} onChange={(e) => setImm({ ...imm, means: e.target.value })} />
              <input className="input" aria-label="DOSH office" placeholder="DOSH office (state)" value={imm.office} onChange={(e) => setImm({ ...imm, office: e.target.value })} />
              <input className="input" aria-label="DOSH officer or reference" placeholder="Officer's name or reference" value={imm.ref} onChange={(e) => setImm({ ...imm, ref: e.target.value })} />
              <div>
                <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.recordDoshImmediate(c.id, { ...imm, at: iso(imm.at) }), 'Notice recorded.')}>
                  Save
                </button>
              </div>
            </div>
          ) : (
            <Chip tone="crit">Not yet</Chip>
          )}
        </section>
      )}
      {n && clock?.form && (
        <section>
          <h3>
            {clock.form === 'JKKP6' ? 'JKKP 6' : 'JKKP 7'} form · due {dateLabel(clock.formDue!)}
          </h3>
          {n.form ? (
            <>
              <div className="small">
                Sent {dateLabel(n.form.on)}, DOSH ref {n.form.ref} ({n.form.by})
              </div>
              <Docs d={d} ids={n.form.docIds} />
            </>
          ) : manage ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="grid-2">
                <input className="input" type="date" aria-label="Date sent" value={form.on} onChange={(e) => setForm({ ...form, on: e.target.value })} />
                <input className="input" aria-label="DOSH reference" placeholder="DOSH reference" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
              </div>
              <span className="muted small">A copy of the form as sent</span>
              <ProofPicker site={null} refText="DOSH" items={proof} onChange={setProof} documentsOnly required />
              <div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !proof.length}
                  onClick={async () => {
                    if (await act.run(() => api.recordDoshForm(c.id, { ...form, proof }), 'Form recorded.')) setProof([]);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <Chip tone={clock.overdue ? 'crit' : 'warn'}>Not sent</Chip>
          )}
        </section>
      )}
      {n && (
        <section>
          <h3>Client told</h3>
          {n.clientToldAt ? (
            <div className="small">{dateTimeLabel(n.clientToldAt)}</div>
          ) : manage ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" type="datetime-local" aria-label="When the client was told" value={clientAt} onChange={(e) => setClientAt(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.recordDoshClientTold(c.id, iso(clientAt)), 'Recorded.')}>
                Save
              </button>
            </div>
          ) : (
            <span className="muted small">Not recorded.</span>
          )}
        </section>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** The JKKP 8 register for a year, from the SOCSO claims of workplace accidents. */
export function DoshRegisterPanel() {
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const { data, error } = useLoad(() => api.doshRegister(year), [year]);
  return (
    <section className="panel" style={{ padding: 12 }}>
      <div className="panel-head">
        <h2>DOSH accident register (JKKP 8)</h2>
        <Select className="input" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const y = Number(today().slice(0, 4)) - k;
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </Select>
      </div>
      <ErrorNotice error={error ?? null} />
      {!data && !error && <Loading what="register" />}
      {data && (
        <>
          <p className="muted small">
            Send to DOSH by {dateLabel(data.due)}; keep until {dateLabel(data.keepUntil)}. Accidents and dangerous occurrences with no SOCSO claim are not listed here yet.
          </p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <Chip tone={data.notAssessed ? 'warn' : 'ok'}>{data.notAssessed} not assessed</Chip>
            <Chip tone={data.overdue ? 'crit' : 'ok'}>{data.overdue} overdue to DOSH</Chip>
          </div>
          <div className="list">
            {data.rows.length === 0 && <div className="empty">No workplace accident on a SOCSO claim this year.</div>}
            {data.rows.map((r) => (
              <div key={r.claimId} className="list-item small" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ fontWeight: 600 }}>
                  {dateTimeLabel(r.incidentAt)} · {r.person?.name ?? 'Unknown'} ({r.person?.staffNo}) · {r.companyName}
                </div>
                <div className="muted">
                  {r.typeLabel} · {r.place || 'place not given'} · {r.kindLabel}
                  {r.form ? ` · ${r.form.form === 'JKKP6' ? 'JKKP 6' : 'JKKP 7'} sent ${dateLabel(r.form.on)}` : ''}
                </div>
                {r.clock && r.clock.owed.length > 0 && (
                  <div style={{ color: r.clock.overdue ? 'var(--crit)' : undefined }}>
                    Owed: {r.clock.owed.join('; ')}
                    {r.clock.formDue && !r.clock.formDone ? ` (form due ${dateLabel(r.clock.formDue)})` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
