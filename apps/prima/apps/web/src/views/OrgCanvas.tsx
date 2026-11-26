import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  ArrowsInIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CornersOutIcon,
  CrosshairIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  UserPlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { api } from '../api';
import { Avatar } from '../kit';
import { Chip, dateLabel } from '../ui';
import '../styles/org-canvas.css';

/**
 * P129 (Fitri, 24 Nov 2026: "the org chart in Prima, make it visually nice with a canvas, draggable, zoom in and out like
 * the Agentic side ... fully advanced, a full page with a back button, hierarchy layout"). The whole chart as boxes
 * joined by lines on a canvas that fills the screen: drag the background (or two fingers) to move, the wheel, a pinch or
 * the buttons to zoom, Fit to see it all. Each box opens and closes the people under it; a head with six or more people
 * who have nobody under them shows them as one team list (as on a paper chart). Find a person and the chart opens the
 * path to them and moves to them. From a box: Change line (who they report to) and Put someone under (a person whose
 * line this person may change). The server checks every rule again; this is only a way to see and reach it.
 */
type Chart = Awaited<ReturnType<typeof api.orgChart>>;
type Person = Chart['people'][number];
type Unit = Chart['units'][number];
type Mode = 'lines' | 'units';

/** The people of a Prima unit: its central department's staff, or a central company's (core unitsOfMember). */
function membersOf(u: Unit, people: Person[]): Person[] {
  const co = u.key.startsWith('c_') ? u.key.slice(2) : null;
  return people.filter((p) => (u.key.startsWith('d_') && `d_${p.department}` === u.key) || (co !== null && p.companyIds.includes(co))).sort((a, b) => a.name.localeCompare(b.name));
}

const TEAM_BOX = 6;
const MIN = 0.2;
const MAX = 1.8;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

const HOW: Record<Person['how'], { tone: 'ok' | 'info' | 'warn' | 'neutral'; text: string }> = {
  set: { tone: 'info', text: 'Set by a head' },
  standard: { tone: 'neutral', text: 'From the job' },
  assumed: { tone: 'warn', text: 'Assumed: no line yet' },
  top: { tone: 'ok', text: 'Top of the group' },
};

