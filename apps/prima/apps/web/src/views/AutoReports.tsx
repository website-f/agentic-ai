import { useRef, useState } from 'react';
import { api } from '../api';
import { saveFile } from '../save';
import { Chip, ErrorNotice, Kpi, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

// Monthly reports Prima makes by itself (Fauzan, 23 Nov 2026: "Let system automaticly create every month report
// needed"). Prima fills them on the 1st from its own records; the owner keys in a short note where Prima has no record,
// adds a paper (Upload), downloads (PDF or spreadsheet) and sends. If the owner has not sent an internal report by its
// due day, Prima sends it, marked Not checked. Client reports always wait for a person.

interface Row {
  id: string;
  name: string;
  kind: 'company' | 'department' | 'client' | 'group';
  period: string;
  monthName: string;
  scopeName: string;
  due: string;
  madeAt: string;
  version: number;
  status: 'made' | 'sent';
  sent: { by: string; at: string; checked: boolean; note: string } | null;
  owner: boolean;
  overdue: boolean;
  sections: number;
  filled: number;
  notes: number;
  extras: string[];
  missing: string[];
}
interface Mine {
  installed: boolean;
  month: string | null;
  canRun: boolean;
  canSet: boolean;
  reports: Row[];
}
interface Section {
  title: string;
  lines: string[];
  note?: string;
  source?: 'prima' | 'added' | 'own';
  must?: boolean;
  hint?: string;
  hidden?: boolean;
}
interface Detail extends Row {
  sectionsList: Section[];
  history: { at: string; by: string; note: string }[];
  noteMax: number;
  ownParts: boolean;
  maxOwn: number;
}
type Use = 'must' | 'optional' | 'off';
interface Layout {
  parts: { title: string; use: Use }[];
  added: { title: string; hint: string; must: boolean }[];
  ownParts: boolean;
  by: string;
  at: string;
  note: string;
}
interface Settings {
  canSet: boolean;
  reports: { id: string; name: string; kind: Row['kind']; from: string; primaParts: string[]; layout: Layout | null }[];
  limits: { maxAdded: number; hintMax: number };
}

const KIND: Record<Row['kind'], string> = {
  company: 'Company report to the Director Office',
  department: 'Department report to the Director Office',
  client: 'Service report to the client',
  group: 'Group report for the CEO',
};

function state(r: Row): { label: string; tone: Tone } {
  if (r.sent) return r.sent.checked ? { label: `Sent by ${r.sent.by}`, tone: 'ok' } : { label: 'Sent by Prima, not checked', tone: 'warn' };
  if (r.overdue) return { label: 'Past due, not sent', tone: 'crit' };
  return { label: 'Ready to check', tone: 'neutral' };
}

async function download(id: string, format: 'pdf' | 'csv') {
  const f = (await api.autoReportAct('download', { id, format })) as { name: string; data: string };
  const data = format === 'csv' ? new Blob([f.data], { type: 'text/csv' }) : f.data;
  return saveFile(f.name, data);
}

/** The "Made by Prima" panel on the Reports screen. */
export function AutoReportsPanel() {
  const { data, error } = useLoad(() => api.autoReportAct('mine', {}) as Promise<Mine>, []);
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'mine' | 'all'>('mine');
  const [settings, setSettings] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;
  if (!data.installed)
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Monthly reports made by Prima</h3>
          <Chip tone="unknown">Not installed</Chip>
        </div>
        <p className="muted small" style={{ padding: 12 }}>
          Prima makes every monthly report on the 1st once the database module auto-reports-v1 is installed.
        </p>
      </section>
    );
  const mine = data.reports.filter((r) => r.owner);
  const shown = kind === 'mine' && mine.length ? mine : data.reports;
  const waiting = mine.filter((r) => r.status === 'made').length;
  const late = mine.filter((r) => r.overdue).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Monthly reports made by Prima</h3>
          <span className="muted small">
            Made on the 1st from Prima's records{data.month ? `; latest month ${data.month}` : ''}. Check, key in a note where Prima has no record, then send. Internal reports
            not sent by the due day are sent by Prima, marked Not checked.
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {(data.canSet || data.canRun) && (
            <button className="btn btn-sm" aria-pressed={settings} onClick={() => setSettings(!settings)}>
              What each report must have
            </button>
          )}
          {data.canRun && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.autoReportAct('run', {}) as Promise<{ made: number; sent: number }>, (r) => `Made ${r.made}, sent ${r.sent} past due.`)}>
              Make now
            </button>
          )}
        </div>
      </div>
      {settings && <ReportSettings />}
      <ErrorNotice error={act.error} />
      {mine.length > 0 && (
        <div className="kpis">
          <Kpi label="Yours to check" value={waiting} tone={waiting ? 'warn' : 'ok'} />
          <Kpi label="Past due" value={late} tone={late ? 'crit' : 'ok'} />
        </div>
      )}
      {mine.length > 0 && mine.length < data.reports.length && (
        <div className="row" style={{ gap: 6, padding: '0 12px' }}>
          <button className="btn btn-sm" aria-pressed={kind === 'mine'} onClick={() => setKind('mine')}>
            Mine ({mine.length})
          </button>
          <button className="btn btn-sm" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            All I can read ({data.reports.length})
          </button>
        </div>
      )}
      {shown.length === 0 && <div className="empty">No monthly report made yet.</div>}
      <div className="list">
        {shown.map((r) => {
          const st = state(r);
          return (
            <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <button className="list-button" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0 }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div style={{ fontWeight: 600 }}>
                  {r.name} · {r.monthName}
                </div>
                <div className="muted small">
                  {r.scopeName} · {KIND[r.kind]} · due {dateLabel(r.due)} · {r.filled} of {r.sections} parts filled by Prima{r.notes ? `, ${r.notes} notes` : ''}
                </div>
                {r.status === 'made' && r.missing.length > 0 && <div className="small">Must have, still empty: {r.missing.join(', ')}</div>}
                <div style={{ marginTop: 4 }}>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
              </button>
              {open === r.id && <AutoReportDetail id={r.id} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AutoReportDetail({ id }: { id: string }) {
  const { data, error } = useLoad(() => api.autoReportAct('view', { id }) as Promise<Detail>, [id]);
  const act = useAction();
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [own, setOwn] = useState('');
  const file = useRef<HTMLInputElement>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <div className="muted small">Opening the report…</div>;
  const can = data.owner && data.status === 'made';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.sectionsList.map((s, i) => (
        <div key={i} style={{ borderLeft: '3px solid var(--line, #ddd)', paddingLeft: 8, opacity: s.hidden ? 0.6 : 1 }}>
          <div className="small row" style={{ fontWeight: 600, gap: 6, flexWrap: 'wrap' }}>
            <span>
              {i + 1}. {s.title}
            </span>
            {s.must && <Chip tone={!s.lines.length && !s.note ? 'warn' : 'ok'}>Must have</Chip>}
            {s.source === 'added' && <Chip tone="neutral">Added by the Director Office</Chip>}
            {s.source === 'own' && <Chip tone="neutral">Your own part</Chip>}
            {s.hidden && <Chip tone="unknown">Left out</Chip>}
          </div>
          {s.hint && <div className="muted small">Wanted: {s.hint}</div>}
          {!s.hidden && s.lines.map((l, j) => (
            <div key={j} className="small">
              {l}
            </div>
          ))}
          {s.note && !s.hidden && <div className="small">Note: {s.note}</div>}
          {!s.hidden && !s.lines.length && !s.note && <div className="muted small">{s.source === 'prima' || !s.source ? 'Prima has no record for this part.' : 'Key in this part.'}</div>}
          {can && !s.must && (s.source === 'own' ? (
            <button className="btn btn-sm" style={{ marginTop: 4, marginRight: 6 }} disabled={act.busy} onClick={() => act.run(() => api.autoReportAct('removePart', { id, index: i }), 'Part taken away.')}>
              Take away
            </button>
          ) : (
            <button className="btn btn-sm" style={{ marginTop: 4, marginRight: 6 }} disabled={act.busy} onClick={() => act.run(() => api.autoReportAct('hide', { id, index: i, hidden: !s.hidden }), s.hidden ? 'Put back.' : 'Left out; next month too.')}>
              {s.hidden ? 'Put back' : 'Leave out'}
            </button>
          ))}
          {can && !s.hidden &&
            (editing === i ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <textarea className="input" aria-label={`Note for ${s.title}`} maxLength={data.noteMax} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={act.busy}
                    onClick={async () => {
                      if (await act.run(() => api.autoReportAct('note', { id, index: i, text }), 'Note saved.')) setEditing(null);
                    }}
                  >
                    Save note
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-sm"
                style={{ marginTop: 4 }}
                onClick={() => {
                  setEditing(i);
                  setText(s.note ?? '');
                }}
              >
                Key in
              </button>
            ))}
        </div>
      ))}
      {can && data.ownParts && data.sectionsList.filter((s) => s.source === 'own').length < data.maxOwn && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Name of your own part" placeholder="Add a part of your own (kept for next month)" maxLength={80} value={own} onChange={(e) => setOwn(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy || own.trim().length < 3}
            onClick={async () => {
              if (await act.run(() => api.autoReportAct('addPart', { id, title: own }), 'Part added.')) setOwn('');
            }}
          >
            Add part
          </button>
        </div>
      )}
      {data.extras.length > 0 && <div className="small">Papers added: {data.extras.join(', ')}</div>}
      {data.sent && (
        <div className="small">
          Sent by {data.sent.by}, {dateTimeLabel(data.sent.at)}
          {data.sent.checked ? '' : ' (not checked by the owner)'}
          {data.sent.note ? ` · ${data.sent.note}` : ''}
        </div>
      )}
      <ErrorNotice error={act.error} />
      {msg && <div className="muted small">{msg}</div>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={async () => setMsg(await download(id, 'pdf'))}>
          Download PDF
        </button>
        <button className="btn btn-sm" onClick={async () => setMsg(await download(id, 'csv'))}>
          Download spreadsheet
        </button>
        {can && (
          <>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => file.current?.click()}>
              Upload a paper (PDF)
            </button>
            <input
              ref={file}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => void act.run(() => api.autoReportAct('upload', { id, name: f.name, data: String(rd.result) }), 'Paper added.');
                rd.readAsDataURL(f);
              }}
            />
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.autoReportAct('remake', { id }), 'Made again from today’s records.')}>
              Make again
            </button>
          </>
        )}
      </div>
      {can && data.missing.length > 0 && <div className="small">Key in these parts before sending (the Director Office says they must be there): {data.missing.join(', ')}</div>}
      {can && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Note when sending" placeholder="Note when sending (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.autoReportAct('send', { id, note }), data.kind === 'client' ? 'Recorded as sent to the client.' : data.kind === 'group' ? 'Sent to the CEO.' : 'Sent to the Director Office.')}>
            {data.kind === 'client' ? 'Checked: record as sent to the client' : data.kind === 'group' ? 'Checked: send to the CEO' : 'Checked: send'}
          </button>
        </div>
      )}
      {data.kind === 'client' && can && <div className="muted small">Give the downloaded PDF to the client the usual way; Prima does not email clients.</div>}
    </div>
  );
}

