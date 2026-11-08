import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type TenderBoard } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Joint tender entries (Fauzan, 26 Oct 2026): the Director Office sets which companies enter the same tender; each
 * company's admin executive fills its own bid and the company manager verifies it with the submission slip. Fauzan dropped
 * the paired-company check on 26 Oct 2026; the Director Office keeps the proof (steps, document names, slip).
 */
export function JointTenders({ board }: { board?: TenderBoard }) {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.tenderGroups(), []);
  const [creating, setCreating] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;
  const isDesk = !!board;
  if (!isDesk && data.length === 0) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Joint tenders</h3>
          <div className="muted small">
            Several group companies entering the same tender. The Director Office makes the checklist and sends it; each company ticks it, the preparer and the
            manager sign, then the slip.
          </div>
        </div>
        {isDesk && !creating && (
          <button className="btn btn-sm" onClick={() => setCreating(true)}>
            Enter more companies
          </button>
        )}
      </div>
      {creating && board && <CreateJoint board={board} onDone={() => setCreating(false)} />}
      {data.length === 0 && <div className="empty">No joint tender yet.</div>}
      {data.map((g) => (
        <div key={g.id} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>{g.title}</div>
          <div className="muted small">
            <span className="mono">{g.ref}</span> · {g.buyer} · closes {dateLabel(g.closesOn)} ({g.daysLeft} d) · set by {g.createdBy}
          </div>
          {isDesk && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
              <Chip tone="neutral">{g.entered} entered</Chip>
              <Chip tone={g.filledCount === g.entered ? 'ok' : 'warn'}>
                {g.filledCount} of {g.entered} filled
              </Chip>
              <Chip tone={g.followedCount === g.entered ? 'ok' : 'warn'}>
                {g.followedCount} of {g.entered} followed the guide
              </Chip>
              <Chip tone={g.slipCount === g.entered ? 'ok' : 'warn'}>
                {g.slipCount} of {g.entered} slips in
              </Chip>
            </div>
          )}
          {isDesk && (
            <div className="muted small">
              {g.reportDue
                ? `Report sent to the CEO on ${dateLabel(g.reportOn)}: ${g.slipCount} of ${g.entered} companies entered with the slip${g.noSlip.length ? `; no slip from ${g.noSlip.join(', ')}` : ''}.`
                : `The report of how many companies entered goes to the CEO by itself on ${dateLabel(g.reportOn)}, 24 hours after closing.`}
            </div>
          )}
          <div className="list">
            {g.entries.map((e) => (
              <EntryRow key={e.companyId} e={e} canSeeAll={isDesk} />
            ))}
          </div>
        </div>
      ))}
      <p className="muted small">
        The proof never shows prices or the files themselves. Separate companies bidding on the same tender carry a competition-law and procurement risk;
        counsel to confirm before government tenders.
      </p>
    </section>
  );
}

type Entry = Awaited<ReturnType<typeof api.tenderGroups>>[number]['entries'][number];

function EntryRow({ e, canSeeAll }: { e: Entry; canSeeAll: boolean }) {
  const [open, setOpen] = useState(false);
  const p = e.proof;
  const tone = e.followedGuide ? 'ok' : p || e.managerVerified ? 'warn' : 'neutral';
  const label = e.followedGuide
    ? 'Followed the guide'
    : p
      ? 'Slip in'
      : e.managerVerified
        ? 'Manager signed'
        : e.preparerSigned
          ? 'Preparer signed'
          : e.filled
            ? 'Filled, to sign'
            : 'Being filled';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{e.companyName}</div>
          {e.progress && (
            <div className="muted small">
              {e.progress.done} of {e.progress.total} items ticked
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={tone}>{label}</Chip>
          {(p || canSeeAll) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
              {open ? 'Hide' : 'Proof'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!p && <div className="muted">No submission slip yet.</div>}
          {p && (
            <>
              <div>
                Guide steps: {p.stepsDone} of {p.stepsTotal} done{p.naSteps ? ` (${p.naSteps} not applicable, confirmed)` : ''} · checks:{' '}
                {p.checks.map((c) => ({ PREPARER: 'preparer', MANAGER: 'manager' })[c]).join(', ') || 'none'}
              </div>
              <div>
                Slip: {p.slip ? `${p.slip.name}, uploaded by ${p.slip.by} ${dateTimeLabel(p.slip.at)}` : 'none'}
                {p.slip && <span className="mono muted"> · SHA-256 {p.slip.sha256.slice(0, 12)}…</span>}
              </div>
              <div>Documents attached ({p.documents.length}):</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {p.documents.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CreateJoint({ board, onDone }: { board: TenderBoard; onDone: () => void }) {
  const { me } = useApp();
  // Only a tender whose checklist the Director Office has made and checked is sent to the companies.
  const live = board.rows.filter((r) => (r.tender.status === 'open' || r.tender.status === 'preparing') && r.reviewed && r.checklistItems > 0);
  const [source, setSource] = useState(live[0]?.tender.id ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const act = useAction();
  const src = live.find((r) => r.tender.id === source);
  const others = me.companies.filter((c) => c.isPilot && c.id !== src?.tender.companyId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <label className="field">
        <span className="label">Tender</span>
        <Select className="select" value={source} onChange={(x) => (setSource(x.target.value), setPicked([]))} aria-label="Tender to share">
          {live.map((r) => (
            <option key={r.tender.id} value={r.tender.id}>
              {r.tender.ref} · {r.tender.title} ({r.companyName})
            </option>
          ))}
        </Select>
      </label>
      <div className="field">
        <span className="label">Also entering</span>
        {others.map((c) => (
          <label key={c.id} className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={picked.includes(c.id)}
              onChange={(x) => setPicked(x.target.checked ? [...picked, c.id] : picked.filter((p) => p !== c.id))}
            />
            {c.name}
          </label>
        ))}
      </div>
      {live.length === 0 && <p className="muted small">Make and check a tender checklist first; then it can be sent to the companies.</p>}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !source || !picked.length}
          onClick={async () => {
            if (await act.run(() => api.createTenderGroup(source, picked), 'Each company now has the tender.')) onDone();
          }}
        >
          Send to the companies
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
