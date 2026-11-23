import { Select } from '../SearchSelect';
import { useState } from 'react';
import { useRouteTab } from '../App';
import { SopHelp } from '../sop/SopHelp';
import { api, type JaSwitchBoard, type JaSwitchReport, type JaGuardHistory } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DataTable } from '../DataTable';

/**
 * Switch-over from the JA Group app (Fauzan, 5 Nov 2026). One company and one area at a time: 30 days side by side, a
 * difference report where every mismatch is explained or fixed, ACT checks it, then the CEO switches. JA history comes
 * across from JA export files, staged by one person and approved by another.
 */

type Tab = 'areas' | 'files' | 'history' | 'numbers';
type Row = JaSwitchBoard['rows'][number];
type Area = Row['area'];

const STATE: Record<Row['state'], [Tone, string]> = {
  ja: ['neutral', 'JA is the record'],
  side_by_side: ['info', 'Side by side'],
  prima: ['ok', 'Switched to Prima'],
};
const KIND_LABEL: Record<JaSwitchBoard['importKinds'][number]['kind'], string> = {
  attendance: 'Attendance (per guard per day)',
  patrol: 'Patrol scans (per site per day)',
  incidents: 'Incidents',
  payslips: 'Payslips (per guard per month)',
  hostels: 'Hostel per worker per month',
  guards: 'Guard records',
};