/** The Director Office sets, for each report Prima makes, which parts must be there, which are left out and what is added. */
function ReportSettings() {
  const { data, error } = useLoad(() => api.autoReportAct('layouts', {}) as Promise<Settings>, []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <div className="muted small" style={{ padding: 12 }}>Opening the report settings…</div>;
  return (
    <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="muted small">
        {data.canSet
          ? 'Set what each report must have (it cannot be sent until those parts have something in them) and add parts the owner keys in. Owners may leave out optional parts and add their own unless you fix the parts.'
          : 'Set by the Director Office. You can read the settings.'}
      </div>
      {data.reports.map((r) => (
        <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <button className="list-button" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0 }} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div className="muted small">
              {r.from} · {KIND[r.kind]} ·{' '}
              {r.layout
                ? `${r.layout.parts.filter((p) => p.use === 'must').length} must have, ${r.layout.parts.filter((p) => p.use === 'off').length} left out, ${r.layout.added.length} added · set by ${r.layout.by}, ${dateLabel(r.layout.at.slice(0, 10))}`
                : 'Not set yet: every part Prima makes, all optional'}
            </div>
          </button>
          {open === r.id && <LayoutEditor report={r} canSet={data.canSet} limits={data.limits} />}
        </div>
      ))}
    </div>
  );
}

