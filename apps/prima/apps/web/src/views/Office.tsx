import { useState } from 'react';
import type { HomeLink, OfficeGuideRole } from '@prima/core';
import { OFFICE_GUIDE_VERSION, officeGuideFor } from '@prima/core';
import { useLang } from '../i18n';
import { api, type CompanyOffice, type CompanyOffices } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, useAction, useLoad, type Tone } from '../ui';

/**
 * Each licensed company's own office (Fauzan, 2 Nov 2026: 1 Company Manager or GM and 2 to 8 executives). The head
 * shares the company's work out to desks, each with an owner and a backup; executives see the team and the work on their
 * desks; group leaders see every office's staffing. The people come from the accounts HR and IT already keep.
 */
export function OfficeView() {
  const { me, companyId } = useApp();
  const companyScoped = me.user.role === 'company_manager' || me.user.role === 'admin_exec';
  const [pick, setPick] = useState<string | null>(null);
  if (companyScoped) return <OneOffice companyId={companyId} />;
  if (pick) return <OneOffice companyId={pick} back={() => setPick(null)} />;
  return <AllOffices open={setPick} />;
}

const DESK_STATE: Record<CompanyOffice['desks'][number]['state'], [Tone, string]> = {
  ok: ['ok', 'Owner on duty'],
  cover: ['info', 'Backup covering'],
  head: ['warn', 'With the head'],
  unassigned: ['warn', 'Not shared out'],
};

/** The KDN licence as already recorded under Licences: a fact shown beside the company, never a block. */
const KDN_LABEL: Record<CompanyOffice['kdnLicence'], [Tone, string]> = {
  held: ['ok', 'KDN licence held'],
  expired: ['warn', 'KDN licence expired'],
  unknown: ['neutral', 'KDN licence not recorded'],
};

