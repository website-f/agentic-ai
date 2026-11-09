import { BrainIcon, CoinsIcon, GaugeIcon, PencilSimpleIcon, ProhibitIcon, ShieldCheckIcon, UsersIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { procedureSummaryQuery, useReplaySwitch, type AgentSavings } from "@/components/learned-procedures";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, filterOf, useLocalTableState, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import {
  allowanceKeys,
  refusalsQuery,
  tokens,
  workScopeQuery,
  type AllowancePolicy,
  type AllowancesBody,
  type AllowanceStatus,
  type PersonAllowance,
  type Refusal,
  type WorkScope,
} from "@/lib/allowance";
import { api, errorMessage } from "@/lib/api";
import { branchesQuery, meQuery } from "@/lib/queries";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";

// Roles a policy can cover (the owner never: they set their own if they want one).
const LIMITABLE: Role[] = ["staff", "supervisor", "hod", "branch_manager", "operator", "approver", "viewer", "admin", "management", "hr"];
const ALL_ROLES: Role[] = ["owner", ...LIMITABLE];
const WHERE: Record<string, string> = { chat: msg("Chat"), task: msg("Task") };
const PRESETS = [20_000, 50_000, 100_000, 250_000];
const STATUS: Record<AllowanceStatus, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  ok: { label: msg("Within limit"), tone: "ok" },
  near: { label: msg("Near the limit"), tone: "warn" },
  over: { label: msg("At the limit"), tone: "danger" },
  unlimited: { label: msg("No limit"), tone: "neutral" },
};
const ALL = "all";

/** How much of the limit is used: a bar and a percent, or "No limit". */
function Meter({ p }: { p: PersonAllowance }) {
  const t = useT();
  if (p.limit === null) return <span className="text-[12.5px] text-muted">{t("No limit")}</span>;
  const ratio = p.limit ? Math.min(1, p.used / p.limit) : 1;
  const pct = p.pct ?? Math.round(ratio * 100);
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)} aria-label={t("AI allowance used")}>
        <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warn" : "bg-accent")} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="w-10 text-right text-[12px] text-muted tabular">{pct}%</span>
    </div>
  );
}

function usd(n: number | undefined): string {
  return `US$${(n ?? 0).toFixed((n ?? 0) < 1 ? 3 : 2)}`;
}

function RolesPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Who it applies to")}>
      {LIMITABLE.map((r) => {
        const on = value.includes(r);
        return (
          <button key={r} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={cn("rounded-full border px-3 py-1 text-[12.5px] transition-colors", on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:bg-surface-2")}>
            {t(ROLE_INFO[r].label)}
          </button>
        );
      })}
    </div>
  );
}

