import { CoinsIcon, ProhibitIcon, ShieldCheckIcon, UsersIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard } from "@/components/ui/card";
import { FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import {
  allowanceKeys,
  allowancesQuery,
  refusalsQuery,
  tokens,
  workScopeQuery,
  type AllowancePolicy,
  type PersonAllowance,
  type WorkScope,
} from "@/lib/allowance";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";

// Roles a policy can cover (the owner never: they set their own if they want one).
const LIMITABLE: Role[] = ["staff", "supervisor", "hod", "branch_manager", "operator", "approver", "viewer", "admin"];
const WHERE: Record<string, string> = { chat: msg("Chat"), task: msg("Task") };
const PRESETS = [20_000, 50_000, 100_000, 250_000];

function Bar({ used, limit }: { used: number; limit: number | null }) {
  const t = useT();
  if (limit === null) return <span className="text-[12.5px] text-muted tabular">{t("{used} today, no limit", { used: tokens(used) })}</span>;
  const ratio = limit ? Math.min(1, used / limit) : 1;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={t("AI allowance used")}>
        <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warn" : "bg-accent")} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="text-[12px] text-muted tabular">{t("{used} of {limit} tokens", { used: tokens(used), limit: tokens(limit) })}</span>
    </div>
  );
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
  const save = useMutation({
    mutationFn: () => api<AllowancePolicy>("/api/allowances/policy", "PUT", { daily_tokens: Number(daily) || 0, roles }),
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
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {canSet ? <div><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save allowance")}</Button></div> : null}
      </CardBody>
    </Card>
  );
}

const OWN_DEFAULT = "default";
const OWN_NONE = "none";
const OWN_CUSTOM = "custom";

function PersonRow({ p, meId, canOwnerRows }: { p: PersonAllowance; meId: string; canOwnerRows: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const mode = p.own === null ? OWN_DEFAULT : p.own === 0 ? OWN_NONE : OWN_CUSTOM;
  const [choice, setChoice] = useState(mode);
  const [value, setValue] = useState(String(p.own && p.own > 0 ? p.own : 50_000));
  const save = useMutation({
    mutationFn: (daily: number | null) => api<PersonAllowance>(`/api/allowances/${p.user_id}`, "PUT", { daily_tokens: daily }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: allowanceKeys.all });
      toast.success(t("{name}'s allowance is saved.", { name: p.name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const locked = (p.user_id === meId && !canOwnerRows) || (p.role === "owner" && !canOwnerRows);
  const apply = (next: string, amount = value) => {
    setChoice(next);
    if (next === OWN_DEFAULT) save.mutate(null);
    else if (next === OWN_NONE) save.mutate(0);
    else if (Number(amount) > 0) save.mutate(Number(amount));
  };
  return (
    <li className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{initials(p.name)}</span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">{p.name}</p>
          <p className="truncate text-[12px] text-muted">{t(ROLE_INFO[p.role as Role]?.label ?? p.role)}{p.extra ? ` · ${t("+{n} given today", { n: tokens(p.extra) })}` : ""}</p>
        </div>
      </div>
      <Bar used={p.used} limit={p.limit} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select size="sm" value={choice} disabled={locked || save.isPending} onValueChange={(v) => apply(v)} label={t("Allowance for {name}", { name: p.name })}
          options={[
            { value: OWN_DEFAULT, label: t("Default for their role") },
            { value: OWN_CUSTOM, label: t("Their own amount") },
            { value: OWN_NONE, label: t("No limit") },
          ]} />
        {choice === OWN_CUSTOM ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); apply(OWN_CUSTOM); }}>
            <Input type="number" min={1000} step={1000} value={value} disabled={locked} onChange={(e) => setValue(e.target.value)} className="h-8 w-28 tabular" aria-label={t("Tokens per day for {name}", { name: p.name })} />
            <Button type="submit" size="sm" variant="outline" disabled={locked} loading={save.isPending}>{t("Set")}</Button>
          </form>
        ) : null}
      </div>
    </li>
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

function Refusals() {
  const t = useT();
  const { data, isLoading } = useQuery(refusalsQuery);
  return (
    <Card>
      <CardHeader title={t("Refused requests")} icon={<IconTile icon={ProhibitIcon} size="sm" tone="danger" />} description={t("The latest requests the check turned away, newest first.")} />
      {isLoading ? <Skeleton className="m-4 h-16" /> : !data?.length ? (
        <p className="px-4 py-5 text-[13px] text-muted sm:px-5">{t("Nothing refused. Requests have all been about work.")}</p>
      ) : (
        <ListCard className="rounded-none border-0">
          {data.map((r, i) => (
            <li key={i} className="grid min-w-0 gap-1 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                <span className="font-medium text-fg">{r.name}</span>
                <Pill tone="neutral">{t(WHERE[r.where] ?? r.where)}</Pill>
                <span>{timeAgo(r.at)}</span>
              </div>
              <p className="text-[13px] break-words">{r.text}</p>
              {r.why ? <p className="text-[12px] text-muted">{t("Why: {why}", { why: r.why })}</p> : null}
            </li>
          ))}
        </ListCard>
      )}
    </Card>
  );
}

export function AiUsePage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canSet = me.permissions.includes("members.manage");
  const canOwnerRows = me.permissions.includes("members.assign_owner");
  const all = useQuery(allowancesQuery);
  const scope = useQuery(workScopeQuery);
  const people = all.data?.people ?? [];
  const over = people.filter((p) => p.over).length;
  const used = people.reduce((n, p) => n + p.used, 0);
  return (
    <Page className="max-w-5xl">
      <PageHeader title={t("AI use and limits")}
        description={t("Keep AI use fair and on the job: a daily allowance for each person, a check that staff use their AI for work, and who used what today.")} />
      <StatGrid>
        <Stat label={t("Used today")} value={tokens(used)} icon={CoinsIcon} tone="accent" hint={t("Tokens, by everyone you manage")} />
        <Stat label={t("People at their limit")} value={over} icon={ProhibitIcon} tone={over ? "warn" : "ok"} hint={over ? t("Their AI waits for a manager") : t("Nobody")} />
        <Stat label={t("People")} value={people.length} icon={UsersIcon} tone="info" />
      </StatGrid>
      {all.isLoading ? <Skeleton className="h-48" /> : all.error ? (
        <p role="alert" className="text-danger">{errorMessage(all.error)}</p>
      ) : all.data ? (
        <>
          <PolicyCard key={JSON.stringify(all.data.policy)} policy={all.data.policy} canSet={canSet} />
          <Card>
            <CardHeader title={t("Each person today")} icon={<IconTile icon={UsersIcon} size="sm" tone="info" />}
              description={t("Give someone their own amount, or no limit. Changes count straight away.")} />
            {people.length ? (
              <ListCard className="rounded-none border-0">
                {people.map((p) => <PersonRow key={`${p.user_id}:${p.own}`} p={p} meId={me.user.id} canOwnerRows={canOwnerRows} />)}
              </ListCard>
            ) : (
              <EmptyState icon={UsersIcon} title={t("Nobody yet")} body={t("Add people in Members and roles.")} />
            )}
          </Card>
        </>
      ) : null}
      {scope.data ? <ScopeCard key={JSON.stringify(scope.data)} scope={scope.data} canSet={canSet} /> : <Skeleton className="h-40" />}
      <Refusals />
    </Page>
  );
}
