import { useMemo, useState, type CSSProperties } from 'react';
import { CaretRightIcon, TreeStructureIcon, UserSwitchIcon, UsersThreeIcon, WarningIcon, ArrowsClockwiseIcon, UserIcon, ArrowsOutSimpleIcon } from '@phosphor-icons/react';
import { useRouteTab } from '../App';
import { OrgCanvas } from './OrgCanvas';
import { api } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { Avatar, Card, Empty, PageHead, Person as PersonCell, Search, Stat, Stats } from '../kit';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import { Select } from '../SearchSelect';
import { FoldNotice } from '../fold';
import '../styles/org.css';

/**
 * Org chart (Fauzan, 23 Nov 2026: "Make sure every head can put who staff under it. So every task can be set
 * correctly."). Each head puts staff under themselves, or under someone already in their own line, with a reason. The
 * CEO or the HR Director names the head and deputy of each central department and central company, and can set any
 * line. Work, help, team memos, claim checks, time slips and leave follow the line shown here. The server checks every
 * rule again; this screen only helps.
 *
 * P128 (Fitri, 24 Nov 2026): the office kit look. The notices fold to one line, the people show as a line view (the
 * tree) or a table, and the units as a table; changing a line or naming a head opens a drawer. Same data, same rules.
 */
type Chart = Awaited<ReturnType<typeof api.orgChart>>;
type Person = Chart['people'][number];
type Unit = Chart['units'][number];

const HOW: Record<Person['how'], { tone: 'ok' | 'info' | 'warn' | 'neutral'; text: string }> = {
  set: { tone: 'info', text: 'Set by a head' },
  standard: { tone: 'neutral', text: 'From the job' },
  assumed: { tone: 'warn', text: 'Assumed: no line yet' },
  top: { tone: 'ok', text: 'Top of the group' },
};

export function OrgChart() {
  const chart = useLoad(() => api.orgChart(), []);
  if (chart.loading && !chart.data)
    return (
      <div className="page org">
        <Loading what="the org chart" />
      </div>
    );
  if (chart.error || !chart.data)
    return (
      <div className="page org">
        <PageHead title="Org chart" />
        <ErrorNotice error={chart.error} />
      </div>
    );
  return <Screen c={chart.data} />;
}

