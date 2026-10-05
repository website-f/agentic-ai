import {
  BuildingsIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  FlowArrowIcon,
  KanbanIcon,
  RobotIcon,
  SealCheckIcon,
  SignInIcon,
  SparkleIcon,
  UsersIcon,
  WarningOctagonIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { LoadMore } from "@/components/load-more";
import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, t as tr, translate, useLang, useT, type Lang } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { auditQuery } from "@/lib/queries";
import { ROLE_INFO, type AuditItem, type Role } from "@/lib/types";

/** Plain-language sentence for each audit action. */
function describe(item: AuditItem): string {
  const a = item.after ?? {};
  const b = item.before ?? {};
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const role = (v: unknown) => (ROLE_INFO[v as Role] ? tr(ROLE_INFO[v as Role].label) : s(v));
  switch (item.action) {
    case "workspace.created": return tr("created the workspace {name}", { name: s(a.name) });
    case "auth.login": return tr("signed in");
    case "auth.password_changed": return tr("changed their password");
    case "member.added": return tr("added {email} as {role}", { email: s(a.email), role: role(a.role) });
    case "member.role_changed": return tr("changed a role from {from} to {to}", { from: role(b.role), to: role(a.role) });
    case "member.removed": return tr("removed {email}", { email: s(b.email) });
    case "member.password_reset": return tr("reset a member's password");
    case "branch.created": return tr("created the branch {name}", { name: s(a.name) });
    case "branch.updated": return tr("updated the branch {name}", { name: s(a.name) });
    case "branch.deleted": return tr("deleted the branch {name}", { name: s(b.name) });
    case "department.created": return tr("added the {name} department to {branch}", { name: s(a.name), branch: s(a.branch) });
    case "department.updated": return b.name !== a.name ? tr("renamed {from} to {to}", { from: s(b.name), to: s(a.name) }) : tr("updated {name}", { name: s(a.name) });
    case "department.deleted": return tr("removed the {name} department", { name: s(b.name) });
    default: return fallback(item.action);
  }
}

/** Malay for the generated sentences below ("mencipta tugasan"); unknown pairs stay English.
 * The keys are only looked up in Malay, so they carry an "activity:" prefix to stay apart. */
const VERB_MS: Record<string, string> = {
  created: msg("activity: created"), updated: msg("activity: updated"), deleted: msg("activity: deleted"), uploaded: msg("activity: uploaded"),
  added: msg("activity: added"), removed: msg("activity: removed"), approved: msg("activity: approved"), rejected: msg("activity: rejected"),
  reverted: msg("activity: reverted"), applied: msg("activity: applied"), compiled: msg("activity: compiled"), delegated: msg("activity: delegated"),
  published: msg("activity: published"), started: msg("activity: started"), accepted: msg("activity: accepted"),
};
const NOUN_MS: Record<string, string> = {
  task: msg("activity: task"), file: msg("activity: file"), document: msg("activity: document"), pack: msg("activity: pack"), workflow: msg("activity: workflow"),
  template: msg("activity: template"), meeting: msg("activity: meeting"), broadcast: msg("activity: broadcast"), report: msg("activity: report"),
  schedule: msg("activity: schedule"), agent: msg("activity: agent"), skill: msg("activity: skill"), sop: msg("activity: SOP"), blueprint: msg("activity: blueprint"),
  objective: msg("activity: objective"), minutes: msg("activity: meeting minutes"), mcp: msg("activity: MCP server"),
};

