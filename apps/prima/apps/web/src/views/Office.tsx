import { useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, BriefcaseIcon, BuildingsIcon, CheckCircleIcon, QuestionIcon, TrayIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import type { HomeLink, OfficeGuideRole } from '@prima/core';
import { OFFICE_GUIDE_VERSION, officeGuideFor } from '@prima/core';
import { useLang } from '../i18n';
import { api, type CompanyOffice, type CompanyOffices } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Person, Stat, Stats } from '../kit';
import '../styles/leadership.css';

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

/** Work lists open folded to this many lines; the rest one click away. */
const FOLD = 12;

function AllOffices({ open }: { open: (id: string) => void }) {
  const { me, setCompanyId, go } = useApp();
  // Fauzan, 3 Nov 2026: "cos will set" (the CEO keeps the right as owner); the server checks again.
  const canSetRunBy = (me.user.role === 'pwvsb_officer' && me.user.leadership === 'cos') || (me.user.role === 'director' && me.user.opsTier === 'ceo');
  const { data, error } = useLoad(() => api.companyOffices(), []);
  const [desk, setDesk] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [allOffices, setAllOffices] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="company offices" />
      </div>
    );
  const work = data.work.filter((w) => !desk || w.desk === desk).slice(0, 80);
  const shownWork = all ? work : work.slice(0, FOLD);
  return (
    <div className="page ld">
      <PageHead
        title="Company offices"
        sub={
          <>
            {officeRule(data.rule)} All offices in one place: staffing, desk cover and every company's open work. Each company still acts on its own work; totals
            are a management view, not combined company records.
          </>
        }
      />
      <Stats>
        <Stat label="Companies" value={data.totals.companies} icon={<BuildingsIcon />} tone="info" />
        <Stat label="Office ready" value={data.totals.ready} tone="ok" icon={<CheckCircleIcon />} />
        <Stat label="Short of people" value={data.totals.short} tone={data.totals.short ? 'crit' : 'ok'} icon={<WarningIcon />} />
        <Stat label="Not entered yet" value={data.totals.notEntered} tone="neutral" note="Shown as Unknown" icon={<QuestionIcon />} />
        <Stat label="Executives in all" value={data.totals.execs} icon={<UsersThreeIcon />} />
        <Stat
          label="Open office work"
          value={data.totals.open}
          tone={data.totals.urgent ? 'crit' : 'ok'}
          note={`${data.totals.urgent} urgent`}
          icon={<TrayIcon />}
        />
      </Stats>

      <section className="ld-section" aria-labelledby="ld-offices">
        <div className="ld-section-head">
          <h2 id="ld-offices">Offices</h2>
          <Chip tone="neutral">{data.rows.length}</Chip>
        </div>
        <ul className="ld-grid">
          {(allOffices ? data.rows : data.rows.slice(0, FOLD)).map((r) => (
            <li key={r.company.id} className="ld-co" data-tone={r.tone} data-pilot={r.company.isPilot}>
              <div className="ld-co-head">
                <div className="ld-co-name">
                  <button type="button" className="ld-co-link" onClick={() => open(r.company.id)}>
                    {r.company.name}
                  </button>
                  <span className="ld-co-sub">
                    {r.company.isPilot ? 'Pilot · ' : ''}
                    {r.execCount} executive{r.execCount === 1 ? '' : 's'}
                    {r.unassigned !== null && ` · ${r.desksAssigned} of ${r.desksTotal} desks shared out`}
                  </span>
                </div>
                <Chip tone={r.tone}>{r.tone === 'ok' ? 'Ready' : r.tone === 'neutral' ? 'Unknown' : r.tone === 'crit' ? 'Short' : 'Check'}</Chip>
              </div>
              <div className="ld-co-people">
                {r.heads.length ? (
                  r.heads.map((h) => <Person key={h.name} name={h.name} sub={h.job} size={30} />)
                ) : (
                  <span className="muted small">No head entered</span>
                )}
              </div>
              <div className="ld-co-chips">
                <Chip tone={r.urgent ? 'crit' : r.open ? 'warn' : 'ok'}>
                  {r.open} open{r.urgent ? ` (${r.urgent} urgent)` : ''}
                </Chip>
                <Chip tone={KDN_LABEL[r.kdnLicence][0]}>{KDN_LABEL[r.kdnLicence][1]}</Chip>
              </div>
              {(r.runBy || r.runs.length > 0) && (
                <p className="ld-co-note">
                  {r.runBy && `Run by the ${r.runBy.name} office`}
                  {r.runs.length > 0 && `Also runs: ${r.runs.map((x) => x.name).join(', ')}`}
                </p>
              )}
              {r.findings.length > 0 && <p className="ld-co-note" data-tone={r.tone}>{r.findings.map((f) => f.message).join(' ')}</p>}
              <div className="ld-co-foot">
                <button type="button" className="btn btn-sm btn-ghost ld-go" onClick={() => open(r.company.id)}>
                  Open office
                  <ArrowRightIcon size={14} weight="bold" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {data.rows.length > FOLD && (
          <button type="button" className="btn ld-more-cards" aria-expanded={allOffices} onClick={() => setAllOffices(!allOffices)}>
            {allOffices ? 'Show fewer offices' : `Show all ${data.rows.length} offices`}
          </button>
        )}
      </section>

      <Card
        title="All office work, by desk"
        actions={
          desk && (
            <button className="btn btn-sm" onClick={() => setDesk(null)}>
              Show all desks
            </button>
          )
        }
        flush
      >
        <div className="ld-filters" role="group" aria-label="Filter by desk">
          {data.byDesk.map((d) => (
            <button
              key={d.desk}
              type="button"
              className="ld-filter"
              aria-pressed={desk === d.desk}
              data-urgent={d.urgent ? true : undefined}
              onClick={() => setDesk(desk === d.desk ? null : d.desk)}
            >
              <span>{d.label}</span>
              <span className="ld-filter-count">
                {d.open}
                {d.urgent ? ` (${d.urgent} urgent)` : ''}
              </span>
            </button>
          ))}
        </div>
        {work.length === 0 ? (
          <Empty title="Nothing waiting." />
        ) : (
          <ul className="ld-rows">
            {shownWork.map((w, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="ld-row"
                  data-tone={w.tone}
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
                  <span className="ld-row-main">
                    <span className="ld-row-title">{w.title}</span>
                    <span className="ld-row-meta">
                      {w.companyName} · {w.deskLabel}
                      {w.actingName ? ` · ${w.actingName}` : ''} · {w.detail}
                    </span>
                  </span>
                  <span className="ld-row-aside">
                    <Chip tone={w.tone}>{w.tag}</Chip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {work.length > FOLD && (
          <button type="button" className="ld-more" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${work.length}`}
          </button>
        )}
      </Card>
      {canSetRunBy && <RunByForm rows={data.rows} />}
      <OfficeGuide role="monitor" />
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
    <Card
      title="Companies run by another office"
      sub="For a company without a licence, or without enough work of its own. The running office's Company Manager or GM heads it and can give its desks to their own executives. One level only. Give the reason, for example the board decision."
      footer={
        target && (
          <button className="btn btn-primary btn-sm" disabled={act.busy || !reason.trim()} onClick={save}>
            Save
          </button>
        )
      }
    >
      <div className="ld-form">
        <label className="field">
          <span className="label">Company</span>
          <select
            className="select"
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
          <label className="field">
            <span className="label">Run by</span>
            <select className="select" value={runBy} onChange={(e) => setRunBy(e.target.value)}>
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
          <label className="field ld-span">
            <span className="label">Reason</span>
            <input
              className="input"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: board decision of the parent company"
            />
          </label>
        )}
        {act.error && (
          <div className="notice ld-span" data-tone="crit">
            {act.error.message}
          </div>
        )}
      </div>
    </Card>
  );
}

function OneOffice({ companyId, back }: { companyId: string; back?: () => void }) {
  const { setCompanyId, go } = useApp();
  const { data, error } = useLoad(() => api.companyOffice(companyId), [companyId]);
  const [editing, setEditing] = useState(false);
  const [onlyMine, setOnlyMine] = useState(true);
  const [all, setAll] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="the company office" />
      </div>
    );
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
  const capped = shown.slice(0, 60);
  const visible = all ? capped : capped.slice(0, FOLD);
  return (
    <div className="page ld">
      <PageHead
        title={`${data.company.name} office`}
        sub={
          <>
            {officeRule(data.rule)} {data.role === 'head' ? 'You share' : 'The Company Manager or GM shares'} the work out by desk. Each desk has an owner and a
            backup, so the work moves to the backup when the owner is on leave.
          </>
        }
        actions={
          back && (
            <button className="btn btn-sm" onClick={back}>
              <ArrowLeftIcon size={14} aria-hidden="true" /> All offices
            </button>
          )
        }
      />
      {data.runBy && (
        <div className="notice" data-tone="info">
          Run by the {data.runBy.name} office: its {data.role === 'head' ? 'head (you)' : 'Company Manager or GM'} leads this office, and its executives can
          hold desks here. {KDN_LABEL[data.kdnLicence][1]}.
        </div>
      )}
      {!data.ready && (
        <div className="notice" data-tone="warn">
          The company office is not switched on in this database yet. Desks cannot be saved until its module is applied.
        </div>
      )}

      <Stats>
        <Stat
          label="Executives"
          value={data.execCount}
          tone={data.execCount < data.rule.minExecs || data.execCount > data.rule.maxExecs ? 'crit' : 'ok'}
          note={`${data.rule.minExecs} to ${data.rule.maxExecs}`}
          icon={<UsersThreeIcon />}
        />
        <Stat
          label={data.role === 'exec' ? 'On your desks' : 'Office work open'}
          value={data.role === 'exec' ? mine.length : data.queue.length}
          tone={(data.role === 'exec' ? mine : data.queue).some((q) => q.tone === 'crit') ? 'crit' : 'ok'}
          icon={<TrayIcon />}
        />
        <Stat
          label="Desks shared out"
          value={data.desks.filter((d) => d.state !== 'unassigned').length}
          note={`of ${data.desks.length}`}
          icon={<BriefcaseIcon />}
        />
      </Stats>

      {data.findings.length > 0 && (
        <Card title="To fix" actions={<Chip tone={data.tone}>{data.findings.length}</Chip>} flush>
          <ul className="ld-rows">
            {data.findings.map((f, i) => (
              <li key={i} className="ld-row" data-tone={f.tone}>
                <span className="ld-row-main">
                  <span className="ld-row-text">{f.message}</span>
                </span>
                <span className="ld-row-aside">
                  {/* P80: how urgent, in words; the rule's code stays on hover for whoever looks it up. */}
                  <Chip tone={f.tone} title={`Rule ${f.rule}`}>
                    {f.tone === 'crit' ? 'Urgent' : f.tone === 'warn' ? 'To fix' : 'Note'}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="ld-main-side">
        <Card
          title={data.role === 'exec' ? 'Work' : 'Office work by desk'}
          actions={
            data.role === 'exec' && (
              <div className="seg" role="group" aria-label="Whose work">
                <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>
                  Show only mine
                </button>
                <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>
                  The whole office
                </button>
              </div>
            )
          }
          flush
        >
          {shown.length === 0 ? (
            <Empty title="Nothing waiting." />
          ) : (
            <ul className="ld-rows">
              {visible.map((q, i) => (
                <li key={i}>
                  <button type="button" className="ld-row" data-tone={q.tone} onClick={() => openLink(q.go)}>
                    <span className="ld-row-main">
                      <span className="ld-row-title">{q.title}</span>
                      <span className="ld-row-meta">
                        {q.detail} · {q.deskLabel}
                        {q.actingName ? ` · ${q.mine ? 'you' : q.actingName}` : ''}
                      </span>
                    </span>
                    <span className="ld-row-aside">
                      <Chip tone={q.tone}>{q.tag}</Chip>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {capped.length > FOLD && (
            <button type="button" className="ld-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${capped.length}`}
            </button>
          )}
          {shown.length > 60 && <p className="muted small ld-pad">and {shown.length - 60} more</p>}
        </Card>

        <div className="ld-side">
          <Card title="Team" sub={`${data.team.length} in the office`} flush>
            {data.team.length === 0 ? (
              <Empty title="No office people entered yet. HR adds them when they join." />
            ) : (
              <ul className="ld-rows">
                {data.team.map((t) => (
                  <li key={t.userId} className="ld-row ld-row-team">
                    <Person name={t.name} sub={`${t.job}${t.from ? ` · from the ${t.from} office` : ''}`} size={32} />
                    <span className="ld-row-aside">
                      {t.onLeave && <Chip tone="info">On leave today</Chip>}
                      <Chip tone={t.open ? 'warn' : 'ok'}>{t.open} open</Chip>
                    </span>
                    <span className="ld-row-meta ld-row-full">
                      {t.desks.length ? `Owns: ${t.desks.join(', ')}` : t.job === 'Executive' ? 'No desk yet' : 'Approvals, arms and anything not shared out'}
                      {t.backupFor.length > 0 && ` · Backup for: ${t.backupFor.join(', ')}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.runs.length > 0 && (
            <Card title="Companies your office also runs" flush>
              <ul className="ld-rows">
                {data.runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="ld-row"
                      onClick={() => {
                        setCompanyId(r.id);
                        if (back) back();
                        go({ view: 'office' });
                      }}
                    >
                      <span className="ld-row-main">
                        <span className="ld-row-title">{r.name}</span>
                        <span className="ld-row-meta">Open its office to share out its desks and see its work.</span>
                      </span>
                      <span className="ld-row-aside">
                        <Chip tone={KDN_LABEL[r.kdnLicence][0]}>{KDN_LABEL[r.kdnLicence][1]}</Chip>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card
        title="Desks"
        sub="Each desk has an owner and a backup"
        actions={
          data.canAssign &&
          !editing && (
            <button className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
              Share out desks
            </button>
          )
        }
      >
        {editing ? (
          <DeskForm office={data} onDone={() => setEditing(false)} />
        ) : (
          <ul className="ld-desks">
            {data.desks.map((d) => (
              <li key={d.desk} className="ld-desk" data-tone={DESK_STATE[d.state][0]}>
                <div className="ld-desk-head">
                  <h3>{d.label}</h3>
                  <Chip tone={DESK_STATE[d.state][0]}>{DESK_STATE[d.state][1]}</Chip>
                </div>
                <p className="ld-desk-covers">{d.covers}</p>
                <dl className="ld-desk-who">
                  <div>
                    <dt>Owner</dt>
                    <dd>{d.ownerName ? <Person name={d.ownerName} size={26} /> : <span className="muted">none</span>}</dd>
                  </div>
                  <div>
                    <dt>Backup</dt>
                    <dd>{d.backupName ? <Person name={d.backupName} size={26} /> : <span className="muted">none</span>}</dd>
                  </div>
                </dl>
                {d.actingName && d.state !== 'ok' && <p className="ld-desk-note">Today: {d.actingName}</p>}
                {d.note && <p className="ld-desk-note muted">{d.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <OfficeGuide role={data.role} />
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
    <div className="ld-deskform">
      {office.suggested && (
        <p className="notice" data-tone="info">
          Filled with a fair first split: desks go round the executives, and each backup is the next person along. Change anything before saving.
        </p>
      )}
      <ul className="ld-deskform-rows">
        {office.desks.map((d) => (
          <li key={d.desk} className="ld-deskform-row">
            <div className="ld-deskform-desk">
              <strong>{d.label}</strong>
              <span className="muted small">{d.covers}</span>
            </div>
            <label className="field">
              <span className="label">Owner</span>
              <select className="select" value={rows[d.desk].owner} onChange={(e) => set(d.desk, 'owner', e.target.value)}>
                <option value="">Not shared out</option>
                {people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name} ({p.job})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Backup</span>
              <select className="select" value={rows[d.desk].backup} onChange={(e) => set(d.desk, 'backup', e.target.value)}>
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
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: new executive joined" />
      </label>
      {act.error && (
        <div className="notice" data-tone="crit">
          {act.error.message}
        </div>
      )}
      <div className="ld-actions">
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={save}>
          Save desks
        </button>
      </div>
    </div>
  );
}

/**
 * In-app guide cards (main review, section A; shared guide-card shape of PR #56): read-only help for each office
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
    <section className="k-card" aria-label="Office guide">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>{L('Panduan kerja', 'How to do it')}</h2>
          <p>
            {L(
              'Panduan sahaja. Ia tidak menyimpan, melulus atau mengubah apa-apa; gunakan skrin yang dinamakan pada setiap kad.',
              'Help only. It does not save, approve or change anything; you use the screen named on each card.',
            )}
          </p>
        </div>
        <span className="muted small">{OFFICE_GUIDE_VERSION}</span>
      </div>
      <ul className="ld-guide">
        {cards.map((c) => (
          <li key={c.id}>
            <button type="button" className="ld-guide-toggle" aria-expanded={openId === c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              <T v={c.title} />
            </button>
            {openId === c.id && (
              <div className="ld-guide-body">
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
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Desk names as the hand-over map (PR #56, ORG_DESK_LABEL) shows them. */
const OFFICE_ASK_LABEL: Record<string, string> = {
  company_office: 'Company office (manager and admin executives)',
  director_office: 'Director Office',
};

/** P80: the office size rule as a sentence, not its source note. */
function officeRule(r: { heads: number; minExecs: number; maxExecs: number }): string {
  return `Each company office has ${r.heads} Company Manager or GM and ${r.minExecs} to ${r.maxExecs} executives.`;
}