function PolicyCard({ policy, canSet }: { policy: AllowancePolicy; canSet: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [daily, setDaily] = useState(String(policy.daily_tokens));
  const [roles, setRoles] = useState<string[]>(policy.roles);
  const [office, setOffice] = useState(String(policy.office_daily_tokens ?? 2_000_000));
  const save = useMutation({
    mutationFn: () => api<AllowancePolicy>("/api/allowances/policy", "PUT", { daily_tokens: Number(daily) || 0, roles, office_daily_tokens: Number(office) || 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: allowanceKeys.all });
      toast.success(t("Saved. It counts from now, for today too."));
    },
  });
  const n = Number(daily);
  return (
    <Card>
      <CardHeader title={t("Daily AI allowance")} icon={<IconTile icon={CoinsIcon} size="sm" />}
        description={t("Every AI call is counted against the person the work is for. When their allowance is used up, their AI stops and a manager decides on more. It resets at midnight.")} />
      <CardBody className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Tokens per person per day")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="number" min={0} step={1000} value={daily} disabled={!canSet} onChange={(e) => setDaily(e.target.value)} className="w-40 tabular" aria-label={t("Tokens per person per day")} />
            {PRESETS.map((p) => (
              <Button key={p} type="button" size="sm" variant={n === p ? "secondary" : "ghost"} disabled={!canSet} onClick={() => setDaily(String(p))}>{tokens(p)}</Button>
            ))}
            <Button type="button" size="sm" variant={n === 0 ? "secondary" : "ghost"} disabled={!canSet} onClick={() => setDaily("0")}>{t("No limit")}</Button>
          </div>
          <p className="text-[12px] text-muted">{t("About 1,000 tokens is a short chat answer; a task that reads documents and writes a report uses 20,000 to 60,000. Jobs your AI learned to repeat use almost none.")}</p>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Who it applies to")}</span>
          <RolesPicker value={roles} onChange={canSet ? setRoles : () => undefined} />
          <p className="text-[12px] text-muted">{t("The owner is never limited by this. Anyone can still get their own allowance below.")}</p>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("The office's own work, per day")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="number" min={0} step={100000} value={office} disabled={!canSet} onChange={(e) => setOffice(e.target.value)} className="w-40 tabular" aria-label={t("The office's own work, per day")} />
            <Button type="button" size="sm" variant={Number(office) === 0 ? "secondary" : "ghost"} disabled={!canSet} onClick={() => setOffice("0")}>{t("No limit")}</Button>
          </div>
          <p className="text-[12px] text-muted">{t("Work nobody asked for directly: shared mailbox rules and agents' own follow-ups. When it is used up, that work waits for a manager to approve more.")}</p>
        </div>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {canSet ? <div><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save allowance")}</Button></div> : null}
      </CardBody>
    </Card>
  );
}

const OWN_DEFAULT = "default";
const OWN_NONE = "none";
const OWN_CUSTOM = "custom";

/** Can this manager change this person's allowance? (The server checks the same.) */
function lockedFor(p: PersonAllowance, meId: string, canOwnerRows: boolean): string | null {
  if (p.user_id === meId && !canOwnerRows) return msg("You cannot change your own AI allowance. Ask an owner or admin.");
  if (p.role === "owner" && !canOwnerRows) return msg("Only an owner can change owner access.");
  return null;
}

/** One person's allowance, opened from their row: what they used, and their own limit. */
function LimitSheet({ p, policy, meId, canOwnerRows, onClose }: {
  p: PersonAllowance;
  policy: AllowancePolicy | undefined;
  meId: string;
  canOwnerRows: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [choice, setChoice] = useState(p.own === null ? OWN_DEFAULT : p.own === 0 ? OWN_NONE : OWN_CUSTOM);
  const [value, setValue] = useState(String(p.own && p.own > 0 ? p.own : 50_000));
  const locked = lockedFor(p, meId, canOwnerRows);
  const save = useMutation({
    mutationFn: (daily: number | null) => api<PersonAllowance>(`/api/allowances/${p.user_id}`, "PUT", { daily_tokens: daily }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: allowanceKeys.all });
      toast.success(t("{name}'s allowance is saved.", { name: p.name }));
      onClose();
    },
  });
  const amount = Number(value);
  const bad = choice === OWN_CUSTOM && !(amount >= 1000);
  const roleDefault = policy && policy.daily_tokens && policy.roles.includes(p.role)
    ? t("{n} tokens a day", { n: tokens(policy.daily_tokens) }) : t("No limit");
  const place = [p.branch_name, p.department_name].filter(Boolean).join(" · ");
  const choices = [
    { value: OWN_DEFAULT, label: t("Default for their role"), hint: roleDefault },
    { value: OWN_CUSTOM, label: t("Their own amount"), hint: t("Tokens per day, from 1,000") },
    { value: OWN_NONE, label: t("No limit"), hint: t("Their AI is never stopped for use") },
  ];
  return (
    <SideSheet open onOpenChange={(o) => { if (!o) onClose(); }} size="sm"
      title={t("AI allowance for {name}", { name: p.name })} description={p.email}>
      <form className="grid gap-5" onSubmit={(e) => {
        e.preventDefault();
        if (locked || bad) return;
        save.mutate(choice === OWN_DEFAULT ? null : choice === OWN_NONE ? 0 : amount);
      }}>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">{t("Role")}</dt><dd>{t(ROLE_INFO[p.role as Role]?.label ?? p.role)}</dd>
          <dt className="text-muted">{t("Where")}</dt><dd className="break-words">{place || t("Whole workspace")}</dd>
          <dt className="text-muted">{t("Used today")}</dt><dd className="tabular">{tokens(p.used)}{p.cost_usd ? ` · ${usd(p.cost_usd)}` : ""}</dd>
          <dt className="text-muted">{t("Limit today")}</dt>
          <dd className="tabular">{p.limit === null ? t("No limit") : tokens(p.limit)}{p.extra ? ` (${t("+{n} given today", { n: tokens(p.extra) })})` : ""}</dd>
          <dt className="text-muted">{t("Status")}</dt><dd><Pill tone={STATUS[p.status ?? "ok"].tone}>{t(STATUS[p.status ?? "ok"].label)}</Pill></dd>
        </dl>
        {p.limit !== null ? <Meter p={p} /> : null}
        {locked ? <p role="note" className="rounded-sm bg-surface-2 px-3 py-2 text-[13px] text-muted">{t(locked)}</p> : null}
        <fieldset className="grid gap-2" disabled={!!locked || save.isPending}>
          <legend className="mb-1 text-[13px] font-medium">{t("Their daily allowance")}</legend>
          {choices.map((c) => (
            <label key={c.value} className={cn("flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5",
              choice === c.value ? "border-accent bg-accent-soft/50" : "border-border hover:bg-surface-2")}>
              <input type="radio" name="own" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)}
                className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[13.5px] font-medium">{c.label}</span>
                <span className="text-[12px] text-muted">{c.hint}</span>
              </span>
            </label>
          ))}
          {choice === OWN_CUSTOM ? (
            <div className="grid gap-2 pt-1">
              <Input type="number" min={1000} step={1000} value={value} onChange={(e) => setValue(e.target.value)} className="w-full tabular sm:w-44"
                aria-label={t("Tokens per day for {name}", { name: p.name })} aria-invalid={bad || undefined} />
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((n) => (
                  <Button key={n} type="button" size="sm" variant={amount === n ? "secondary" : "ghost"} onClick={() => setValue(String(n))}>{tokens(n)}</Button>
                ))}
              </div>
              {bad ? <p className="text-[12px] text-danger">{t("Give at least 1,000 tokens a day, or pick No limit.")}</p> : null}
            </div>
          ) : null}
        </fieldset>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!!locked || bad}>{t("Save allowance")}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t("Cancel")}</Button>
        </div>
      </form>
    </SideSheet>
  );
}

