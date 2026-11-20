/**
 * P111: "My hierarchy" on My workspace. Fitri (17 Nov 2026): "in my workspace can see this my
 * hierarchy expand so see who is my higher ups". My manager first; open it to see everyone
 * above me up to the top; then me and the people who report to me. The managers above come by
 * name, job title, department and company only (the server's rule, lib/hierarchy.ts). Opens the
 * organization chart on me (Organization > Hierarchy; P113: every member opens it).
 * P120 (Fitri, 20 Nov 2026: "in their workspace they can see their hierarchy and who they report
 * to"): the people under me are the whole line, a tree that opens level by level.
 */
import { ArrowRightIcon, CaretDownIcon, CaretRightIcon, CaretUpIcon, TreeStructureIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { myHierarchyQuery, placeOf, type OrgPerson } from "@/lib/hierarchy";
import type { Me } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

/** P120: the line under me as a tree: who reports to whom, by name. */
function lineTree(line: OrgPerson[], me: string): { roots: OrgPerson[]; kids: Map<string, OrgPerson[]> } {
  const ids = new Set(line.map((p) => p.user_id));
  const kids = new Map<string, OrgPerson[]>();
  const roots: OrgPerson[] = [];
  for (const p of line) {
    const boss = p.reports_to_user_id;
    if (!boss || boss === me || !ids.has(boss)) roots.push(p);
    else kids.set(boss, [...(kids.get(boss) ?? []), p]);
  }
  const byName = (a: OrgPerson, b: OrgPerson) => a.name.localeCompare(b.name);
  roots.sort(byName);
  for (const list of kids.values()) list.sort(byName);
  return { roots, kids };
}

function countUnder(id: string, kids: Map<string, OrgPerson[]>, seen = new Set<string>()): number {
  let n = 0;
  for (const k of kids.get(id) ?? []) {
    if (seen.has(k.user_id)) continue;
    seen.add(k.user_id);
    n += 1 + countUnder(k.user_id, kids, seen);
  }
  return n;
}

function LineNode({ person, kids, depth, seen }: { person: OrgPerson; kids: Map<string, OrgPerson[]>; depth: number; seen: Set<string> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const mine = seen.has(person.user_id) ? [] : (kids.get(person.user_id) ?? []);
  const under = mine.length ? countUnder(person.user_id, kids) : 0;
  const place = placeOf(person);
  return (
    <li className="grid min-w-0">
      <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] py-1 pr-1 hover:bg-surface-2/60">
        {mine.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            aria-label={open ? t("Hide the people under {name}", { name: person.name }) : t("Show the people under {name}", { name: person.name })}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
            {open ? <CaretDownIcon size={13} weight="bold" /> : <CaretRightIcon size={13} weight="bold" />}
          </button>
        ) : <span aria-hidden className="size-7 shrink-0" />}
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{initials(person.name)}</span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-[13px] font-medium">{person.name}</span>
          {person.job_title || place ? (
            <span className="truncate text-[11.5px] text-muted" title={[person.job_title, place].filter(Boolean).join(" · ")}>
              {[person.job_title, place].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
        {under ? (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-muted tabular">
            {under === 1 ? t("1 under them") : t("{n} under them", { n: under })}
          </span>
        ) : null}
      </div>
      {open && mine.length ? (
        <ul className="ml-[13px] grid border-l border-border pl-3">
          {mine.map((k) => <LineNode key={k.user_id} person={k} kids={kids} depth={depth + 1} seen={new Set([...seen, person.user_id])} />)}
        </ul>
      ) : null}
    </li>
  );
}

/** Opens the chart on me: Organization > Hierarchy (P113: every member opens it). */
export function MyHierarchyLink({ me }: { me: Me }) {
  const t = useT();
  return (
    <Link to="/organization" search={{ view: "hierarchy", focus: me.user.id } as never}
      className="hit inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
      {t("Open the organization chart")} <ArrowRightIcon size={13} />
    </Link>
  );
}

function Row({ person, you, last }: { person: OrgPerson; you?: boolean; last?: boolean }) {
  const t = useT();
  const place = placeOf(person);
  return (
    <li className="relative flex min-w-0 items-start gap-3 pb-3">
      {!last ? <span aria-hidden className="absolute top-10 bottom-0 left-[19px] w-px bg-border" /> : null}
      <span aria-hidden className={cn(
        "relative grid size-10 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold ring-1",
        you ? "bg-accent text-accent-fg ring-accent/30" : "bg-accent-soft text-accent ring-accent/15",
      )}>
        {initials(person.name)}
      </span>
      <span className={cn("grid min-w-0 flex-1 gap-0.5 rounded-[var(--radius-sm)] px-2 py-1", you && "bg-accent-soft/40")}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[13.5px] font-semibold">
          <span className="min-w-0 break-words">{person.name}</span>
          {you ? <span className="text-[11.5px] font-medium text-accent">{t("You")}</span> : null}
        </span>
        {person.job_title ? <span className="text-[12.5px] font-medium text-accent">{person.job_title}</span> : null}
        {place ? <span className="truncate text-[12px] text-muted" title={place}>{place}</span> : null}
      </span>
    </li>
  );
}

export function MyHierarchy() {
  const t = useT();
  const { data, isLoading, error } = useQuery(myHierarchyQuery);
  const [whole, setWhole] = useState(false);
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (error || !data) {
    return <Card className="px-4 py-4 text-[13.5px] text-muted sm:px-5">{t("Could not load your hierarchy.")}</Card>;
  }
  const up = [...data.chain].reverse(); // the top first, my own manager last
  const shown = whole ? up : up.slice(-1);
  const hidden = up.length - shown.length;
  const reports = data.reports;
  const line = data.line?.length ? data.line : reports;
  if (!up.length && !reports.length) {
    return (
      <Card className="flex items-start gap-3 px-4 py-4 text-[13.5px] text-muted sm:px-5">
        <TreeStructureIcon size={20} className="mt-0.5 shrink-0 text-accent" weight="duotone" />
        <span>{t("Nobody is set above or under you yet. An owner or admin sets who reports to whom in Members.")}</span>
      </Card>
    );
  }
  return (
    <Card className="grid gap-1 px-4 py-4 sm:px-5">
      {up.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <span className="text-[12px] font-medium tracking-wide text-muted uppercase">
            {up.length === 1 ? t("You report to") : t("Your line of managers ({n})", { n: up.length })}
          </span>
          {up.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={() => setWhole((w) => !w)} aria-expanded={whole}>
              {whole ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
              {whole ? t("Show only my manager") : t("Show everyone above me ({n})", { n: hidden })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ol aria-label={t("My hierarchy")} className="grid min-w-0">
        {shown.map((p) => <Row key={p.user_id} person={p} />)}
        <Row person={data.me} you last />
      </ol>
      {reports.length ? <MyLine me={data.me.user_id} line={line} direct={reports.length} below={data.below} /> : null}
    </Card>
  );
}

/** P120: everyone under me, a tree that opens level by level. */
function MyLine({ me, line, direct, below }: { me: string; line: OrgPerson[]; direct: number; below: number }) {
  const t = useT();
  const { roots, kids } = useMemo(() => lineTree(line, me), [line, me]);
  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium tracking-wide text-muted uppercase">
        <UsersThreeIcon size={13} />
        {direct === 1 ? t("1 person reports to you") : t("{n} people report to you", { n: direct })}
        {below > direct ? <span className="normal-case tracking-normal">{t("· {n} in your whole line", { n: below })}</span> : null}
      </span>
      <ul aria-label={t("The people under you")} className="grid max-h-[26rem] min-w-0 overflow-y-auto overscroll-contain">
        {roots.map((p) => <LineNode key={p.user_id} person={p} kids={kids} depth={0} seen={new Set([me])} />)}
      </ul>
      <p className="text-[12px] text-muted">{t("You can give tasks to everyone in your line and follow their work.")}</p>
    </div>
  );
}