function Screen({ c }: { c: Chart }) {
  const [moving, setMoving] = useState<Person | null>(null);
  const [adding, setAdding] = useState<Person | null>(null);
  // P137: a box dropped on another in the chart: who goes under whom, the reason asked in a drawer.
  const [placing, setPlacing] = useState<{ who: Person; boss: Person } | null>(null);
  // P138: a department's + (or a person dropped on it): head, deputy or member.
  const [unitEdit, setUnitEdit] = useState<{ unit: Unit; who: Person | null } | null>(null);
  const [naming, setNaming] = useState<Unit | null>(null);
  // P129 (Fitri, 24 Nov 2026): the chart opens as a full-page canvas; Back shows the details (tables, units, notices).
  const [tab, setTab] = useRouteTab<'chart' | 'details'>('chart', ['chart', 'details']);
  const table = useTableState('org.people');
  const byId = useMemo(() => new Map(c.people.map((p) => [p.id, p])), [c]);
  const unitName = useMemo(() => new Map(c.units.map((u) => [u.key, u.label])), [c]);
  const children = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of c.people) {
      const key = p.managerId && byId.has(p.managerId) ? p.managerId : '';
      m.set(key, [...(m.get(key) ?? []), p]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [c, byId]);
  const mine = children.get(c.meId) ?? [];
  const setCount = c.people.filter((p) => p.how === 'set').length;
  const assumed = c.people.filter((p) => p.how === 'assumed').length;
  const showAssumed = () => {
    setTab('details');
    table.set({ f: { how: 'assumed' } });
  };
  const drawers = (
    <>
      {moving && (
        <Drawer title="Change line" sub={`${moving.name} · ${moving.title}`} onClose={() => setMoving(null)}>
          <MoveForm p={moving} c={c} onDone={() => setMoving(null)} />
        </Drawer>
      )}
      {adding && (
        <Drawer title="Put someone under" sub={`${adding.name} · ${adding.title}`} onClose={() => setAdding(null)}>
          <AddUnderForm boss={adding} c={c} byId={byId} onDone={() => setAdding(null)} />
        </Drawer>
      )}
      {unitEdit && (
        <Drawer title={unitEdit.unit.label} sub="Head, deputy or member" onClose={() => setUnitEdit(null)}>
          <UnitPersonForm c={c} unit={unitEdit.unit} who={unitEdit.who} onDone={() => setUnitEdit(null)} />
        </Drawer>
      )}
      {placing && (
        <Drawer title="Put under" sub={`${placing.who.name} under ${placing.boss.name}`} onClose={() => setPlacing(null)}>
          <MoveForm p={placing.who} c={c} to={placing.boss} onDone={() => setPlacing(null)} />
        </Drawer>
      )}
      {naming && (
        <Drawer title="Name head" sub={naming.label} onClose={() => setNaming(null)}>
          <HeadForm c={c} unit={naming} onDone={() => setNaming(null)} />
        </Drawer>
      )}
    </>
  );
  if (tab === 'chart')
    return (
      <div className="page org">
        <OrgCanvas c={c} byId={byId} kids={children} unitName={unitName} onMove={setMoving} onAddUnder={setAdding} onPlace={(who, boss) => setPlacing({ who, boss })} onUnit={(unit, who) => setUnitEdit({ unit, who })} onBack={() => setTab('details')}>
          {drawers}
        </OrgCanvas>
      </div>
    );
  return (
    <div className="page org">
      <PageHead
        title="Org chart"
        sub="Who reports to whom, and who heads each department and central company."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setTab('chart')}>
            <ArrowsOutSimpleIcon size={16} aria-hidden="true" />
            Open the chart
          </button>
        }
      />
      <div className="org-notices">
        {!c.installed && (
          <FoldNotice id="org.install" tone="warn" summary="Module not installed: the lines come from each job and cannot be changed yet.">
            <p>The org chart settings are not installed in this database yet (module org-lines-v1). The lines shown come from each job; changes open once Fauzan runs the module.</p>
          </FoldNotice>
        )}
        <FoldNotice id="org.how" tone="info" summary="How the lines work">
          <p>
            Who reports to whom. Work, help, team memos, claim checks, time slips and leave go to the manager shown here. A head puts staff under themselves or under
            someone in their own line, with a reason; a move between heads goes to the HR Director.
          </p>
          <p>{c.whole ? 'You see the whole group.' : 'You see your own line: the people above you and everyone under you.'}</p>
        </FoldNotice>
        {c.gaps.length > 0 && (
          <FoldNotice id="org.gaps" tone="warn" summary={`Gaps to fix: ${c.gaps.length}`}>
            <ul>
              {c.gaps.slice(0, 40).map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            {c.gaps.length > 40 && <p className="muted">{`and ${c.gaps.length - 40} more`}</p>}
          </FoldNotice>
        )}
      </div>
      <Stats>
        <Stat label="People on the chart" value={c.people.length} icon={<UsersThreeIcon size={18} />} />
        <Stat label="Directly under you" value={mine.length} icon={<UserIcon size={18} />} />
        <Stat label="Lines set by a head" value={setCount} tone="info" icon={<UserSwitchIcon size={18} />} />
        <Stat label="Assumed lines" value={assumed} tone={assumed ? 'warn' : 'ok'} icon={<WarningIcon size={18} />} onClick={assumed ? showAssumed : undefined} />
      </Stats>
      <button type="button" className="org-open-chart" onClick={() => setTab('chart')}>
        <TreeStructureIcon size={34} aria-hidden="true" />
        <span className="org-open-chart-text">
          <strong>The chart, full page</strong>
          <span className="muted small">Boxes and lines for everyone you may see. Drag to move, zoom in and out, find a person, change a line or put someone under a head.</span>
        </span>
        <span className="btn btn-primary">
          Open the chart
          <CaretRightIcon size={14} aria-hidden="true" />
        </span>
      </button>
      {c.canBring.length > 0 && <Bring c={c} />}
      <PeopleTable c={c} byId={byId} unitName={unitName} control={table} onMove={setMoving} />
      <Units c={c} onName={setNaming} />
      {drawers}
    </div>
  );
}

// ---------- Line view (the tree) ----------

type NodeProps = { c: Chart; byId: Map<string, Person>; unitName: Map<string, string>; onMove: (p: Person) => void };

// ---------- Table view ----------

