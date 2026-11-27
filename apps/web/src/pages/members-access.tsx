/**
 * P99: what a member reaches. "Agentic + Prima" (the office and Prima: everyone by default) or
 * "Prima only" (they sign in on the same page and land in Prima; the office's pages are closed
 * to them). And their Prima modules: everything their Prima role allows, or a chosen list, in
 * Prima's own apps and groups. A choice only narrows: Prima's own role still decides inside.
 * Who may set it: owners, admins, management and HR (members.manage), never for themselves or
 * an owner, and never beyond what they have themselves (api/routers/members.py).
 * P106: and their Prima department (transport, procurement, hr) for their own Prima account; and
 * the developer's own choice of how they open Prima (PrimaOpensAsCard, on the Members page).
 * P128 (Fitri, 24 Nov 2026: what is set here did not show in Prima): the section shows what the
 * person will really get in Prima with what is on the form (their Prima role and department, the
 * screens that open), and for each picked module Prima will not open, what it still needs; a
 * department that opens more of them is offered by name, never given silently.
 */
import { ShieldCheckIcon, SquaresFourIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/ui/company-picker";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { MultiSelect, type PickOption } from "@/components/ui/search-select";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Access, LibraryGrants, Me, Member } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PrimaModule { id: string; title: string; blurb: string; always: boolean }
export interface PrimaApp { id: string; title: string; blurb: string; groups: { title: string; modules: PrimaModule[] }[] }
export interface PrimaCatalog {
  enabled: boolean;
  /** Modules everyone keeps (the home screen and their own things). */
  always: string[];
  /** The modules the reader may give (null: all of Prima). */
  mine: string[] | null;
  apps: PrimaApp[];
}

/** P106: the Prima departments a member's own Prima account may be in (the API's own list). */
// P125: every working central department (Prima opens a person's screens by department; ticking
// Prima modules only narrows what the role and department allow).
export const PRIMA_DEPARTMENTS = [
  "operations", "finance", "procurement", "hr", "chief_of_staff", "it", "legal", "audit",
  "transport", "asset", "pdpa", "fwm", "cms",
] as const;
export type PrimaDepartment = (typeof PRIMA_DEPARTMENTS)[number];

const DEPARTMENT_LABELS: Record<PrimaDepartment, string> = {
  operations: msg("Operations"),
  finance: msg("Finance"),
  procurement: msg("Procurement and stores"),
  hr: msg("HR"),
  chief_of_staff: msg("Chief of Staff office"),
  it: msg("IT"),
  legal: msg("Legal"),
  audit: msg("Audit (ACT)"),
  transport: msg("Transport"),
  asset: msg("Asset management"),
  pdpa: msg("PDPA"),
  fwm: msg("Foreign workers"),
  cms: msg("CMS (control and monitoring)"),
};
/** P125: these open staff personal data, payroll or money: central staff only. */
const SENSITIVE_DEPARTMENTS: readonly PrimaDepartment[] = ["hr", "finance", "chief_of_staff", "audit", "legal"];

/** `department` left out: not changed (the bulk dialog never sets it). */
export interface AccessValue { access: Access; modules: string[] | null; department?: PrimaDepartment | null }

export const DEFAULT_ACCESS: AccessValue = { access: "agentic", modules: null };

/** Who may set what someone reaches (the server checks again). */
export const setsAccess = (me: Me) => me.permissions.includes("members.manage");

export const accessOf = (m: Member): AccessValue => ({
  access: m.access ?? "agentic",
  modules: m.prima_modules ?? null,
  ...(m.prima_department ? { department: m.prima_department } : {}),
});

export const primaCatalogQuery = {
  queryKey: ["members", "prima-modules"],
  queryFn: () => api<PrimaCatalog>("/api/members/prima-modules"),
  staleTime: 5 * 60_000,
};

const sameList = (a: string[] | null, b: string[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && [...a].sort().join() === [...b].sort().join());

/** The body to send: only what changed (nothing when nothing did). */
export function accessChanges(before: AccessValue, after: AccessValue): { access?: Access; prima_modules?: string[] | null; prima_department?: PrimaDepartment | null } {
  const dept = after.department;
  return {
    ...(after.access !== before.access ? { access: after.access } : {}),
    ...(!sameList(after.modules, before.modules) ? { prima_modules: after.modules } : {}),
    ...(dept !== undefined && dept !== (before.department ?? null) ? { prima_department: dept } : {}),
  };
}

const NO_DEPARTMENT = "none";

/** P106: the Prima department for a person's own Prima account, with a plain warning for HR. */
export function PrimaDepartmentField({ value, onChange, label }: {
  value: PrimaDepartment | null;
  onChange: (d: PrimaDepartment | null) => void;
  label?: string;
}) {
  const t = useT();
  const name = label ?? t("Prima department");
  const options = [
    { value: NO_DEPARTMENT, label: t("No department") },
    ...PRIMA_DEPARTMENTS.map((d) => ({ value: d, label: t(DEPARTMENT_LABELS[d]) })),
  ];
  return (
    <div className="grid gap-1.5" data-testid="prima-department">
      <span className="text-[13px] font-medium">{name}</span>
      <Select value={value ?? NO_DEPARTMENT} options={options} label={name} className="w-full sm:w-72"
        onValueChange={(v) => onChange(v === NO_DEPARTMENT ? null : (v as PrimaDepartment))} />
      <p className="text-[12.5px] text-muted">{t("For their own Prima account: Prima opens the screens of their department, and the department's work comes with it. It reaches their Prima on their next reload. A Prima staff record keeps the department set in Prima.")}</p>
      {value === "hr" ? (
        <p role="note" className="flex items-start gap-1.5 rounded-sm border border-warn/30 bg-warn/8 px-2.5 py-2 text-[12.5px]">
          <WarningIcon size={14} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <span>{t("HR sees staff personal data and payroll in Prima. Give it only to people who do HR work. Central staff only, not branch managers.")}</span>
        </p>
      ) : value && SENSITIVE_DEPARTMENTS.includes(value) ? (
        <p role="note" className="flex items-start gap-1.5 rounded-sm border border-warn/30 bg-warn/8 px-2.5 py-2 text-[12.5px]">
          <WarningIcon size={14} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <span>{t("This department sees money, pay or staff records in Prima. Give it only to people who do that work. Central staff only, not branch managers.")}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The choosable modules as grouped options (Prima's apps), the ones everyone keeps left out;
 * a module the reader does not have (and the person does not have already) cannot be picked. */
export function moduleOptions(cat: PrimaCatalog, had: string[] | null): PickOption[] {
  const may = (id: string) => cat.mine === null || cat.mine.includes(id) || had === null || had.includes(id);
  return cat.apps.flatMap((a) =>
    a.groups.flatMap((g) =>
      g.modules
        .filter((m) => !m.always)
        .map((m) => ({
          value: m.id,
          label: m.title,
          hint: [g.title !== a.title ? g.title : "", m.blurb].filter(Boolean).join(" · "),
          group: a.title,
          keywords: [a.title, g.title],
          disabled: !may(m.id),
        })),
    ),
  );
}

const ACCESS_CHOICES: { value: Access; title: string; line: string }[] = [
  { value: "agentic", title: msg("Agentic + Prima"), line: msg("The office (desk, AI, tasks, chat) and Prima.") },
  { value: "prima_only", title: msg("Prima only"), line: msg("Signs in on the same page and goes straight to Prima. No office pages, AI or chat.") },
];

/** The Access section of the member editor. */
export function AccessFields({ value, onChange, member, ownerTarget, noDepartment }: {
  value: AccessValue;
  onChange: (v: AccessValue) => void;
  /** Editing someone already here: their Prima role is shown, and what they had counts as theirs. */
  member?: Member;
  /** An owner keeps everything: shown, not editable. */
  ownerTarget?: boolean;
  /** P106: the bulk dialog sets no department. */
  noDepartment?: boolean;
}) {
  const t = useT();
  const cat = useQuery(primaCatalogQuery);
  const had = member ? (member.prima_modules ?? null) : null;
  const choose = value.modules !== null;
  // "All" only from someone who has all of Prima (or for someone who has it already).
  const allowedAll = cat.data ? cat.data.mine === null || (!!member && had === null) : true;
  const alwaysNames = cat.data
    ? cat.data.apps.flatMap((a) => a.groups.flatMap((g) => g.modules)).filter((m) => m.always).map((m) => m.title)
    : [];
  if (ownerTarget) {
    return (
      <fieldset className="grid gap-1.5 rounded-[var(--radius-md)] border border-border p-3">
        <legend className="px-1 text-[13px] font-medium">{t("Access")}</legend>
        <p className="text-[12.5px] text-muted">{t("Owners always have the office and all of Prima.")}</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3" data-testid="access-fields">
      <legend className="px-1 text-[13px] font-medium">{t("Access")}</legend>
      <div role="radiogroup" aria-label={t("What they can open")} className="grid gap-2 sm:grid-cols-2">
        {ACCESS_CHOICES.map((c) => {
          const on = value.access === c.value;
          return (
            <button key={c.value} type="button" role="radio" aria-checked={on}
              onClick={() => onChange({ ...value, access: c.value })}
              className={cn(
                "grid min-h-11 content-start gap-0.5 rounded-sm border p-2.5 text-left focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none",
                on ? "border-accent bg-accent-soft/50" : "border-border bg-surface hover:bg-surface-2",
              )}>
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                <span aria-hidden className={cn("grid size-4 place-items-center rounded-full border", on ? "border-accent" : "border-border")}>
                  {on ? <span className="size-2 rounded-full bg-accent" /> : null}
                </span>
                {t(c.title)}
              </span>
              <span className="text-[12.5px] text-muted">{t(c.line)}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Prima modules")}</span>
        <div role="radiogroup" aria-label={t("Prima modules")} className="flex flex-wrap gap-2">
          {[
            { on: !choose, label: t("All modules their Prima role allows"), pick: () => onChange({ ...value, modules: null }), disabled: !allowedAll },
            { on: choose, label: t("Choose modules"), pick: () => onChange({ ...value, modules: had ?? [] }), disabled: false },
          ].map((o) => (
            <button key={o.label} type="button" role="radio" aria-checked={o.on} disabled={o.disabled && !o.on} onClick={o.pick}
              className={cn(
                "min-h-9 rounded-sm border px-3 py-1.5 text-[13px] disabled:opacity-50",
                o.on ? "border-accent bg-accent-soft/50 font-medium" : "border-border bg-surface hover:bg-surface-2",
              )}>
              {o.label}
            </button>
          ))}
        </div>
        {choose ? (
          cat.isLoading ? <Skeleton className="h-10 rounded-sm" /> : cat.data ? (
            <>
              <MultiSelect value={value.modules ?? []} onValueChange={(v) => onChange({ ...value, modules: v })}
                options={moduleOptions(cat.data, had)} label={t("Prima modules")} placeholder={t("Pick the Prima modules")}
                searchPlaceholder={t("Search Prima modules")} maxChips={8} />
              <p className="text-[12.5px] text-muted">
                {t("Always included: {names}.", { names: alwaysNames.join(", ") })}{" "}
                {t("A module not picked is hidden in Prima, and Prima refuses it with a plain message.")}
              </p>
              <p className="rounded-sm border border-warn/30 bg-warn/6 px-2.5 py-1.5 text-[12.5px]">
                {t("Prima opens a screen only for the role, department or job that works it. What they will really get, and what each picked module still needs, is shown below.")}
              </p>
              {cat.data.mine !== null ? <p className="text-[12.5px] text-muted">{t("You can give only the Prima modules you have yourself.")}</p> : null}
            </>
          ) : <FormError message={cat.error ? errorMessage(cat.error) : null} />
        ) : (
          <p className="text-[12.5px] text-muted">{t("Everything their Prima role allows. Prima's own role checks always apply.")}</p>
        )}
        {cat.data && !cat.data.enabled ? <p className="text-[12.5px] text-muted">{t("Prima is not set up on this server yet; this applies once it is.")}</p> : null}
      </div>
      {noDepartment ? null : (
        <PrimaDepartmentField value={value.department ?? null} onChange={(d) => onChange({ ...value, department: d })} />
      )}
      {member ? (
        <PrimaRoleLine member={member} value={value}
          onDepartment={noDepartment ? undefined : (d) => onChange({ ...value, department: d })} />
      ) : null}
    </fieldset>
  );
}

interface Screen { id: string; title: string }
/** P128: what a picked screen that Prima will not open for them needs (api: screen_access.py). */
export interface PrimaNeed extends Screen {
  kind: "department" | "branch_manager" | "central_staff" | "job" | "leadership" | "none";
  departments: PrimaDepartment[];
  jobs: string[];
}
/** P128: what they really get in Prima, by Prima's own menu rule. */
export interface PrimaEffective {
  role: string;
  role_label: string;
  department: PrimaDepartment | null;
  how: "chosen" | "none" | "refused" | "top";
  screens: Screen[];
  needs: PrimaNeed[];
  company_access: Screen[];
  suggestion: { department: PrimaDepartment; adds: Screen[]; sensitive: boolean } | null;
}
interface PrimaRole { enabled: boolean; role: string | null; role_label: string | null; where: string; record: string | null; effective: PrimaEffective | null }

/** P128: the address that explains what someone gets in Prima with the form's modules and
 * department (not saved yet). */
export function primaPreviewPath(userId: string, value: AccessValue): string {
  const q = new URLSearchParams();
  q.set("modules", value.modules === null ? "all" : value.modules.join(","));
  if (value.department !== undefined) q.set("department", value.department ?? "none");
  return `/api/members/${userId}/prima?${q.toString()}`;
}

const listNames = (xs: { title: string }[]) => xs.map((x) => x.title).join(", ");

/** P128: what a picked module still needs, in plain words. */
export function needLine(n: PrimaNeed, t: ReturnType<typeof useT>): string {
  switch (n.kind) {
    case "department": {
      const names = n.departments.map((d) => t(DEPARTMENT_LABELS[d]));
      return names.length === 1
        ? t("Needs Prima department {department}.", { department: names[0] ?? "" })
        : t("Needs one of these Prima departments: {departments}.", { departments: names.join(", ") });
    }
    case "branch_manager":
      return t("Only for a company's office staff (office role Branch manager).");
    case "central_staff":
      return t("Only for central staff, not a branch manager.");
    case "job":
      return t("Needs a Prima job ({jobs}). It is given in Prima (Accounts and access), not from the office.", { jobs: n.jobs.slice(0, 3).join(", ") });
    case "leadership":
      return t("Only for group leadership in Prima.");
    default:
      return t("Not opened to office accounts.");
  }
}

/** The Prima role this person has and where it is set (their Prima staff record, their office
 * role, or owner); P128: and what they will really get there with the access on the form. */
function PrimaRoleLine({ member, value, onDepartment }: {
  member: Member;
  value: AccessValue;
  onDepartment?: (d: PrimaDepartment) => void;
}) {
  const t = useT();
  const path = primaPreviewPath(member.user_id, value);
  const q = useQuery({
    queryKey: ["members", member.user_id, "prima", path],
    queryFn: () => api<PrimaRole>(path),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  if (q.isLoading) return <Skeleton className="h-9 rounded-sm" />;
  if (!q.data) return <FormError message={q.error ? errorMessage(q.error) : null} />;
  const e = q.data.effective;
  return (
    <div className="grid gap-2 rounded-sm bg-surface-2/70 px-3 py-2 text-[12.5px]" data-testid="prima-role">
      <div className="grid gap-0.5">
        <span className="font-medium">{q.data.role_label ? t("Prima role: {role}", { role: q.data.role_label }) : t("Prima role")}</span>
        <span className="text-muted">{q.data.where}</span>
      </div>
      {e ? <PrimaEffectiveView e={e} onDepartment={onDepartment} /> : null}
    </div>
  );
}

function PrimaEffectiveView({ e, onDepartment }: { e: PrimaEffective; onDepartment?: (d: PrimaDepartment) => void }) {
  const t = useT();
  const tip = e.suggestion;
  return (
    <div className="grid gap-2 border-t border-border pt-2" data-testid="prima-effective">
      <span className="font-medium">{t("In Prima they will get")}</span>
      {e.how !== "top" ? (
        <span>
          {e.department
            ? t("Prima department: {department}", { department: t(DEPARTMENT_LABELS[e.department]) })
            : t("Prima department: none")}
        </span>
      ) : null}
      {e.how === "refused" ? (
        <p role="note" className="flex items-start gap-1.5 rounded-sm border border-warn/30 bg-warn/8 px-2.5 py-2">
          <WarningIcon size={14} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <span>{t("Prima refused this department for them: their own staff record is in a company's office, so they are that company's office staff. Their Prima opens with no department.")}</span>
        </p>
      ) : null}
      <div className="grid gap-0.5">
        <span className="text-muted">{t("Screens that open")}</span>
        <span data-testid="prima-opens">{e.screens.length ? listNames(e.screens) : t("None")}</span>
      </div>
      {e.needs.length ? (
        <div className="grid gap-1" data-testid="prima-needs">
          <span className="text-muted">{t("Picked, but Prima will not open them yet")}</span>
          <ul className="grid gap-1">
            {e.needs.map((n) => (
              <li key={n.id} className="flex items-start gap-1.5">
                <WarningIcon size={13} className="mt-0.5 shrink-0 text-warn" />
                <span><span className="font-medium">{n.title}</span>: {needLine(n, t)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tip && onDepartment ? (
        <div className="grid gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-2" data-testid="prima-suggestion">
          <span>
            {t("Prima department {department} would also open: {screens}.", { department: t(DEPARTMENT_LABELS[tip.department]), screens: listNames(tip.adds) })}{" "}
            {t("A department is a job in Prima: they get all of that department's work, not only these screens.")}
          </span>
          {tip.sensitive ? <span className="text-warn">{t("This department sees money, pay, staff records or other protected data in Prima.")}</span> : null}
          <div>
            <Button size="sm" variant="outline" onClick={() => onDepartment(tip.department)}>
              {t("Use {department}", { department: t(DEPARTMENT_LABELS[tip.department]) })}
            </Button>
          </div>
        </div>
      ) : null}
      {e.company_access.length ? (
        <p className="text-muted">{t("{screens}: shows a company's records only for the companies Prima gives them (Accounts and access in Prima).", { screens: listNames(e.company_access) })}</p>
      ) : null}
    </div>
  );
}

/** Small badges for the members list: "Prima only", "N Prima modules". */
export function AccessBadges({ member }: { member: Member }) {
  const t = useT();
  const n = member.prima_modules?.length;
  if (member.access !== "prima_only" && member.prima_modules == null) return null;
  return (
    <>
      {member.access === "prima_only" ? <Pill tone="info"><ShieldCheckIcon size={12} weight="fill" /> {t("Prima only")}</Pill> : null}
      {member.prima_modules != null ? (
        <Pill tone="neutral" title={t("Their chosen Prima modules (the home screen and their own things always come too)")}>
          <SquaresFourIcon size={12} /> {n === 1 ? t("1 Prima module") : t("{n} Prima modules", { n: n ?? 0 })}
        </Pill>
      ) : null}
    </>
  );
}

interface BulkOut { results: { user_id: string; ok: boolean; message: string | null }[]; done: number; skipped: number }

/** Access for everyone ticked at once (owners and the person themselves are skipped and say why). */
export function BulkAccessDialog({ userIds, open, onOpenChange, onDone }: {
  userIds: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState<AccessValue>(DEFAULT_ACCESS);
  const save = useMutation({
    mutationFn: () => api<BulkOut>("/api/members/bulk", "POST", { user_ids: userIds, action: "prima", access: value.access, prima_modules: value.modules }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      if (r.done) toast.success(r.done === 1 ? tr("1 person changed.") : tr("{n} people changed.", { n: r.done }));
      if (r.skipped) {
        const first = r.results.find((x) => !x.ok)?.message;
        const line = r.skipped === 1 ? tr("1 person skipped.") : tr("{n} people skipped.", { n: r.skipped });
        toast.warning(first ? `${line} ${first}` : line);
      }
      onDone?.();
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}
      title={userIds.length === 1 ? t("Access for 1 person") : t("Access for {n} people", { n: userIds.length })}
      description={t("Everyone ticked gets this access. Anyone the rules stop is skipped and keeps what they have.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-4">
        <AccessFields value={value} onChange={setValue} noDepartment />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

type OpensAsChoice = { opens_as: "top" | "own"; department: PrimaDepartment | null };

interface OpensAs extends OpensAsChoice {
  enabled: boolean;
  can_choose: boolean;
  account: { id: string; name: string; department: PrimaDepartment | null } | null;
}

const OPENS_AS_KEY = ["prima", "opens-as"];

const OPENS_AS_CHOICES = [
  { value: "top" as const, title: msg("The CEO record (sees everything)"), line: msg("As every owner: Prima's top record. Use it to review and OK.") },
  { value: "own" as const, title: msg("My own Prima account"), line: msg("Central staff in the department below. Use it to prepare loads; someone else OKs them.") },
];

/** P106: the developer opens Prima as its CEO record (sees everything; the default) or as their
 * own Prima account in a department they pick, to prepare loads someone else OKs. Shown only to
 * the developer; each switch is in the activity log. */
export function PrimaOpensAsCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: OPENS_AS_KEY, queryFn: () => api<OpensAs>("/api/prima/opens-as"), staleTime: 60_000 });
  const [pick, setPick] = useState<OpensAsChoice | null>(null);
  const save = useMutation({
    mutationFn: (b: OpensAsChoice) => api<OpensAs>("/api/prima/opens-as", "PUT", b),
    onSuccess: (d) => {
      qc.setQueryData(OPENS_AS_KEY, d);
      void qc.invalidateQueries({ queryKey: ["prima", "status"] });
      setPick(null);
      toast.success(d.opens_as === "own" ? tr("Prima now opens as your own account.") : tr("Prima now opens as the CEO record."));
    },
  });
  const d = q.data;
  if (!d?.can_choose || !d.enabled) return null;
  const now: OpensAsChoice = pick ?? { opens_as: d.opens_as, department: d.department };
  const changed = now.opens_as !== d.opens_as || now.department !== d.department;
  return (
    <section data-testid="prima-opens-as" className="mb-4 grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="grid gap-0.5">
        <h2 className="flex items-center gap-2 text-[14.5px] font-semibold"><ShieldCheckIcon size={16} className="text-accent" /> {t("Open Prima as")}</h2>
        <p className="text-[12.5px] text-muted">{t("Only you (the developer) see this. Nobody OKs their own load: what your own account loads, the CEO OKs, and the office refuses your own OK on it through the CEO record.")}</p>
      </div>
      <div role="radiogroup" aria-label={t("Open Prima as")} className="grid gap-2 sm:grid-cols-2">
        {OPENS_AS_CHOICES.map((c) => {
          const on = now.opens_as === c.value;
          return (
            <button key={c.value} type="button" role="radio" aria-checked={on}
              onClick={() => setPick({ ...now, opens_as: c.value })}
              className={cn(
                "grid min-h-11 content-start gap-0.5 rounded-sm border p-2.5 text-left focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none",
                on ? "border-accent bg-accent-soft/50" : "border-border bg-surface hover:bg-surface-2",
              )}>
              <span className="text-[13.5px] font-medium">{t(c.title)}</span>
              <span className="text-[12.5px] text-muted">{t(c.line)}</span>
            </button>
          );
        })}
      </div>
      <PrimaDepartmentField value={now.department} label={t("Department of my own Prima account")}
        onChange={(dep) => setPick({ ...now, department: dep })} />
      {d.account ? (
        <p className="text-[12.5px] text-muted">{t("Your own Prima account: {name} ({id}).", { name: d.account.name, id: d.account.id })}</p>
      ) : null}
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div>
        <Button size="sm" disabled={!changed} loading={save.isPending} onClick={() => save.mutate(now)}>{t("Save")}</Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- P109 Library by department

/** P109: what of the Library a member reads, and whether they may upload for other companies.
 * P144: and what more of it was given to them (units, companies; missing: nothing given). */
export interface LibraryValue { scope: "company" | "department"; forOthers: boolean; grants?: LibraryGrants }

export const NO_GRANTS: LibraryGrants = { units: [], companies: [], departments: [] };

export const libraryOf = (m: Member | null): LibraryValue => ({
  scope: m?.library_scope ?? "company",
  forOthers: !!m?.uploads_for_others,
  ...(m?.library_grants ? { grants: m.library_grants } : {}),
});

/** The same grant written one way (sorted ids), to tell whether it changed. */
const grantKey = (g: LibraryGrants | undefined) => {
  const v = g ?? NO_GRANTS;
  const list = (x: string[] | "all") => (x === "all" ? "all" : [...x].sort().join(","));
  return `${list(v.units)}|${list(v.companies)}|${[...v.departments].sort().join(",")}`;
};

const emptyGrants = (g: LibraryGrants) =>
  (g.units === "all" ? false : !g.units.length) && (g.companies === "all" ? false : !g.companies.length) && !g.departments.length;

/** The body for PUT /api/members/{id}/library: only what changed (null: nothing). P144: the
 * grant goes whole (null when nothing is given any more). */
export function libraryChanges(before: LibraryValue, after: LibraryValue): { library_scope?: string; uploads_for_others?: boolean; grants?: LibraryGrants | null } | null {
  const g = after.grants ?? NO_GRANTS;
  const out = {
    ...(after.scope !== before.scope ? { library_scope: after.scope } : {}),
    ...(after.forOthers !== before.forOthers ? { uploads_for_others: after.forOthers } : {}),
    ...(grantKey(after.grants) !== grantKey(before.grants) ? { grants: emptyGrants(g) ? null : g } : {}),
  };
  return Object.keys(out).length ? out : null;
}

export interface GrantUnit { key: "hr" | "audit" | "finance"; label: string }

/** P144: one short line of what they get in the Library: their own part, then what was given. */
export function librarySummary(value: LibraryValue, units: GrantUnit[], companies: { id: string; name: string }[], t: ReturnType<typeof useT>): string {
  const g = value.grants ?? NO_GRANTS;
  const parts = [value.scope === "department" ? t("their own department") : t("their whole company")];
  if (g.units === "all") parts.push(t("all units"));
  else if (g.units.length) parts.push(g.units.map((k) => t(units.find((u) => u.key === k)?.label ?? k)).join(", "));
  if (g.companies === "all") parts.push(t("all companies"));
  else if (g.companies.length) {
    const names = g.companies.map((id) => companies.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
    parts.push(names.length && names.length <= 3 ? names.join(", ") : t("{n} more companies", { n: g.companies.length }));
  }
  if (g.departments.length) parts.push(g.departments.length === 1 ? t("1 more department") : t("{n} more departments", { n: g.departments.length }));
  return t("They read: {what}.", { what: parts.join(" · ") });
}

// The roles the "own department only" choice narrows (api/knowledge/dept_scope.LIMITABLE_ROLES).
const LIMITABLE: string[] = ["hod", "supervisor", "staff"];

/** "Library: whole company / own department only" and "May upload for other companies". P144:
 * with `give`, also the units and companies given to them (extra access, never less): `units`
 * and `companies` are the ones the person setting it may give; `every`: they may give all
 * companies (owners and admins). */
export function LibraryAccessFields({ value, onChange, role, give }: {
  value: LibraryValue;
  onChange: (v: LibraryValue) => void;
  role: string;
  give?: { units: GrantUnit[]; companies: { id: string; name: string; slug?: string }[]; every: boolean };
}) {
  const t = useT();
  const limitable = LIMITABLE.includes(role);
  const g = value.grants ?? NO_GRANTS;
  const setGrants = (patch: Partial<LibraryGrants>) => onChange({ ...value, grants: { ...g, ...patch } });
  const unitOn = (k: GrantUnit["key"]) => g.units === "all" || g.units.includes(k);
  const toggleUnit = (k: GrantUnit["key"], on: boolean) => {
    const now = g.units === "all" ? (give?.units ?? []).map((u) => u.key) : g.units;
    const next = on ? [...new Set([...now, k])] : now.filter((x) => x !== k);
    setGrants({ units: give && give.units.length > 1 && next.length === give.units.length ? "all" : next });
  };
  const check = "mt-1 size-4 shrink-0 accent-[var(--accent)]";
  return (
    <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
      <legend className="px-1 text-[13px] font-medium">{give ? t("Library access") : t("Library")}</legend>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Files they can see")}</span>
        <Select value={value.scope} onValueChange={(v) => onChange({ ...value, scope: v as LibraryValue["scope"] })} label={t("Files they can see")}
          options={[
            { value: "company", label: t("Whole company") },
            { value: "department", label: t("Own department only") },
          ]} />
        <p className="text-[12.5px] text-muted">
          {!limitable ? t("Their role sees more than one department, so this applies only to heads of department, supervisors and staff.")
            : value.scope === "department" ? t("They and their AI see only their department's files, plus their own files and the work they are part of.")
            : t("They and their AI see their company's files, as before.")}
        </p>
      </div>
      {give && give.units.length ? (
        <div className="grid gap-1.5" role="group" aria-label={t("Units")}>
          <span className="text-[13px] font-medium">{t("Units")}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {give.units.length > 1 ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13.5px]">
                <input type="checkbox" className={check} checked={g.units === "all"}
                  onChange={(e) => setGrants({ units: e.target.checked ? "all" : [] })} />
                {t("All units")}
              </label>
            ) : null}
            {give.units.map((u) => (
              <label key={u.key} className="flex min-h-11 cursor-pointer items-center gap-2 text-[13.5px]">
                <input type="checkbox" className={check} checked={unitOn(u.key)} onChange={(e) => toggleUnit(u.key, e.target.checked)} />
                {t(u.label)}
              </label>
            ))}
          </div>
          <p className="text-[12.5px] text-muted">{t("They open the unit in the Library, read its files and add files to it, as its own people do.")}</p>
        </div>
      ) : null}
      {give && (give.every || give.companies.length) ? (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Other companies")}</span>
          {give.every ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13.5px]">
              <input type="checkbox" className={check} checked={g.companies === "all"}
                onChange={(e) => setGrants({ companies: e.target.checked ? "all" : [] })} />
              {t("All companies")}
            </label>
          ) : null}
          {g.companies !== "all" ? (
            <CompanyPicker multiple companies={give.companies} value={g.companies} onValueChange={(ids) => setGrants({ companies: ids })}
              label={t("Other companies")} placeholder={t("Pick companies")} />
          ) : null}
          <p className="text-[12.5px] text-muted">{t("They read each company's shared files (never restricted ones or anyone's own files) and add files to it.")}</p>
        </div>
      ) : null}
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" checked={value.forOthers} onChange={(e) => onChange({ ...value, forOthers: e.target.checked })}
          className={check} />
        <span className="grid gap-0.5">
          <span className="text-[13.5px] font-medium">{t("May upload files for other companies")}</span>
          <span className="text-[12.5px] text-muted">{t("They upload in Library > For other companies; each file waits for their check, then goes to that company. Its heads of department are told.")}</span>
        </span>
      </label>
      {give ? <p className="rounded-[var(--radius-sm)] bg-surface-2 px-2.5 py-2 text-[12.5px]">{librarySummary(value, give.units, give.companies, t)}</p> : null}
    </fieldset>
  );
}