/** A steady colour per department, for the band on top of each box. */
function hueOf(dept: string | null): number | null {
  if (!dept) return null;
  let h = 0;
  for (const ch of dept) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

const DEPT: Record<string, string> = {
  hr: 'HR',
  finance: 'Finance',
  operations: 'Operations',
  it: 'IT',
  procurement: 'Procurement',
  legal: 'Legal',
  audit: 'Audit',
  transport: 'Transport',
  chief_of_staff: 'Chief of Staff office',
  director_office: 'Director Office',
  asset: 'Asset Management',
  pdpa: 'PDPA',
  fwm: 'Foreign workers',
  cms: 'CMS',
  marketing: 'Marketing',
  arms_control: 'Arms control',
};
const deptLabel = (d: string | null) => (d ? (DEPT[d] ?? d.replace(/_/g, ' ')) : '');

export function OrgCanvas({
  c,
  byId,
  kids,
  unitName,
  onMove,
  onAddUnder,
  onPlace,
  onUnit,
  onBack,
  children,
}: {
  c: Chart;
  byId: Map<string, Person>;
  kids: Map<string, Person[]>;
  unitName: Map<string, string>;
  onMove: (p: Person) => void;
  onAddUnder: (p: Person) => void;
  /** P137: a box dropped on another: put `who` under `boss` (a drawer asks the reason). */
  onPlace?: (who: Person, boss: Person) => void;
  /** P138: a department's + or a person dropped on it: head, deputy or member (a drawer asks). */
  onUnit?: (unit: Unit, who: Person | null) => void;
  onBack: () => void;
  /** Drawers opened from the chart, drawn inside it so they sit above the canvas. */
  children?: ReactNode;
}) {
  const view = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const [focus, setFocus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // P129: Prima's own structure (its departments and central companies, each with its head and deputy) or the lines.
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem('prima.org.mode') === 'units' ? 'units' : 'lines';
    } catch {
      return 'lines';
    }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem('prima.org.mode', m);
    } catch {
      /* this browser only */
    }
    requestAnimationFrame(() => requestAnimationFrame(() => fitWidth()));
  };
  const canAddUnder = useMemo(() => new Set(c.managerChoices.map((m) => m.id)), [c]);
  const movable = useMemo(() => c.people.some((p) => p.canMove), [c]);

  // Depth of each person and the path above them.
  const parentOf = useCallback((id: string) => {
    const p = byId.get(id);
    return p?.managerId && byId.has(p.managerId) ? p.managerId : null;
  }, [byId]);
  const pathTo = useCallback((id: string) => {
    const out: string[] = [];
    for (let at = parentOf(id), n = 0; at && n < 40; at = parentOf(at), n++) out.push(at);
    return out;
  }, [parentOf]);

  // Closed boxes: from the third level down, except the path to the signed-in person.
  const [closed, setClosed] = useState<Set<string>>(() => {
    const open = new Set([c.meId, ...pathTo(c.meId)]);
    const s = new Set<string>();
    const walk = (id: string, depth: number) => {
      const under = kids.get(id) ?? [];
      if (under.length && depth >= 1 && !open.has(id)) s.add(id);
      for (const k of under) walk(k.id, depth + 1);
    };
    for (const r of kids.get('') ?? []) walk(r.id, 0);
    return s;
  });
  const toggle = (id: string) => setClosed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const openAll = () => {
    setClosed(new Set());
    setOpenUnits(new Set(c.units.map((u) => u.key)));
  };
  const closeAll = () => {
    setClosed(new Set(c.people.filter((p) => (kids.get(p.id) ?? []).length).map((p) => p.id)));
    setOpenUnits(new Set());
  };

  // ---------- moving and zooming ----------
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = view.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setT((o) => {
      const s = clamp(o.s * factor, MIN, MAX);
      return { s, x: px - ((px - o.x) * s) / o.s, y: py - ((py - o.y) * s) / o.s };
    });
  }, []);

  const fit = useCallback(() => {
    const el = view.current;
    const box = inner.current;
    if (!el || !box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const s = clamp(Math.min((vw - 48) / w, (vh - 48) / h, 1), MIN, 1);
    setT({ s, x: (vw - w * s) / 2, y: Math.max(24, (vh - h * s) / 2) });
  }, []);

  /** Moves the canvas so this person's box is in view, a little above the middle. */
  const centerOn = useCallback((id: string) => {
    const el = view.current;
    const box = inner.current;
    const node = box?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(id)}"]`);
    if (!el || !box || !node) return;
    const { s: old } = tRef.current;
    const br = box.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    const x = (nr.left - br.left) / old;
    const y = (nr.top - br.top) / old;
    const s = Math.max(old, 0.85);
    setT({ s, x: el.clientWidth / 2 - (x + nr.width / old / 2) * s, y: el.clientHeight * 0.35 - y * s });
  }, []);

  // Start: the top of the chart in the middle, at a size that shows the width (not smaller than 60%).
  const fitWidth = useCallback(() => {
    const el = view.current;
    const box = inner.current;
    if (!el || !box) return;
    const s = clamp(Math.min((el.clientWidth - 48) / box.offsetWidth, 1), 0.6, 1);
    setT({ s, x: (el.clientWidth - box.offsetWidth * s) / 2, y: 28 });
  }, []);
  const started = useRef(false);
  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    fitWidth();
  }, [fitWidth]);

  // The wheel zooms at the pointer (the page itself does not scroll under the canvas).
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
      else setT((o) => ({ ...o, x: o.x - e.deltaX }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Dragging the background moves; two fingers pinch to zoom.
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; d: number } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, .oc-menu, [draggable="true"]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    view.current?.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last.current = null;
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pts.current.values()];
    const r = view.current!.getBoundingClientRect();
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length - r.left;
    const cy = ps.reduce((a, p) => a + p.y, 0) / ps.length - r.top;
    const d = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    const l = last.current;
    if (l) {
      setT((o) => {
        let { s, x, y } = o;
        if (d && l.d) {
          const ns = clamp(s * (d / l.d), MIN, MAX);
          x = cx - ((cx - x) * ns) / s;
          y = cy - ((cy - y) * ns) / s;
          s = ns;
        }
        return { s, x: x + (cx - l.x), y: y + (cy - l.y) };
      });
    }
    last.current = { x: cx, y: cy, d };
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
    last.current = null;
  };

  // Keys: + and - zoom, 0 fits, arrows move, Escape goes back (when nothing else is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.querySelector('.drawer')) return;
      if (e.key === '+' || e.key === '=') zoomAt(1.2);
      else if (e.key === '-') zoomAt(1 / 1.2);
      else if (e.key === '0') fit();
      else if (e.key.startsWith('Arrow')) {
        const step = 60;
        setT((o) => ({ ...o, x: o.x + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0), y: o.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0) }));
      } else if (e.key === 'Escape') onBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, fit, onBack]);

  // ---------- finding a person ----------
  const hits = useMemo(() => {
    const w = q.trim().toLowerCase();
    if (!w) return [];
    return c.people.filter((p) => `${p.name} ${p.title} ${deptLabel(p.department)}`.toLowerCase().includes(w)).slice(0, 8);
  }, [q, c]);
  const goTo = (id: string) => {
    if (mode !== 'lines') setModeState('lines');
    const up = pathTo(id);
    setClosed((s) => new Set([...s].filter((x) => !up.includes(x))));
    setFocus(id);
    setQ('');
    // After the boxes above have opened.
    requestAnimationFrame(() => requestAnimationFrame(() => centerOn(id)));
  };

  const roots = kids.get('') ?? [];
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set());
  const toggleUnit = (key: string) =>
    setOpenUnits((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  // P137 (Fitri, 26 Nov 2026: "drag and drop in the chart ... click a plus button, search the member, add"): who is being
  // dragged, and where it may land (not on themselves, nor on anyone under them).
  const [dragId, setDragId] = useState<string | null>(null);
  const under = useCallback(
    (top: string, id: string): boolean => (kids.get(top) ?? []).some((k) => k.id === id || under(k.id, id)),
    [kids],
  );
  // "Move": pick someone, then press Put here on the person they go under (works on a phone too).
  const [picked, setPicked] = useState<Person | null>(null);
  const moving = dragId ?? picked?.id ?? null;
  const canDrop = useCallback(
    (boss: Person) => !!moving && moving !== boss.id && !under(moving, boss.id) && byId.get(moving)?.managerId !== boss.id,
    [moving, under, byId],
  );
  const place = (boss: Person) => {
    const who = moving ? byId.get(moving) : undefined;
    setDragId(null);
    setPicked(null);
    if (who && onPlace && canDrop(boss)) onPlace(who, boss);
  };
  useEffect(() => {
    if (!picked) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPicked(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picked]);
  const ctx: Ctx = { c, kids, byId, unitName, closed, toggle, focus, canAddUnder, onMove, onAddUnder, openUnits, toggleUnit, dragId, setDragId, canDrop, place, dnd: !!onPlace, picked, pick: setPicked, onUnit: c.canNameHeads ? onUnit : undefined };
  return (
    <div className="oc-full" role="dialog" aria-label="Org chart">
      <header className="oc-bar">
        <button type="button" className="btn oc-back" onClick={onBack}>
          <ArrowLeftIcon size={16} aria-hidden="true" />
          Back
        </button>
        <div className="oc-title">
          <strong>Org chart</strong>
          <span className="muted small">
            <span className="num">{c.people.length}</span> <span>people</span> · <span>{c.whole ? 'The whole group' : 'Your line'}</span>
          </span>
        </div>
        <div className="oc-find">
          <MagnifyingGlassIcon size={16} aria-hidden="true" className="oc-find-icon" />
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) goTo(hits[0].id);
              if (e.key === 'Escape') setQ('');
            }}
            placeholder="Find a person, title or department"
            aria-label="Find a person"
          />
          {q && (
            <button type="button" className="oc-find-clear" aria-label="Clear" onClick={() => setQ('')}>
              <XIcon size={14} aria-hidden="true" />
            </button>
          )}
          {q.trim() && (
            <ul className="oc-hits" role="listbox" aria-label="People found">
              {hits.length ? (
                hits.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => goTo(p.id)}>
                      <Avatar name={p.name} size={28} />
                      <span>
                        <strong>{p.name}</strong>
                        <span className="muted small">{[p.title, deptLabel(p.department)].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="muted small oc-hits-none">Nobody matches.</li>
              )}
            </ul>
          )}
        </div>
        <div className="seg oc-mode" role="group" aria-label="Show">
          <button type="button" aria-pressed={mode === 'lines'} onClick={() => setMode('lines')}>
            Reporting lines
          </button>
          <button type="button" aria-pressed={mode === 'units'} onClick={() => setMode('units')}>
            Departments
          </button>
        </div>
        <div className="oc-tools" role="group" aria-label="Chart tools">
          <button type="button" className="btn btn-sm" onClick={() => goTo(c.meId)} title="Find me">
            <CrosshairIcon size={16} aria-hidden="true" />
            <span className="hide-sm">Me</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={openAll} title="Open every box">
            <ArrowsOutIcon size={16} aria-hidden="true" />
            <span className="hide-sm">Open all</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={closeAll} title="Close every box">
            <ArrowsInIcon size={16} aria-hidden="true" />
            <span className="hide-sm">Close all</span>
          </button>
        </div>
      </header>
      {picked && (
        <div className="oc-pickbar" role="status">
          <ArrowsClockwiseIcon size={16} aria-hidden="true" />
          <span>
            <span>Moving</span> <strong>{picked.name}</strong>: <span>press Put here on the person they go under.</span>
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setPicked(null)}>
            Cancel
          </button>
        </div>
      )}
      <div
        className="oc-view"
        ref={view}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        tabIndex={0}
        aria-label="Chart canvas: drag to move, wheel or pinch to zoom"
        onDragOver={(e) => {
          if (dragId) e.preventDefault();
        }}
        onDrop={(e) => {
          // Dropped on the empty canvas (dragged out): their line opens, to pick another head or go back to the job's.
          if (!dragId || (e.target as HTMLElement).closest('.oc-box')) return;
          e.preventDefault();
          const who = byId.get(dragId);
          setDragId(null);
          if (who) onMove(who);
        }}
      >
        <div className="oc-inner" ref={inner} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>
          {mode === 'units' ? (
            <UnitsTree ctx={ctx} />
          ) : roots.length ? (
            <div className="oc-roots">
              {roots.map((p) => (
                <TreeNode key={p.id} p={p} ctx={ctx} />
              ))}
            </div>
          ) : (
            <p className="muted">Nobody on the chart yet.</p>
          )}
        </div>
        <div className="oc-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out" disabled={t.s <= MIN + 0.001}>
            <MinusIcon size={16} aria-hidden="true" />
          </button>
          <button type="button" className="oc-zoom-pct num" onClick={() => setT((o) => ({ ...o, s: 1 }))} title="Back to 100%">
            {Math.round(t.s * 100)}%
          </button>
          <button type="button" onClick={() => zoomAt(1.2)} aria-label="Zoom in" disabled={t.s >= MAX - 0.001}>
            <PlusIcon size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={fit} aria-label="Fit the chart to the screen" title="Fit (0)">
            <CornersOutIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="oc-legend" aria-label="Key">
          <span className="oc-dot" data-how="set" /> <span>Set by a head</span>
          <span className="oc-dot" data-how="standard" /> <span>From the job</span>
          <span className="oc-dot" data-how="assumed" /> <span>Assumed</span>
          {movable && (
            <span className="muted hide-sm">
              · <span>Drag to move</span> · <span>Wheel to zoom</span>
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

type Ctx = {
  c: Chart;
  kids: Map<string, Person[]>;
  byId: Map<string, Person>;
  unitName: Map<string, string>;
  closed: Set<string>;
  toggle: (id: string) => void;
  focus: string | null;
  canAddUnder: Set<string>;
  onMove: (p: Person) => void;
  onAddUnder: (p: Person) => void;
  openUnits: Set<string>;
  toggleUnit: (key: string) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  canDrop: (boss: Person) => boolean;
  place: (boss: Person) => void;
  dnd: boolean;
  picked: Person | null;
  pick: (p: Person | null) => void;
  onUnit?: (unit: Unit, who: Person | null) => void;
};

function TreeNode({ p, ctx }: { p: Person; ctx: Ctx }) {
  const under = ctx.kids.get(p.id) ?? [];
  const open = !ctx.closed.has(p.id);
  const team = under.length >= TEAM_BOX && under.every((k) => !(ctx.kids.get(k.id) ?? []).length);
  return (
    <div className="oc-node">
      <Box p={p} ctx={ctx} count={under.length} open={open} />
      {under.length > 0 && open && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          {team ? (
            <TeamBox people={under} ctx={ctx} />
          ) : (
            <ul className="oc-kids">
              {under.map((k) => (
                <li key={k.id}>
                  <TreeNode p={k} ctx={ctx} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Box({ p, ctx, count, open }: { p: Person; ctx: Ctx; count: number; open: boolean }) {
  const [menu, setMenu] = useState(false);
  const me = p.id === ctx.c.meId;
  const hue = hueOf(p.department);
  const how = HOW[p.how];
  const total = useMemo(() => {
    let n = 0;
    const walk = (id: string) => (ctx.kids.get(id) ?? []).forEach((k) => (n++, walk(k.id)));
    walk(p.id);
    return n;
  }, [ctx.kids, p.id]);
  const canAdd = ctx.canAddUnder.has(p.id);
  const [over, setOver] = useState(false);
  const drags = ctx.dnd && p.canMove;
  return (
    <div
      className="oc-box"
      draggable={drags || undefined}
      data-drop={(over && ctx.canDrop(p)) || undefined}
      data-dragging={ctx.dragId === p.id || ctx.picked?.id === p.id || undefined}
      onDragStart={
        drags
          ? (e) => {
              e.dataTransfer.setData('text/plain', p.id);
              e.dataTransfer.effectAllowed = 'move';
              ctx.setDragId(p.id);
            }
          : undefined
      }
      onDragEnd={drags ? () => ctx.setDragId(null) : undefined}
      onDragOver={(e) => {
        if (!ctx.canDrop(p)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        ctx.place(p);
      }}
      title={drags ? 'Drag onto another box to put them under that person' : undefined}
      data-pid={p.id}
      data-me={me || undefined}
      data-focus={ctx.focus === p.id || undefined}
      data-how={p.how}
      style={hue == null ? undefined : ({ '--oc-h': hue } as CSSProperties)}
    >
      <span className="oc-band" aria-hidden="true" />
      <div className="oc-box-main">
        <Avatar name={p.name} size={40} />
        <div className="oc-box-text">
          <strong className="oc-name" title={p.name}>
            {p.name}
            {me && <Chip tone="info">You</Chip>}
          </strong>
          <span className="oc-role" title={p.title}>
            {p.title}
          </span>
          <span className="oc-meta">
            {deptLabel(p.department) && <span className="oc-dept">{deptLabel(p.department)}</span>}
            <span className="oc-how" data-how={p.how} title={p.setBy ? `${p.setBy.by}, ${dateLabel(p.setBy.at)}: ${p.setBy.reason}` : how.text}>
              {p.setBy?.until ? `Until ${dateLabel(p.setBy.until)}` : how.text}
            </span>
          </span>
          {p.heads.length > 0 && (
            <span className="oc-heads" title={p.heads.map((k) => ctx.unitName.get(k) ?? k).join(', ')}>
              {`Head: ${p.heads.map((k) => ctx.unitName.get(k) ?? k).join(', ')}`}
            </span>
          )}
        </div>
        {(p.canMove || canAdd) && (
          <div className="oc-menu-wrap">
            <button type="button" className="oc-more" aria-label={`Actions for ${p.name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              ⋯
            </button>
            {menu && (
              <div className="oc-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                {p.canMove && ctx.dnd && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), ctx.pick(p))}>
                    <ArrowsClockwiseIcon size={15} aria-hidden="true" />
                    Move (then press Put here)
                  </button>
                )}
                {p.canMove && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), ctx.onMove(p))}>
                    <ArrowsClockwiseIcon size={15} aria-hidden="true" />
                    Change line
                  </button>
                )}
                {canAdd && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), ctx.onAddUnder(p))}>
                    <UserPlusIcon size={15} aria-hidden="true" />
                    Put someone under
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {ctx.picked && ctx.canDrop(p) && (
        <button type="button" className="oc-puthere" onClick={() => ctx.place(p)}>
          Put here
        </button>
      )}
      {canAdd && !ctx.picked && (
        <button type="button" className="oc-add" title={`Put someone under ${p.name}`} aria-label={`Put someone under ${p.name}`} onClick={() => ctx.onAddUnder(p)}>
          <PlusIcon size={13} weight="bold" aria-hidden="true" />
        </button>
      )}
      {count > 0 && (
        <button type="button" className="oc-toggle" aria-expanded={open} onClick={() => ctx.toggle(p.id)} title={open ? 'Close' : `Open: ${total} under`}>
          {open ? <CaretDownIcon size={11} weight="bold" aria-hidden="true" /> : <CaretRightIcon size={11} weight="bold" aria-hidden="true" />}
          <span className="num">{open ? count : total}</span>
        </button>
      )}
    </div>
  );
}

/**
 * P129 (Fitri, 24 Nov 2026: "follow the Prima side"): Prima's own structure. The top of the group, then each central
 * department and central company Prima knows, with its head (by job, or named in Prima), its deputy and its staff.
 */
function UnitsTree({ ctx }: { ctx: Ctx }) {
  const tops = ctx.c.people.filter((p) => p.how === 'top');
  const units = ctx.c.units;
  return (
    <div className="oc-node">
      <div className="oc-box oc-group" style={{ '--oc-h': 160 } as CSSProperties}>
        <span className="oc-band" aria-hidden="true" />
        <div className="oc-box-main">
          <div className="oc-box-text">
            <strong className="oc-name">PWVSB Security Group</strong>
            <span className="oc-role">{tops.length ? tops.map((t) => `${t.name} (${t.title})`).join(' · ') : 'Group leadership'}</span>
            <span className="oc-meta">
              <span className="oc-dept">
                <span className="num">{units.length}</span> <span>units</span>
              </span>
            </span>
          </div>
        </div>
      </div>
      {units.length > 0 && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          <ul className="oc-kids oc-wrap">
            {units.map((u) => (
              <li key={u.key}>
                <UnitNode u={u} ctx={ctx} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UnitNode({ u, ctx }: { u: Unit; ctx: Ctx }) {
  const id = `unit:${u.key}`;
  const open = !ctx.closed.has(id) && ctx.openUnits.has(u.key);
  const members = useMemo(() => membersOf(u, ctx.c.people), [u, ctx.c.people]);
  const hue = hueOf(u.key);
  const [over, setOver] = useState(false);
  const edits = !!ctx.onUnit;
  return (
    <div className="oc-node">
      <div
        className="oc-box oc-unit"
        data-nohead={!u.heads.length || undefined}
        data-drop={(over && edits && !!ctx.dragId) || undefined}
        style={hue == null ? undefined : ({ '--oc-h': hue } as CSSProperties)}
        onDragOver={(e) => {
          if (!edits || !ctx.dragId) return;
          e.preventDefault();
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const who = ctx.dragId ? ctx.byId.get(ctx.dragId) : undefined;
          ctx.setDragId(null);
          if (who && ctx.onUnit) ctx.onUnit(u, who);
        }}
      >
        <span className="oc-band" aria-hidden="true" />
        <div className="oc-box-main">
          <div className="oc-box-text">
            <strong className="oc-name" title={u.label}>
              {u.label}
            </strong>
            {u.heads.length ? (
              u.heads.map((h) => (
                <span key={h.id} className="oc-unit-person">
                  <Avatar name={h.name} size={22} />
                  <span>
                    <strong>{h.name}</strong>
                    <span className="muted"> · {h.how === 'named' ? 'Head (named)' : 'Head'}</span>
                  </span>
                </span>
              ))
            ) : (
              <span className="oc-how" data-how="assumed">
                No head named
              </span>
            )}
            {u.deputy && (
              <span className="oc-unit-person">
                <Avatar name={u.deputy.name} size={22} />
                <span>
                  <strong>{u.deputy.name}</strong>
                  <span className="muted"> · Deputy</span>
                </span>
              </span>
            )}
          </div>
        </div>
        {edits && (
          <button type="button" className="oc-add" title={`Add to ${u.label}: head, deputy or member`} aria-label={`Add to ${u.label}`} onClick={() => ctx.onUnit?.(u, null)}>
            <PlusIcon size={13} weight="bold" aria-hidden="true" />
          </button>
        )}
        {members.length > 0 && (
          <button type="button" className="oc-toggle" aria-expanded={open} onClick={() => ctx.toggleUnit(u.key)} title={open ? 'Close' : 'Staff'}>
            {open ? <CaretDownIcon size={11} weight="bold" aria-hidden="true" /> : <CaretRightIcon size={11} weight="bold" aria-hidden="true" />}
            <span className="num">{members.length}</span>
          </button>
        )}
      </div>
      {open && members.length > 0 && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          <TeamBox people={members} ctx={ctx} />
        </>
      )}
    </div>
  );
}

/** Six or more people with nobody under them: one list box, as on a paper chart. */
function TeamBox({ people, ctx }: { people: Person[]; ctx: Ctx }) {
  return (
    <div className="oc-team">
      <div className="oc-team-head">
        <span>Team</span> · <span className="num">{people.length}</span>
      </div>
      <ul>
        {people.map((p) => (
          <li
            key={p.id}
            data-pid={p.id}
            data-focus={ctx.focus === p.id || undefined}
            data-me={p.id === ctx.c.meId || undefined}
            draggable={ctx.dnd || undefined}
            onDragStart={
              ctx.dnd
                ? (e) => {
                    e.dataTransfer.setData('text/plain', p.id);
                    ctx.setDragId(p.id);
                  }
                : undefined
            }
            onDragEnd={ctx.dnd ? () => ctx.setDragId(null) : undefined}
          >
            <Avatar name={p.name} size={26} />
            <span className="oc-team-text">
              <strong title={p.name}>{p.name}</strong>
              <span className="muted small" title={p.title}>
                {p.title}
              </span>
            </span>
            {p.canMove && (
              <button type="button" className="oc-team-act" title="Change line" aria-label={`Change line: ${p.name}`} onClick={() => ctx.onMove(p)}>
                <ArrowsClockwiseIcon size={14} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
