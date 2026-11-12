// J1 (P100, Fauzan 11 Nov 2026): the client portal desk. The Operations Manager gives a named person at the client their
// own sign-in (a personal link and an access code, shown once), resets the code or closes it; the company manager sees
// it and may close it; the COO sees every company's. What clients send (ratings, complaints, requests) lands on the
// client's record, answered where the OM already works (Clients, Requests and complaints).
import { useState } from 'react';
import { ChatCircleTextIcon, ClockIcon, KeyIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { api } from '../api';
import type { ClientPortalDesk as Desk, ClientPortalOpened } from '../api/p100-newb';
import { Card, Empty, Facts, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { FilterChips, TabIntro, hasText } from './nb-shared';
import '../styles/items.css';
import '../styles/p100-newb.css';

type Row = Desk['clients'][number];

export function ClientPortalDesk() {
  const { data, error } = useLoad(() => api.clientPortalDesk(), []);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'waiting' | 'portal' | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="client portal" />;
  const list = data.clients.filter((c) => (show === 'waiting' ? c.waiting.length > 0 : show === 'portal' ? c.openUsers > 0 : true) && hasText(q, c.name));
  const row = data.clients.find((c) => c.clientId === open) ?? null;
  const who = data.role === 'om' ? 'You manage the portal sign-ins of the clients in your area.' : data.role === 'cm' ? 'You monitor your company’s client portal sign-ins and may close one.' : 'You oversee every company’s client portal.';
  return (
    <div className="it-stack">
      <TabIntro
        title="Client portal"
        sub={`A named person at the client signs in with a personal link and an access code, sees their own sites, monthly reports and signed slips as PDFs, and rates the service, complains or asks. ${who}`}
      />
      {!data.on && <p className="nb-note">The client portal page is not switched on here (it needs the report link settings). Sign-ins can be prepared; the link appears once it is on.</p>}
      <Stats>
        <Stat label="Clients with portal" value={`${data.counts.withPortal} of ${data.counts.clients}`} icon={<UsersThreeIcon size={16} />} tone="info" onClick={() => setShow('portal')} />
        <Stat label="Waiting for an answer" value={data.counts.waiting} tone={data.counts.waiting ? 'warn' : 'ok'} icon={<ChatCircleTextIcon size={16} />} onClick={() => setShow('waiting')} />
        <Stat label="Waiting over 3 days" value={data.counts.waitingOver3Days} tone={data.counts.waitingOver3Days ? 'crit' : 'ok'} icon={<ClockIcon size={16} />} onClick={() => setShow('waiting')} />
      </Stats>
      <Card title="Clients" flush>
        <div className="it-pad">
          <Toolbar>
            <Search value={q} onChange={setQ} placeholder="Search client" />
          </Toolbar>
          <FilterChips
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              ['all', 'All', data.clients.length],
              ['portal', 'With portal', data.clients.filter((c) => c.openUsers > 0).length],
              ['waiting', 'Waiting', data.clients.filter((c) => c.waiting.length > 0).length],
            ]}
          />
        </div>
        {!data.clients.length ? (
          <Empty title="No clients to show.">Clients in your area or company show here.</Empty>
        ) : !list.length ? (
          <Empty title="Nothing matches.">Change the search or choose another filter.</Empty>
        ) : (
          <ul className="it-rows">
            {list.map((c) => (
              <li key={c.clientId}>
                <button className="it-row it-row-btn" type="button" data-tone={c.waiting.length ? 'warn' : undefined} onClick={() => setOpen(c.clientId)}>
                  <span className="it-row-main">
                    <strong>{c.name}</strong>
                    <span className="muted">
                      {c.openUsers ? `${c.openUsers} portal sign-in${c.openUsers === 1 ? '' : 's'}` : 'No portal sign-in'}
                      {c.lastSignInAt ? ` · last in ${dateLabel(c.lastSignInAt.slice(0, 10))}` : ''}
                    </span>
                  </span>
                  {c.waiting.length > 0 ? <Chip tone="warn">{`${c.waiting.length} waiting`}</Chip> : c.openUsers ? <Chip tone="ok">On</Chip> : <Chip tone="neutral">Off</Chip>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {row && (
        <Drawer title={row.name} sub="Client portal" onClose={() => setOpen(null)}>
          <ClientPortalDetail c={row} on={data.on} />
        </Drawer>
      )}
    </div>
  );
}

function ClientPortalDetail({ c, on }: { c: Row; on: boolean }) {
  const act = useAction();
  const [made, setMade] = useState<ClientPortalOpened | null>(null);
  const [form, setForm] = useState({ name: '', post: '' });
  const [doing, setDoing] = useState<{ id: string; what: 'reset' | 'close' } | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div className="it-stack">
      {made && <Made made={made} on={on} onDone={() => setMade(null)} />}
      <Card title="People with a portal sign-in" flush>
        {!c.users.length ? (
          <Empty title="Nobody yet.">{c.canManage ? 'Give the person at the client their own sign-in below.' : 'The Operations Manager gives sign-ins.'}</Empty>
        ) : (
          <ul className="it-rows">
            {c.users.map((u) => (
              <li key={u.id} className="it-row it-row-col">
                <div className="it-row-line">
                  <span className="it-row-main">
                    <strong>{u.name}</strong>
                    <span className="muted">
                      {u.post} · {u.lastSignInAt ? `last in ${dateTimeLabel(u.lastSignInAt)}` : 'not signed in yet'}
                    </span>
                  </span>
                  <Chip tone={u.open ? (u.locked ? 'warn' : 'ok') : 'neutral'}>{u.open ? (u.locked ? 'Locked for now' : 'Open') : 'Closed'}</Chip>
                </div>
                {u.closed && <span className="muted small">{`Closed by ${u.closed.by}: ${u.closed.reason}`}</span>}
                {u.open && (c.canManage || c.canClose) && (
                  <div className="nb-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                    {c.canManage && (
                      <button className="btn btn-sm" type="button" onClick={() => (setDoing({ id: u.id, what: 'reset' }), setReason(''))}>
                        <KeyIcon size={14} aria-hidden="true" /> New code
                      </button>
                    )}
                    <button className="btn btn-sm" type="button" onClick={() => (setDoing({ id: u.id, what: 'close' }), setReason(''))}>
                      Close sign-in
                    </button>
                  </div>
                )}
                {doing?.id === u.id && (
                  <div className="it-form">
                    <label className="isc-field">
                      Reason (required)
                      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <div className="nb-actions">
                      <button className="btn" type="button" onClick={() => setDoing(null)}>
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={act.busy || reason.trim().length < 3}
                        onClick={async () => {
                          if (doing.what === 'reset') {
                            const r = await act.run(() => api.resetClientPortal(c.clientId, u.id, reason), 'New code made. The old code stops now.');
                            if (r) (setMade(r), setDoing(null));
                          } else {
                            const r = await act.run(() => api.closeClientPortal(c.clientId, u.id, reason), 'Sign-in closed.');
                            if (r) setDoing(null);
                          }
                        }}
                      >
                        {doing.what === 'reset' ? 'Make a new code' : 'Close it now'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {c.canManage && (
        <Card title="Give portal access" sub="For one named person at the client. The code shows once: give it to them yourself, not by the same message as the link.">
          <div className="it-form nb-grid">
            <label className="isc-field">
              Name
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="isc-field">
              Post at the client
              <input className="input" value={form.post} placeholder="e.g. Facilities Manager" onChange={(e) => setForm({ ...form, post: e.target.value })} />
            </label>
          </div>
          <div className="nb-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={act.busy || form.name.trim().length < 3 || form.post.trim().length < 2}
              onClick={async () => {
                const r = await act.run(() => api.openClientPortal(c.clientId, form), 'Portal sign-in made.');
                if (r) (setMade(r), setForm({ name: '', post: '' }));
              }}
            >
              Make the sign-in
            </button>
          </div>
        </Card>
      )}
      <Card title="Sent from the portal, waiting" sub="Answer them on the client's page (Clients, Requests and complaints). The client sees your answer on the portal." flush>
        {!c.waiting.length ? (
          <Empty title="Nothing waiting." />
        ) : (
          <ul className="it-rows">
            {c.waiting.map((w) => (
              <li key={w.id} className="it-row">
                <span className="it-row-main">
                  <strong>{w.kind === 'request' ? 'Request' : 'Complaint'}</strong>
                  <span className="muted">
                    {dateLabel(w.at.slice(0, 10))} · {w.from}
                  </span>
                  <span>{w.what}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {c.lastRating && (
        <Facts items={[['Last rating from the portal', `${c.lastRating.score} of 5${c.lastRating.comment ? `: ${c.lastRating.comment}` : ''} (${c.lastRating.from ?? ''}, ${dateLabel(c.lastRating.at.slice(0, 10))})`]]} />
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Made({ made, on, onDone }: { made: ClientPortalOpened; on: boolean; onDone: () => void }) {
  const copy = (t: string) => {
    try {
      void navigator.clipboard.writeText(t);
    } catch {
      /* the person copies it by hand */
    }
  };
  return (
    <Card title={`Sign-in for ${made.user.name}`} sub="Shown once. Prima keeps only a fingerprint of the code: if it is lost, make a new code.">
      <Facts
        items={[
          ['Access code', <span key="c" className="nb-mono">{made.code}</span>],
          ['Personal link', made.url ? <span key="u" className="small" style={{ wordBreak: 'break-all' }}>{made.url}</span> : on ? '' : 'The portal page is not switched on here yet.'],
        ]}
      />
      <div className="nb-actions">
        <button className="btn" type="button" onClick={() => copy(made.code)}>
          Copy the code
        </button>
        {made.url && (
          <button className="btn" type="button" onClick={() => copy(made.url!)}>
            Copy the link
          </button>
        )}
        <button className="btn btn-primary" type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </Card>
  );
}
