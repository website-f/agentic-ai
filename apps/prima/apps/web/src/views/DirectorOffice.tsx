import { Select } from '../SearchSelect';
import { useState } from 'react';
import { FileTextIcon, HourglassIcon, LightningIcon, TrayIcon } from '@phosphor-icons/react';
import { ExceptionalGuardCash } from './ExceptionalGuardCash';
import { JointTenders } from './JointTenders';
import { DirectorDesk } from './DirectorDesk';
import { SopHelp } from '../sop/SopHelp';
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
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import '../styles/leadership.css';

type TenderRow = Awaited<ReturnType<typeof api.tenderBoard>>['rows'][number];

const TENDER_COLUMNS: DtColumn<TenderRow>[] = [
  { id: 'title', label: 'Tender', value: (r) => r.tender.title, render: (r) => <strong>{r.tender.title}</strong>, phone: 'title' },
  { id: 'company', label: 'Company', value: (r) => r.companyName, phone: 'sub' },
  { id: 'ref', label: 'Reference', value: (r) => r.tender.ref, render: (r) => <span className="mono small">{r.tender.ref}</span>, hideBelow: 1300 },
  { id: 'channel', label: 'Channel', value: (r) => (r.tender.channel === 'GOVERNMENT' ? 'Government' : 'Private'), translate: true, hideBelow: 1200 },
  {
    id: 'checklist',
    label: 'Checklist',
    value: (r) => (r.total ? r.done / r.total : null),
    sort: 'number',
    align: 'left',
    render: (r) => (
      <span className="small">
        {r.total ? `${r.done} of ${r.total} done` : 'not started'}
        {r.checklistItems > 0 && !r.reviewed ? ', not checked yet' : ''}
        {r.checks.length ? ` · checks: ${r.checks.map((c) => ({ PREPARER: 'preparer', CHECK: 'Marketing check', MANAGER: 'manager' })[c]).join(', ')}` : ''}
        {r.total > 0 && (
          <span className="ld-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((r.done / r.total) * 100)}%` }} />
          </span>
        )}
      </span>
    ),
    hideBelow: 1100,
  },
  {
    id: 'stage',
    label: 'Stage',
    value: (r) => r.stage,
    translate: true,
    render: (r) => (
      <span className="ld-chips">
        <Chip tone={r.mine ? 'warn' : r.tender.status === 'submitted' ? 'ok' : 'neutral'}>{r.stage}</Chip>
        <PriorityChip p={r.priority} />
        {r.naWaiting > 0 && <Chip tone="warn">{r.naWaiting} T/B to confirm</Chip>}
        {r.openQueries > 0 && <Chip tone="info">{r.openQueries} questions to the buyer open</Chip>}
        {r.leadOnly && <Chip tone="unknown">Lead only</Chip>}
      </span>
    ),
  },
  { id: 'closes', label: 'Closes', value: (r) => r.tender.closesOn, sort: 'date' },
  {
    id: 'left',
    label: 'Days left',
    value: (r) => (r.tender.status === 'submitted' ? null : r.daysLeft),
    sort: 'number',
    render: (r) =>
      r.tender.status === 'submitted' ? (
        '–'
      ) : (
        <span className="ld-when-left" data-soon={r.daysLeft >= 0 && r.daysLeft <= 7 ? true : undefined}>
          {r.daysLeft >= 0 ? `${r.daysLeft} days` : 'Closed'}
        </span>
      ),
  },
];
const TENDER_FILTERS: DtFilter<TenderRow>[] = [
  {
    id: 'show',
    label: 'Show',
    value: (r) => [r.mine ? 'mine' : '', r.tender.status !== 'submitted' ? 'live' : ''].filter(Boolean),
    options: [
      { value: 'mine', label: 'Waiting for you' },
      { value: 'live', label: 'Being worked on' },
    ],
  },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
  { id: 'channel', label: 'Channel', value: (r) => r.tender.channel, optionLabel: (v) => (v === 'GOVERNMENT' ? 'Government' : 'Private') },
  { id: 'stage', label: 'Stage', value: (r) => r.stage },
  { id: 'priority', label: 'Priority', value: (r) => r.priority?.level ?? '', optionLabel: (v) => (v === 'URGENT' ? 'Urgent' : 'Short window') },
];

