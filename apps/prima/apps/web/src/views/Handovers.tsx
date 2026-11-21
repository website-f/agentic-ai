import { Select } from '../SearchSelect';
import { useContext, useState } from 'react';
import { ArrowSquareOutIcon, BellIcon, ClockCountdownIcon, TrayIcon } from '@phosphor-icons/react';
import { Ctx, useApp, useRouteTab, type ViewName } from '../App';
import { SopHelp } from '../sop/SopHelp';
import { ColumnHelper } from './BulkHelper';
import { MyGuide } from './GuideCard';
import { ImportButton } from './ImportDrawer';
import { api, type OrgImportPreview, type OrgInbox } from '../api';
import { GROUP_EMPLOYER_ID, JOINING_SAY, JOINING_SAY_HR, joiningAllows, type ImportKind, type RecordKind } from '@prima/core';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { DataTable } from '../DataTable';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/hrx.css';

/**
 * Prima as one organisation (Fauzan, 2 Nov 2026): "Key in once and all department get the data needed."
 * My hand-overs: what other departments keyed that I must act on or know, with a link to their record.
 * How departments connect: every link in one map; ACT and group leadership see the counts and what is late.
 * Import: load existing records from a spreadsheet through the same checks as the forms.
 */

type Tab = 'mine' | 'guide' | 'map' | 'import';
type Item = OrgInbox['items'][number];

const IMPORT_KINDS: [ImportKind, string][] = [
  ['site', 'Sites'],
  ['post', 'Posts'],
  ['checkpoint', 'Checkpoints'],
  ['licence', 'Licences'],
  ['insurancePolicy', 'Insurance policies'],
  ['insuranceGuarantee', 'Guarantees'],
  ['vehicle', 'Vehicles'],
  ['stockItem', 'Stock items'],
  ['hostel', 'Hostels'],
  ['officeStaff', 'Office staff'],
  ['amUnit', 'Rental units'],
  ['amAsset', 'Fixed assets'],
  ['itDomain', 'Domains and websites'],
  // P81: kinds added with the auto-aligning import (each page's Import button opens the same check).
  ['insuranceClaim', 'Insurance claims'],
  ['amWorkOrder', 'Work orders'],
  ['phoneExtension', 'Phone extensions'],
  ['siteSystem', 'CCTV and alarm panels'],
  ['cmsStaff', 'CMS staff'],
  ['armsSupplier', 'Arms suppliers'],
  ['supplierItem', 'Arms price list'],
  ['client', 'Clients'],
  ['contract', 'Client contracts'],
  ['leaveEntitlement', 'Leave days above the Act'],
  // P91: Operations, Security, Equipment and HR records (each page has its own Import too).
  ['staffTraining', 'Training records'],
  ['guardPaper', 'Guard papers (KDN, CSG, TNG)'],
  ['fuelCard', 'Fuel cards'],
  ['cmsDevice', 'Site devices for CMS'],
  ['siteKitItem', 'Site fittings'],
];

const STATUS = { live: 'Ready', in_pr: 'Waits for its department PR', direct: 'Already linked; notice added', waits: 'Waits for an outside system' } as const;
const STATUS_TONE = { live: 'ok', in_pr: 'info', direct: 'ok', waits: 'warn' } as const;