export function JaSwitchView() {
  const { data, error } = useLoad(() => api.jaSwitchBoard(), []);
  // P121: a link can open a tab (#jaswitch/files); everyone on this screen has all four.
  const [tab, setTab] = useRouteTab<Tab>('areas', ['areas', 'files', 'history', 'numbers']);
  const [open, setOpen] = useState<{ companyId: string; area: Area } | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="switch-over from JA" />;
  const running = data.rows.filter((r) => r.state === 'side_by_side');
  const switched = data.rows.filter((r) => r.state === 'prima');
  const waiting = data.imports.filter((i) => !i.decision);
  const unexplained = running.reduce((n, r) => n + (r.summary ? r.summary.differences - r.summary.explained : 0), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h1>Switch from JA</h1>
          <SopHelp id="it-ja-switch" />
        </div>
        <p className="muted">
          One company and one area at a time. Prima and JA run the same {data.settingsShown ? `${data.settings.sideBySideDays} days` : 'days'} side by side, every difference is explained or fixed,
          ACT checks the report, then the CEO switches. A switch can be undone.
        </p>
        <p className="notice" data-tone="info">
          Test data. JA stays the real system for guards. Switching here records the decision; it does not yet turn JA or Prima screens on or off, and Prima
          cannot make JA read-only. That needs the JA developer.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Running side by side" value={running.length} tone={running.length ? 'info' : 'neutral'} note="Company and area" />
        <Kpi label="Differences not explained" value={unexplained} tone={unexplained ? 'warn' : 'ok'} />
        <Kpi label="Switched to Prima" value={switched.length} tone={switched.length ? 'ok' : 'neutral'} />
        <Kpi label="JA files waiting" value={waiting.length} tone={waiting.length ? 'warn' : 'ok'} note="Need a second person" />
      </div>
      <div className="tabbar" role="tablist" aria-label="Switch-over">
        {(['areas', 'files', 'history', 'numbers'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'areas' ? 'Areas' : t === 'files' ? `JA files${waiting.length ? ` (${waiting.length})` : ''}` : t === 'history' ? 'Guard history' : 'Numbers'}
          </button>
        ))}
      </div>
      {tab === 'areas' && <AreasPanel data={data} onOpen={setOpen} />}
      {tab === 'files' && <FilesPanel data={data} />}
      {tab === 'history' && <HistoryPanel data={data} />}
      {tab === 'numbers' && <NumbersPanel data={data} />}
      {open && <ReportDrawer companyId={open.companyId} area={open.area} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AreasPanel({ data, onOpen }: { data: JaSwitchBoard; onOpen: (x: { companyId: string; area: Area }) => void }) {
  const [start, setStart] = useState<Row | null>(null);
  const label = (a: Area) => data.areas.find((x) => x.area === a)?.label ?? a;
  // P107: one table for every company and area, in the companies' order as before (each company's areas together).
  const order = new Map(data.companies.map((c, i) => [c.id, i]));
  const rows = data.rows.filter((r) => order.has(r.companyId)).sort((a, b) => order.get(a.companyId)! - order.get(b.companyId)!);
  return (
    <>
      <p className="muted small">
        Suggested order: incidents, attendance and patrol, guard pay, then hostels. Foreign worker papers live in both apps and do not switch.
      </p>
      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <DataTable
            label="Areas"
            stateKey="it.jaswitch.areas"
            rows={rows}
            rowKey={(r) => `${r.companyId}-${r.area}`}
            columns={[
              { id: 'company', label: 'Company', value: (r) => r.companyName, render: (r) => <strong>{r.companyName}</strong>, phone: 'title' },
              { id: 'area', label: 'Area', value: (r) => label(r.area), translate: true, phone: 'sub' },
              {
                id: 'state',
                label: 'Where it stands',
                value: (r) => STATE[r.state][1],
                translate: true,
                render: (r) => {
                  const s = r.summary;
                  return (
                    <>
                      <Chip tone={STATE[r.state][0]}>{STATE[r.state][1]}</Chip>
                      {r.state === 'side_by_side' && r.check && !s?.checkStale && <Chip tone="ok">ACT checked</Chip>}
                      {s?.checkStale && <Chip tone="warn">Data changed after ACT check</Chip>}
                      {r.switched && <div className="muted small">JA read-only until {dateLabel(r.switched.jaReadOnlyUntil)}</div>}
                    </>
                  );
                },
              },
              {
                id: 'run',
                label: 'Side-by-side days',
                value: (r) => r.run?.from ?? '',
                sort: 'date',
                render: (r) =>
                  r.run ? (
                    <>
                      {dateLabel(r.run.from)} to {dateLabel(r.run.to)}
                      <div className="muted small">{r.ended ? 'Finished' : `${r.summary?.compared ?? 0} of ${r.run.settings?.sideBySideDays ?? data.settings.sideBySideDays} days compared`}</div>
                    </>
                  ) : (
                    '–'
                  ),
              },
              {
                id: 'differences',
                label: 'Differences',
                value: (r) => (r.summary?.primaReady ? r.summary.differences - r.summary.explained : null),
                sort: 'number',
                align: 'left',
                render: (r) => {
                  const s = r.summary;
                  return !s ? (
                    '–'
                  ) : !s.primaReady ? (
                    <Chip tone="unknown">Prima side not built</Chip>
                  ) : (
                    <>
                      <Chip tone={s.differences === s.explained ? 'ok' : 'warn'}>
                        {s.explained} of {s.differences} explained
                      </Chip>
                      {s.jaMissingDays > 0 && <Chip tone="unknown">JA data missing {s.jaMissingDays} day(s)</Chip>}
                    </>
                  );
                },
              },
            ]}
            filters={[
              { id: 'company', label: 'Company', value: (r) => r.companyName },
              { id: 'area', label: 'Area', value: (r) => r.area, optionLabel: (a) => label(a as Area) },
              { id: 'state', label: 'Where it stands', value: (r) => r.state, options: Object.entries(STATE).map(([k, [, l]]) => ({ value: k, label: l })) },
            ]}
            rowEnd={(r) => (
              <div className="row">
                {r.run && (
                  <button className="btn btn-sm" onClick={() => onOpen({ companyId: r.companyId, area: r.area })}>
                    Open report
                  </button>
                )}
                {!r.run && r.state === 'prima' && (
                  <button className="btn btn-sm" onClick={() => onOpen({ companyId: r.companyId, area: r.area })}>
                    Details
                  </button>
                )}
                {r.canStart && (
                  <button className="btn btn-sm btn-primary" onClick={() => setStart(r)}>
                    Start side by side
                  </button>
                )}
              </div>
            )}
          />
        </div>
      </section>
      {start && <StartDrawer row={start} label={label(start.area)} days={data.settings.sideBySideDays} today={data.today} onClose={() => setStart(null)} />}
    </>
  );
}

function StartDrawer({ row, label, days, today, onClose }: { row: Row; label: string; days: number; today: string; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState('');
  return (
    <Drawer title={`Start side by side: ${label}`} sub={row.companyName} onClose={onClose}>
      <p className="muted">
        Prima and JA both record {label.toLowerCase()} for {days} days from the first day. JA stays the real system until the CEO switches.
      </p>
      <label className="field">
        <span className="label">First day</span>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Note</span>
        <input className="input" value={note} placeholder="e.g. pilot with this company" onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorNotice error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.jaSwitchAct(row.companyId, row.area, 'start', { from, note: note || 'Side by side with JA' }), 'Side-by-side run started');
            if (r !== undefined) onClose();
          }}
        >
          Start
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

function ReportDrawer({ companyId, area, onClose }: { companyId: string; area: Area; onClose: () => void }) {
  const { data, error } = useLoad(() => api.jaSwitchReport(companyId, area), [companyId, area]);
  const { run, busy, error: actError } = useAction();
  const [explain, setExplain] = useState<string | null>(null);
  const [kind, setKind] = useState<'explained' | 'fixed'>('explained');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  if (error) return <Drawer title="Difference report" onClose={onClose}><ErrorNotice error={error} /></Drawer>;
  if (!data) return <Drawer title="Difference report" onClose={onClose}><Loading what="the report" /></Drawer>;
  const r = data as JaSwitchReport & { canExplain?: boolean; canCheck?: boolean; canSwitch?: boolean; canUndo?: boolean; canCancel?: boolean };
  const c = r.comparison;
  const done = new Map(r.explanations.map((e) => [e.key, e]));
  const act = (action: 'explain' | 'check' | 'switch' | 'undo' | 'cancel', body: Record<string, unknown>, ok: string) =>
    run(() => api.jaSwitchAct(companyId, area, action, body), ok);
  return (
    <Drawer title={`${r.companyName}: ${area}`} sub={<Chip tone={STATE[r.state][0]}>{STATE[r.state][1]}</Chip>} onClose={onClose}>
      {r.run && (
        <p className="muted">
          Side by side {dateLabel(r.run.from)} to {dateLabel(r.run.to)}, started by {r.run.by}. {c?.to ? `Compared up to ${dateLabel(c.to)}.` : 'Nothing to compare yet.'}
        </p>
      )}
      {r.run && <p className="muted small">Numbers for this run (set by the ACT Director, kept from the day it started): {runNumbers(r.run.settings)}.</p>}
      {r.switched && (
        <p className="notice" data-tone="ok">
          Switched to Prima on {dateLabel(r.switched.on)} by {r.switched.by}: {r.switched.reason}. JA to stay read-only until {dateLabel(r.switched.jaReadOnlyUntil)}{' '}
          (agreed with the JA developer; Prima cannot enforce it).
        </p>
      )}
      {c && !c.primaReady && <p className="notice" data-tone="warn">{c.primaNote}</p>}
      {c && c.jaMissingDays.length > 0 && (
        <p className="notice" data-tone="warn">
          No approved JA file covers {c.jaMissingDays.length} day(s): {c.jaMissingDays.slice(0, 6).map(dateLabel).join(', ')}
          {c.jaMissingDays.length > 6 ? ' …' : ''}. Those days are unknown, not matching.
        </p>
      )}
      {c && c.primaReady && (
        <div className="kpis">
          <Kpi label="Matching" value={c.matched} tone="ok" />
          <Kpi label="Differences" value={c.total} tone={c.total ? 'warn' : 'ok'} />
          <Kpi label="Explained or fixed" value={r.explanations.length} tone={r.explanations.length === c.total ? 'ok' : 'warn'} />
        </div>
      )}
      {c && c.differences.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {/* P107: the differences as a table; cards in the narrow drawer. */}
          <DataTable
            label="Differences"
            stateKey="it.jaswitch.differences"
            layout="cards"
            rows={c.differences}
            rowKey={(d) => d.key}
            columns={[
              { id: 'what', label: 'Difference', value: (d) => d.what, phone: 'title' },
              { id: 'subject', label: 'Who or where', value: (d) => d.subject, phone: 'sub' },
              { id: 'date', label: 'Day', value: (d) => d.date, sort: 'date' },
              { id: 'ja', label: 'JA', value: (d) => d.ja },
              { id: 'prima', label: 'Prima', value: (d) => d.prima },
              {
                id: 'state',
                label: 'Explanation',
                value: (d) => {
                  const e = done.get(d.key);
                  return e ? (e.kind === 'fixed' ? 'Fixed' : 'Explained') : 'Open';
                },
                translate: true,
                render: (d) => {
                  const e = done.get(d.key);
                  return e ? (
                    <div className="small">
                      <Chip tone="ok">{e.kind === 'fixed' ? 'Fixed' : 'Explained'}</Chip> {e.note} <span className="muted">({e.by})</span>
                    </div>
                  ) : (
                    <Chip tone="warn">Open</Chip>
                  );
                },
              },
            ]}
            phoneFacts={4}
            filters={[
              {
                id: 'state',
                label: 'Explanation',
                value: (d) => done.get(d.key)?.kind ?? 'open',
                options: [
                  { value: 'open', label: 'Open' },
                  { value: 'explained', label: 'Explained' },
                  { value: 'fixed', label: 'Fixed' },
                ],
              },
              { id: 'date', label: 'Day', value: (d) => d.date, optionLabel: dateLabel },
            ]}
            rowEnd={(d) => {
              const e = done.get(d.key);
              return r.canExplain ? (
                <button className="btn btn-sm btn-ghost" onClick={() => { setExplain(d.key); setNote(e?.note ?? ''); setKind(e?.kind ?? 'explained'); }}>
                  {e ? 'Change' : 'Explain'}
                </button>
              ) : null;
            }}
          />
          {c.total > c.differences.length && <p className="muted small">Showing the first {c.differences.length} of {c.total}.</p>}
        </div>
      )}
      {explain && (
        <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <div className="label">Difference {explain}</div>
          <div className="seg" style={{ margin: '8px 0' }}>
            {(['explained', 'fixed'] as const).map((k) => (
              <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'explained' ? 'Explained' : 'Fixed'}
              </button>
            ))}
          </div>
          <textarea className="textarea" value={note} placeholder="What happened and why (at least 10 characters)" onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                if ((await act('explain', { key: explain, kind, note }, 'Saved')) !== undefined) setExplain(null);
              }}
            >
              Save
            </button>
            <button className="btn" onClick={() => setExplain(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      <ErrorNotice error={actError} />
      {(r.canCheck || r.canSwitch || r.canUndo || r.canCancel) && (
        <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <label className="field">
            <span className="label">{r.canCheck ? 'ACT note' : 'Reason (at least 10 characters)'}</span>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            {r.canCheck && (
              <button className="btn btn-primary" disabled={busy} onClick={() => act('check', { reportHash: r.reportHash, note: reason || 'Checked' }, 'Report checked')}>
                Mark report checked
              </button>
            )}
            {r.canSwitch && (
              <button className="btn btn-primary" disabled={busy} onClick={() => act('switch', { reportHash: r.reportHash, reason }, 'Switched to Prima')}>
                Switch this area to Prima
              </button>
            )}
            {r.canUndo && (
              <button className="btn btn-danger" disabled={busy} onClick={() => act('undo', { reason }, 'Switched back to JA')}>
                Switch back to JA
              </button>
            )}
            {r.canCancel && (
              <button className="btn" disabled={busy} onClick={() => act('cancel', { reason }, 'Side-by-side run stopped')}>
                Stop the run
              </button>
            )}
          </div>
        </section>
      )}
      {r.check && (
        <p className="muted small">
          ACT check by {r.check.by} on {dateTimeLabel(r.check.at)}: {r.check.note}
        </p>
      )}
      {r.history.length > 0 && (
        <>
          <h3>History</h3>
          <div className="list">
            {[...r.history].reverse().map((h, i) => (
              <div key={i} className="list-item">
                <div>
                  {h.action} · {h.by}
                  <div className="muted small">{h.note}</div>
                </div>
                <span className="muted small">{dateTimeLabel(h.at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}

/** Read a CSV export: the first line names the columns. Handles quoted fields with commas and quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) lines.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) lines.push(row);
  const [head, ...body] = lines;
  if (!head) return [];
  const cols = head.map((h) => h.trim().replace(/^﻿/, ''));
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

function FilesPanel({ data }: { data: JaSwitchBoard }) {
  const { run, busy, error } = useAction();
  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? '');
  const [kind, setKind] = useState<JaSwitchBoard['importKinds'][number]['kind']>('attendance');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [file, setFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const cols = data.importKinds.find((k) => k.kind === kind)?.columns ?? [];
  return (
    <>
      {data.canStage && (
        <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <h3>Stage a JA export</h3>
          <p className="muted small">
            A CSV file from JA for one company. Columns used: {cols.join(', ')}. Other columns are ignored; full IC numbers are refused. Nothing is written until
            the ACT Director approves it.
          </p>
          <div className="row">
            <label className="field">
              <span className="label">Company</span>
              <Select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">What the file holds</span>
              <Select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {data.importKinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {KIND_LABEL[k.kind]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">First day covered</span>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Last day covered</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">CSV file</span>
              <input
                className="input"
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setFile(f ? { name: f.name, rows: parseCsv(await f.text()) } : null);
                }}
              />
            </label>
          </div>
          {file && <p className="muted small">{file.rows.length} row(s) read from {file.name}.</p>}
          <ErrorNotice error={error} />
          <button
            className="btn btn-primary"
            disabled={busy || !file || !from || !to}
            onClick={() =>
              run(() => api.jaImportStage({ companyId, kind, from, to, fileName: file!.name, rows: file!.rows }), 'File staged for a second person to approve')
            }
          >
            Stage file
          </button>
        </section>
      )}
      {data.imports.length === 0 && <p className="muted">No JA files yet.</p>}
      {data.imports.map((b) => (
        <section key={b.id} className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              {KIND_LABEL[b.kind]} · {b.companyName}
            </strong>
            <Chip tone={!b.decision ? 'warn' : b.decision.decision === 'approved' ? 'ok' : 'neutral'}>
              {!b.decision ? 'Waiting for approval' : b.decision.decision === 'approved' ? `Approved, ${b.written} written` : 'Rejected'}
            </Chip>
          </div>
          <div className="muted small">
            {b.fileName} · {dateLabel(b.from)} to {dateLabel(b.to)} · staged by {b.staged.by} {dateTimeLabel(b.staged.at)} · fingerprint {b.fileHash.slice(0, 12)}
          </div>
          <div className="small">
            {b.rowsInFile} rows in the file: {b.kept} kept ({b.counts.new} new, {b.counts.changed} change what Prima holds, {b.counts.same} same), {b.refusedCount}{' '}
            refused.
          </div>
          {b.ignoredColumns.length > 0 && <div className="muted small">Ignored columns: {b.ignoredColumns.join(', ')}</div>}
          {b.unknownStaffCount > 0 && (
            <div className="notice small" data-tone="warn">
              {b.unknownStaffCount} staff number(s) not on Prima's people list ({b.unknownStaff.slice(0, 8).join(', ')}
              {b.unknownStaffCount > 8 ? ' …' : ''}). HR adds them; the import never creates people.
            </div>
          )}
          {b.refused.slice(0, 5).map((x) => (
            <div key={x.line} className="muted small">
              Line {x.line}: {x.reason}
            </div>
          ))}
          {b.decision && (
            <div className="muted small">
              {b.decision.decision} by {b.decision.by}: {b.decision.note}
            </div>
          )}
          {b.canDecide && (
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input" placeholder="Note" value={notes[b.id] ?? ''} onChange={(e) => setNotes({ ...notes, [b.id]: e.target.value })} />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.jaImportDecide(b.id, { decision: 'approve', fileHash: b.fileHash, note: notes[b.id] || 'Checked' }), 'Approved')}>
                Approve
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.jaImportDecide(b.id, { decision: 'reject', fileHash: b.fileHash, note: notes[b.id] ?? '' }), 'Rejected')}>
                Reject
              </button>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

function HistoryPanel({ data }: { data: JaSwitchBoard }) {
  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? '');
  const [staffNo, setStaffNo] = useState('');
  const [found, setFound] = useState<JaGuardHistory | null>(null);
  const { run, busy, error } = useAction();
  return (
    <>
      <p className="muted">
        Brought across from approved JA files: {data.history.guards} guard records, {data.history.payslips} payslips, {data.history.attendance} attendance days,{' '}
        {data.history.incidents} incidents, {data.history.patrol} patrol days, {data.history.hostels} hostel months.
      </p>
      <div className="row">
        <Select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <input className="input" placeholder="Staff number" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} />
        <button className="btn" disabled={busy || !staffNo.trim()} onClick={async () => setFound((await run(() => api.jaGuardHistory(companyId, staffNo.trim()))) ?? null)}>
          Look up
        </button>
      </div>
      <ErrorNotice error={error} />
      {found && (
        <section className="panel" style={{ padding: 12, marginTop: 12 }}>
          {found.guard ? (
            <div>
              <strong>{found.guard.name}</strong> · {found.guard.staffNo} · {found.guard.nationality} · {found.guard.status}
              <div className="muted small">
                Joined {dateLabel(found.guard.joinedOn)}
                {found.guard.leftOn ? `, left ${dateLabel(found.guard.leftOn)}` : ''} · {found.guard.rank ?? 'no rank'} · {found.guard.siteCode ?? 'no site'}
              </div>
            </div>
          ) : (
            <p className="muted">No guard record from JA for {found.staffNo}.</p>
          )}
          <div className="small">{found.attendanceDays} attendance day(s) from JA.</div>
          {found.payslips == null ? (
            <div className="muted small">Pay history is shown to HR, the company manager, ACT and group leaders.</div>
          ) : (
            found.payslips.map((p) => (
              <div key={p.period} className="small">
                {p.period}: gross RM{p.gross.toFixed(2)}, net RM{p.net.toFixed(2)}
              </div>
            ))
          )}
          {found.hostels.map((h) => (
            <div key={h.month} className="small">
              {h.month}: {h.hostel ?? 'no hostel'}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function runNumbers(v: JaSwitchBoard['settings'] | undefined): string {
  if (!v) return 'the standard numbers';
  return `${v.sideBySideDays} days side by side, hours within ${Math.round(v.hoursTolerance * 60)} minutes, incidents within ${v.incidentMatchMin} minutes, pay within RM${v.payToleranceRm.toFixed(2)}, JA read-only ${v.jaReadOnlyDays} days`;
}

type SettingKey = keyof JaSwitchBoard['settings'];

/** The switch-over numbers (Fauzan: "Every formula can set by act director"). Only the ACT Director changes them, with a reason; a run already started keeps its own. */
function NumbersPanel({ data }: { data: JaSwitchBoard }) {
  const { run, busy, error } = useAction();
  const keys = Object.keys(data.settingsLimits) as SettingKey[];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, String(data.settings[k])])));
  const [reason, setReason] = useState('');
  const changed = keys.filter((k) => Number(values[k]) !== data.settings[k]);
  if (!data.settingsShown)
    return (
      <section className="card">
        <h2>Switch-over numbers</h2>
        <p className="muted">Set by the ACT Director for the whole group. Each difference report shows the numbers its run uses.</p>
      </section>
    );
  return (
    <section className="card">
      <h2>Switch-over numbers</h2>
      <p className="muted">
        {data.canSetSettings
          ? 'You set these as ACT Director. A change applies to side-by-side runs started after it; a run already started keeps the numbers it began with.'
          : 'Set by the ACT Director. A run already started keeps the numbers it began with.'}
      </p>
      <div className="grid-2">
        {keys.map((k) => {
          const lim = data.settingsLimits[k];
          return (
            <label key={k} className="field">
              <span className="label">{lim.label}</span>
              <input
                className="input"
                type="number"
                min={lim.min}
                max={lim.max}
                step={k === 'hoursTolerance' || k === 'payToleranceRm' ? 0.05 : 1}
                value={values[k]}
                disabled={!data.canSetSettings}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
              <span className="muted small">
                From {lim.min} to {lim.max}
                {k === 'hoursTolerance' ? ' hours' : ''}
              </span>
            </label>
          );
        })}
      </div>
      {data.canSetSettings && (
        <>
          <label className="field">
            <span className="label">Reason for the change</span>
            <input className="input" value={reason} placeholder="e.g. JA rounds clock times to 30 minutes" onChange={(e) => setReason(e.target.value)} />
          </label>
          <ErrorNotice error={error} />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={busy || changed.length === 0 || reason.trim().length < 10}
              onClick={async () => {
                if ((await run(() => api.jaSwitchSettings({ values: Object.fromEntries(changed.map((k) => [k, values[k]])), reason }), 'Numbers saved')) !== undefined) setReason('');
              }}
            >
              Save numbers
            </button>
            <span className="muted small">{changed.length ? `${changed.length} changed` : 'No changes'}</span>
          </div>
        </>
      )}
      <h3 style={{ marginTop: 16 }}>Changes</h3>
      {data.settingsHistory.length === 0 ? (
        <p className="muted">No changes yet. The standard numbers are in use.</p>
      ) : (
        <ul className="list">
          {data.settingsHistory.map((h, i) => (
            <li key={i}>
              <strong>{h.by}</strong> on {dateTimeLabel(h.at)}: {h.reason}
              <div className="muted small">{runNumbers(h.values)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
