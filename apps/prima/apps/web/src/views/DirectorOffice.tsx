import { Select } from '../SearchSelect';
import { useState } from 'react';
import { FileTextIcon, HourglassIcon, LightningIcon, TrayIcon } from '@phosphor-icons/react';
import { ExceptionalGuardCash } from './ExceptionalGuardCash';
import { JointTenders } from './JointTenders';
import { DirectorDesk } from './DirectorDesk';
import { MyDailyCash } from './FinanceDailyCash';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, dateLabel, useLoad } from '../ui';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { rm } from './Commercial';
import { PriorityChip } from './TenderFlow';
import { TenderCounterPanel } from './TenderCounter';
import { DirectorOfficeCounterPanel } from './DirectorOfficeCounter';
import { TenderOpportunitiesPanel, TenderSourcesPanel } from './TenderOpportunities';
import '../styles/leadership.css';

type Show = 'mine' | 'live' | 'all';

/**
 * The Director Office Administrator's desk (Fauzan, 25 Oct 2026): every company's tenders, quotations, proposals and
 * leads and where each stands, the reports companies send in, and the meeting schedule.
 */
export function DirectorOfficeView() {
  const { companyId, me, setCompanyId, go, canOpen } = useApp();
  // Tenders and quotations are added on the company's Tenders and quotations screen (each bids in its own name).
  const toCommercial = canOpen ? canOpen('commercial') : true;
  const [cashCompany, setCashCompany] = useState(companyId);
  const { data, error } = useLoad(() => api.tenderBoard(), []);
  const [show, setShow] = useState<Show | null>(null);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="tender board" />
      </div>
    );
  const live = data.rows.filter((r) => r.tender.status !== 'submitted');
  const mine = data.rows.filter((r) => r.mine).length;
  // What waits for this person opens first; otherwise every tender.
  const view: Show = show ?? (mine ? 'mine' : 'all');
  const rows = view === 'mine' ? data.rows.filter((r) => r.mine) : view === 'live' ? live : data.rows;
  return (
    <div className="page ld">
      <PageHead
        title="Director Office"
        sub="Every company's tenders from papers to submission slip. Each company bids in its own name and does the work; the Director Office checks the checklist, follows each bid and gets the CEO's approval."
        actions={
          toCommercial && (
            <button className="btn" onClick={() => go({ view: 'commercial' })}>
              Open Tenders and quotations
            </button>
          )
        }
      />
      <Stats>
        <Stat label="Waiting for you" value={mine} tone={mine ? 'warn' : 'ok'} icon={<TrayIcon />} onClick={() => setShow('mine')} />
        <Stat label="Tenders being worked on" value={live.length} icon={<FileTextIcon />} onClick={() => setShow('live')} />
        <Stat
          label="Urgent or short window"
          value={live.filter((r) => r.priority?.level).length}
          tone={live.some((r) => r.priority?.level === 'URGENT') ? 'crit' : live.some((r) => r.priority?.level) ? 'warn' : undefined}
          icon={<LightningIcon />}
        />
        <Stat
          label="No arahan petender yet"
          value={live.filter((r) => !r.hasArahan).length}
          tone={live.some((r) => !r.hasArahan) ? 'warn' : 'ok'}
          icon={<HourglassIcon />}
        />
      </Stats>

      <Card
        title="Tenders"
        sub={data.reader.readsFiles ? data.reader.name : 'Checklists: test version sample draft'}
        actions={
          <div className="seg" role="group" aria-label="Which tenders">
            <button type="button" aria-pressed={view === 'mine'} onClick={() => setShow('mine')}>
              Waiting for you ({mine})
            </button>
            <button type="button" aria-pressed={view === 'live'} onClick={() => setShow('live')}>
              Being worked on ({live.length})
            </button>
            <button type="button" aria-pressed={view === 'all'} onClick={() => setShow('all')}>
              All ({data.rows.length})
            </button>
          </div>
        }
        flush
      >
        {data.rows.length === 0 ? (
          <Empty
            title="No tenders being worked on."
            action={
              toCommercial && (
                <button className="btn btn-sm" onClick={() => go({ view: 'commercial' })}>
                  Open Tenders and quotations
                </button>
              )
            }
          >
            Each company works its tenders and quotations on its Tenders and quotations screen; they show here as they move.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="Nothing here." />
        ) : (
          <ul className="ld-rows">
            {rows.map((r) => (
              <li key={r.tender.id}>
                <button
                  type="button"
                  className="ld-row ld-tender"
                  data-tone={r.mine ? 'warn' : undefined}
                  onClick={() => {
                    setCompanyId(r.tender.companyId);
                    go({ view: 'commercial', tenderId: r.tender.id });
                  }}
                >
                  <span className="ld-row-main">
                    <span className="ld-row-title">{r.tender.title}</span>
                    <span className="ld-row-meta">
                      {r.companyName} · <span className="mono">{r.tender.ref}</span> · {r.tender.channel === 'GOVERNMENT' ? 'Government' : 'Private'}
                    </span>
                    <span className="ld-row-meta">
                      Checklist {r.total ? `${r.done} of ${r.total} done` : 'not started'}
                      {r.checklistItems > 0 && !r.reviewed ? ', not checked yet' : ''}
                      {r.checks.length ? ` · checks: ${r.checks.map((c) => ({ PREPARER: 'preparer', MANAGER: 'manager' })[c]).join(', ')}` : ''}
                    </span>
                    {r.total > 0 && (
                      <span className="ld-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((r.done / r.total) * 100)}%` }} />
                      </span>
                    )}
                    <span className="ld-chips">
                      <Chip tone={r.mine ? 'warn' : r.tender.status === 'submitted' ? 'ok' : 'neutral'}>{r.stage}</Chip>
                      <PriorityChip p={r.priority} />
                      {r.naWaiting > 0 && <Chip tone="warn">{r.naWaiting} T/B to confirm</Chip>}
                      {r.openQueries > 0 && <Chip tone="info">{r.openQueries} questions to the buyer open</Chip>}
                      {r.leadOnly && <Chip tone="unknown">Lead only</Chip>}
                    </span>
                  </span>
                  <span className="ld-row-aside ld-when">
                    <span className="ld-when-date">{dateLabel(r.tender.closesOn)}</span>
                    {r.tender.status !== 'submitted' && (
                      <span className="ld-when-left" data-soon={r.daysLeft >= 0 && r.daysLeft <= 7 ? true : undefined}>
                        {r.daysLeft >= 0 ? `${r.daysLeft} days` : 'Closed'}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Quotations waiting for approval"
        actions={<Chip tone={data.quotationsWaiting.length ? 'warn' : 'ok'}>{data.quotationsWaiting.length}</Chip>}
        flush
      >
        {data.quotationsWaiting.length === 0 ? (
          <Empty title="None waiting." />
        ) : (
          <ul className="ld-rows">
            {data.quotationsWaiting.map((q) => (
              <li key={q.id} className="ld-row">
                <span className="ld-row-main">
                  <span className="ld-row-title">
                    {q.client} <span className="muted small mono">{q.ref}</span>
                  </span>
                  <span className="ld-row-meta">{q.companyName}</span>
                </span>
                <span className="ld-row-aside ld-money">{rm(q.monthlyTotal)} a month</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DirectorDesk />
      <label>Cash handover company<Select className="select" value={cashCompany} onChange={e => setCashCompany(e.target.value)}>{me.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
      <ExceptionalGuardCash key={cashCompany} companyId={cashCompany} />
      <MyDailyCash />
      <TenderOpportunitiesPanel />
      <TenderCounterPanel />
      <TenderSourcesPanel />
      <DirectorOfficeCounterPanel />
      <JointTenders board={data} />
    </div>
  );
}