function PeopleTable({ c, byId, unitName, control, onMove }: NodeProps & { control: ReturnType<typeof useTableState> }) {
  const columns: DtColumn<Person>[] = [
    {
      id: 'name',
      label: 'Name',
      value: (p) => p.name,
      render: (p) => <PersonCell name={p.name} sub={p.title} size={32} />,
      phone: 'title',
    },
    { id: 'manager', label: 'Manager', value: (p) => (p.managerId ? byId.get(p.managerId)?.name ?? '' : '') || '–' },
    {
      id: 'how',
      label: 'Reporting line',
      value: (p) => HOW[p.how].text,
      translate: true,
      render: (p) => (
        <Chip tone={HOW[p.how].tone} title={p.setBy ? `${p.setBy.by}, ${dateLabel(p.setBy.at)}: ${p.setBy.reason}` : undefined}>
          {p.setBy?.until ? `${HOW[p.how].text} until ${dateLabel(p.setBy.until)}` : HOW[p.how].text}
        </Chip>
      ),
    },
    {
      id: 'heads',
      label: 'Head of',
      value: (p) => p.heads.map((k) => unitName.get(k) ?? k).join(', '),
      render: (p) => (p.heads.length ? <span className="org-heads">{p.heads.map((k) => unitName.get(k) ?? k).join(', ')}</span> : <span className="muted">–</span>),
      hideBelow: 1100,
    },
  ];
  const filters: DtFilter<Person>[] = [
    { id: 'how', label: 'Reporting line', value: (p) => p.how, options: (Object.keys(HOW) as Person['how'][]).map((k) => ({ value: k, label: HOW[k].text })) },
    { id: 'manager', label: 'Manager', value: (p) => p.managerId ?? '', optionLabel: (id) => byId.get(id)?.name ?? id },
    { id: 'head', label: 'Heads a unit', value: (p) => (p.heads.length ? 'yes' : 'no'), options: [{ value: 'yes', label: 'Heads a unit' }, { value: 'no', label: 'Not a head' }] },
  ];
  return (
    <Card title="People" sub="Everyone on the chart you may see, with their manager and how the line is set." flush>
      <DataTable
        label="People on the chart"
        stateKey="org.people"
        control={control}
        rows={c.people}
        rowKey={(p) => p.id}
        columns={columns}
        searchText={(p) => p.title}
        filters={filters}
        searchPlaceholder="Find a name or title"
        rowTone={(p) => (p.how === 'assumed' ? 'warn' : undefined)}
        actions={(p) => [{ label: 'Change line', onClick: () => onMove(p), hidden: !p.canMove }]}
        exportName="org-chart"
        empty={<Empty title="Nobody on the chart yet." />}
      />
    </Card>
  );
}

// ---------- Units ----------

function Units({ c, onName }: { c: Chart; onName: (u: Unit) => void }) {
  if (!c.units.length) return null;
  const columns: DtColumn<Unit>[] = [
    { id: 'unit', label: 'Unit', value: (u) => u.label, render: (u) => <strong>{u.label}</strong>, phone: 'title' },
    { id: 'members', label: 'Staff', value: (u) => u.members, sort: 'number' },
    {
      id: 'heads',
      label: 'Head',
      value: (u) => u.heads.map((h) => h.name).join(', '),
      render: (u) =>
        u.heads.length ? (
          <span className="org-chips">
            {u.heads.map((h) => (
              <Chip key={h.id} tone="ok" title={h.how === 'job' ? 'Head by job' : 'Named in the org chart'}>
                {h.name}
                {h.how === 'named' ? ' (named)' : ''}
              </Chip>
            ))}
          </span>
        ) : (
          <Chip tone={u.members ? 'warn' : 'neutral'}>No head</Chip>
        ),
    },
    { id: 'deputy', label: 'Deputy', value: (u) => u.deputy?.name ?? '–' },
    {
      id: 'until',
      label: 'Until',
      value: (u) => u.named?.until ?? '',
      sort: 'date',
      render: (u) => (u.named?.until ? <Chip tone="info">{dateLabel(u.named.until)}</Chip> : <span className="muted">–</span>),
      hideBelow: 1100,
    },
  ];
  const filters: DtFilter<Unit>[] = [
    { id: 'head', label: 'Head', value: (u) => (u.heads.length ? 'yes' : 'no'), options: [{ value: 'yes', label: 'Has a head' }, { value: 'no', label: 'No head' }] },
  ];
  return (
    <Card
      title="Departments and central companies"
      sub={
        <>
          <span>A unit&apos;s head sees the unit&apos;s items and is the manager of its staff who have no other line.</span>{' '}
          <span>{c.canNameHeads ? 'You can name the head and deputy; nobody names themselves.' : 'The CEO or the HR Director names heads.'}</span>
        </>
      }
      flush
    >
      <DataTable
        label="Departments and central companies"
        stateKey="org.units"
        rows={c.units}
        rowKey={(u) => u.key}
        columns={columns}
        filters={filters}
        rowTone={(u) => (!u.heads.length && u.members ? 'warn' : undefined)}
        actions={c.canNameHeads ? (u) => [{ label: 'Name head', onClick: () => onName(u) }] : undefined}
        exportName="org-units"
        empty={<Empty title="No units to show." />}
      />
    </Card>
  );
}