function LayoutEditor({ report, canSet, limits }: { report: Settings['reports'][number]; canSet: boolean; limits: Settings['limits'] }) {
  const act = useAction();
  const start = report.layout;
  const [parts, setParts] = useState<{ title: string; use: Use }[]>(() => {
    const got = start?.parts.filter((p) => report.primaParts.includes(p.title)) ?? [];
    return [...got, ...report.primaParts.filter((t) => !got.some((p) => p.title === t)).map((title) => ({ title, use: 'optional' as Use }))];
  });
  const [added, setAdded] = useState(start?.added ?? []);
  const [ownParts, setOwnParts] = useState(start?.ownParts ?? true);
  const [note, setNote] = useState('');
  const USE: Record<Use, string> = { must: 'Must have', optional: 'Optional', off: 'Left out' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="small" style={{ fontWeight: 600 }}>Parts Prima fills from its records</div>
      {parts.map((p, i) => (
        <div key={p.title} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small" style={{ flex: '1 1 200px' }}>
            {i + 1}. {p.title}
          </span>
          <select className="input" aria-label={`Use of ${p.title}`} disabled={!canSet} value={p.use} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, use: e.target.value as Use } : x)))}>
            {(Object.keys(USE) as Use[]).map((u) => (
              <option key={u} value={u}>
                {USE[u]}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="small" style={{ fontWeight: 600 }}>Parts the owner keys in</div>
      {added.length === 0 && <div className="muted small">None added.</div>}
      {added.map((a, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" aria-label={`Added part ${i + 1} name`} placeholder="Part name" maxLength={80} disabled={!canSet} value={a.title} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <input className="input" aria-label={`Added part ${i + 1} what to write`} placeholder="What the owner should write" maxLength={limits.hintMax} disabled={!canSet} value={a.hint} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, hint: e.target.value } : x)))} />
          <label className="small">
            <input type="checkbox" disabled={!canSet} checked={a.must} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, must: e.target.checked } : x)))} /> Must have
          </label>
          {canSet && (
            <button className="btn btn-sm" onClick={() => setAdded(added.filter((_, j) => j !== i))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {canSet && added.length < limits.maxAdded && (
        <div>
          <button className="btn btn-sm" onClick={() => setAdded([...added, { title: '', hint: '', must: true }])}>
            Add a part
          </button>
        </div>
      )}
      <label className="small">
        <input type="checkbox" disabled={!canSet} checked={ownParts} onChange={(e) => setOwnParts(e.target.checked)} /> Owners may add parts of their own
      </label>
      {canSet && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="What changed" placeholder="What changed (needed)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await act.run(() => api.autoReportAct('setLayout', { reportId: report.id, parts, added, ownParts, note }), 'Saved. Unsent reports follow it now, and every report made from now on.')) setNote('');
            }}
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {start && <div className="muted small">Last set by {start.by}: {start.note}</div>}
    </div>
  );
}