function AllOffices({ open }: { open: (id: string) => void }) {
  const { me, setCompanyId, go } = useApp();
  // Fauzan, 3 Nov 2026: "cos will set" (the CEO keeps the right as owner); the server checks again.
  const canSetRunBy = (me.user.role === 'pwvsb_officer' && me.user.leadership === 'cos') || (me.user.role === 'director' && me.user.opsTier === 'ceo');
  const { data, error } = useLoad(() => api.companyOffices(), []);
  const [desk, setDesk] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="company offices" />;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Company offices</h1>
          <p className="muted">
            {data.rule.source}. All offices in one place: staffing, desk cover and every company's open work. Each company still acts on its own work; totals
            are a management view, not combined company records.
          </p>
        </div>
      </div>
      <OfficeGuide role="monitor" />
      <div className="kpis">
        <Kpi label="Companies" value={data.totals.companies} />
        <Kpi label="Office ready" value={data.totals.ready} tone="ok" />
        <Kpi label="Short of people" value={data.totals.short} tone={data.totals.short ? 'crit' : 'ok'} />
        <Kpi label="Not entered yet" value={data.totals.notEntered} tone="neutral" note="Shown as Unknown" />
        <Kpi label="Executives in all" value={data.totals.execs} />
        <Kpi label="Open office work" value={data.totals.open} tone={data.totals.urgent ? 'crit' : 'ok'} note={`${data.totals.urgent} urgent`} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>All office work, by desk</h2>
          {desk && (
            <button className="btn btn-sm" onClick={() => setDesk(null)}>
              Show all desks
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {data.byDesk.map((d) => (
            <button key={d.desk} className="btn btn-sm" aria-pressed={desk === d.desk} onClick={() => setDesk(desk === d.desk ? null : d.desk)}>
              {d.label}: {d.open}
              {d.urgent ? ` (${d.urgent} urgent)` : ''}
            </button>
          ))}
        </div>
        <div className="list">
          {data.work.filter((w) => !desk || w.desk === desk).length === 0 && <div className="empty">Nothing waiting.</div>}
          {data.work
            .filter((w) => !desk || w.desk === desk)
            .slice(0, 80)
            .map((w, i) => (
              <button
                key={i}
                className="list-item"
                onClick={() => {
                  setCompanyId(w.companyId);
                  go({
                    view: w.go.view,
                    siteId: w.go.siteId,
                    personId: w.go.personId,
                    caseId: w.go.caseId,
                    tenderId: w.go.tenderId,
                  });
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{w.title}</div>
                  <div className="muted small">
                    {w.companyName} · {w.deskLabel}
                    {w.actingName ? ` · ${w.actingName}` : ''} · {w.detail}
                  </div>
                </div>
                <Chip tone={w.tone}>{w.tag}</Chip>
              </button>
            ))}
        </div>
      </section>
      <section className="panel">
        <div className="list">
          {data.rows.map((r) => (
            <button key={r.company.id} className="list-item" onClick={() => open(r.company.id)}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.company.name} {r.company.isPilot && <span className="muted small">(pilot)</span>}
                </div>
                <div className="muted small">
                  {r.heads.length ? r.heads.map((h) => `${h.name}, ${h.job}`).join('; ') : 'No head entered'} · {r.execCount} executive
                  {r.execCount === 1 ? '' : 's'} · {r.open} open
                  {r.urgent ? ` (${r.urgent} urgent)` : ''}
                  {r.unassigned !== null && ` · ${r.desksAssigned} of ${r.desksTotal} desks shared out`}
                </div>
                {(r.runBy || r.runs.length > 0) && (
                  <div className="small">
                    {r.runBy && `Run by the ${r.runBy.name} office`}
                    {r.runs.length > 0 && `Also runs: ${r.runs.map((x) => x.name).join(', ')}`}
                  </div>
                )}
                <div className="muted small">{KDN_LABEL[r.kdnLicence][1]}</div>
                {r.findings.length > 0 && <div className="small">{r.findings.map((f) => f.message).join(' ')}</div>}
              </div>
              <Chip tone={r.tone}>{r.tone === 'ok' ? 'Ready' : r.tone === 'neutral' ? 'Unknown' : r.tone === 'crit' ? 'Short' : 'Check'}</Chip>
            </button>
          ))}
        </div>
      </section>
      {canSetRunBy && <RunByForm rows={data.rows} />}
    </div>
  );
}

/**
 * Chief of Staff (Fauzan, 3 Nov 2026: "cos will set") and the CEO: a company without a licence, or without enough work of its own, can be run by another
 * company's office. Its head then manages and monitors it and can give its desks to their own executives. One level only;
 * a reason is required and every change is audited. The server checks all of this again.
 */
function RunByForm({ rows }: { rows: CompanyOffices['rows'] }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState('');
  const [runBy, setRunBy] = useState('');
  const [reason, setReason] = useState('');
  const target = rows.find((r) => r.company.id === companyId);
  // Only a company that runs its own office can run another; a company that runs others cannot itself be run.
  const parents = rows.filter((r) => r.company.id !== companyId && !r.runBy);
  const save = async () => {
    const r = await act.run(
      () => api.setCompanyRunBy(companyId, runBy || null, reason),
      runBy ? 'Saved: the office now runs this company' : 'Saved: the company runs its own office',
    );
    if (r !== undefined) {
      setReason('');
      setCompanyId('');
      setRunBy('');
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Companies run by another office</h2>
      </div>
      <p className="muted small">
        For a company without a licence, or without enough work of its own. The running office's Company Manager or GM heads it and can give its desks to their
        own executives. One level only. Give the reason, for example the board decision.
      </p>
      <div className="form">
        <label>
          Company
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setRunBy(rows.find((r) => r.company.id === e.target.value)?.runBy?.id ?? '');
            }}
          >
            <option value="">Choose a company</option>
            {rows
              .filter((r) => r.runs.length === 0)
              .map((r) => (
                <option key={r.company.id} value={r.company.id}>
                  {r.company.name}
                </option>
              ))}
          </select>
        </label>
        {target && (
          <label>
            Run by
            <select value={runBy} onChange={(e) => setRunBy(e.target.value)}>
              <option value="">Its own office</option>
              {parents.map((r) => (
                <option key={r.company.id} value={r.company.id}>
                  The {r.company.name} office
                </option>
              ))}
            </select>
          </label>
        )}
        {target && (
          <label>
            Reason
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: board decision of the parent company" />
          </label>
        )}
        {act.error && (
          <div className="notice" data-tone="crit">
            {act.error.message}
          </div>
        )}
        {target && (
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn btn-sm" disabled={act.busy || !reason.trim()} onClick={save}>
              Save
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function OneOffice({ companyId, back }: { companyId: string; back?: () => void }) {
  const { setCompanyId, go } = useApp();
  const { data, error } = useLoad(() => api.companyOffice(companyId), [companyId]);
  const [editing, setEditing] = useState(false);
  const [onlyMine, setOnlyMine] = useState(true);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the company office" />;
  const openLink = (l: HomeLink) => {
    if (l.companyId) setCompanyId(l.companyId);
    go({
      view: l.view,
      siteId: l.siteId,
      personId: l.personId,
      caseId: l.caseId,
      tenderId: l.tenderId,
    });
  };
  const mine = data.queue.filter((q) => q.mine);
  const shown = data.role === 'exec' && onlyMine ? mine : data.queue;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          {back && (
            <button className="btn btn-sm" onClick={back} style={{ marginBottom: 8 }}>
              All offices
            </button>
          )}
          <h1>{data.company.name} office</h1>
          <p className="muted">
            {data.rule.source}. {data.role === 'head' ? 'You share' : 'The Company Manager or GM shares'} the work out by desk. Each desk has an owner and a
            backup, so the work moves to the backup when the owner is on leave.
          </p>
        </div>
      </div>
      <OfficeGuide role={data.role} />
      {data.runBy && (
        <div className="notice">
          Run by the {data.runBy.name} office: its {data.role === 'head' ? 'head (you)' : 'Company Manager or GM'} leads this office, and its executives can
          hold desks here. {KDN_LABEL[data.kdnLicence][1]}.
        </div>
      )}
      {data.runs.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Companies your office also runs</h2>
          </div>
          <div className="list">
            {data.runs.map((r) => (
              <button
                key={r.id}
                className="list-item"
                onClick={() => {
                  setCompanyId(r.id);
                  if (back) back();
                  go({ view: 'office' });
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="muted small">Open its office to share out its desks and see its work.</div>
                </div>
                <Chip tone={KDN_LABEL[r.kdnLicence][0]}>{KDN_LABEL[r.kdnLicence][1]}</Chip>
              </button>
            ))}
          </div>
        </section>
      )}
      {!data.ready && (
        <div className="notice">The company office is not switched on in this database yet. Desks cannot be saved until its module is applied.</div>
      )}
      {data.findings.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>To fix</h2>
            <Chip tone={data.tone}>{data.findings.length}</Chip>
          </div>
          <div className="list">
            {data.findings.map((f, i) => (
              <div key={i} className="list-item">
                <div>{f.message}</div>
                <Chip tone={f.tone}>{f.rule}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="kpis">
        <Kpi
          label="Executives"
          value={data.execCount}
          tone={data.execCount < data.rule.minExecs || data.execCount > data.rule.maxExecs ? 'crit' : 'ok'}
          note={`${data.rule.minExecs} to ${data.rule.maxExecs}`}
        />
        <Kpi
          label={data.role === 'exec' ? 'On your desks' : 'Office work open'}
          value={data.role === 'exec' ? mine.length : data.queue.length}
          tone={(data.role === 'exec' ? mine : data.queue).some((q) => q.tone === 'crit') ? 'crit' : 'ok'}
        />
        <Kpi label="Desks shared out" value={data.desks.filter((d) => d.state !== 'unassigned').length} note={`of ${data.desks.length}`} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Team</h2>
        </div>
        <div className="list">
          {data.team.length === 0 && <div className="empty">No office people entered yet. HR adds them when they join.</div>}
          {data.team.map((t) => (
            <div key={t.userId} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {t.name} <span className="muted small">{t.job}</span>
                  {t.from && <span className="muted small"> · from the {t.from} office</span>}
                </div>
                <div className="muted small">
                  {t.desks.length ? `Owns: ${t.desks.join(', ')}` : t.job === 'Executive' ? 'No desk yet' : 'Approvals, arms and anything not shared out'}
                  {t.backupFor.length > 0 && ` · Backup for: ${t.backupFor.join(', ')}`}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {t.onLeave && <Chip tone="info">On leave today</Chip>}
                <Chip tone={t.open ? 'warn' : 'ok'}>{t.open} open</Chip>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Desks</h2>
          {data.canAssign && !editing && (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              Share out desks
            </button>
          )}
        </div>
        {editing ? (
          <DeskForm office={data} onDone={() => setEditing(false)} />
        ) : (
          <div className="list">
            {data.desks.map((d) => (
              <div key={d.desk} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div className="muted small">{d.covers}</div>
                  <div className="small">
                    Owner: {d.ownerName ?? 'none'} · Backup: {d.backupName ?? 'none'}
                    {d.actingName && d.state !== 'ok' && ` · Today: ${d.actingName}`}
                  </div>
                  {d.note && <div className="muted small">{d.note}</div>}
                </div>
                <Chip tone={DESK_STATE[d.state][0]}>{DESK_STATE[d.state][1]}</Chip>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>{data.role === 'exec' ? 'Work' : 'Office work by desk'}</h2>
          {data.role === 'exec' && (
            <button className="btn btn-sm" onClick={() => setOnlyMine(!onlyMine)}>
              {onlyMine ? 'Show the whole office' : 'Show only mine'}
            </button>
          )}
        </div>
        <div className="list">
          {shown.length === 0 && <div className="empty">Nothing waiting.</div>}
          {shown.slice(0, 60).map((q, i) => (
            <button key={i} className="list-item" onClick={() => openLink(q.go)}>
              <div>
                <div style={{ fontWeight: 600 }}>{q.title}</div>
                <div className="muted small">
                  {q.detail} · {q.deskLabel}
                  {q.actingName ? ` · ${q.mine ? 'you' : q.actingName}` : ''}
                </div>
              </div>
              <Chip tone={q.tone}>{q.tag}</Chip>
            </button>
          ))}
          {shown.length > 60 && <div className="muted small">and {shown.length - 60} more</div>}
        </div>
      </section>
    </div>
  );
}

function DeskForm({ office, onDone }: { office: CompanyOffice; onDone: () => void }) {
  const act = useAction();
  const start = Object.fromEntries(
    office.desks.map((d) => {
      const s = office.suggested?.[d.desk as keyof NonNullable<CompanyOffice['suggested']>];
      return [
        d.desk,
        {
          // A desk the head cleared on purpose stays clear; the suggestion fills only desks never shared out.
          owner: d.setAt ? (d.ownerUserId ?? '') : (d.ownerUserId ?? s?.ownerUserId ?? ''),
          backup: d.setAt ? (d.backupUserId ?? '') : (d.backupUserId ?? s?.backupUserId ?? ''),
        },
      ];
    }),
  ) as Record<string, { owner: string; backup: string }>;
  const [rows, setRows] = useState(start);
  const [note, setNote] = useState('');
  const people = office.team;
  const set = (desk: string, k: 'owner' | 'backup', v: string) => setRows({ ...rows, [desk]: { ...rows[desk], [k]: v } });
  const save = async () => {
    // Every desk is sent: "Not shared out" clears it on the server, so what is saved is what the form shows.
    const desks = office.desks.map((d) => ({
      desk: d.desk,
      ownerUserId: rows[d.desk].owner || null,
      backupUserId: rows[d.desk].owner ? rows[d.desk].backup || null : null,
    }));
    const r = await act.run(
      () => api.setOfficeDesks(office.company.id, desks, note),
      (x) => ((x as { changed: number }).changed ? `${(x as { changed: number }).changed} desk(s) saved` : 'No changes to save'),
    );
    if (r !== undefined) onDone();
  };
  return (
    <div className="form">
      {office.suggested && (
        <p className="muted small">
          Filled with a fair first split: desks go round the executives, and each backup is the next person along. Change anything before saving.
        </p>
      )}
      {office.desks.map((d) => (
        <div
          key={d.desk}
          className="row"
          style={{
            gap: 8,
            alignItems: 'end',
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <div style={{ minWidth: 200, flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{d.label}</div>
            <div className="muted small">{d.covers}</div>
          </div>
          <label>
            Owner
            <select value={rows[d.desk].owner} onChange={(e) => set(d.desk, 'owner', e.target.value)}>
              <option value="">Not shared out</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name} ({p.job})
                </option>
              ))}
            </select>
          </label>
          <label>
            Backup
            <select value={rows[d.desk].backup} onChange={(e) => set(d.desk, 'backup', e.target.value)}>
              <option value="">None</option>
              {people
                .filter((p) => p.userId !== rows[d.desk].owner)
                .map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name} ({p.job})
                  </option>
                ))}
            </select>
          </label>
        </div>
      ))}
      <label>
        Note (optional)
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: new executive joined" />
      </label>
      {act.error && (
        <div className="notice" data-tone="crit">
          {act.error.message}
        </div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn btn-sm" disabled={act.busy} onClick={save}>
          Save desks
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * In-app guide cards (Arisha main review, section A; shared guide-card shape of PR #56): read-only help for each office
 * task, scoped to the viewer's office role. Bahasa Melayu first, with English. It explains; it never saves or approves.
 */
function OfficeGuide({ role }: { role: OfficeGuideRole | null }) {
  const { lang } = useLang();
  const [openId, setOpenId] = useState<string | null>(null);
  const cards = officeGuideFor(role);
  if (!cards.length) return null;
  const en = lang === 'en';
  const T = ({ v }: { v: { bm: string; en: string } }) =>
    en ? (
      <>{v.en}</>
    ) : lang === 'ms' ? (
      <>{v.bm}</>
    ) : (
      <>
        {v.bm} <span className="muted small">({v.en})</span>
      </>
    );
  const L = (bm: string, english: string) => (en ? english : bm);
  return (
    <section className="panel" aria-label="Office guide">
      <div className="panel-head">
        <h2>{L('Panduan kerja', 'How to do it')}</h2>
        <span className="muted small">{OFFICE_GUIDE_VERSION}</span>
      </div>
      <p className="muted small">
        {L(
          'Panduan sahaja. Ia tidak menyimpan, melulus atau mengubah apa-apa; gunakan skrin yang dinamakan pada setiap kad.',
          'Help only. It does not save, approve or change anything; you use the screen named on each card.',
        )}
      </p>
      <div className="list">
        {cards.map((c) => (
          <div key={c.id} className="list-item" style={{ display: 'block' }}>
            <button className="link-button" aria-expanded={openId === c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              <T v={c.title} />
            </button>
            {openId === c.id && (
              <div className="small" style={{ marginTop: 6 }}>
                <p>
                  <T v={c.purpose} />
                </p>
                <p>
                  <strong>{L('Siapa', 'Who')}:</strong> <T v={c.who} />
                </p>
                <p>
                  <strong>{L('Di mana', 'Where')}:</strong> {c.screen.name} → <T v={c.screen.action} />
                </p>
                {c.fields && c.fields.length > 0 && (
                  <ul>
                    {c.fields.map((f) => (
                      <li key={f.key}>
                        <strong>{f.label}</strong> {f.required ? L('(wajib)', '(needed)') : L('(pilihan)', '(optional)')}: <T v={f.format} />{' '}
                        <span className="muted">
                          {L('Contoh (rekaan)', 'Example (made up)')}: {f.example}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.sources.map((s, i) => (
                  <p key={i}>
                    <strong>{L('Di mana rekod', 'Where the record is')}:</strong> <T v={s.what} />{' '}
                    <span className="muted">
                      {L('Tanya', 'Ask')}: {s.askDesk ? (OFFICE_ASK_LABEL[s.askDesk] ?? s.askDesk) : s.askName}
                    </span>
                  </p>
                ))}
                <p>
                  <strong>{L('Dimasukkan sekali, diguna semula', 'Entered once, reused')}:</strong> <T v={c.enteredOnce} />
                </p>
                <p>
                  <strong>{L('Simpan', 'Save')}:</strong> <T v={c.steps.save} />
                </p>
                <p>
                  <strong>{L('Semakan', 'Review')}:</strong> <T v={c.steps.review} />
                </p>
                <p>
                  <strong>{L('Jika dipulangkan', 'If returned')}:</strong> <T v={c.steps.returned} />
                </p>
                <p>
                  <strong>{L('Selesai bila', 'Done when')}:</strong> <T v={c.steps.done} />
                </p>
                <p>
                  <strong>{L('Jika ada ralat', 'If something goes wrong')}:</strong> <T v={c.steps.recover} />
                </p>
                {c.notVerified.length > 0 && (
                  <div className="notice" data-tone="unknown">
                    <strong>{L('Belum dibina atau belum disahkan', 'Not built or not verified yet')}:</strong>
                    <ul>
                      {c.notVerified.map((n, i) => (
                        <li key={i}>
                          <T v={n} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Desk names as the hand-over map (PR #56, ORG_DESK_LABEL) shows them. */
const OFFICE_ASK_LABEL: Record<string, string> = {
  company_office: 'Company office (manager and admin executives)',
  director_office: 'Director Office',
};
