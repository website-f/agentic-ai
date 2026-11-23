/**
 * P111: the organization chart (Organization > Hierarchy, and My workspace's "View as chart").
 * Fitri (17 Nov 2026): "in organization/members can show organization hierarchy and showing this
 * kind of visual mapping who report to who", like the Unit Pengurusan Sekolah chart: clean boxes
 * joined by lines. Boxes show the name, job title, department and company, and how many report
 * to them; a team of people with nobody under them shows as one list box (as on the paper
 * chart). Collapse and expand, zoom, drag to move around, find a person, filter by company or
 * department. On a phone: an indented list that opens level by level.
 *
 * Owners, admins, management and HR change who someone reports to right from a box (and who
 * is under them); the server checks every rule (no loops, nobody their own manager). What each
 * reader sees is the server's (lib/hierarchy.ts). No chart library: plain boxes and lines.
 * P113: everyone sees the whole organization; branch managers and HODs change the boxes of
 * their own people (`editable`), and everyone else gets a "View only" note and no menus.
 * P120 (Fitri, 20 Nov 2026: "the canvas for the hierarchy: we can add and search the user and
 * expand accordingly"): a + on each box they may change adds someone under that person (search
 * by name, title, company or department); the box opens and the new person is shown. A box's
 * menu also opens the person's own page in Members.
 */
import {
  ArrowsInIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CrownSimpleIcon,
  DotsThreeIcon,
  EyeIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  TreeStructureIcon,
  UserCircleIcon,
  UserSwitchIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { Skeleton } from "@/components/ui/skeleton";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  ancestorsOf,
  buildForest,
  descendantsOf,
  filterPeople,
  hierarchyKey,
  orgChartQuery,
  placeOf,
  setReportsTo,
  splitForest,
  type OrgNode,
  type OrgPerson,
} from "@/lib/hierarchy";
import { keys, membersQuery } from "@/lib/queries";
import { ROLE_INFO, type Me } from "@/lib/types";
import { useIsPhone } from "@/lib/use-media";
import { cn, initials } from "@/lib/utils";

import { TeamDialog } from "./members-org";

const ALL = "__all__";
const NO_ONE = "__none__";
/** A team of at least this many people with nobody under them shows as one list box. */
const TEAM_BOX = 3;
const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

interface ChartCtx {
  me: string;
  canEdit: boolean;
  /** P113: the reader's own managers (a branch manager or HOD may place people under them). */
  above: Set<string>;
  focus: string | null;
  matched: Set<string> | null;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onChangeManager: (p: OrgPerson) => void;
  onTeam: (p: OrgPerson) => void;
  /** P120: add someone under this person (a search). */
  onAdd: (p: OrgPerson) => void;
  /** P120: the box's menu opens the person's page in Members. */
  canOpenPage: boolean;
}