function PersonName({ p, isMe }: { p: PersonAllowance; isMe: boolean }) {
  const t = useT();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{initials(p.name)}</span>
      <span className="grid min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-medium">
          <span className="min-w-0 break-words">{p.name}</span>
          {isMe ? <Pill tone="accent">{t("You")}</Pill> : null}
        </span>
        <span className="text-[12px] break-all text-muted">{p.email}</span>
      </span>
    </span>
  );
}

/** Everyone the manager looks after, today: search by name or email, filter, sort, page, and
 * open a row to change that person's allowance. The API does the work (api/routers/allowances.py). */
function PeopleTable({ canSet, canOwnerRows, meId }: { canSet: boolean; canOwnerRows: boolean; meId: string }) {
  const t = useT();
  const control = useTableState({ size: 25 }, { filters: ["role", "branch", "status"] });
  const table = useServerTable<PersonAllowance, AllowancesBody>(allowanceKeys.all, "/api/allowances", control.state, {}, {
    pick: (b) => b.people,
    refetchInterval: 60_000,
  });
  const { data: branches = [] } = useQuery(branchesQuery);
  const [role, setRole] = filterOf(control, "role");
  const [branch, setBranch] = filterOf(control, "branch");
  const [status, setStatus] = filterOf(control, "status");
  const [open, setOpen] = useState<PersonAllowance | null>(null);
  const body = table.body;
  const summary = body?.summary;

  const columns: Column<PersonAllowance>[] = [
    { id: "name", header: t("Name"), sortable: true, card: "title", cell: (p) => <PersonName p={p} isMe={p.user_id === meId} /> },
    { id: "role", header: t("Role"), sortable: true, cell: (p) => t(ROLE_INFO[p.role as Role]?.label ?? p.role) },
    {
      id: "place", header: t("Where"), sortable: true, hideBelow: "lg",
      cell: (p) => [p.branch_name, p.department_name].filter(Boolean).join(" · ") || <span className="text-muted">{t("Whole workspace")}</span>,
    },
    {
      id: "used", header: t("Used today"), sortable: true, kind: "number", align: "right",
      cell: (p) => (
        <span className="grid justify-items-end whitespace-nowrap tabular max-md:justify-items-start">
          <span>{tokens(p.used)}</span>
          {p.cost_usd ? <span className="text-[11.5px] text-muted">{usd(p.cost_usd)}</span> : null}
        </span>
      ),
    },
    {
      id: "limit", header: t("Limit"), sortable: true, kind: "number", align: "right",
      cell: (p) => (
        <span className="grid justify-items-end whitespace-nowrap tabular max-md:justify-items-start">
          <span>{p.limit === null ? t("No limit") : tokens(p.limit)}</span>
          <span className="text-[11.5px] text-muted">
            {p.own === null ? t("Role default") : t("Their own")}{p.extra ? ` · ${t("+{n} given today", { n: tokens(p.extra) })}` : ""}
          </span>
        </span>
      ),
    },
    { id: "pct", header: t("Used %"), sortable: true, kind: "number", cell: (p) => <Meter p={p} /> },
    { id: "status", header: t("Status"), cell: (p) => <Pill tone={STATUS[p.status ?? "ok"].tone}>{t(STATUS[p.status ?? "ok"].label)}</Pill> },
  ];

  return (
    <>
      {!summary ? (
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
      ) : <StatGrid>
        <Stat label={t("Used today")} value={tokens(summary.used)} icon={CoinsIcon} tone="accent"
          hint={summary.cost_usd ? t("Tokens, by everyone you manage · {cost}", { cost: usd(summary.cost_usd) }) : t("Tokens, by everyone you manage")} />
        <Stat label={t("People at their limit")} value={summary.over} icon={ProhibitIcon} tone={summary.over ? "warn" : "ok"}
          hint={summary.over ? t("Their AI waits for a manager") : t("Nobody")}
          onClick={() => setStatus(status === "over" ? "" : "over")} active={status === "over"} />
        <Stat label={t("Near their limit")} value={summary.near} icon={GaugeIcon} tone={summary.near ? "warn" : "neutral"}
          hint={t("80% or more used today")} onClick={() => setStatus(status === "near" ? "" : "near")} active={status === "near"} />
        <Stat label={t("People")} value={summary.people} icon={UsersIcon} tone="info"
          onClick={() => control.set({ q: "", f: { role: "", branch: "", status: "" } })} active={!role && !branch && !status && !control.state.q} />
      </StatGrid>}
      <Card>
        <CardHeader title={t("Each person today")} icon={<IconTile icon={UsersIcon} size="sm" tone="info" />}
          description={t("Find someone by name or email, then open their row to give them their own amount or no limit. Changes count straight away.")} />
        <CardBody>
          <DataTable
            label={t("Each person's AI use today")}
            mode="server"
            columns={columns}
            rows={table.rows}
            total={table.total}
            rowId={(p) => p.user_id}
            rowLabel={(p) => p.name}
            control={control}
            loading={table.loading}
            fetching={table.fetching}
            error={table.error}
            onRetry={table.refetch}
            searchPlaceholder={t("Search by name or email")}
            onOpen={setOpen}
            actions={(p) => (
              <Button size="sm" variant="ghost" onClick={() => setOpen(p)} aria-label={t("Change the allowance for {name}", { name: p.name })}>
                <PencilSimpleIcon size={15} /> <span className="max-sm:sr-only">{t("Change")}</span>
              </Button>
            )}
            filters={
              <>
                <Select className="w-full sm:w-40" label={t("Role")} value={role || ALL} onValueChange={(v) => setRole(v === ALL ? "" : v)}
                  options={[{ value: ALL, label: t("All roles") }, ...ALL_ROLES.map((r) => ({ value: r, label: t(ROLE_INFO[r].label) }))]} />
                {branches.length > 1 ? (
                  <Select className="w-full sm:w-44" label={t("Company")} value={branch || ALL} onValueChange={(v) => setBranch(v === ALL ? "" : v)}
                    options={[{ value: ALL, label: t("All companies") }, { value: "none", label: t("No company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
                ) : null}
                <Select className="w-full sm:w-40" label={t("Status")} value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? "" : v)}
                  options={[{ value: ALL, label: t("All statuses") }, ...(Object.keys(STATUS) as AllowanceStatus[]).map((s) => ({ value: s, label: t(STATUS[s].label) }))]} />
              </>
            }
            empty={<EmptyState icon={UsersIcon} title={t("Nobody yet")} body={t("Add people in Members and roles.")} />}
          />
        </CardBody>
      </Card>
      {/* The default for everyone sits under the people: the table is what managers use most. */}
      {body ? <PolicyCard key={JSON.stringify(body.policy)} policy={body.policy} canSet={canSet} /> : null}
      {open ? (
        <LimitSheet key={`${open.user_id}:${open.own}`} p={open} policy={body?.policy} meId={meId} canOwnerRows={canOwnerRows} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function ScopeCard({ scope, canSet }: { scope: WorkScope; canSet: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(scope.enabled);
  const [about, setAbout] = useState(scope.about);
  const [roles, setRoles] = useState<string[]>(scope.roles);
  const save = useMutation({
    mutationFn: () => api<WorkScope>("/api/work-scope", "PUT", { enabled, roles, about }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: allowanceKeys.scope });
      toast.success(t("Saved."));
    },
  });
  return (
    <Card>
      <CardHeader title={t("What staff may use their AI for")} icon={<IconTile icon={ShieldCheckIcon} size="sm" tone="ok" />}
        description={t("Before any work starts, a request from these roles is checked against your business. Homework, games, personal shopping and attempts to switch the AI's rules off are refused and listed below. When unsure, it counts as work.")} />
      <CardBody className="grid gap-4">
        <SwitchField checked={enabled} onCheckedChange={setEnabled} disabled={!canSet} label={t("Check requests are about work")} hint={t("Off: only the daily allowance limits use.")} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Who it applies to")}</span>
          <RolesPicker value={roles} onChange={canSet ? setRoles : () => undefined} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="scope-about" className="text-[13px] font-medium">{t("What the work is (optional)")}</label>
          <textarea id="scope-about" rows={3} maxLength={1500} value={about} disabled={!canSet} onChange={(e) => setAbout(e.target.value)}
            placeholder={t("e.g. Security guard services: rosters, payroll, client sites, tenders, incident reports and customer letters.")}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          <p className="text-[12px] text-muted">{t("Your company's name and industry are already used. Add what your teams actually do, so work that sounds unusual still passes.")}</p>
        </div>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {canSet ? <div><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></div> : null}
      </CardBody>
    </Card>
  );
}

/** P96: one agent's "reuse what it learned" switch, for the row of the learned-work table. */
function ReplayCell({ row }: { row: AgentSavings }) {
  const t = useT();
  const set = useReplaySwitch(row.agent_id);
  if (!row.can_manage) return <Pill tone={row.replay ? "ok" : "neutral"}>{row.replay ? t("On") : t("Off")}</Pill>;
  return <SwitchField checked={row.replay} disabled={set.isPending || !row.office_on} onCheckedChange={(v) => set.mutate(v)} label={t("Reuse what it learned")} />;
}

/** P96: what each agent learned to do from memory, and the tokens that saved (api/routers/procedures.py). */
function LearnedSavings() {
  const t = useT();
  const summary = useQuery(procedureSummaryQuery);
  const { isLoading, error, refetch } = summary;
  const data = Array.isArray(summary.data) ? summary.data : [];
  const control = useLocalTableState({ size: 10, sort: "saved", dir: "desc" });
  const saved = (r: AgentSavings) => r.tokens_saved + r.answer_tokens_saved;
  const total = data.reduce((n, r) => n + saved(r), 0);
  const columns: Column<AgentSavings>[] = [
    { id: "agent", header: t("Agent"), sortValue: (r) => r.agent_name, card: "title", cell: (r) => <span className="font-medium">{r.agent_name}</span> },
    { id: "active", header: t("Jobs it knows"), kind: "number", align: "right", sortValue: (r) => r.active, cell: (r) => <span className="tabular">{r.active}</span> },
    { id: "replays", header: t("Jobs done from memory"), kind: "number", align: "right", sortValue: (r) => r.replays, cell: (r) => <span className="tabular">{r.replays}</span> },
    { id: "answers", header: t("Answers reused"), kind: "number", align: "right", hideBelow: "lg", sortValue: (r) => r.answers_reused, cell: (r) => <span className="tabular">{r.answers_reused}</span> },
    { id: "saved", header: t("Tokens saved"), kind: "number", align: "right", sortValue: saved, cell: (r) => <span className="tabular font-medium">{tokens(saved(r))}</span> },
    { id: "replay", header: t("Reuse what it learned"), card: "full", cell: (r) => <ReplayCell row={r} /> },
  ];
  return (
    <Card>
      <CardHeader title={t("Learned work and tokens saved")} icon={<IconTile icon={BrainIcon} size="sm" tone="ok" />}
        description={t("Jobs an agent has learned run from its memory without the AI engine. {n} tokens saved so far.", { n: tokens(total) })} />
      <CardBody>
        <DataTable label={t("Learned work and tokens saved")} columns={columns} rows={data} rowId={(r) => r.agent_id}
          control={control} loading={isLoading} error={error} onRetry={() => void refetch()}
          searchText={(r) => r.agent_name} searchPlaceholder={t("Search by agent name")}
          empty={<p className="py-3 text-[13px] text-muted">{t("No agent has learned a job yet. After the same job is done well twice, it runs from memory.")}</p>} />
      </CardBody>
    </Card>
  );
}

/** The latest refused requests (the API keeps the newest 30): searchable by name or words. */
function Refusals() {
  const t = useT();
  const { data = [], isLoading, error, refetch } = useQuery(refusalsQuery);
  const control = useLocalTableState({ size: 10 });
  const columns: Column<Refusal>[] = [
    { id: "name", header: t("Who"), sortValue: (r) => r.name, card: "title", cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "where", header: t("Where"), sortValue: (r) => r.where, cell: (r) => <Pill tone="neutral">{t(WHERE[r.where] ?? r.where)}</Pill> },
    {
      id: "text", header: t("What they asked"), card: "full",
      cell: (r) => (
        <span className="grid gap-0.5">
          <span className="text-[13px] break-words">{r.text}</span>
          {r.why ? <span className="text-[12px] text-muted">{t("Why: {why}", { why: r.why })}</span> : null}
        </span>
      ),
    },
    { id: "at", header: t("When"), sortValue: (r) => r.at, kind: "date", cell: (r) => <span className="whitespace-nowrap text-muted">{timeAgo(r.at)}</span> },
  ];
  return (
    <Card>
      <CardHeader title={t("Refused requests")} icon={<IconTile icon={ProhibitIcon} size="sm" tone="danger" />} description={t("The latest requests the check turned away, newest first.")} />
      <CardBody>
        <DataTable label={t("Refused requests")} columns={columns} rows={data} rowId={(r) => `${r.at}:${r.user_id ?? ""}:${r.text.slice(0, 20)}`}
          control={control} loading={isLoading} error={error} onRetry={() => void refetch()}
          searchText={(r) => `${r.name} ${r.text} ${r.why}`} searchPlaceholder={t("Search by name or words")}
          empty={<p className="py-3 text-[13px] text-muted">{t("Nothing refused. Requests have all been about work.")}</p>} />
      </CardBody>
    </Card>
  );
}

export function AiUsePage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canSet = me.permissions.includes("members.manage");
  const canOwnerRows = me.permissions.includes("members.assign_owner");
  const scope = useQuery(workScopeQuery);
  return (
    <Page className="max-w-6xl">
      <PageHeader title={t("AI use and limits")}
        description={t("Keep AI use fair and on the job: a daily allowance for each person, a check that staff use their AI for work, and who used what today.")} />
      {/* The stat tiles, the policy and the people table share one call (PeopleTable). */}
      <PeopleTable canSet={canSet} canOwnerRows={canOwnerRows} meId={me.user.id} />
      <LearnedSavings />
      {scope.data ? <ScopeCard key={JSON.stringify(scope.data)} scope={scope.data} canSet={canSet} /> : <Skeleton className="h-40" />}
      <Refusals />
    </Page>
  );
}