/** "task.created" -> "created a task", "workflow.run_started" -> "workflow run started". */
function fallback(action: string): string {
  const [entity = "", verb = ""] = action.split(".");
  const noun = entity.replace(/_/g, " ");
  if (useLang.getState().lang === "ms" && VERB_MS[verb] && NOUN_MS[entity]) return `${tr(VERB_MS[verb])} ${tr(NOUN_MS[entity])}`;
  if (/^[a-z]+ed$/.test(verb)) return `${verb} ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
  return `${noun} ${verb.replace(/_/g, " ")}`.trim() || action;
}

type Kind = "signin" | "people" | "org" | "work" | "agents" | "other";

const KINDS: Record<Kind, { label: string; icon: Icon; tone: Tone }> = {
  signin: { label: msg("Sign-ins"), icon: SignInIcon, tone: "neutral" },
  people: { label: msg("People"), icon: UsersIcon, tone: "info" },
  org: { label: msg("Organization"), icon: BuildingsIcon, tone: "violet" },
  work: { label: msg("Work"), icon: KanbanIcon, tone: "accent" },
  agents: { label: msg("Agents"), icon: RobotIcon, tone: "orange" },
  other: { label: msg("Other"), icon: SparkleIcon, tone: "neutral" },
};

function kindOf(action: string): Kind {
  const entity = action.split(".")[0] ?? "";
  if (entity === "auth") return action === "auth.login" ? "signin" : "people";
  if (entity === "member") return "people";
  if (["workspace", "branch", "department"].includes(entity)) return "org";
  if (["task", "file", "document", "pack", "workflow", "template", "meeting", "broadcast", "report", "schedule"].includes(entity)) return "work";
  if (["agent", "skill", "sop", "brain", "blueprint"].includes(entity)) return "agents";
  return "other";
}

function iconFor(action: string): { icon: Icon; tone: Tone } {
  const entity = action.split(".")[0] ?? "";
  const k = KINDS[kindOf(action)];
  if (entity === "file" || entity === "document") return { icon: FileTextIcon, tone: k.tone };
  if (entity === "workflow") return { icon: FlowArrowIcon, tone: k.tone };
  return { icon: k.icon, tone: k.tone };
}


function dayLabel(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return translate(lang, "Today");
  if (d.toDateString() === yesterday.toDateString()) return translate(lang, "Yesterday");
  return d.toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long" });
}

export function ActivityPage() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const verify = useMutation({ mutationFn: () => api<{ ok: boolean; checked: number; broken_at: number | null }>("/api/audit/verify") });
  const [kind, setKind] = useState<Kind | "all">("all");
  // The kind filter runs on the server: every page is that kind, and the counts are true counts.
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(auditQuery(kind === "all" ? undefined : kind));

  const all = useMemo(() => {
    const seen = new Set<number>();
    return (data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !seen.has(i.id) && seen.add(i.id));
  }, [data]);
  const first = data?.pages[0];
  const counts = first?.kinds ?? {};
  const everything = Object.values(counts).reduce((a, b) => a + b, 0);

  const groups = useMemo(() => {
    const out: { day: string; items: AuditItem[] }[] = [];
    for (const item of all) {
      const day = dayLabel(item.ts, lang);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [all, lang]);

  const options = [
    { value: "all" as const, label: t("All"), count: everything || undefined },
    ...(Object.keys(KINDS) as Kind[]).filter((k) => counts[k] || k === kind).map((k) => ({ value: k, label: t(KINDS[k].label), count: counts[k] ?? 0 })),
  ];

  return (
    <Page>
      <PageHeader
        title={t("Activity")}
        description={t("Every change in this workspace. Entries are chained by hash, so editing or deleting one is detectable.")}
        actions={
          <Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}>
            {!verify.isPending ? <SealCheckIcon size={16} /> : null} {t("Verify log")}
          </Button>
        }
      />
      {verify.data ? (
        verify.data.ok ? (
          <div role="status" className="flex items-start gap-3 rounded-[var(--radius-md)] border border-ok/25 bg-ok/8 px-4 py-3">
            <IconTile icon={SealCheckIcon} tone="ok" size="sm" />
            <p className="min-w-0 text-[13px]">
              <span className="font-medium text-ok">{t("Log intact.")}</span>{" "}
              <span className="text-muted">{t("All {n} entries match their hash chain.", { n: verify.data.checked })}</span>
            </p>
          </div>
        ) : (
          <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 px-4 py-3">
            <IconTile icon={WarningOctagonIcon} tone="danger" size="sm" />
            <p className="min-w-0 text-[13px]">
              <span className="font-medium text-danger">{t("Chain broken at entry {n}.", { n: verify.data.broken_at ?? "" })}</span>{" "}
              <span className="text-muted">{t("An entry from that point on was changed or removed.")}</span>
            </p>
          </div>
        )
      ) : null}
      {verify.error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(verify.error)}</p> : null}

      {isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load activity. {error}", { error: errorMessage(error) })}
        </div>
      ) : all.length === 0 && kind === "all" ? (
        <EmptyState icon={ClockCounterClockwiseIcon} title={t("Nothing recorded yet")} body={t("Changes to members, branches and departments will show up here.")} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <Segmented guide="activity.filter" label={t("Filter activity")} value={kind} onChange={setKind} options={options} className="w-fit" />
          {groups.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
              {kind !== "all" ? t("No {kind} recorded yet.", { kind: t(KINDS[kind].label).toLowerCase() }) : t("No entries recorded yet.")}
            </p>
          ) : null}
          {groups.map((g, gi) => (
            <section key={g.day} data-guide={gi === 0 ? "activity.list" : undefined} className="grid gap-2">
              <h2 className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
                {g.day}
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular">{g.items.length}</span>
              </h2>
              <ol className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                {g.items.map((item) => {
                  const look = iconFor(item.action);
                  return (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                      <IconTile icon={look.icon} tone={look.tone} size="sm" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] break-words">
                          <span className="font-medium">{item.actor_name ?? item.actor}</span>{" "}
                          <span className="text-muted">{describe(item)}</span>
                        </p>
                        {item.note ? <p className="text-[12px] break-words text-muted">{item.note}</p> : null}
                      </div>
                      <time className="mt-0.5 shrink-0 font-mono text-[12px] whitespace-nowrap text-muted tabular" dateTime={item.ts} title={new Date(item.ts).toLocaleString(locale())}>
                        {new Date(item.ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          <LoadMore noun="entries" shown={all.length} total={first?.total} hasMore={!!hasNextPage} loading={isFetchingNextPage}
            onLoad={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }} />
        </div>
      )}
    </Page>
  );
}