// ---------- Forms (in drawers) ----------

function MoveForm({ p, c, onDone, to: preset }: { p: Person; c: Chart; onDone: () => void; to?: Person }) {
  const act = useAction();
  const [to, setTo] = useState(preset?.id ?? '');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const listed = c.managerChoices.filter((m) => m.id !== p.id);
  // P137: the box dropped on is offered even when it is not among the usual heads (the server checks it).
  const choices = preset && !listed.some((m) => m.id === preset.id) ? [{ id: preset.id, name: preset.name, title: preset.title }, ...listed] : listed;
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>{`Put ${p.name} under`}</span>
        <Select className="input" value={to} onChange={(e) => setTo(e.target.value)} searchable>
          <option value="">Choose…</option>
          {choices.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Reason</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Joins the Selangor team" />
      </label>
      <label className="field">
        <span>Until (leave empty if it is for good)</span>
        <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <div className="org-form-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !to || reason.trim().length < 3}
          onClick={() => act.run(() => api.orgSetLine({ userId: p.id, managerId: to, reason, until: until || null }), 'Line saved.').then((r) => r && onDone())}
        >
          Save
        </button>
        {p.how === 'set' && (
          <button
            className="btn"
            disabled={act.busy || reason.trim().length < 3}
            onClick={() => act.run(() => api.orgSetLine({ userId: p.id, managerId: null, reason }), 'Back to the line from the job.').then((r) => r && onDone())}
          >
            Back to the line from the job
          </button>
        )}
      </div>
    </div>
  );
}

