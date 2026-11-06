import { useContext, useState } from 'react';
import { ArrowSquareOutIcon, BellIcon, ClockCountdownIcon, TrayIcon } from '@phosphor-icons/react';
import { Ctx, useApp, type ViewName } from '../App';
import { MyGuide } from './GuideCard';
import { api, type OrgImportPreview, type OrgInbox } from '../api';
import { GROUP_EMPLOYER_ID, JOINING_SAY, JOINING_SAY_HR, joiningAllows, type RecordKind } from '@prima/core';
import { Card, Empty, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
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

const IMPORT_KINDS: [RecordKind, string][] = [
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
];

const STATUS = { live: 'Ready', in_pr: 'Waits for its department PR', direct: 'Already linked; notice added', waits: 'Waits for an outside system' } as const;
const STATUS_TONE = { live: 'ok', in_pr: 'info', direct: 'ok', waits: 'warn' } as const;

export function HandoversView() {
  const [tab, setTab] = useState<Tab>('mine');
  return (
    <div className="page">
      <PageHead
        title="Hand-overs"
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
            ['guide', 'Panduan / Guide'],
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
  const [showClosed, setShowClosed] = useState(false);
  // Further pages, loaded on request; the counts above always cover every hand-over (data.total).
  const [more, setMore] = useState<Item[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your hand-overs" />;
  const nextOffset = next === undefined ? data.nextOffset : next;
  const loaded = [...data.items, ...more];
  const rows = loaded.filter((r) => showClosed || r.task.status === 'open');
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
        actions={
          <label className="ho-toggle">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
          </label>
        }
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
        {!data.off && !rows.length && <Empty title="Nothing waiting for you from other departments." />}
        {rows.length > 0 && (
          <ul className="hx-rows">
            {rows.map((r) => (
              <li key={r.task.id}>
                <HandOver row={r} />
              </li>
            ))}
          </ul>
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
  return (
    <div className="hx-row" data-tone={open && row.overdueDays ? 'crit' : undefined}>
      <div className="hx-row-main">
        <span className="hx-row-title">{t.title}</span>
        <span className="hx-row-text">{t.task}</span>
        <span className="hx-row-meta">
          From {t.from}, {dateTimeLabel(t.at)}
          {t.dueOn ? `. Due ${dateLabel(t.dueOn)}` : ''}. Record: {t.entity} {t.entityId}
        </span>
      </div>
      <div className="hx-row-side">
        {row.unread && <Chip tone="info">New</Chip>}
        <Chip tone={row.tone}>
          {!open ? (t.status === 'done' ? 'Done' : 'Not needed') : row.overdueDays ? `${row.overdueDays} day(s) late` : t.kind === 'todo' ? 'To do' : 'For your information'}
        </Chip>
      </div>
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

function OrgMapView() {
  const { data, error } = useLoad(() => api.org.map(), []);
  const [q, setQ] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the department map" />;
  const needle = q.trim().toLowerCase();
  const flows = data.flows.filter(
    (f) => !needle || [f.name, f.keyedBy, f.record, ...f.targets.flatMap((t) => [t.desk, t.task])].some((v) => v.toLowerCase().includes(needle)),
  );
  return (
    <div className="hx-stack">
      {data.oversee && data.late.length > 0 && (
        <Card
          title={`Late or with nobody to receive (${data.lateTotal})`}
          sub={data.lateTotal > data.late.length ? `The ${data.late.length} latest are listed; the counts per link above include all ${data.lateTotal}.` : undefined}
          flush
        >
          <ul className="hx-rows">
            {data.late.map((r) => (
              <li key={r.task.id} className="hx-row" data-tone="crit">
                <div className="hx-row-main">
                  <span className="hx-row-title">
                    {r.task.title}: {r.task.desk}
                  </span>
                  <span className="hx-row-meta">
                    {r.task.unassigned ? 'Nobody in this desk has an account yet.' : `${r.overdueDays} day(s) late.`} From {r.task.from}.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Toolbar>
        <Search value={q} onChange={setQ} placeholder="Search a link, department or record" label="Search links between departments" />
      </Toolbar>
      <Card
        title="Every link between departments"
        actions={<span className="hx-count">{flows.length === data.flows.length ? data.flows.length : `${flows.length} of ${data.flows.length}`}</span>}
        footer={
          <p className="hx-source ho-foot-note">
            Never passed between departments: speak-up reports, arms detail, discipline and harassment cases, PDPA cases, face data.
          </p>
        }
        flush
      >
        {flows.length === 0 && <Empty title="No link matches the search." />}
        <ul className="hx-rows">
          {flows.map((f) => (
            <li key={f.id} className="hx-row">
              <div className="hx-row-main">
                <span className="hx-row-title">{f.name}</span>
                <span className="hx-row-text">
                  Keyed once by <strong>{f.keyedBy}</strong>: {f.record}.
                </span>
              </div>
              <div className="hx-row-side">
                <Chip tone={STATUS_TONE[f.status]}>{STATUS[f.status]}</Chip>
                {f.counts && (
                  <span className="hx-count">
                    {f.counts.open} open, {f.counts.overdue} late, {f.counts.total} in all
                  </span>
                )}
              </div>
              <div className="hx-row-body">
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
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ImportView() {
  const { me } = useApp();
  const [kind, setKind] = useState<RecordKind>('site');
  const [companyId, setCompanyId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<OrgImportPreview | null>(null);
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
            <button className="btn" disabled={busy || !csv.trim()} onClick={() => run(async () => setPreview(await api.org.importPreview(kind, companyId || null, csv)))}>
              Check the file
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !preview?.canImport}
              onClick={() =>
                run(
                  () => api.org.importCommit(kind, companyId || null, csv, preview!.fingerprint),
                  (r) => `Imported ${(r as { rows: number }).rows} records.`,
                ).then((r) => r && reset())
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
              <select className="select" aria-label="Kind of record" value={kind} onChange={(e) => (setKind(e.target.value as RecordKind), reset())}>
                {IMPORT_KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {tpl.data?.companyScoped && (
              <label className="field">
                <span className="label">Company</span>
                <select className="select" value={companyId} onChange={(e) => (setCompanyId(e.target.value), reset())}>
                  <option value="">Choose the company</option>
                  {kind === 'officeStaff' && <option value={GROUP_EMPLOYER_ID}>PWVSB (central staff)</option>}
                  {me.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
    </div>
  );
}
