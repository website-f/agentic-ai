// Cases (paper sections 3.5, 4 and 9): every difference stays open until someone closes it with a reason. A loss or
// disposal is decided by a manager who did not open the case. A shortage is closed as arrived or found only by
// scanning the item's label, never by typing its ID. No case ever makes a pay deduction.
import { useState } from 'react';
import type { ItemBoard } from '../../api';
import { Card, Empty, Toolbar } from '../../kit';
import { Chip, ErrorNotice, dateTimeLabel, useAction } from '../../ui';
import { Scanner } from './Scanner';
import { OUTCOMES, SHORTAGE_CLOSE, act, partyName } from './shared';

export function Cases({ data }: { data: ItemBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.cases.filter((c) => all || c.status === 'open');
  return (
    <Card title="Cases" sub="Differences stay open until closed with a reason and proof. Never a pay deduction." flush>
      <div className="it-pad">
        <Toolbar end={<div className="seg" role="group" aria-label="Show"><button type="button" aria-pressed={!all} onClick={() => setAll(false)}>Open</button><button type="button" aria-pressed={all} onClick={() => setAll(true)}>All</button></div>}>
          <span className="muted">{rows.length} case(s)</span>
        </Toolbar>
      </div>
      {!rows.length ? (
        <Empty title="No open cases." />
      ) : (
        <ul className="it-rows">
          {rows.map((c) => (
            <CaseRow key={c.id} data={data} c={c} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CaseRow({ data, c }: { data: ItemBoard; c: ItemBoard['cases'][number] }) {
  const a = useAction();
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const mayClose = c.status === 'open' && data.roles.some((r) => r.partyId === c.partyId && r.roles.some((x) => x !== 'view' && x !== 'hr' && (x !== 'finance' || c.kind === 'recon_diff' || c.kind === 'sync_review')));
  const needsScan = SHORTAGE_CLOSE[c.kind] === outcome && !!c.itemId;
  return (
    <li className="it-row it-row-col" data-tone={c.status === 'open' ? 'warn' : undefined}>
      <span className="it-row-line">
        <strong>
          {c.ref} · {c.kind.replace(/_/g, ' ')} · {partyName(data, c.partyId)}
        </strong>
        <Chip tone={c.status === 'open' ? 'warn' : 'ok'}>{c.status}</Chip>
      </span>
      <span className="muted">
        {c.note} ({c.openedBy}, {dateTimeLabel(c.at)})
      </span>
      {c.resolution && (
        <span>
          Closed: {c.resolution.outcome.replace(/_/g, ' ')} by {c.resolution.by}. {c.resolution.note}
        </span>
      )}
      {mayClose && (
        <div className="it-form">
          <select className="input" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Close as…</option>
            {(OUTCOMES[c.kind] ?? []).map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Reason and the proof you checked" value={note} onChange={(e) => setNote(e.target.value)} />
          {needsScan ? (
            <Scanner
              purpose="view"
              title="Scan the item to show it is here"
              allowManual={false}
              busy={a.busy}
              onResult={({ verdict, entry }) => verdict.outcome !== 'not_found' && a.run(() => act({ kind: 'case.resolve', caseId: c.id, outcome, note, scan: entry }), 'Case closed.')}
            />
          ) : (
            <button className="btn btn-primary" type="button" disabled={a.busy || !outcome} onClick={() => a.run(() => act({ kind: 'case.resolve', caseId: c.id, outcome, note }), 'Case closed.')}>
              Close case
            </button>
          )}
        </div>
      )}
      <ErrorNotice error={a.error} />
    </li>
  );
}
