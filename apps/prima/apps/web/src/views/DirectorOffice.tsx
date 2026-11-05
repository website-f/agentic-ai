import { JointTenders } from './JointTenders';
import { DirectorDesk } from './DirectorDesk';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useLoad } from '../ui';
import { rm } from './Commercial';
import { PriorityChip } from './TenderFlow';

/**
 * The Director Office Administrator's desk (Fauzan, 25 Oct 2026): every company's tenders, quotations, proposals and
 * leads and where each stands, the reports companies send in, and the meeting schedule.
 */
export function DirectorOfficeView() {
  const { setCompanyId, go } = useApp();
  const { data, error } = useLoad(() => api.tenderBoard(), []);
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
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Director Office</h1>
          <p>
            Every company's tenders from papers to submission slip. Each company bids in its own name and does the work; the Director Office checks the
            checklist, follows each bid and gets the CEO's approval.
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Waiting for you" value={mine} tone={mine ? 'warn' : 'ok'} />
        <Kpi label="Tenders being worked on" value={live.length} />
        <Kpi
          label="Urgent or short window"
          value={live.filter((r) => r.priority?.level).length}
          tone={live.some((r) => r.priority?.level === 'URGENT') ? 'crit' : live.some((r) => r.priority?.level) ? 'warn' : undefined}
        />
        <Kpi label="No arahan petender yet" value={live.filter((r) => !r.hasArahan).length} tone={live.some((r) => !r.hasArahan) ? 'warn' : 'ok'} />
      </div>
      <DirectorDesk />
      <JointTenders board={data} />
      <section className="panel">
        <div className="panel-head">
          <h3>Tenders</h3>
          <span className="muted small">
            {data.reader.readsFiles ? data.reader.name : 'Checklists: test version sample draft; the AI agent is not connected yet'}
          </span>
        </div>
        <div className="list">
          {data.rows.map((r) => (
            <button
              key={r.tender.id}
              className="list-item list-button"
              style={{ alignItems: 'flex-start' }}
              onClick={() => {
                setCompanyId(r.tender.companyId);
                go({ view: 'commercial', tenderId: r.tender.id });
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.tender.title}</div>
                <div className="muted small">
                  {r.companyName} · <span className="mono">{r.tender.ref}</span> · {r.tender.channel === 'GOVERNMENT' ? 'Government' : 'Private'}
                </div>
                <div className="muted small">
                  Checklist {r.total ? `${r.done} of ${r.total} done` : 'not started'}
                  {r.checklistItems > 0 && !r.reviewed ? ', not checked yet' : ''}
                  {r.checks.length ? ` · checks: ${r.checks.map((c) => ({ PREPARER: 'preparer', MANAGER: 'manager' })[c]).join(', ')}` : ''}
                </div>
                <div className="row" style={{ marginTop: 4, gap: 4, flexWrap: 'wrap' }}>
                  <Chip tone={r.mine ? 'warn' : r.tender.status === 'submitted' ? 'ok' : 'neutral'}>{r.stage}</Chip>
                  <PriorityChip p={r.priority} />
                  {r.naWaiting > 0 && <Chip tone="warn">{r.naWaiting} T/B to confirm</Chip>}
                  {r.openQueries > 0 && <Chip tone="info">{r.openQueries} questions to the buyer open</Chip>}
                  {r.leadOnly && <Chip tone="unknown">Lead only</Chip>}
                </div>
              </div>
              <div className="num small" style={{ flexShrink: 0, textAlign: 'right' }}>
                <div>{dateLabel(r.tender.closesOn)}</div>
                {r.tender.status !== 'submitted' && <div className="muted">{r.daysLeft >= 0 ? `${r.daysLeft} days` : 'Closed'}</div>}
              </div>
            </button>
          ))}
          {data.rows.length === 0 && <div className="empty">No tenders being worked on.</div>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Quotations waiting for approval</h3>
          <Chip tone={data.quotationsWaiting.length ? 'warn' : 'ok'}>{data.quotationsWaiting.length}</Chip>
        </div>
        <div className="list">
          {data.quotationsWaiting.length === 0 && <div className="empty">None waiting.</div>}
          {data.quotationsWaiting.map((q) => (
            <div key={q.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {q.client} <span className="muted small mono">{q.ref}</span>
                </div>
                <div className="muted small">
                  {q.companyName} · {rm(q.monthlyTotal)} a month
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
