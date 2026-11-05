import { useContext, useState } from 'react';
import { Ctx, type ViewName } from '../App';
import { MyGuide } from './GuideCard';
import { api, type OrgImportPreview, type OrgInbox } from '../api';
import { JOINING_SAY, JOINING_SAY_HR, joiningAllows, type RecordKind } from '@prima/core';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

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
      <div className="page-head">
        <h1>Hand-overs</h1>
        <p className="muted">
          Key it once. When one department records something another needs, the right people get it here with a link to
          the record, so nobody types it again. A hand-over tells and links: it never approves, pays or changes the other
          department&apos;s records.
        </p>
        <p className="notice" data-tone="info">
          In-app only. Email and Teams notices stay off until they are set up and checked.
        </p>
      </div>
      <div className="tabbar" role="tablist" aria-label="Hand-overs" style={{ flexWrap: 'wrap' }}>
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
    <>
      <div className="kpis">
        <Kpi label="Open" value={data.open} tone={data.open ? 'warn' : 'ok'} />
        <Kpi label="Late" value={data.overdue} tone={data.overdue ? 'crit' : 'ok'} />
        <Kpi label="Unread" value={data.unread} tone={data.unread ? 'info' : 'ok'} />
      </div>
      <label className="small">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
      </label>
      {data.off && <p className="muted">Hand-overs are switched off here: other departments are not told automatically yet.</p>}
      {!data.off && !rows.length && <p className="muted">Nothing waiting for you from other departments.</p>}
      <div className="list">
        {rows.map((r) => (
          <HandOver key={r.task.id} row={r} />
        ))}
      </div>
      <p className="small muted">
        Showing {loaded.length} of {data.total}.{' '}
        {nextOffset != null && (
          <button disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        )}
      </p>
    </>
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
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{t.title}</strong>
        <Chip tone={row.tone}>{!open ? (t.status === 'done' ? 'Done' : 'Not needed') : row.overdueDays ? `${row.overdueDays} day(s) late` : t.kind === 'todo' ? 'To do' : 'For your information'}</Chip>
        {row.unread && <Chip tone="info">New</Chip>}
      </div>
      <div>{t.task}</div>
      <div className="small muted">
        From {t.from}, {dateTimeLabel(t.at)}
        {t.dueOn ? `. Due ${dateLabel(t.dueOn)}` : ''}. Record: {t.entity} {t.entityId}
      </div>
      <div className="small">
        {'refused' in link ? (
          <span className="muted">{link.refused}</span>
        ) : canOpen && !canOpen(link.view as ViewName) ? (
          // The link would open a screen this person does not have; say where the record is instead of a dead end.
          <span className="muted">
            Kept on {link.screen}, which is not in your menu. Ask {t.from} for what you need.
          </span>
        ) : link.exact ? (
          // A link only: the screen it opens checks the person's own permissions on the server.
          <button onClick={() => go({ view: link.view as ViewName, caseId: link.caseId, personId: link.personId })}>Open this record in {link.screen}</button>
        ) : (
          <>
            <button onClick={() => go({ view: link.view as ViewName })}>Open {link.screen}</button>{' '}
            <span className="muted">The screen opens at its list; look for {link.find}.</span>
          </>
        )}
      </div>
      {row.joining && open && (
        // The joining hand-overs (HR opens the request, IT records the account) follow the HR/IT joining request.
        <div className="small" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip tone={row.joining.state === 'ready' ? 'ok' : row.joining.state === 'cancelled' ? 'info' : 'warn'}>
            {{ ready: 'Identity prepared on the joining request (account and device not checked by Prima)', waiting: 'Joining request: waiting for IT identity record', cancelled: 'Joining request cancelled', missing: 'No joining request yet' }[row.joining.state]}
          </Chip>
          <span className="muted">{(t.desk === 'hr' ? JOINING_SAY_HR : JOINING_SAY)[row.joining.state]}</span>
          {(!canOpen || canOpen('hr-it-intake' as ViewName)) && (
            <button onClick={() => go({ view: 'hr-it-intake' as ViewName })}>Open HR/IT joining</button>
          )}
        </div>
      )}
      {t.closed && (
        <div className="small">
          {t.closed.by}, {dateTimeLabel(t.closed.at)}: {t.closed.note}
        </div>
      )}
      {open && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {t.kind === 'todo' ? (
            <>
              <input
                aria-label="What was done"
                placeholder="What was done (a reference helps)"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: '1 1 220px' }}
              />
              <button className="primary" disabled={busy || note.trim().length < 3 || (!!row.joining && !joiningAllows(t.desk, 'done', row.joining.state))} onClick={() => run(() => api.org.close(t.id, 'done', note), 'Marked done.')}>
                Done
              </button>
              <button disabled={busy || note.trim().length < 3 || (!!row.joining && !joiningAllows(t.desk, 'not_needed', row.joining.state))} onClick={() => run(() => api.org.close(t.id, 'not_needed', note), 'Marked not needed.')}>
                Not needed
              </button>
            </>
          ) : (
            <button disabled={busy} onClick={() => run(() => api.org.close(t.id, 'done', 'Read'), 'Noted.')}>
              Noted
            </button>
          )}
        </div>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}