/** The chart with its tools. `initialFocus`: a person to find first (My workspace's link). */
export function OrgChartView({ me, initialFocus, embedded }: { me: Me; initialFocus?: string; embedded?: boolean }) {
  const t = useT();
  const phone = useIsPhone();
  const { data, isLoading, error, refetch } = useQuery(orgChartQuery);
  const [company, setCompany] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [focus, setFocus] = useState<string | null>(initialFocus === "me" ? me.user.id : (initialFocus ?? null));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [changing, setChanging] = useState<OrgPerson | null>(null);
  const [team, setTeam] = useState<OrgPerson | null>(null);
  const [adding, setAdding] = useState<OrgPerson | null>(null);
  const area = useRef<HTMLDivElement>(null);

  const all = useMemo(() => data?.people ?? [], [data]);
  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of all) if (p.branch_id && p.branch_name) seen.set(p.branch_id, p.branch_name);
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);
  const departments = useMemo(() => {
    const seen = new Map<string, { label: string; hint?: string }>();
    for (const p of all) {
      if (!p.department_id || !p.department_name) continue;
      if (company !== ALL && p.branch_id !== company) continue;
      seen.set(p.department_id, { label: p.department_name, hint: company === ALL ? (p.branch_name ?? undefined) : undefined });
    }
    return [...seen].map(([value, o]) => ({ value, ...o })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all, company]);
  const test = company === ALL && department === ALL ? null
    : (p: OrgPerson) => (company === ALL || p.branch_id === company || p.branch_ids.includes(company)) && (department === ALL || p.department_id === department);
  const { people, matched } = useMemo(() => filterPeople(all, test), [all, company, department]); // eslint-disable-line react-hooks/exhaustive-deps
  const forest = useMemo(() => buildForest(people), [people]);
  const { trees, alone } = useMemo(() => splitForest(forest, focus ?? undefined), [forest, focus]);
  const lines = people.filter((p) => p.reports_to_user_id && people.some((q) => q.user_id === p.reports_to_user_id)).length;

  // Finding a person: open every box above them, then bring theirs into view.
  const find = (id: string | null) => {
    setFocus(id);
    if (!id) return;
    if (!people.some((p) => p.user_id === id)) { setCompany(ALL); setDepartment(ALL); }
    const up = ancestorsOf(all, id);
    setCollapsed((c) => (up.some((u) => c.has(u)) ? new Set([...c].filter((x) => !up.includes(x))) : c));
  };
  useEffect(() => {
    if (!focus || !data) return;
    const id = requestAnimationFrame(() => {
      const el = area.current?.querySelector<HTMLElement>(`[data-person="${CSS.escape(focus)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [focus, data, phone, collapsed]);

  const withKids = useMemo(() => {
    const ids: string[] = [];
    const walk = (n: OrgNode) => { if (n.children.length) ids.push(n.person.user_id); n.children.forEach(walk); };
    forest.forEach(walk);
    return ids;
  }, [forest]);
  const above = useMemo(() => new Set(ancestorsOf(all, me.user.id)), [all, me.user.id]);
  const ctx: ChartCtx = {
    me: me.user.id,
    canEdit: !!data?.can_edit,
    above,
    focus,
    matched,
    collapsed,
    toggle: (id) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    onChangeManager: setChanging,
    onTeam: setTeam,
    onAdd: setAdding,
    canOpenPage: me.permissions.includes("members.manage") || me.permissions.includes("team.manage") || me.permissions.includes("office.view"),
  };

  if (isLoading) return <div className="grid gap-3"><Skeleton className="h-11" /><Skeleton className="h-96" /></div>;
  if (error || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
        <span className="min-w-0 flex-1">{t("Could not load the organization chart.")} {error ? errorMessage(error) : null}</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>{t("Try again")}</Button>
      </div>
    );
  }

  const personOptions = all.map((p) => ({
    value: p.user_id,
    label: p.name,
    hint: [p.job_title, placeOf(p)].filter(Boolean).join(" · ") || undefined,
    keywords: [p.job_title ?? "", p.branch_name ?? "", p.department_name ?? ""],
  }));

  return (
    <div className="grid min-w-0 gap-3">
      {/* Tools: find, filter, open or close every level, zoom */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56 max-sm:basis-full sm:max-w-80">
          <SearchSelect value={focus ?? ""} onValueChange={(v) => find(v || null)} label={t("Find a person")} placeholder={t("Find a person")}
            searchPlaceholder={t("Search by name, title, company or department")} options={personOptions} size="sm" />
        </div>
        {focus ? (
          <Button size="sm" variant="ghost" onClick={() => setFocus(null)}><XIcon size={14} /> {t("Clear")}</Button>
        ) : null}
        {companies.length > 1 ? (
          <div className="min-w-0 basis-44 max-sm:flex-1 max-sm:basis-36">
            <SearchSelect value={company} onValueChange={(v) => { setCompany(v); setDepartment(ALL); }} label={t("Company")} size="sm"
              searchPlaceholder={t("Search companies")} options={[{ value: ALL, label: t("All companies") }, ...companies]} />
          </div>
        ) : null}
        {departments.length ? (
          <div className="min-w-0 basis-44 max-sm:flex-1 max-sm:basis-36">
            <SearchSelect value={department} onValueChange={setDepartment} label={t("Department")} size="sm"
              searchPlaceholder={t("Search departments")} options={[{ value: ALL, label: t("All departments") }, ...departments]} />
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {withKids.length ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())} aria-label={t("Open every level")}>
                <ArrowsOutIcon size={15} /> <span className="max-sm:sr-only">{t("Open all")}</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(withKids))} aria-label={t("Close every level")}>
                <ArrowsInIcon size={15} /> <span className="max-sm:sr-only">{t("Close all")}</span>
              </Button>
            </>
          ) : null}
          {!phone ? (
            <span className="ml-1 inline-flex items-center rounded-full border border-border bg-surface">
              <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={t("Zoom out")} disabled={zoom <= ZOOMS[0]!}
                onClick={() => setZoom((z) => ZOOMS.filter((x) => x < z).at(-1) ?? z)}><MagnifyingGlassMinusIcon size={15} /></Button>
              <button type="button" className="min-w-12 text-center text-[12px] font-medium text-muted tabular hover:text-fg" onClick={() => setZoom(1)} title={t("Actual size")}>
                {Math.round(zoom * 100)}%
              </button>
              <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={t("Zoom in")} disabled={zoom >= ZOOMS.at(-1)!}
                onClick={() => setZoom((z) => ZOOMS.find((x) => x > z) ?? z)}><MagnifyingGlassPlusIcon size={15} /></Button>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-muted">
        {!data.can_edit ? (
          <Pill tone="neutral" className="gap-1 px-2 py-0.5 text-[11.5px]"><EyeIcon size={12} /> {t("View only")}</Pill>
        ) : null}
        <span>{t("{n} people · {lines} reporting lines", { n: people.length, lines })}</span>
        {!data.can_edit ? (
          <span className="min-w-0">· {t("Owners, admins, HQ management, HR, branch managers and heads of department keep it up to date.")}</span>
        ) : data.edit_scope === "branch" || data.edit_scope === "department" ? (
          <span className="min-w-0">· {data.edit_scope === "branch"
            ? t("You change the lines and job titles of the people in your branch.")
            : t("You change the lines and job titles of the people in your department.")}</span>
        ) : null}
        {/* P126: Prima keeps its own org chart (heads put staff under them; work, claims and leave follow it). */}
        {me.prima && (!me.prima_modules || me.prima_modules.includes("orgchart")) ? (
          <Link to="/prima" hash="orgchart" className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
            <TreeStructureIcon size={13} /> {t("Prima org chart")}
          </Link>
        ) : null}
      </div>

      <div ref={area} className="min-w-0">
        {!trees.length ? (
          <EmptyState icon={TreeStructureIcon} title={t("No reporting lines yet")}
            body={data.can_edit
              ? t("Set who each person reports to: use Change reports to on a person below, or tick many people in Members and pick Reports to.")
              : t("Nobody's reporting lines are set yet. Owners, admins, HQ management, HR, branch managers and heads of department set them.")} />
        ) : phone ? (
          <ul role="tree" aria-label={t("Organization chart")} className="grid gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-2">
            {trees.map((n) => <ListNode key={n.person.user_id} node={n} depth={0} ctx={ctx} />)}
          </ul>
        ) : (
          <PanArea className={embedded ? "h-[min(62vh,560px)]" : "h-[min(72vh,760px)]"}>
            <div className="w-max min-w-full p-6" style={{ zoom }}>
              <div className="flex items-start justify-center gap-10">
                {trees.map((n) => <TreeNode key={n.person.user_id} node={n} ctx={ctx} />)}
              </div>
            </div>
          </PanArea>
        )}
      </div>

      {alone.length ? <AloneList people={alone} ctx={ctx} total={all.length} /> : null}

      {changing ? <ChangeManagerDialog person={changing} people={all} above={above} onClose={() => setChanging(null)} /> : null}
      {team ? <TeamFor person={team} me={me} editable={!!team.editable || team.user_id === me.user.id} onClose={() => setTeam(null)} /> : null}
      {adding ? (
        <AddUnderDialog boss={adding} people={all} onClose={() => setAdding(null)}
          onAdded={(id) => {
            // Open the box the person went under (and every box above it), then show them.
            const up = [adding.user_id, ...ancestorsOf(all, adding.user_id)];
            setCollapsed((c) => new Set([...c].filter((x) => !up.includes(x))));
            setFocus(id);
          }} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- desktop: boxes and lines

/** Scrolls both ways, and moves when dragged on its background (a mouse or a pen). */
function PanArea({ className, children }: { className?: string; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // The top of the chart sits in the middle: start there (a person found moves it after).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, [role=menu], [data-person]")) return;
    const el = ref.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const up = () => { drag.current = null; };
  return (
    <div ref={ref} role="region" aria-label={t("Organization chart")} tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      className={cn("relative min-w-0 cursor-grab overflow-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface-2/40 active:cursor-grabbing",
        "bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px]", className)}>
      {children}
    </div>
  );
}

const LINE = "bg-[color-mix(in_oklab,var(--text-muted)_45%,transparent)]";

function TreeNode({ node, ctx }: { node: OrgNode; ctx: ChartCtx }) {
  const t = useT();
  const id = node.person.user_id;
  const open = !ctx.collapsed.has(id);
  const kids = node.children;
  const teamBox = kids.length >= TEAM_BOX && kids.every((k) => !k.children.length);
  return (
    <div className="flex flex-col items-center">
      <PersonBox person={node.person} ctx={ctx} count={kids.length}
        toggle={kids.length ? (
          <button type="button" onClick={() => ctx.toggle(id)} aria-expanded={open}
            aria-label={open ? t("Close the people under {name}", { name: node.person.name }) : t("Open the people under {name}", { name: node.person.name })}
            className="absolute -bottom-3 left-1/2 z-10 inline-flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[11px] font-semibold text-muted tabular shadow-sm hover:border-accent/50 hover:text-accent">
            {open ? <CaretDownIcon size={11} weight="bold" /> : <CaretRightIcon size={11} weight="bold" />}
            {open ? kids.length : node.size}
          </button>
        ) : null} />
      {kids.length && open ? (
        <>
          <span aria-hidden className={cn("h-7 w-px", LINE)} />
          {teamBox ? (
            <TeamBox people={kids.map((k) => k.person)} ctx={ctx} />
          ) : (
            <ul className="flex items-start">
              {kids.map((k, i) => (
                <li key={k.person.user_id} className="relative flex flex-col items-center px-3 pt-6">
                  {i > 0 ? <span aria-hidden className={cn("absolute top-0 right-1/2 left-0 h-px", LINE)} /> : null}
                  {i < kids.length - 1 ? <span aria-hidden className={cn("absolute top-0 right-0 left-1/2 h-px", LINE)} /> : null}
                  <span aria-hidden className={cn("absolute top-0 left-1/2 h-6 w-px", LINE)} />
                  <TreeNode node={k} ctx={ctx} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function Avatar({ person, me, size = "md" }: { person: OrgPerson; me: boolean; size?: "sm" | "md" }) {
  return (
    <span aria-hidden className={cn(
      "grid shrink-0 place-items-center rounded-full font-semibold ring-1",
      size === "sm" ? "size-8 text-[11px]" : "size-10 text-[12.5px]",
      me ? "bg-accent text-accent-fg ring-accent/30" : "bg-accent-soft text-accent ring-accent/15",
    )}>
      {initials(person.name)}
    </span>
  );
}

function Lines({ person, ctx }: { person: OrgPerson; ctx: ChartCtx }) {
  const t = useT();
  const place = placeOf(person);
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="line-clamp-2 min-w-0 text-[13.5px] leading-snug font-semibold break-words">{person.name}</span>
        {person.user_id === ctx.me ? <Pill tone="accent" className="px-1.5 py-0 text-[10.5px]">{t("You")}</Pill> : null}
      </span>
      {person.job_title ? <span className="line-clamp-2 text-[12px] leading-snug font-medium text-accent">{person.job_title}</span> : null}
      {place ? <span className="line-clamp-2 text-[11.5px] break-words text-muted" title={place}>{place}</span> : null}
      {person.reports_to_name ? <span className="truncate text-[11.5px] text-muted">{t("Reports to {name}", { name: person.reports_to_name })}</span> : null}
      {!person.is_active ? <span className="text-[11px] font-medium text-warn">{t("Account switched off")}</span> : null}
    </span>
  );
}

function PersonBox({ person, ctx, count, toggle }: { person: OrgPerson; ctx: ChartCtx; count: number; toggle: ReactNode }) {
  const t = useT();
  const isMe = person.user_id === ctx.me;
  const faded = ctx.matched !== null && !ctx.matched.has(person.user_id);
  return (
    <div data-person={person.user_id} className={cn(
      "relative w-60 rounded-[var(--radius-md)] border bg-surface text-left shadow-[0_1px_3px_hsl(var(--shadow)/0.08)] transition-[box-shadow,opacity]",
      isMe ? "border-accent/60" : "border-border",
      ctx.focus === person.user_id && "ring-2 ring-info ring-offset-2 ring-offset-bg",
      (faded || !person.is_active) && "opacity-55",
    )}>
      <span aria-hidden className={cn("block h-1 rounded-t-[var(--radius-md)]", isMe ? "bg-accent" : person.limited ? "bg-border" : "bg-accent/45")} />
      <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-3.5">
        <Avatar person={person} me={isMe} />
        <span className="min-w-0 flex-1"><Lines person={person} ctx={ctx} /></span>
        <span className="-mt-1 -mr-1.5 flex shrink-0 items-center">
          {mayAdd(person, ctx) ? (
            <Button variant="ghost" size="icon-sm" onClick={() => ctx.onAdd(person)} aria-label={t("Add someone under {name}", { name: person.name })} title={t("Add someone under {name}", { name: person.name })}>
              <PlusIcon size={15} weight="bold" />
            </Button>
          ) : null}
          <BoxMenu person={person} ctx={ctx} />
        </span>
      </div>
      {count || person.heads_department ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-3 py-1.5 pb-3 text-[11.5px] text-muted">
          {person.heads_department ? <Pill tone="accent" className="px-1.5 py-0 text-[10.5px]"><CrownSimpleIcon size={10} weight="fill" /> {t("HOD")}</Pill> : null}
          {count ? <span className="inline-flex items-center gap-1 tabular"><UsersThreeIcon size={12} /> {count === 1 ? t("1 direct report") : t("{n} direct reports", { n: count })}</span> : null}
        </div>
      ) : null}
      {toggle}
    </div>
  );
}

/** A team with nobody under them: one box listing them (as on the paper chart). */
function TeamBox({ people, ctx }: { people: OrgPerson[]; ctx: ChartCtx }) {
  return (
    <ul className="w-64 divide-y divide-border/70 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_3px_hsl(var(--shadow)/0.08)]">
      {people.map((p) => {
        const faded = ctx.matched !== null && !ctx.matched.has(p.user_id);
        return (
          <li key={p.user_id} data-person={p.user_id} className={cn(
            "flex items-start gap-2.5 px-3 py-2.5",
            p.user_id === ctx.me && "bg-accent-soft/40",
            ctx.focus === p.user_id && "bg-info/10 ring-2 ring-info ring-inset",
            (faded || !p.is_active) && "opacity-55",
          )}>
            <Avatar person={p} me={p.user_id === ctx.me} size="sm" />
            <span className="min-w-0 flex-1"><Lines person={p} ctx={ctx} /></span>
            <BoxMenu person={p} ctx={ctx} />
          </li>
        );
      })}
    </ul>
  );
}

/** P120: whether this reader may put people under this box (the server checks each one). */
function mayAdd(person: OrgPerson, ctx: ChartCtx): boolean {
  return ctx.canEdit && !person.limited && (!!person.editable || person.user_id === ctx.me);
}

function BoxMenu({ person, ctx }: { person: OrgPerson; ctx: ChartCtx }) {
  const t = useT();
  const navigate = useNavigate();
  // P113: only on the boxes this reader may change (the server's `editable`), and their own
  // box for the people under them; nothing for those who only look. P120: anyone who sees a
  // person in full opens their page in Members.
  const isMe = person.user_id === ctx.me;
  const edits = ctx.canEdit && !person.limited && (person.editable || isMe);
  const opens = ctx.canOpenPage && !person.limited;
  if (!edits && !opens) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={t("Options for {name}", { name: person.name })}>
          <DotsThreeIcon size={18} weight="bold" />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {opens ? (
          <MenuItem icon={<UserCircleIcon />} onSelect={() => void navigate({ to: "/settings/members/$userId", params: { userId: person.user_id } })}>{t("Open their page")}</MenuItem>
        ) : null}
        {edits && !isMe && person.editable ? (
          <MenuItem icon={<UserSwitchIcon />} onSelect={() => ctx.onChangeManager(person)}>{t("Change reports to")}</MenuItem>
        ) : null}
        {edits ? <MenuItem icon={<PlusIcon />} onSelect={() => ctx.onAdd(person)}>{t("Add someone under them")}</MenuItem> : null}
        {edits ? <MenuItem icon={<UsersThreeIcon />} onSelect={() => ctx.onTeam(person)}>{t("People under them")}</MenuItem> : null}
      </MenuContent>
    </Menu>
  );
}

/** P120: put one more person under `boss`: search everyone the reader may move (never the boss,
 * nor anyone above the boss: that would be a loop). The server checks every rule again. */
function AddUnderDialog({ boss, people, onClose, onAdded }: { boss: OrgPerson; people: OrgPerson[]; onClose: () => void; onAdded: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const up = useMemo(() => new Set(ancestorsOf(people, boss.user_id)), [people, boss.user_id]);
  const options = useMemo(() => people
    .filter((p) => p.user_id !== boss.user_id && !up.has(p.user_id) && !p.limited && p.editable && p.reports_to_user_id !== boss.user_id)
    .map((p) => ({
      value: p.user_id,
      label: p.name,
      hint: [p.job_title, placeOf(p), p.reports_to_user_id ? t("Now reports to {name}", { name: people.find((q) => q.user_id === p.reports_to_user_id)?.name ?? p.reports_to_name ?? "" }) : t("Reports to no one yet")].filter(Boolean).join(" · "),
      keywords: [p.job_title ?? "", p.branch_name ?? "", p.department_name ?? ""],
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), [people, boss.user_id, up, t]);
  const save = useMutation({
    mutationFn: () => setReportsTo(value, boss.user_id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: hierarchyKey });
      toast.success(t("{name} now reports to {boss}.", { name: options.find((o) => o.value === value)?.label ?? "", boss: boss.name }));
      onAdded(value);
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Add someone under {name}", { name: boss.name })}
      description={t("Pick the person who reports to {name}. They move from whoever they report to now.", { name: boss.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button disabled={!value} loading={save.isPending} onClick={() => save.mutate()}>{t("Add")}</Button></>}>
      <div className="grid gap-3">
        <SearchSelect value={value} onValueChange={setValue} label={t("Person")} placeholder={t("Search for a person")}
          searchPlaceholder={t("Search by name, title, company or department")} emptyText={t("Nobody matches.")} options={options} />
        {!options.length ? <p className="text-[12.5px] text-muted">{t("There is nobody you may move under them.")}</p> : null}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- phone: an indented list

function ListNode({ node, depth, ctx }: { node: OrgNode; depth: number; ctx: ChartCtx }) {
  const t = useT();
  const p = node.person;
  const kids = node.children;
  const open = !ctx.collapsed.has(p.user_id);
  const faded = ctx.matched !== null && !ctx.matched.has(p.user_id);
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={ctx.focus === p.user_id} className="min-w-0">
      <div data-person={p.user_id} className={cn(
        "flex min-h-14 min-w-0 items-start gap-2 rounded-[var(--radius-sm)] py-2 pr-1",
        p.user_id === ctx.me && "bg-accent-soft/40",
        ctx.focus === p.user_id && "ring-2 ring-info ring-inset",
        (faded || !p.is_active) && "opacity-55",
      )}>
        {kids.length ? (
          <button type="button" onClick={() => ctx.toggle(p.user_id)} className="hit -my-0.5 grid size-8 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2"
            aria-label={open ? t("Close the people under {name}", { name: p.name }) : t("Open the people under {name}", { name: p.name })}>
            {open ? <CaretDownIcon size={16} weight="bold" /> : <CaretRightIcon size={16} weight="bold" />}
          </button>
        ) : <span aria-hidden className="w-8 shrink-0" />}
        <Avatar person={p} me={p.user_id === ctx.me} size="sm" />
        <span className="min-w-0 flex-1"><Lines person={p} ctx={ctx} /></span>
        {kids.length ? <span className="mt-1 shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted tabular">{kids.length}</span> : null}
        <BoxMenu person={p} ctx={ctx} />
      </div>
      {kids.length && open ? (
        <ul role="group" className={cn("grid gap-1 border-l border-border", depth < 3 ? "ml-4 pl-1" : "ml-1.5 pl-0.5")}>
          {kids.map((k) => <ListNode key={k.person.user_id} node={k} depth={depth + 1} ctx={ctx} />)}
        </ul>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------- people on their own

const ALONE_SHOWN = 24;

/** Nobody above them and nobody under them (yet): listed apart, with a quick way to place them. */
function AloneList({ people, ctx, total }: { people: OrgPerson[]; ctx: ChartCtx; total: number }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, ALONE_SHOWN);
  return (
    <section aria-label={t("Not in the chart yet")} className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold">{t("Not in the chart yet ({n})", { n: people.length })}</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {people.length === total ? t("Nobody reports to anyone yet.") : t("Nobody above them and nobody under them yet.")}{" "}
            {ctx.canEdit ? t("Use Change reports to on a person, or tick many in Members and pick Reports to.") : null}
          </p>
        </div>
        {ctx.canEdit ? (
          <Link to="/settings/members" search={{ team: "unplaced" } as never} className="hit inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
            {t("Set many at once in Members")}
          </Link>
        ) : null}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => (
          <li key={p.user_id} data-person={p.user_id} className={cn(
            "flex min-w-0 items-start gap-2.5 rounded-[var(--radius-sm)] border border-border/70 px-3 py-2.5",
            ctx.focus === p.user_id && "ring-2 ring-info",
            !p.is_active && "opacity-55",
          )}>
            <Avatar person={p} me={p.user_id === ctx.me} size="sm" />
            <span className="min-w-0 flex-1"><Lines person={p} ctx={ctx} /></span>
            <BoxMenu person={p} ctx={ctx} />
          </li>
        ))}
      </ul>
      {people.length > ALONE_SHOWN ? (
        <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setAll((a) => !a)}>
          {all ? t("Show fewer") : t("Show all {n}", { n: people.length })}
        </Button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- changing it

/** Who this person reports to: anyone active here but themselves and the people under them
 * (P113: for a branch manager or HOD, someone of their part of the chart or above them). */
export function ChangeManagerDialog({ person, people, above, onClose }: { person: OrgPerson; people: OrgPerson[]; above?: Set<string>; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState(person.reports_to_user_id ?? NO_ONE);
  const under = useMemo(() => descendantsOf(people, person.user_id), [people, person.user_id]);
  const options = [
    { value: NO_ONE, label: t("No one (top of a line)") },
    ...people
      .filter((p) => p.user_id !== person.user_id && !under.has(p.user_id) && p.is_active && (!p.limited || !!above?.has(p.user_id)))
      .map((p) => ({
        value: p.user_id,
        label: p.name,
        hint: [p.job_title ?? (p.role ? tr(ROLE_INFO[p.role].label) : null), placeOf(p)].filter(Boolean).join(" · ") || undefined,
        keywords: [p.job_title ?? "", p.branch_name ?? "", p.department_name ?? ""],
      })),
  ];
  const save = useMutation({
    mutationFn: () => setReportsTo(person.user_id, value === NO_ONE ? null : value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.members });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      const boss = people.find((p) => p.user_id === value);
      toast.success(boss ? t("{name} now reports to {boss}.", { name: person.name, boss: boss.name }) : t("{name} now reports to no one.", { name: person.name }));
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}
      title={t("Who {name} reports to", { name: person.name })}
      description={t("Pick their manager. The people under {name} move with them.", { name: person.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-3">
        <SearchSelect value={value} onValueChange={setValue} label={t("Reports to")} searchPlaceholder={t("Search by name, title, company or department")} options={options} />
        <p className="text-[12.5px] text-muted">{t("A manager in a managing role (such as Head of department) can also give them tasks and follow their work.")}</p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** "People under them": the Members page's own dialog (tick who reports to this person). */
function TeamFor({ person, me, editable, onClose }: { person: OrgPerson; me: Me; editable: boolean; onClose: () => void }) {
  const { data: members } = useQuery(membersQuery);
  const member = members?.find((m) => m.user_id === person.user_id);
  if (!member) return null;
  return <TeamDialog member={member} me={me} editable={editable} open onOpenChange={(o) => !o && onClose()} />;
}
