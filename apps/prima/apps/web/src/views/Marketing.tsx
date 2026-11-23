import { useState } from 'react';
import { api, type MarketingBoard } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { TenderOpportunitiesPanel, TenderSourcesPanel } from './TenderOpportunities';

const ROLE = { manager: 'Marketing Manager', deputy: 'Deputy Marketing Manager', executive: 'Tender Executive' } as const;

/**
 * The Marketing desk (Fauzan, 22-23 Nov 2026): one central department prepares and lodges every tender in each
 * company's name. Shows who covers which company, what each company entered this month (none is red), bids closing
 * with work left and approvals not given. Counts only: no prices and no files.
 */
export function MarketingView() {
  const { setCompanyId, go, me } = useApp();
  const { data, error } = useLoad(() => api.marketingBoard(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="Marketing desk" />
      </div>
    );
  const t = data.totals;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Marketing</h1>
          <p>
            Marketing prepares and lodges every tender in each company's name. The company manager approves the price and the bid once. Quotations stay with
            the companies.
          </p>
        </div>
      </div>
      {data.deskOn ? (
        <div className="notice" data-tone="ok">
          The Marketing desk started on {dateLabel(data.desk!.from)} ({data.desk!.by}). Every new tender is prepared here; a company has{' '}
          {data.rule.noBidNoticeHours} hours to say "do not bid", and no answer means go ahead.
        </div>
      ) : data.desk ? (
        <div className="notice" data-tone="info">
          The Marketing desk starts on {dateLabel(data.desk.from)} ({data.desk.by}). Until then each company prepares its own bids.
        </div>
      ) : (
        <div className="notice" data-tone="warn">
          The Marketing desk has not started. Each company still prepares its own bids, and the Director Office keeps the tender protocol. The CEO or the COO
          starts the desk.
        </div>
      )}
      {data.canStart && !data.desk && <StartDesk today={me.now.slice(0, 10)} />}
      {data.proposeFor.length > 0 && <NewProposal companies={data.proposeFor} today={me.now.slice(0, 10)} />}
      <div className="kpis">
        <Kpi label={`Tenders entered (${data.month})`} value={t.entered} />
        <Kpi label="Being prepared" value={t.working} />
        <Kpi label={`Proposals sent (${data.month})`} value={t.proposals} note="Our own offers to private clients; they do not count as tenders entered." />
        <Kpi label="Companies with none this month" value={t.zero} tone={t.zero ? 'crit' : 'ok'} note={t.zero ? `${t.noReason} with no reason written` : undefined} />
        <Kpi
          label="Working hours for each bid"
          value={t.avgHours ?? 'UNKNOWN'}
          note={`Average this month, as entered by staff.${t.avgDaysToLodge != null ? ` ${t.avgDaysToLodge} days from notice to lodging.` : ''}`}
          tone={t.avgHours == null ? undefined : t.avgHours <= 1 ? 'ok' : undefined}
        />
        <Kpi
          label="Found by the Marketing check"
          value={t.caught}
          note={`${t.sentBack} sent back this month. ${t.lodged ? `${t.firstPassClean} of ${t.lodged} lodged bids passed the first time.` : 'No bid lodged yet this month.'}`}
          tone={t.caught ? 'warn' : undefined}
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>To do</h3>
          <Chip tone={data.alerts.length ? 'warn' : 'ok'}>{data.alerts.length}</Chip>
        </div>
        <div className="list">
          {data.alerts.length === 0 && <div className="empty">Nothing closing soon and nothing waiting.</div>}
          {data.alerts.map((a, i) => (
            <button
              key={i}
              className="list-item list-button"
              onClick={() => {
                if (a.go.companyId) setCompanyId(a.go.companyId);
                go({ view: 'commercial', tenderId: a.go.tenderId });
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div className="muted small">{a.detail}</div>
              </div>
              <Chip tone={a.tone as Tone}>{a.level === 'coo' ? 'COO told' : a.tag}</Chip>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Each company this month</h3>
          <span className="muted small">Entered = bid lodged with the slip</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="hide-sm">Tender Executive</th>
                <th className="num">Entered</th>
                <th className="num hide-sm">Proposals</th>
                <th className="num">Being prepared</th>
                <th className="num">"Do not bid"</th>
                <th>Status</th>
                <th>Reason if none</th>
                <th className="hide-sm">Papers</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.companyId}>
                  <td>{r.companyName}</td>
                  <td className="hide-sm">{r.executives.join(', ') || <span className="muted">Nobody yet</span>}</td>
                  <td className="num">{r.entered}</td>
                  <td className="num hide-sm">{r.proposals}</td>
                  <td className="num">{r.working}</td>
                  <td className="num">{r.noBid}</td>
                  <td>
                    <Chip tone={r.tone as Tone}>{r.tone === 'ok' ? 'Entered' : r.tone === 'warn' ? 'In progress' : 'None'}</Chip>{' '}
                    {r.repeatNoBid && <Chip tone="warn">Keeps saying no</Chip>}
                  </td>
                  <td>
                    <NoEntryReason row={r} />
                  </td>
                  <td className="hide-sm">
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setCompanyId(r.companyId);
                        go({ view: 'commercial' });
                      }}
                    >
                      {r.papers === null ? (
                        'Unknown'
                      ) : r.papers.missing + r.papers.expired ? (
                        <Chip tone="crit">{r.papers.missing + r.papers.expired} not ready</Chip>
                      ) : r.papers.due ? (
                        <Chip tone="warn">{r.papers.due} ending</Chip>
                      ) : (
                        <Chip tone="ok">Ready</Chip>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Team</h3>
          <span className="muted small">Up to {data.rule.companiesPerExecutive} companies for each executive</span>
        </div>
        <div className="list">
          {data.staff.map((s) => (
            <div key={s.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="muted small">
                  {ROLE[s.role]}
                  {s.avgHours != null ? ` · ${s.avgHours} hours a bid over ${s.bids} lodged this month` : ''}
                  {s.caught ? ` · ${s.caught} found by the check on bids they prepared` : ''}
                </div>
              </div>
              <Chip tone={s.over ? 'warn' : 'neutral'}>
                {s.companies} {s.companies === 1 ? 'company' : 'companies'}
                {s.over ? ', too many' : ''}
              </Chip>
            </div>
          ))}
          {data.staff.length === 0 && <div className="empty">No Marketing staff have a sign-in yet. IT or HR prepares them in Accounts and Access.</div>}
        </div>
        {data.uncovered.length > 0 && (
          <p className="small" style={{ marginTop: 8 }}>
            <Chip tone="warn">No executive yet</Chip> {data.uncovered.join(', ')}
          </p>
        )}
      </section>
      <TenderOpportunitiesPanel />
      <TenderSourcesPanel />
    </div>
  );
}

function NoEntryReason({ row }: { row: MarketingBoard['rows'][number] }) {
  const act = useAction();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  if (row.entered > 0) return <span className="muted small">–</span>;
  if (edit)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
        <input className="input" aria-label={`Reason for ${row.companyName}`} placeholder="Why nothing was entered" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ gap: 4 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || text.trim().length < 10}
            onClick={() => act.run(() => api.setNoEntryReason(row.companyId, text), 'Reason saved.').then((ok) => ok !== undefined && setEdit(false))}
          >
            Save
          </button>
          <button className="btn btn-sm" onClick={() => setEdit(false)}>
            Cancel
          </button>
        </div>
        <ErrorNotice error={act.error} />
      </div>
    );
  return (
    <div className="small">
      {row.reason ? (
        <>
          {row.reason.reason} <span className="muted">({row.reason.by})</span>
        </>
      ) : (
        <span className="muted">Not written</span>
      )}{' '}
      {row.canNote && (
        <button
          className="btn btn-sm"
          onClick={() => {
            setText(row.reason?.reason ?? '');
            setEdit(true);
          }}
        >
          {row.reason ? 'Change' : 'Write'}
        </button>
      )}
    </div>
  );
}

/**
 * Start a proposal (Marketing item AH8, Fauzan 23 Nov 2026): our own offer to a private client, without tender papers.
 * It then appears on the company's "Tenders & quotes" with the proposal checklist.
 */
function NewProposal({ companies, today }: { companies: { id: string; name: string }[]; today: string }) {
  const { setCompanyId, go } = useApp();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const blank = { companyId: companies[0]?.id ?? '', client: '', title: '', scope: '', contact: '', sendBy: '', guards: '', sites: '' };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = f.companyId && f.client.trim().length >= 2 && f.title.trim().length >= 3 && f.scope.trim().length >= 3 && f.sendBy >= today;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Proposals</h3>
        {!open && (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            New proposal
          </button>
        )}
      </div>
      <p className="small muted">
        A proposal is our own offer to a private client, with no tender papers. It is prepared from the proposal checklist, checked by the Marketing
        Manager or Deputy, and the company manager approves the price before it is sent.
      </p>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select className="input" aria-label="Company" value={f.companyId} onChange={set('companyId')}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input className="input" aria-label="Client" placeholder="Client" value={f.client} onChange={set('client')} />
          <input className="input" aria-label="Proposal title" placeholder="Title, for example Guarding for the main office" value={f.title} onChange={set('title')} />
          <textarea className="input" aria-label="What we offer" rows={2} placeholder="What we will offer: posts, shifts, services" value={f.scope} onChange={set('scope')} />
          <input className="input" aria-label="Client contact" placeholder="Client contact (role or name, optional)" value={f.contact} onChange={set('contact')} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <label className="small">
              Send by{' '}
              <input className="input" type="date" aria-label="Send by" min={today} value={f.sendBy} onChange={set('sendBy')} />
            </label>
            <input className="input" type="number" min={0} aria-label="Guards" placeholder="Guards" value={f.guards} onChange={set('guards')} style={{ width: 110 }} />
            <input className="input" type="number" min={0} aria-label="Sites" placeholder="Sites" value={f.sites} onChange={set('sites')} style={{ width: 110 }} />
          </div>
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !ready}
              onClick={() =>
                act
                  .run(() => api.startProposal({ ...f, guards: Number(f.guards || 0), sites: Number(f.sites || 0) }), 'Proposal started. The company manager has been told.')
                  .then((ok) => {
                    if (ok === undefined) return;
                    setCompanyId(f.companyId);
                    go({ view: 'commercial' });
                  })
              }
            >
              Start proposal
            </button>
            <button className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StartDesk({ today }: { today: string }) {
  const act = useAction();
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Start the Marketing desk</h3>
      </div>
      <p className="small">
        From the start date Marketing prepares and lodges every new tender for every company. Bids a company has already started are finished by that
        company. This cannot be switched back from this screen.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input className="input" type="date" aria-label="Start date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" aria-label="Comment" placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !from || note.trim().length < 3}
          onClick={() => act.run(() => api.startMarketingDesk(from, note), 'Marketing desk start date set.')}
        >
          Start
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}