/**
 * The Director Office Administrator's desk. Its own work comes first (Director Office study B4, Fauzan 23 Nov 2026): the
 * weekly digest, CEO instructions, legal flags for the directors, reports and meetings, and cash lists. Tenders follow:
 * before the Marketing desk starts the Director Office keeps the tender protocol as before (Fauzan, 25 Oct 2026); once
 * it has started Marketing runs every bid and the Director Office only monitors.
 */
export function DirectorOfficeView() {
  const { companyId, me, setCompanyId, go, canOpen } = useApp();
  // Tenders and quotations are added on the company's Tenders and quotations screen (each bids in its own name).
  const toCommercial = canOpen ? canOpen('commercial') : true;
  const [cashCompany, setCashCompany] = useState(companyId);
  const { data, error } = useLoad(() => api.tenderBoard(), []);
  // P121: loaded here (not in the desk) so the head can offer a jump to CEO instructions to those who keep them.
  const instr = useLoad(() => api.ceoInstructions().catch(() => null), []);
  const table = useTableState('board.doa.tenders');
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
  // What waits for this person opens first; otherwise every tender (until the person picks).
  const control = { state: { ...table.state, f: { ...table.state.f, show: table.state.f.show ?? (mine ? 'mine' : '') } }, set: table.set };
  const setShow = (v: 'mine' | 'live' | '') => table.set({ f: { show: v } });
  // Director Office study B4 (Fauzan, 23 Nov 2026): once the Marketing desk has started, Marketing runs every bid and the
  // Director Office only monitors the tenders.
  const monitorOnly = data.marketingDeskOn;
  return (
    <div className="page ld">
      <PageHead
        title="Director Office"
        sub={
          <>
            The directors' week in one place: CEO instructions to done, reports due to the Director Office, meetings and minutes, and the legal points for
            the directors.{' '}
            {monitorOnly
              ? 'Marketing prepares and lodges every bid; the Director Office monitors them below.'
              : "Below: every company's tenders, which the Director Office still checks until the Marketing desk starts."}
          </>
        }
        actions={
          <>
            {instr.data && (
              <button className="btn" onClick={() => document.getElementById('ceo-instructions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                CEO instructions
                {instr.data.totals.waiting > 0 && <Chip tone="warn">{instr.data.totals.waiting}</Chip>}
              </button>
            )}
            <SopHelp id={instr.data ? 'board-ceo-instruction' : 'board'} />
            {toCommercial && (
              <button className="btn" onClick={() => go({ view: 'commercial' })}>
                Open Tenders and quotations
              </button>
            )}
          </>
        }
      />

      <DirectorDesk instr={instr} />
      <DirectorOfficeCounterPanel />
      <Card title="Cash lists">
        <ExceptionalGuardCash key={cashCompany} companyId={cashCompany} picker={<label>Cash handover company<Select className="select" value={cashCompany} onChange={e => setCashCompany(e.target.value)}>{me.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>} />
        <MyDailyCash />
      </Card>

      <h2 style={{ margin: '16px 0 0', fontSize: '1.1rem' }}>{monitorOnly ? 'Tenders: monitor only (Marketing runs the bids)' : 'Tenders'}</h2>
      <Stats>
        {!monitorOnly && <Stat label="Waiting for you" value={mine} tone={mine ? 'warn' : 'ok'} icon={<TrayIcon />} onClick={() => setShow('mine')} />}
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
      <TenderCounterPanel />
      <TenderOpportunitiesPanel />
      <TenderSourcesPanel />
      <JointTenders board={data} />

      <Card
        title="Tenders"
        sub={data.reader.readsFiles ? data.reader.name : 'Checklists: test version sample draft'}
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
        ) : (
          <DataTable
            label="Tenders"
            control={control}
            rows={data.rows}
            rowKey={(r) => r.tender.id}
            columns={TENDER_COLUMNS}
            filters={TENDER_FILTERS}
            onRowClick={(r) => {
              setCompanyId(r.tender.companyId);
              go({ view: 'commercial', tenderId: r.tender.id });
            }}
            rowTone={(r) => (r.mine ? 'warn' : undefined)}
          />
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
    </div>
  );
}