function OrgMapView() {
  const { data, error } = useLoad(() => api.org.map(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the department map" />;
  return (
    <>
      {data.oversee && data.late.length > 0 && (
        <>
          <h2>Late or with nobody to receive ({data.lateTotal})</h2>
          {data.lateTotal > data.late.length && <p className="small muted">The {data.late.length} latest are listed; the counts per link above include all {data.lateTotal}.</p>}
          <div className="list">
            {data.late.map((r) => (
              <div key={r.task.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <strong>
                  {r.task.title}: {r.task.desk}
                </strong>
                <span className="small">
                  {r.task.unassigned ? 'Nobody in this desk has an account yet.' : `${r.overdueDays} day(s) late.`} From {r.task.from}.
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <h2>Every link between departments</h2>
      <div className="list">
        {data.flows.map((f) => (
          <div key={f.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{f.name}</strong>
              <Chip tone={STATUS_TONE[f.status]}>{STATUS[f.status]}</Chip>
              {f.counts && (
                <span className="small muted">
                  {f.counts.open} open, {f.counts.overdue} late, {f.counts.total} in all
                </span>
              )}
            </div>
            <div className="small">
              Keyed once by <strong>{f.keyedBy}</strong>: {f.record}.
            </div>
            <ul className="small" style={{ margin: 0 }}>
              {f.targets.map((t, i) => (
                <li key={i}>
                  <strong>{t.desk}</strong> {t.kind === 'todo' ? `to do${t.dueDays ? ` within ${t.dueDays} day${t.dueDays === 1 ? '' : 's'}` : ''}` : 'is told'}: {t.task}
                </li>
              ))}
            </ul>
            {f.note && <div className="small muted">{f.note}</div>}
          </div>
        ))}
      </div>
      <p className="small muted">Never passed between departments: speak-up reports, arms detail, discipline and harassment cases, PDPA cases, face data.</p>
    </>
  );
}

function ImportView() {
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
  return (
    <>
      <p className="muted">
        For records that already exist. Save the spreadsheet as CSV with the column names in the first row. Prima first
        checks every row exactly as the form would and keeps nothing; you then import the same file, all rows or none.
        The same file cannot be imported twice. Imported records do not send hand-overs (they are not new).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>
          Kind{' '}
          <select aria-label="Kind of record" value={kind} onChange={(e) => (setKind(e.target.value as RecordKind), reset())}>
            {IMPORT_KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {tpl.data?.companyScoped && (
          <label>
            Company id <input value={companyId} onChange={(e) => (setCompanyId(e.target.value.trim()), reset())} placeholder="e.g. co-sasa" />
          </label>
        )}
        <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} aria-label="CSV file" />
      </div>
      {tpl.data && (
        <p className="small">
          Kept by {tpl.data.keptBy}. Columns: <code>{tpl.data.csvHeader}</code>. Needed:{' '}
          {tpl.data.columns
            .filter((c) => c.required)
            .map((c) => c.label)
            .join(', ')}
          .
        </p>
      )}
      <textarea aria-label="CSV" rows={6} value={csv} onChange={(e) => (setCsv(e.target.value), reset())} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy || !csv.trim()} onClick={() => run(async () => setPreview(await api.org.importPreview(kind, companyId || null, csv)))}>
          Check the file
        </button>
        <button
          className="primary"
          disabled={busy || !preview?.canImport}
          onClick={() => run(() => api.org.importCommit(kind, companyId || null, csv, preview!.fingerprint), (r) => `Imported ${(r as { rows: number }).rows} records.`).then((r) => r && reset())}
        >
          Import {preview?.okRows ?? ''} rows
        </button>
      </div>
      <ErrorNotice error={error} />
      {preview && (
        <>
          <div className="kpis">
            <Kpi label="Rows ready" value={preview.okRows} tone="ok" />
            <Kpi label="Rows to fix" value={preview.badRows} tone={preview.badRows ? 'crit' : 'ok'} />
          </div>
          {preview.alreadyImported && (
            <p className="notice" data-tone="warn">
              This file was already imported by {preview.alreadyImported.by} on {dateTimeLabel(preview.alreadyImported.at)}.
            </p>
          )}
          {preview.missingColumns.length > 0 && <p className="notice" data-tone="crit">Columns needed: {preview.missingColumns.join(', ')}.</p>}
          {preview.ignoredColumns.length > 0 && <p className="small muted">Columns not used: {preview.ignoredColumns.join(', ')}.</p>}
          <div className="list">
            {preview.rows
              .filter((r) => !r.ok)
              .slice(0, 100)
              .map((r) => (
                <div key={r.row} className="list-item">
                  Row {r.row}: {r.problems.join(' ')}
                </div>
              ))}
          </div>
        </>
      )}
    </>
  );
}