export function HandoversView() {
  // P121: a link may open a tab (#handovers/map).
  const [tab, setTab] = useRouteTab<Tab>('mine', ['mine', 'guide', 'map', 'import']);
  return (
    <div className="page">
      <PageHead
        title="Hand-overs"
        actions={<SopHelp id="hr-handover" />}
        sub={
          <>
            Key it once. When one department records something another needs, the right people get it here with a link to the record, so nobody types it
            again. A hand-over tells and links: it never approves, pays or changes the other department&apos;s records.
          </>
        }
      >
        <p className="notice" data-tone="info">
          In-app only. Email and Teams notices stay off until they are set up and checked.
        </p>
      </PageHead>
      <div className="tabbar hx-tabs" role="tablist" aria-label="Hand-overs">
        {(
          [
            ['mine', 'My hand-overs'],
            // P80: one language at a time; the translator shows Panduan in Bahasa Melayu.
            ['guide', 'Guide'],
            ['map', 'How departments connect'],
            ['import', 'Import existing records'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'mine' && <Mine />}
      {tab === 'guide' && <MyGuide />}
      {tab === 'map' && <OrgMapView />}
      {tab === 'import' && <ImportView />}
    </div>
  );
}

function Mine() {
  const { data, error } = useLoad(() => api.org.inbox(), []);
  // Further pages, loaded on request; the counts above always cover every hand-over (data.total).
  const [more, setMore] = useState<Item[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your hand-overs" />;
  const nextOffset = next === undefined ? data.nextOffset : next;
  const loaded = [...data.items, ...more];
  const loadMore = async () => {
    if (nextOffset == null) return;
    setLoadingMore(true);
    try {
      const page = await api.org.inbox(nextOffset);
      setMore((m) => [...m, ...page.items]);
      setNext(page.nextOffset);
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <div className="hx-stack">
      <Stats>
        <Stat label="Open" value={data.open} tone={data.open ? 'warn' : 'ok'} icon={<TrayIcon size={16} />} />
        <Stat label="Late" value={data.overdue} tone={data.overdue ? 'crit' : 'ok'} icon={<ClockCountdownIcon size={16} />} />
        <Stat label="Unread" value={data.unread} tone={data.unread ? 'info' : 'ok'} icon={<BellIcon size={16} />} />
      </Stats>
      {data.off && <p className="notice" data-tone="warn">Hand-overs are switched off here: other departments are not told automatically yet.</p>}
      <Card
        title="From other departments"
        footer={
          <div className="ho-foot">
            <span className="muted small">
              Showing {loaded.length} of {data.total}.
            </span>
            {nextOffset != null && (
              <button className="btn btn-sm" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            )}
          </div>
        }
        flush
      >
        {/* P107: the loaded hand-overs as a data table: search, open / closed, kind and department filters, sort and
            pages; each one's link and Done / Not needed box sit under its row. "Show more" still loads further pages. */}
        {data.off && !loaded.length ? null : (
          <DataTable
            label="From other departments"
            stateKey="handovers.mine"
            defaults={{ f: { state: 'open' } }}
            rows={loaded}
            rowKey={(r) => r.task.id}
            searchPlaceholder="Search a hand-over, department or record"
            searchText={(r) => `${r.task.task} ${r.task.entity} ${r.task.entityId}`}
            rowTone={(r) => (r.task.status === 'open' && r.overdueDays ? 'crit' : undefined)}
            empty={<Empty title="Nothing waiting for you from other departments." />}
            filters={[
              {
                id: 'state',
                label: 'Show',
                value: (r) => (r.task.status === 'open' ? 'open' : 'closed'),
                options: [
                  { value: 'open', label: 'Open' },
                  { value: 'closed', label: 'Closed' },
                ],
              },
              {
                id: 'kind',
                label: 'Kind',
                value: (r) => r.task.kind,
                options: [
                  { value: 'todo', label: 'To do' },
                  { value: 'info', label: 'For your information' },
                ],
              },
              { id: 'from', label: 'From', value: (r) => r.task.from },
            ]}
            columns={[
              {
                id: 'title',
                label: 'Hand-over',
                value: (r) => r.task.title,
                phone: 'title',
                render: (r) => (
                  <span className="hx-row-main">
                    <span className="hx-row-title">{r.task.title}</span>
                    <span className="hx-row-text">{r.task.task}</span>
                  </span>
                ),
              },
              {
                id: 'from',
                label: 'From',
                value: (r) => r.task.at,
                sort: 'date',
                render: (r) => (
                  <span className="hx-row-meta">
                    {r.task.from}, {dateTimeLabel(r.task.at)}
                  </span>
                ),
              },
              { id: 'due', label: 'Due', value: (r) => r.task.dueOn ?? '', sort: 'date', hideBelow: 1200 },
              {
                id: 'status',
                label: 'Status',
                value: (r) => handoverState(r),
                translate: true,
                render: (r) => (
                  <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {r.unread && <Chip tone="info">New</Chip>}
                    <Chip tone={r.tone}>{handoverState(r)}</Chip>
                  </span>
                ),
              },
            ]}
            rowDetail={(r) => <HandOver row={r} />}
          />
        )}
      </Card>
    </div>
  );
}

function HandOver({ row }: { row: Item }) {
  const t = row.task;
  const { go, canOpen } = useContext(Ctx);
  const link = row.open;
  const { run, busy, error } = useAction();
  const [note, setNote] = useState('');
  const open = t.status === 'open';
  // P107: the hand-over's record, link, joining state and Done / Not needed box, under its row in the table.
  return (
    <div className="hx-dt-body">
      <span className="hx-row-meta">
        Record: {t.entity} {t.entityId}
        {t.dueOn ? `. Due ${dateLabel(t.dueOn)}` : ''}
      </span>
      <div className="hx-row-body">
        <div className="ho-link">
          {'refused' in link ? (
            <span className="muted small">{link.refused}</span>
          ) : canOpen && !canOpen(link.view as ViewName) ? (
            // The link would open a screen this person does not have; say where the record is instead of a dead end.
            <span className="muted small">
              Kept on {link.screen}, which is not in your menu. Ask {t.from} for what you need.
            </span>
          ) : link.exact ? (
            // A link only: the screen it opens checks the person's own permissions on the server.
            <button className="btn btn-sm btn-ghost" onClick={() => go({ view: link.view as ViewName, caseId: link.caseId, personId: link.personId })}>
              <ArrowSquareOutIcon size={16} aria-hidden="true" />
              Open this record in {link.screen}
            </button>
          ) : (
            <>
              <button className="btn btn-sm btn-ghost" onClick={() => go({ view: link.view as ViewName })}>
                <ArrowSquareOutIcon size={16} aria-hidden="true" />
                Open {link.screen}
              </button>
              <span className="muted small">The screen opens at its list; look for {link.find}.</span>
            </>
          )}
        </div>
        {row.joining && open && (
          // The joining hand-overs (HR opens the request, IT records the account) follow the HR/IT joining request.
          <div className="ho-joining">
            <Chip tone={row.joining.state === 'ready' ? 'ok' : row.joining.state === 'cancelled' ? 'info' : 'warn'}>
              {
                {
                  ready: 'Identity prepared on the joining request (account and device not checked by Prima)',
                  waiting: 'Joining request: waiting for IT identity record',
                  cancelled: 'Joining request cancelled',
                  missing: 'No joining request yet',
                }[row.joining.state]
              }
            </Chip>
            <span className="muted small">{(t.desk === 'hr' ? JOINING_SAY_HR : JOINING_SAY)[row.joining.state]}</span>
            {(!canOpen || canOpen('hr-it-intake' as ViewName)) && (
              <button className="btn btn-sm" onClick={() => go({ view: 'hr-it-intake' as ViewName })}>
                Open HR/IT joining
              </button>
            )}
          </div>
        )}
        {t.closed && (
          <p className="hx-row-meta">
            {t.closed.by}, {dateTimeLabel(t.closed.at)}: {t.closed.note}
          </p>
        )}
        {open && (
          <div className="ho-close">
            {t.kind === 'todo' ? (
              <>
                <input
                  className="input"
                  aria-label="What was done"
                  placeholder="What was done (a reference helps)"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || note.trim().length < 3 || (!!row.joining && !joiningAllows(t.desk, 'done', row.joining.state))}
                  onClick={() => run(() => api.org.close(t.id, 'done', note), 'Marked done.')}
                >
                  Done
                </button>
                <button
                  className="btn btn-sm"
                  disabled={busy || note.trim().length < 3 || (!!row.joining && !joiningAllows(t.desk, 'not_needed', row.joining.state))}
                  onClick={() => run(() => api.org.close(t.id, 'not_needed', note), 'Marked not needed.')}
                >
                  Not needed
                </button>
              </>
            ) : (
              <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.org.close(t.id, 'done', 'Read'), 'Noted.')}>
                Noted
              </button>
            )}
          </div>
        )}
        <ErrorNotice error={error} />
      </div>
    </div>
  );
}

/** A hand-over's state in words (the chip). */
function handoverState(row: Item): string {
  const t = row.task;
  if (t.status !== 'open') return t.status === 'done' ? 'Done' : 'Not needed';
  return row.overdueDays ? `${row.overdueDays} day(s) late` : t.kind === 'todo' ? 'To do' : 'For your information';
}

function OrgMapView() {
  const { data, error } = useLoad(() => api.org.map(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the department map" />;
  return (
    <div className="hx-stack">
      {data.oversee && data.late.length > 0 && (
        <Card
          title={`Late or with nobody to receive (${data.lateTotal})`}
          sub={data.lateTotal > data.late.length ? `The ${data.late.length} latest are listed; the counts per link above include all ${data.lateTotal}.` : undefined}
          flush
        >
          <div className="hx-dt-pad">
            <DataTable
              label="Late or with nobody to receive"
              stateKey="handovers.late"
              rows={data.late}
              rowKey={(r) => r.task.id}
              searchPlaceholder="Search a hand-over or department"
              rowTone={() => 'crit'}
              filters={[
                { id: 'desk', label: 'Department', value: (r) => r.task.desk },
                {
                  id: 'why',
                  label: 'Why',
                  value: (r) => (r.task.unassigned ? 'nobody' : 'late'),
                  options: [
                    { value: 'late', label: 'Late' },
                    { value: 'nobody', label: 'Nobody to receive' },
                  ],
                },
              ]}
              columns={[
                {
                  id: 'title',
                  label: 'Hand-over',
                  value: (r) => `${r.task.title}: ${r.task.desk}`,
                  phone: 'title',
                  render: (r) => (
                    <span className="hx-row-title">
                      {r.task.title}: {r.task.desk}
                    </span>
                  ),
                },
                { id: 'from', label: 'From', value: (r) => r.task.from },
                {
                  id: 'late',
                  label: 'Late',
                  value: (r) => (r.task.unassigned ? null : r.overdueDays),
                  sort: 'number',
                  render: (r) => <span className="hx-row-meta">{r.task.unassigned ? 'Nobody in this desk has an account yet.' : `${r.overdueDays} day(s) late.`}</span>,
                },
              ]}
            />
          </div>
        </Card>
      )}
      <Card
        title="Every link between departments"
        actions={<span className="hx-count">{data.flows.length}</span>}
        footer={
          <p className="hx-source ho-foot-note">
            Never passed between departments: speak-up reports, arms detail, discipline and harassment cases, PDPA cases, face data.
          </p>
        }
        flush
      >
        {/* P107: every link as a data table (search, status filter, sort, pages); who is told sits under each row. */}
        <DataTable
          label="Every link between departments"
          stateKey="handovers.links"
          rows={data.flows}
          rowKey={(f) => f.id}
          searchPlaceholder="Search a link, department or record"
          searchText={(f) => f.targets.map((t) => `${t.desk} ${t.task}`).join(' ')}
          empty={<Empty title="No link matches the search." />}
          filters={[
            { id: 'status', label: 'Status', value: (f) => f.status, optionLabel: (v) => STATUS[v as keyof typeof STATUS] ?? v },
            { id: 'keyedBy', label: 'Keyed by', value: (f) => f.keyedBy },
          ]}
          columns={[
            {
              id: 'name',
              label: 'Link',
              value: (f) => f.name,
              phone: 'title',
              render: (f) => (
                <span className="hx-row-main">
                  <span className="hx-row-title">{f.name}</span>
                  <span className="hx-row-text">
                    Keyed once by <strong>{f.keyedBy}</strong>: {f.record}.
                  </span>
                </span>
              ),
            },
            { id: 'status', label: 'Status', value: (f) => STATUS[f.status], translate: true, render: (f) => <Chip tone={STATUS_TONE[f.status]}>{STATUS[f.status]}</Chip> },
            { id: 'open', label: 'Open', value: (f) => f.counts?.open ?? null, sort: 'number' },
            { id: 'late', label: 'Late', value: (f) => f.counts?.overdue ?? null, sort: 'number' },
            { id: 'total', label: 'In all', value: (f) => f.counts?.total ?? null, sort: 'number', hideBelow: 1200 },
          ]}
          rowDetail={(f) => (
            <div className="hx-dt-body">
              <ul className="ho-targets">
                {f.targets.map((t, i) => (
                  <li key={i}>
                    <strong>{t.desk}</strong>{' '}
                    {t.kind === 'todo' ? `to do${t.dueDays ? ` within ${t.dueDays} day${t.dueDays === 1 ? '' : 's'}` : ''}` : 'is told'}: {t.task}
                  </li>
                ))}
              </ul>
              {f.note && <span className="hx-row-meta">{f.note}</span>}
            </div>
          )}
        />
      </Card>
    </div>
  );
}

function ImportView() {
  const { me } = useApp();
  const [kind, setKind] = useState<ImportKind>('site');
  const [companyId, setCompanyId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<OrgImportPreview | null>(null);
  const [backup, setBackup] = useState('');
  const [n, setN] = useState(0);
  const tpl = useLoad(() => api.org.importTemplate(kind), [kind]);
  const { run, busy, error } = useAction();
  const reset = () => setPreview(null);
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) return;
    setCsv(await f.text());
    reset();
  };
  const problems = preview ? preview.rows.filter((r) => !r.ok).slice(0, 100) : [];
  return (
    <div className="hx-stack">
      <Card
        title="Import existing records"
        sub="For records that already exist. Save the spreadsheet as CSV with the column names in the first row. Prima first checks every row exactly as the form would and keeps nothing; you then import the same file, all rows or none. The same file cannot be imported twice. Imported records do not send hand-overs (they are not new)."
        footer={
          <>
            <ImportButton kind={kind} companyId={companyId || null} label="Excel or any sheet, step by step" />
            <button className="btn" disabled={busy || !csv.trim()} onClick={() => run(async () => setPreview(await api.org.importPreview(kind, companyId || null, csv)))}>
              Check the file
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !preview?.canImport}
              onClick={() =>
                run(
                  () => api.org.importCommit(kind, companyId || null, csv, preview!.fingerprint, { backup }),
                  (r) => `Imported ${(r as { rows: number }).rows} records. The counts went to the CEO for his OK.`,
                ).then((r) => r && (reset(), setN((x) => x + 1)))
              }
            >
              Import {preview?.okRows ?? ''} rows
            </button>
          </>
        }
      >
        <div className="ho-import">
          <div className="hx-form-grid">
            <label className="field">
              <span className="label">Kind</span>
              <Select className="select" aria-label="Kind of record" value={kind} onChange={(e) => (setKind(e.target.value as ImportKind), reset())}>
                {IMPORT_KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </label>
            {tpl.data?.companyScoped && (
              <label className="field">
                <span className="label">Company</span>
                <Select className="select" value={companyId} onChange={(e) => (setCompanyId(e.target.value), reset())}>
                  <option value="">Choose the company</option>
                  {kind === 'officeStaff' && <option value={GROUP_EMPLOYER_ID}>PWVSB (central staff)</option>}
                  {me.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="field">
              <span className="label">CSV file</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} aria-label="CSV file" />
            </label>
          </div>
          {tpl.data && (
            <p className="ho-template">
              Kept by {tpl.data.keptBy}. Columns: <code>{tpl.data.csvHeader}</code>. Needed:{' '}
              {tpl.data.columns
                .filter((c) => c.required)
                .map((c) => c.label)
                .join(', ')}
              .
            </p>
          )}
          <label className="field">
            <span className="label">Or paste the CSV</span>
            <textarea className="textarea ho-csv" aria-label="CSV" rows={6} value={csv} onChange={(e) => (setCsv(e.target.value), reset())} />
          </label>
          <ColumnHelper csv={csv} kind={kind as RecordKind} onKind={(k) => (setKind(k), reset())} onCsv={(c) => (setCsv(c), reset())} />
          <label className="field">
            <span className="label">Backup checked before this load (its date or reference)</span>
            <input className="input" aria-label="Backup checked before this load" value={backup} onChange={(e) => setBackup(e.target.value)} placeholder="e.g. nightly backup 14 Nov restored on test" />
          </label>
          <ErrorNotice error={error} />
        </div>
      </Card>
      {preview && (
        <>
          <Stats>
            <Stat label="Rows ready" value={preview.okRows} tone="ok" />
            <Stat label="Rows to fix" value={preview.badRows} tone={preview.badRows ? 'crit' : 'ok'} />
          </Stats>
          {preview.alreadyImported && (
            <p className="notice" data-tone="warn">
              This file was already imported by {preview.alreadyImported.by} on {dateTimeLabel(preview.alreadyImported.at)}.
            </p>
          )}
          {preview.missingColumns.length > 0 && (
            <p className="notice" data-tone="crit">
              Columns needed: {preview.missingColumns.join(', ')}.
            </p>
          )}
          {preview.ignoredColumns.length > 0 && <p className="small muted">Columns not used: {preview.ignoredColumns.join(', ')}.</p>}
          {problems.length > 0 && (
            <Card title="Rows to fix" flush>
              <ul className="hx-rows">
                {problems.map((r) => (
                  <li key={r.row} className="hx-row" data-tone="crit">
                    <div className="hx-row-main">
                      <span className="hx-row-title">Row {r.row}</span>
                      <span className="hx-row-meta">{r.problems.join(' ')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <ImportLoads key={n} />
    </div>
  );
}

/**
 * N2 bulk data load (Fauzan, 11 Nov 2026): each load's counts (in the file, loaded, refused) go to the CEO, who OKs a
 * load with a comment before that person loads the next file. Never his own.
 */
function ImportLoads() {
  const v = useLoad(() => api.org.importLoads(), []);
  const { run, busy, error } = useAction();
  const [why, setWhy] = useState<Record<string, string>>({});
  if (!v.data || !v.data.loads.length) return null;
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <h3>Loads and the CEO's OK</h3>
      </div>
      {!v.data.gate && <p className="muted small">The CEO's OK step is not installed in this database yet; loads work as before.</p>}
      <ErrorNotice error={error} />
      {/* P107: the loads as a data table (search, kind and OK filters, sort, pages); the OK box sits under its row. */}
      <DataTable
        label="Loads and the CEO's OK"
        stateKey="handovers.loads"
        rows={v.data.loads}
        rowKey={(l) => l.id}
        searchPlaceholder="Search a load or who loaded it"
        searchText={(l) => l.by}
        filters={[
          { id: 'kind', label: 'Kind', value: (l) => l.label },
          {
            id: 'ok',
            label: "CEO's OK",
            value: (l) => (l.ok ? 'ok' : 'waiting'),
            options: [
              { value: 'waiting', label: 'Waiting' },
              { value: 'ok', label: 'OK given' },
            ],
          },
        ]}
        columns={[
          { id: 'label', label: 'Load', value: (l) => l.label, phone: 'title', render: (l) => <strong>{l.label}</strong> },
          { id: 'loaded', label: 'Loaded', value: (l) => l.counts.loaded, sort: 'number' },
          { id: 'inFile', label: 'In the file', value: (l) => l.counts.inFile, sort: 'number' },
          { id: 'refused', label: 'Refused', value: (l) => l.counts.refused, sort: 'number' },
          { id: 'at', label: 'Loaded on', value: (l) => l.at, sort: 'date', render: (l) => `${l.by} · ${dateTimeLabel(l.at)}` },
        ]}
        rowDetail={(l) => (
          <div className="hx-dt-body small">
            {(l.backup || l.counts.ignoredColumns.length > 0) && (
              <div className="muted small">
                {l.backup ? `Backup: ${l.backup}` : ''}
                {l.backup && l.counts.ignoredColumns.length ? ' · ' : ''}
                {l.counts.ignoredColumns.length ? `Columns not used: ${l.counts.ignoredColumns.join(', ')}` : ''}
              </div>
            )}
            {l.ok ? (
              <div className="small">OK by {l.ok.by}: {l.ok.comment}</div>
            ) : l.mayOk ? (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input className="input" aria-label="Comment with the OK" value={why[l.id] ?? ''} onChange={(e) => setWhy((m) => ({ ...m, [l.id]: e.target.value }))} placeholder="Comment (needed)" />
                <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.org.importOk(l.id, why[l.id] ?? ''), 'Load OK.').then((r) => r && v.reload())}>
                  OK this load
                </button>
              </div>
            ) : (
              v.data!.gate && <div className="muted small">Waiting for the CEO's OK before the next load.</div>
            )}
          </div>
        )}
      />
    </section>
  );
}
