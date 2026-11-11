// Cases (paper sections 3.5, 4 and 9): every difference stays open until someone closes it with a reason. A loss or
// disposal is decided by a manager who did not open the case. A shortage is closed as arrived or found only by
// scanning the item's label, never by typing its ID. No case ever makes a pay deduction.
import { Select } from '../../SearchSelect';
import { useState } from 'react';
import type { ItemBoard } from '../../api';
import { Card, Empty, Search, Toolbar } from '../../kit';
import { Chip, ErrorNotice, dateTimeLabel, useAction } from '../../ui';
import { Scanner } from './Scanner';
import { FilterChips, OUTCOMES, SHORTAGE_CLOSE, TabIntro, act, hasText, partyName } from './shared';

export function Cases({ data }: { data: ItemBoard }) {
  const [show, setShow] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const rows = data.cases.filter((c) => (show === 'all' || (show === 'open' ? c.status === 'open' : c.status !== 'open')) && hasText(q, c.ref, c.kind.replace(/_/g, ' '), c.note, partyName(data, c.partyId)));
  const quiet = show === 'open' && !q;
  return (
    <div className="it-stack">
    <TabIntro title="Cases" sub="Every difference (short, damaged, missing, a count that did not match) stays open until someone closes it with a reason and proof. A loss is decided by a manager who did not open it. Never a pay deduction." />
    <Card flush>
      <div className="it-pad">
        <Toolbar>
          <Search value={q} onChange={setQ} placeholder="Search reference, kind or note" />
        </Toolbar>
        <FilterChips
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            ['open', 'Open', data.cases.filter((c) => c.status === 'open').length],
            ['closed', 'Closed', data.cases.filter((c) => c.status !== 'open').length],
            ['all', 'All', data.cases.length],
          ]}
        />
      </div>
      {!rows.length ? (
        <Empty title={quiet ? 'No open cases.' : 'Nothing matches.'}>{quiet ? 'Differences found on receipt, in a count or by a scan open a case here.' : 'Change the search or choose another filter.'}</Empty>
      ) : (
        <ul className="it-rows">
          {rows.map((c) => (
            <CaseRow key={c.id} data={data} c={c} />
          ))}
        </ul>
      )}
    </Card>
    </div>
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
          <Select className="input" aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Close as…</option>
            {(OUTCOMES[c.kind] ?? []).map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
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
