import { useState } from 'react';
import { roomProblems, type ProofInput } from '@prima/core';
import { api, type ClientCodeBoard } from '../api';
import { Chip, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { printHtml } from '../native';

/**
 * Client requirements on the site's client needs page (Fauzan, 6 Nov 2026, after the IKEA IWAY audit): a client's code
 * of conduct checklist kept by the OM or ACT, the hours and break check where that client asks for it, and the site and
 * hostel inspection forms with the client's items. Nothing is shown as met until someone checks it.
 */

type Code = ClientCodeBoard['codes'][number];
type Template = ClientCodeBoard['templates'][number];
const RESULT: Record<'met' | 'not_met' | 'na', { t: string; tone: Tone }> = {
  met: { t: 'Met', tone: 'ok' },
  not_met: { t: 'Not met', tone: 'crit' },
  na: { t: 'Not applicable', tone: 'neutral' },
};
/** RBA readiness grades (Fauzan, 8 Nov 2026): a gap is yellow, orange or red; red goes to ACT, the CoS and the COO today. */
const GRADE: Record<'green' | 'yellow' | 'orange' | 'red', { t: string; tone: Tone }> = {
  green: { t: 'Green', tone: 'ok' },
  yellow: { t: 'Yellow: minor', tone: 'warn' },
  orange: { t: 'Orange: major', tone: 'crit' },
  red: { t: 'Red: escalate today', tone: 'crit' },
};
const FLAG: Record<string, string> = {
  week_hours: 'hours in 7 days',
  days_in_row: 'days in a row',
  planned_week_hours: 'hours rostered next 7 days',
};

export function ClientCodesPanel({ siteId }: { siteId: string }) {
  const board = useLoad(() => api.clientCodeBoard(siteId), [siteId]);
  const [mode, setMode] = useState<{ k: 'none' } | { k: 'new' } | { k: 'edit'; code: Code } | { k: 'inspect'; code: Code; kind: 'site' | 'hostel' }>({ k: 'none' });
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="client requirements" />;
  const b = board.data;
  if (mode.k === 'new' || mode.k === 'edit')
    return <CodeForm siteId={siteId} templates={b.templates} code={mode.k === 'edit' ? mode.code.code : null} onDone={() => setMode({ k: 'none' })} />;
  if (mode.k === 'inspect') return <InspectionForm site={b.site} code={mode.code} kind={mode.kind} onDone={() => setMode({ k: 'none' })} />;
  const active = b.codes.filter((c) => c.code.status === 'active');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Client requirements</h3>
        {b.canKeep && (
          <button className="btn btn-sm" onClick={() => setMode({ k: 'new' })}>
            Add a client code
          </button>
        )}
      </div>
      {active.length === 0 ? (
        <div className="empty">
          This client has no code of conduct on record. Add one only if the client asks for it (for example IKEA IWAY).
          {!b.canKeep && ' The OM who covers this site or ACT adds it.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
          {active.map((c) => (
            <CodeCard key={c.code.id} c={c} canKeep={b.canKeep} canDecideReport={b.canDecideReport} site={b.site} onEdit={() => setMode({ k: 'edit', code: c })} onInspect={(kind) => setMode({ k: 'inspect', code: c, kind })} />
          ))}
        </div>
      )}
      {b.codes.some((c) => c.code.status === 'stopped') && (
        <div className="muted small" style={{ padding: '0 12px 12px' }}>
          Stopped: {b.codes.filter((c) => c.code.status === 'stopped').map((c) => `${c.code.name} (${c.code.stopped?.reason ?? ''})`).join('; ')}
        </div>
      )}
    </section>
  );
}

function CodeCard({ c, canKeep, canDecideReport, site, onEdit, onInspect }: { c: Code; canKeep: boolean; canDecideReport: boolean; site: ClientCodeBoard['site']; onEdit: () => void; onInspect: (kind: 'site' | 'hostel') => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const act = useAction();
  const areas = [...new Set(c.rows.map((r) => r.area))];
  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{c.code.name}</div>
          <div className="muted small">
            Added by {c.code.setBy.name} ({c.code.setBy.desk === 'act' ? 'ACT' : 'Operations'}) · last check {c.lastCheck ? c.lastCheck.slice(0, 10) : 'none yet'}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip tone="ok">{c.counted.met} met</Chip>
          <Chip tone={c.counted.notMet ? 'crit' : 'neutral'}>{c.counted.notMet} not met</Chip>
          <Chip tone={c.counted.unknown ? 'warn' : 'neutral'}>{c.counted.unknown} not checked</Chip>
          {c.counted.noProof > 0 && <Chip tone="warn">{c.counted.noProof} met without proof</Chip>}
          {c.counted.red > 0 && <Chip tone="crit">{c.counted.red} red</Chip>}
          {c.counted.orange > 0 && <Chip tone="crit">{c.counted.orange} orange</Chip>}
          {c.counted.yellow > 0 && <Chip tone="warn">{c.counted.yellow} yellow</Chip>}
        </div>
      </div>
      {c.siteCheck && (
        <div className="small">
          <Chip tone={c.siteCheck.overdue ? 'crit' : 'ok'}>{c.siteCheck.overdue ? 'Site check due' : 'Site check done'}</Chip>{' '}
          Site health and safety check every {c.siteCheck.everyDays} days: last {c.siteCheck.lastOn ?? 'never'}
          {c.siteCheck.dueOn ? `, next by ${c.siteCheck.dueOn}` : ''}. Use Site inspection to record it.
        </div>
      )}
      {canKeep && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={onEdit}>
            Change
          </button>
          {c.code.siteForm.length > 0 && (
            <button className="btn btn-sm" onClick={() => onInspect('site')}>
              Site inspection
            </button>
          )}
          {c.code.hostelForm.length > 0 && (
            <button className="btn btn-sm" onClick={() => onInspect('hostel')}>
              Hostel inspection
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            disabled={act.busy}
            onClick={() => {
              const reason = window.prompt('Why does this client code stop?');
              if (reason) void act.run(() => api.stopClientCode(c.code.id, reason), 'Client code stopped');
            }}
          >
            Stop
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {c.code.status === 'active' && <ClientReportChoice c={c} canDecide={canDecideReport} site={site} />}
      {c.hours && <HoursBlock h={c.hours} rule={c.code.hours!} />}
      {c.inspections.length > 0 && <Inspections c={c} canKeep={canKeep} site={site} />}
      {areas.map((area) => (
        <details key={area}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {area} ({c.rows.filter((r) => r.area === area && r.check?.result === 'met').length}/{c.rows.filter((r) => r.area === area).length} met)
          </summary>
          <div className="list">
            {c.rows
              .filter((r) => r.area === area)
              .map((r) => (
                <div key={r.code} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div className="small">
                      <b>{r.code}</b> {r.text} {r.level === 'must' && <Chip tone="warn">Must</Chip>}
                      <div className="muted small">Proof: {r.hint}</div>
                      {r.check && (
                        <div className="muted small">
                          {r.check.by.name} on {r.check.at.slice(0, 10)}: {r.check.note || '(no note)'}
                          {r.check.proofIds.length ? ` · ${r.check.proofIds.length} proof attached` : ''}
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {r.check ? <Chip tone={RESULT[r.check.result].tone}>{RESULT[r.check.result].t}</Chip> : <Chip tone="warn">Not checked</Chip>}
                      {r.check?.grade && r.check.grade !== 'green' && <Chip tone={GRADE[r.check.grade].tone}>{GRADE[r.check.grade].t}</Chip>}
                      {canKeep && (
                        <button className="btn btn-sm" onClick={() => setOpen(open === r.code ? null : r.code)}>
                          Check
                        </button>
                      )}
                    </div>
                  </div>
                  {open === r.code && <CheckForm codeId={c.code.id} reqCode={r.code} site={site} rba={c.code.template === 'RBA'} onDone={() => setOpen(null)} />}
                </div>
              ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function HoursBlock({ h, rule }: { h: NonNullable<Code['hours']>; rule: NonNullable<Code['code']['hours']> }) {
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <b>Hours and breaks (this client's rule)</b>
      <span className="muted">
        At most {rule.maxWeekHours} hours in any 7 days, {rule.maxDaysInRow} days in a row, a {rule.breakMinutes}-minute break after {rule.breakAfterHours} hours. {h.checked} workers checked from clock-ins and the roster.
      </span>
      {h.flags.length === 0 ? (
        <span>
          <Chip tone="ok">Within the limits</Chip>
        </span>
      ) : (
        h.flags.slice(0, 8).map((f) => (
          <span key={`${f.personId}-${f.kind}`}>
            <Chip tone={f.kind === 'planned_week_hours' ? 'warn' : 'crit'}>
              {f.value} {FLAG[f.kind]}
            </Chip>{' '}
            {f.name} ({f.staffNo}), limit {f.limit}, up to {f.upTo}
          </span>
        ))
      )}
      {h.flags.length > 8 && <span className="muted">and {h.flags.length - 8} more</span>}
      <span>
        <Chip tone={h.breaks.ok === null ? 'warn' : h.breaks.ok ? 'ok' : 'crit'}>{h.breaks.ok === null ? 'Break plan missing' : h.breaks.ok ? 'Break plan meets the rule' : 'Break plan short'}</Chip> {h.breaks.why}
      </span>
      <span className="muted">Breaks are not clocked, so they are checked against the break plan agreed for the site.</span>
    </div>
  );
}

function Inspections({ c, canKeep, site }: { c: Code; canKeep: boolean; site: ClientCodeBoard['site'] }) {
  const [fix, setFix] = useState<{ id: string; index: number } | null>(null);
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <b>Inspections</b>
      {c.inspections.map((i) => (
        <details key={i.id}>
          <summary style={{ cursor: 'pointer' }}>
            {i.ref} · {i.kind === 'site' ? 'Site' : 'Hostel'} · {i.place} · {i.date} by {i.by.name}{' '}
            {i.open ? <Chip tone={i.overdue ? 'crit' : 'warn'}>{i.open} open</Chip> : <Chip tone="ok">All right</Chip>}
          </summary>
          <div className="list">
            {i.lines.map((l, k) => (
              <div key={k} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {l.text}
                    {l.note ? <span className="muted"> · {l.note}</span> : null}
                    {l.fix ? <span className="muted"> · fixed {l.fix.at.slice(0, 10)} by {l.fix.by}: {l.fix.note}</span> : null}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <Chip tone={l.result === 'ok' ? 'ok' : l.result === 'na' ? 'neutral' : l.fix ? 'ok' : 'crit'}>{l.result === 'ok' ? 'OK' : l.result === 'na' ? 'N/A' : l.fix ? 'Fixed' : 'Not right'}</Chip>
                    {canKeep && l.result === 'not_ok' && !l.fix && (
                      <button className="btn btn-sm" onClick={() => setFix({ id: i.id, index: k })}>
                        Record fix
                      </button>
                    )}
                  </span>
                </div>
                {fix && fix.id === i.id && fix.index === k && <FixForm site={site} onSave={(note, proof) => api.fixInspectionLine(i.id, k, { note, proof })} onDone={() => setFix(null)} />}
              </div>
            ))}
            {i.rooms.length > 0 && (
              <div className="list-item muted">
                Rooms: {i.rooms.map((r) => `${r.name} ${r.areaM2} m2, ${r.ceilingM} m, ${r.residents} residents`).join('; ')}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function CheckForm({ codeId, reqCode, site, rba, onDone }: { codeId: string; reqCode: string; site: ClientCodeBoard['site']; rba: boolean; onDone: () => void }) {
  const [result, setResult] = useState<'met' | 'not_met' | 'na'>('met');
  const [grade, setGrade] = useState<'yellow' | 'orange' | 'red' | null>(null);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {(['met', 'not_met', 'na'] as const).map((r) => (
          <button key={r} aria-pressed={result === r} onClick={() => setResult(r)}>
            {RESULT[r].t}
          </button>
        ))}
      </div>
      {result === 'not_met' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label">How serious is the gap{rba ? '' : ' (optional)'}?</span>
          <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {(['yellow', 'orange', 'red'] as const).map((g) => (
              <button key={g} aria-pressed={grade === g} onClick={() => setGrade(grade === g ? null : g)}>
                {GRADE[g].t}
              </button>
            ))}
          </div>
          <span className="muted small">Red is for a possible forced labour, recruitment fee, wage, passport, safety or other serious worker-rights issue. It goes to ACT, the Chief of Staff and the COO today.</span>
        </div>
      )}
      <textarea
        className="textarea"
        value={note}
        maxLength={600}
        onChange={(e) => setNote(e.target.value)}
        placeholder={result === 'met' ? 'Where the proof is, if not attached' : result === 'not_met' ? 'What is not met' : 'Why it does not apply here'}
      />
      <ProofPicker site={site} refText={reqCode} items={proof} onChange={setProof} />
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy}
        onClick={async () => {
          if (await act.run(() => api.checkClientRequirement(codeId, { reqCode, result, note, proof, grade: result === 'not_met' ? grade : null }), 'Check saved')) onDone();
        }}
      >
        Save check
      </button>
    </div>
  );
}

function FixForm({ site, onSave, onDone, documentsOnly }: { site: ClientCodeBoard['site'] | null; onSave: (note: string, proof: ProofInput[]) => Promise<unknown>; onDone: () => void; documentsOnly?: boolean }) {
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea className="textarea" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="What was done" />
      <ProofPicker site={site} refText="Fix" items={proof} onChange={setProof} documentsOnly={documentsOnly} />
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || note.trim().length < 5}
        onClick={async () => {
          if (await act.run(() => onSave(note, proof), 'Fix recorded')) onDone();
        }}
      >
        Save fix
      </button>
    </div>
  );
}
export { FixForm };

const linesOf = (t: string) =>
  t
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);

/** Add or change a client code: start from IKEA IWAY or type the client's own list, then set what this client asks for. */
function CodeForm({ siteId, templates, code, onDone }: { siteId: string; templates: Template[]; code: Code['code'] | null; onDone: () => void }) {
  const [template, setTemplate] = useState<'IWAY' | 'RBA' | 'CUSTOM'>(code?.template ?? 'IWAY');
  const base = templates.find((t) => t.template === template)!;
  const src = code ?? base;
  const [name, setName] = useState(src.name);
  const [reqs, setReqs] = useState('');
  const [useHours, setUseHours] = useState(!!src.hours);
  const [hours, setHours] = useState(src.hours ?? { maxWeekHours: 60, maxDaysInRow: 6, breakAfterHours: 4.5, breakMinutes: 30 });
  const [breaks, setBreaks] = useState(code?.breakPlan ?? { count: 2, minutes: 30 });
  const [useBreakPlan, setUseBreakPlan] = useState(!!code?.breakPlan);
  const [useRooms, setUseRooms] = useState(!!src.rooms);
  const [rooms, setRooms] = useState(src.rooms ?? { m2PerPerson: 3.8, minCeilingM: 2.1, maxPerRoom: 8 });
  const [siteForm, setSiteForm] = useState(src.siteForm.join('\n'));
  const [hostelForm, setHostelForm] = useState(src.hostelForm.join('\n'));
  const [note, setNote] = useState('');
  const [checkEvery, setCheckEvery] = useState<number | null>(src.siteInspectEveryDays ?? null);
  const act = useAction();
  const pick = (t: 'IWAY' | 'RBA' | 'CUSTOM') => {
    const b = templates.find((x) => x.template === t)!;
    setTemplate(t);
    setCheckEvery(b.siteInspectEveryDays ?? null);
    setName(b.name);
    setUseHours(!!b.hours);
    setUseRooms(!!b.rooms);
    setSiteForm(b.siteForm.join('\n'));
    setHostelForm(b.hostelForm.join('\n'));
  };
  const typedReqs = linesOf(reqs).map((l, i) => {
    const m = /^([A-Za-z0-9.-]{1,12})\s+(.+)$/.exec(l);
    return m ? { code: m[1], text: m[2] } : { code: `R${i + 1}`, text: l };
  });
  const num = (v: string) => Number(v);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{code ? `Change ${code.name}` : 'Add a client code'}</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!code && (
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            {templates.map((t) => (
              <button key={t.template} aria-pressed={template === t.template} onClick={() => pick(t.template)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span className="label">Name</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client X supplier code" />
        </label>
        {template === 'CUSTOM' && !code ? (
          <label className="field">
            <span className="label">The client's requirements, one a line (start with its number if it has one)</span>
            <textarea className="textarea" rows={6} value={reqs} onChange={(e) => setReqs(e.target.value)} placeholder={'C1 Guards are vetted every year\nC2 Daily report by 9 am'} />
          </label>
        ) : (
          <span className="muted small">{(code ?? base).requirements.length} requirements from the {code ? 'current list' : `${base.label} list`}. Each starts as not checked.</span>
        )}
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={useHours} onChange={(e) => setUseHours(e.target.checked)} /> This client limits working hours and breaks
        </label>
        {useHours && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field">
              <span className="label">Hours in 7 days</span>
              <input className="input" type="number" value={hours.maxWeekHours} onChange={(e) => setHours({ ...hours, maxWeekHours: num(e.target.value) })} />
            </label>
            <label className="field">
              <span className="label">Days in a row</span>
              <input className="input" type="number" value={hours.maxDaysInRow} onChange={(e) => setHours({ ...hours, maxDaysInRow: num(e.target.value) })} />
            </label>
            <label className="field">
              <span className="label">Break after (hours)</span>
              <input className="input" type="number" step="0.5" value={hours.breakAfterHours} onChange={(e) => setHours({ ...hours, breakAfterHours: num(e.target.value) })} />
            </label>
            <label className="field">
              <span className="label">Break at least (minutes)</span>
              <input className="input" type="number" value={hours.breakMinutes} onChange={(e) => setHours({ ...hours, breakMinutes: num(e.target.value) })} />
            </label>
          </div>
        )}
        {useHours && (
          <>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={useBreakPlan} onChange={(e) => setUseBreakPlan(e.target.checked)} /> Break plan agreed for this site
            </label>
            {useBreakPlan && (
              <div className="row" style={{ gap: 8 }}>
                <label className="field">
                  <span className="label">Breaks in a shift</span>
                  <input className="input" type="number" value={breaks.count} onChange={(e) => setBreaks({ ...breaks, count: num(e.target.value) })} />
                </label>
                <label className="field">
                  <span className="label">Minutes each</span>
                  <input className="input" type="number" value={breaks.minutes} onChange={(e) => setBreaks({ ...breaks, minutes: num(e.target.value) })} />
                </label>
              </div>
            )}
          </>
        )}
        <label className="field">
          <span className="label">Site inspection items, one a line (leave empty if the client has no site form)</span>
          <textarea className="textarea" rows={5} value={siteForm} onChange={(e) => setSiteForm(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Hostel inspection items, one a line (leave empty if not needed)</span>
          <textarea className="textarea" rows={5} value={hostelForm} onChange={(e) => setHostelForm(e.target.value)} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={checkEvery != null} onChange={(e) => setCheckEvery(e.target.checked ? 30 : null)} /> The OM does the site inspection on a repeating schedule
        </label>
        {checkEvery != null && (
          <label className="field">
            <span className="label">Every how many days (RBA: 30, the monthly site health and safety check)</span>
            <input className="input" type="number" min={7} max={92} value={checkEvery} onChange={(e) => setCheckEvery(num(e.target.value))} />
          </label>
        )}
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={useRooms} onChange={(e) => setUseRooms(e.target.checked)} /> This client sets room space in hostels
        </label>
        {useRooms && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field">
              <span className="label">m2 a person</span>
              <input className="input" type="number" step="0.1" value={rooms.m2PerPerson} onChange={(e) => setRooms({ ...rooms, m2PerPerson: num(e.target.value) })} />
            </label>
            <label className="field">
              <span className="label">Ceiling at least (m)</span>
              <input className="input" type="number" step="0.1" value={rooms.minCeilingM} onChange={(e) => setRooms({ ...rooms, minCeilingM: num(e.target.value) })} />
            </label>
            <label className="field">
              <span className="label">Most in a room</span>
              <input className="input" type="number" value={rooms.maxPerRoom} onChange={(e) => setRooms({ ...rooms, maxPerRoom: num(e.target.value) })} />
            </label>
          </div>
        )}
        {code && (
          <label className="field">
            <span className="label">What changed and why</span>
            <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client sent a new version" />
          </label>
        )}
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const input = {
              codeId: code?.id ?? null,
              template,
              name,
              requirements: code ? code.requirements : template === 'CUSTOM' ? typedReqs : undefined,
              hours: useHours ? hours : null,
              breakPlan: useHours && useBreakPlan ? breaks : null,
              rooms: useRooms ? rooms : null,
              siteForm: linesOf(siteForm),
              hostelForm: linesOf(hostelForm),
              siteInspectEveryDays: checkEvery,
              note,
            };
            if (await act.run(() => api.saveClientCode(siteId, input), code ? 'Client code changed' : 'Client code added')) onDone();
          }}
        >
          {code ? 'Save changes' : 'Add client code'}
        </button>
      </div>
    </section>
  );
}

/** A site or hostel inspection: every item on the client's form answered, rooms measured where the client sets space. */
function InspectionForm({ site, code, kind, onDone }: { site: ClientCodeBoard['site']; code: Code; kind: 'site' | 'hostel'; onDone: () => void }) {
  const form = kind === 'site' ? code.code.siteForm : code.code.hostelForm;
  const [place, setPlace] = useState('');
  const [lines, setLines] = useState(form.map((text) => ({ text, result: 'ok' as 'ok' | 'not_ok' | 'na', note: '' })));
  const [rooms, setRooms] = useState<{ name: string; areaM2: number; ceilingM: number; residents: number }[]>(kind === 'hostel' && code.code.rooms ? [{ name: 'Room 1', areaM2: 0, ceilingM: 0, residents: 0 }] : []);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {kind === 'site' ? 'Site' : 'Hostel'} inspection: {code.code.name}
        </h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {kind === 'hostel' && (
          <label className="field">
            <span className="label">Which hostel (name or address)</span>
            <input className="input" value={place} maxLength={160} onChange={(e) => setPlace(e.target.value)} />
          </label>
        )}
        {lines.map((l, i) => (
          <div key={l.text} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small">{l.text}</span>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {(['ok', 'not_ok', 'na'] as const).map((r) => (
                <button key={r} aria-pressed={l.result === r} onClick={() => setLines(lines.map((x, k) => (k === i ? { ...x, result: r } : x)))}>
                  {r === 'ok' ? 'OK' : r === 'not_ok' ? 'Not right' : 'N/A'}
                </button>
              ))}
            </div>
            {l.result === 'not_ok' && <input className="input" value={l.note} maxLength={400} placeholder="What is wrong" onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />}
          </div>
        ))}
        {code.code.rooms && kind === 'hostel' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b className="small">
              Rooms (client rule: {code.code.rooms.m2PerPerson} m2 a person, ceiling {code.code.rooms.minCeilingM} m, at most {code.code.rooms.maxPerRoom} a room)
            </b>
            <div className="row muted small" style={{ gap: 6 }}>
              <span style={{ width: 110 }}>Room</span>
              <span style={{ width: 90 }}>Floor m2</span>
              <span style={{ width: 90 }}>Ceiling m</span>
              <span style={{ width: 90 }}>Residents</span>
            </div>
            {rooms.map((r, i) => (
              <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input className="input" style={{ width: 110 }} value={r.name} aria-label="Room name" onChange={(e) => setRooms(rooms.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input" style={{ width: 90 }} type="number" step="0.1" aria-label="Floor area m2" placeholder="m2" value={r.areaM2 || ''} onChange={(e) => setRooms(rooms.map((x, k) => (k === i ? { ...x, areaM2: Number(e.target.value) } : x)))} />
                <input className="input" style={{ width: 90 }} type="number" step="0.1" aria-label="Ceiling m" placeholder="ceiling m" value={r.ceilingM || ''} onChange={(e) => setRooms(rooms.map((x, k) => (k === i ? { ...x, ceilingM: Number(e.target.value) } : x)))} />
                <input className="input" style={{ width: 90 }} type="number" aria-label="Residents" placeholder="residents" value={r.residents || ''} onChange={(e) => setRooms(rooms.map((x, k) => (k === i ? { ...x, residents: Number(e.target.value) } : x)))} />
              </div>
            ))}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRooms([...rooms, { name: `Room ${rooms.length + 1}`, areaM2: 0, ceilingM: 0, residents: 0 }])}>
              Add a room
            </button>
            {roomProblems(code.code.rooms, rooms.filter((r) => r.areaM2 > 0 && r.ceilingM > 0)).map((p) => (
              <span key={p.name} className="small">
                <Chip tone="crit">Below the client rule</Chip> {p.name}: {p.why}. It is saved as an item not right, so attach a photo.
              </span>
            ))}
          </div>
        )}
        <ProofPicker site={site} refText={kind === 'site' ? 'Site' : 'Hostel'} items={proof} onChange={setProof} required={lines.some((l) => l.result === 'not_ok')} />
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy}
          onClick={async () => {
            if (await act.run(() => api.saveClientInspection(code.code.id, { kind, place, lines, rooms, proof }), 'Inspection saved')) onDone();
          }}
        >
          Save inspection
        </button>
      </div>
    </section>
  );
}

/**
 * Whether this client gets a report of the results (Fauzan, 8 Nov 2026): the Operations Director decides for private
 * sites and the OGM for government sites. Prima prints the report; sending it stays with the person who sends it.
 */
function ClientReportChoice({ c, canDecide, site }: { c: Code; canDecide: boolean; site: ClientCodeBoard['site'] }) {
  const r = c.code.clientReport ?? null;
  const [editing, setEditing] = useState(false);
  const [send, setSend] = useState(r?.send ?? true);
  const [how, setHow] = useState(r?.how ?? 'Monthly, with the client report');
  const [reason, setReason] = useState('');
  const act = useAction();
  const printReport = () => {
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
    const notMet = c.rows.filter((x) => x.check?.result === 'not_met');
    const insp = c.inspections.slice(0, 3);
    void printHtml(`${c.code.name} report`, `<!doctype html><meta charset="utf-8"><title>${esc(c.code.name)} report</title><body style="font-family:sans-serif;max-width:760px;margin:24px auto;line-height:1.45">
<h2>${esc(c.code.name)}: ${esc(site.code)} ${esc(site.name)}</h2>
<p>Prepared ${new Date().toISOString().slice(0, 10)} from Prima. Last check ${esc(c.lastCheck ? c.lastCheck.slice(0, 10) : 'none yet')}.</p>
<p><b>${c.counted.met}</b> met, <b>${c.counted.notMet}</b> not met, <b>${c.counted.na}</b> not applicable, <b>${c.counted.unknown}</b> not checked yet.</p>
${notMet.length ? `<h3>Being fixed</h3><ul>${notMet.map((x) => `<li>${esc(x.code)} ${esc(x.text)}: ${esc(x.check?.note ?? '')}</li>`).join('')}</ul>` : ''}
${insp.length ? `<h3>Latest inspections</h3><ul>${insp.map((i) => `<li>${esc(i.kind === 'hostel' ? 'Hostel' : 'Site')} ${esc(i.date)}: ${i.open ? `${i.open} to fix` : 'nothing open'}</li>`).join('')}</ul>` : ''}
</body>`);
  };
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="label">Report to the client</span>
        {r ? <Chip tone={r.send ? 'info' : 'neutral'}>{r.send ? `Sent: ${r.how}` : 'Kept inside'}</Chip> : <Chip tone="neutral">Not decided: nothing goes to the client</Chip>}
        {r && <span className="muted">{r.by}, {r.at.slice(0, 10)}: {r.reason}</span>}
        {r?.send && (
          <button className="btn btn-sm btn-ghost" onClick={printReport}>
            Print client report
          </button>
        )}
        {canDecide && !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            {r ? 'Change' : 'Decide'}
          </button>
        )}
      </div>
      {!canDecide && !r && <span className="muted">The Operations Director (private sites) or the OGM (government sites) decides.</span>}
      {canDecide && editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button aria-pressed={send} onClick={() => setSend(true)}>
              Send to the client
            </button>
            <button aria-pressed={!send} onClick={() => setSend(false)}>
              Keep inside
            </button>
          </div>
          {send && <input className="input" value={how} maxLength={120} placeholder="How often or with what" onChange={(e) => setHow(e.target.value)} />}
          <input className="input" value={reason} maxLength={300} placeholder="Reason" onChange={(e) => setReason(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || reason.trim().length < 5 || (send && how.trim().length < 3)}
              onClick={async () => {
                if (await act.run(() => api.setClientReport(c.code.id, { send, how: send ? how : '', reason }), 'Client report choice saved')) setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