// The Prima departments an office account may have (the office's own list; apps/api prima/client.PRIMA_DEPARTMENTS).
const OFFICE_DEPARTMENTS = ['transport', 'procurement', 'hr', 'finance', 'chief_of_staff', 'it', 'legal', 'audit', 'operations', 'asset', 'pdpa', 'fwm', 'cms'];

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)agentic_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * P138 (Fitri, 26 Nov 2026: "in Departments, drag and drop people, a + to add and search, fully custom, reflected once
 * done"): make someone a department's head or deputy (Prima's own POST /api/org/head), or move them into the department.
 * A member's department is the office's setting for their account (Members and roles, the same rule): changed through
 * the office's own call, which brings their Prima account to it straight away.
 */
function UnitPersonForm({ c, unit, who: preset, onDone }: { c: Chart; unit: Unit; who: Person | null; onDone: () => void }) {
  const act = useAction();
  const [who, setWho] = useState(preset?.id ?? '');
  const dept = unit.key.startsWith('d_') ? unit.key.slice(2) : null;
  const canMember = !!dept && OFFICE_DEPARTMENTS.includes(dept);
  const [as, setAs] = useState<'member' | 'head' | 'deputy'>(canMember ? 'member' : 'head');
  const [reason, setReason] = useState('');
  const person = c.people.find((p) => p.id === who);
  const namedHead = unit.heads.find((h) => h.how === 'named')?.id ?? null;
  const save = async () => {
    if (as === 'head') return api.orgSetHead({ unit: unit.key, headId: who, deputyId: unit.deputy?.id ?? null, reason });
    if (as === 'deputy') return api.orgSetHead({ unit: unit.key, headId: namedHead, deputyId: who, reason });
    if (!who.startsWith('u-off-')) throw new Error(`${person?.name ?? 'This person'} has a Prima-only account: change their department in Accounts and access.`);
    const r = await fetch(`/api/members/${encodeURIComponent(who.slice('u-off-'.length))}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ prima_department: dept }),
    });
    if (!r.ok) {
      const b = (await r.json().catch(() => null)) as { message?: string } | null;
      throw new Error(b?.message ?? `The office refused (${r.status}).`);
    }
    // The office brings their Prima account to the new department in the background: a moment, then the chart reloads.
    await new Promise((res) => setTimeout(res, 2500));
    return null;
  };
  const sorted = [...c.people].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Person</span>
        <Select className="input" value={who} onChange={(e) => setWho(e.target.value)} searchable>
          <option value="">Search a name…</option>
          {sorted.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </Select>
      </label>
      <div className="seg" role="group" aria-label="As">
        {canMember && (
          <button type="button" aria-pressed={as === 'member'} onClick={() => setAs('member')}>
            Member
          </button>
        )}
        <button type="button" aria-pressed={as === 'head'} onClick={() => setAs('head')}>
          Head
        </button>
        <button type="button" aria-pressed={as === 'deputy'} onClick={() => setAs('deputy')}>
          Deputy
        </button>
      </div>
      {as !== 'member' && (
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Appointed by the CEO" />
        </label>
      )}
      <div className="org-form-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !who || (as !== 'member' && reason.trim().length < 3)}
          onClick={() => act.run(save, as === 'member' ? 'Moved into the department.' : as === 'head' ? 'Head named.' : 'Deputy named.').then((r) => r !== undefined && onDone())}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** P129: put someone under this person: anyone whose line the viewer may change (the server checks it again). */
function AddUnderForm({ boss, c, byId, onDone }: { boss: Person; c: Chart; byId: Map<string, Person>; onDone: () => void }) {
  const act = useAction();
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  // Not the head themselves, nor anyone above them (no loops), nor someone already directly under them.
  const above = new Set<string>();
  for (let at = boss.managerId, n = 0; at && n < 40; at = byId.get(at)?.managerId ?? null, n++) above.add(at);
  const choices = c.people.filter((p) => p.canMove && p.id !== boss.id && !above.has(p.id) && p.managerId !== boss.id).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>{`Who goes under ${boss.name}`}</span>
        <Select className="input" value={who} onChange={(e) => setWho(e.target.value)} searchable>
          <option value="">Choose…</option>
          {choices.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Reason</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Joins the Selangor team" />
      </label>
      <label className="field">
        <span>Until (leave empty if it is for good)</span>
        <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <p className="muted small">New staff are added in Accounts and access (or People); they then show here and can be put under a head.</p>
      <div className="org-form-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !who || reason.trim().length < 3}
          onClick={() => act.run(() => api.orgSetLine({ userId: who, managerId: boss.id, reason, until: until || null }), 'Line saved.').then((r) => r && onDone())}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Bring({ c }: { c: Chart }) {
  const act = useAction();
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Card title="Put staff under me" sub="People in your line or your unit whom you can bring directly under you. Their work, help and team memos come to you from then on.">
      <div className="org-bring">
        <ErrorNotice error={act.error} />
        <Select className="input" aria-label="Staff member" value={who} onChange={(e) => setWho(e.target.value)} searchable>
          <option value="">Choose…</option>
          {c.canBring.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </Select>
        <input className="input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        <button
          className="btn btn-primary"
          disabled={act.busy || !who || reason.trim().length < 3}
          onClick={() => act.run(() => api.orgSetLine({ userId: who, managerId: c.meId, reason }), 'Now under you.').then((r) => r && (setWho(''), setReason('')))}
        >
          Put under me
        </button>
      </div>
    </Card>
  );
}

function HeadForm({ c, unit, onDone }: { c: Chart; unit: Unit; onDone: () => void }) {
  const act = useAction();
  const named = unit.heads.find((h) => h.how === 'named');
  const [head, setHead] = useState(named?.id ?? '');
  const [deputy, setDeputy] = useState(unit.deputy?.id ?? '');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const staff = c.people.filter((p) => p.role === 'pwvsb_officer');
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Head</span>
        <Select className="input" value={head} onChange={(e) => setHead(e.target.value)} searchable>
          <option value="">Not named (head by job only)</option>
          {staff.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Deputy</span>
        <Select className="input" value={deputy} onChange={(e) => setDeputy(e.target.value)} searchable>
          <option value="">None</option>
          {staff.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.title})
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Reason</span>
        <input className="input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      </label>
      <label className="field">
        <span>Until (leave empty if it is for good)</span>
        <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <div className="org-form-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || reason.trim().length < 3}
          onClick={() => act.run(() => api.orgSetHead({ unit: unit.key, headId: head || null, deputyId: deputy || null, reason, until: until || null }), 'Saved.').then((r) => r && onDone())}
        >
          Save
        </button>
      </div>
    </div>
  );
}
