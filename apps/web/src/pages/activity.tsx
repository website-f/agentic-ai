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
import { useMutation } from "@tanstack/react-query";

import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, filterOf, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/segmented";
import { locale, msg, t as tr, translate, useLang, useT, type Lang } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { ROLE_INFO, type AuditItem, type AuditPage, type Role } from "@/lib/types";

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
    case "auth.2fa_enabled": return tr("turned on two-step sign-in");
    case "auth.2fa_disabled": return tr("turned off two-step sign-in");
    case "auth.2fa_recovery_used": return tr("signed in with a recovery code");
    case "auth.2fa_recovery_regenerated": return tr("made new recovery codes");
    case "auth.2fa_reset": return tr("reset a member's two-step sign-in");
    case "workspace.require_2fa_changed": return tr("set who must use two-step sign-in: {rule}", { rule: tr(a.require_2fa === "everyone" ? "Everyone" : a.require_2fa === "admins" ? "Owners and admins" : "Off") });
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

function whenText(iso: string, lang: Lang): string {
  return `${dayLabel(iso, lang)}, ${new Date(iso).toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" })}`;
}

export function ActivityPage() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const verify = useMutation({ mutationFn: () => api<{ ok: boolean; checked: number; broken_at: number | null }>("/api/audit/verify") });
  // P96: a data table. The server finds words (action, note, who), filters the kind, sorts by
  // time and sends one numbered page; the address keeps the search, kind, page and order.
  const control = useTableState({ size: 50 }, { filters: ["kind"] });
  const [kindParam, setKind] = filterOf(control, "kind");
  const kind = (kindParam && kindParam in KINDS ? kindParam : "all") as Kind | "all";
  const table = useServerTable<AuditItem, AuditPage>(keys.audit, "/api/audit", control.state, {}, { pick: (b) => b.items });
  const counts = table.body?.kinds ?? {};
  const everything = Object.values(counts).reduce((a, b) => a + b, 0);

  const options = [
    { value: "all" as const, label: t("All"), count: everything || undefined },
    ...(Object.keys(KINDS) as Kind[]).filter((k) => counts[k] || k === kind).map((k) => ({ value: k, label: t(KINDS[k].label), count: counts[k] ?? 0 })),
  ];

  const columns: Column<AuditItem>[] = [
    {
      id: "ts", header: t("When"), sortable: true, kind: "date", className: "whitespace-nowrap",
      cell: (item) => (
        <time className="text-[12.5px] text-muted tabular" dateTime={item.ts} title={new Date(item.ts).toLocaleString(locale())}>
          {whenText(item.ts, lang)}
        </time>
      ),
    },
    { id: "who", header: t("Who"), card: "title", cell: (item) => <span className="font-medium break-words">{item.actor_name ?? item.actor}</span> },
    {
      id: "what", header: t("What happened"), card: "full",
      cell: (item) => {
        const look = iconFor(item.action);
        return (
          <span className="flex min-w-0 items-start gap-2.5">
            <IconTile icon={look.icon} tone={look.tone} size="sm" className="mt-0.5 shrink-0" />
            <span className="grid min-w-0 gap-0.5">
              <span className="text-[13.5px] break-words">{describe(item)}</span>
              {item.note ? <span className="text-[12px] break-words text-muted">{item.note}</span> : null}
            </span>
          </span>
        );
      },
    },
    { id: "kind", header: t("Kind"), hideBelow: "lg", cell: (item) => <span className="text-muted">{t(KINDS[kindOf(item.action)].label)}</span> },
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

      <div data-guide="activity.list" className="grid grid-cols-[minmax(0,1fr)]">
        <DataTable
          label={t("Activity")}
          mode="server"
          columns={columns}
          rows={table.rows}
          total={table.total}
          rowId={(item) => String(item.id)}
          control={control}
          loading={table.loading}
          fetching={table.fetching}
          error={table.error}
          onRetry={table.refetch}
          searchPlaceholder={t("Search by person, action or note")}
          pageSizes={[25, 50, 100]}
          filters={
            <div className="col-span-2 max-w-full min-w-0 overflow-x-auto">
              <Segmented guide="activity.filter" label={t("Filter activity")} value={kind} onChange={(k) => setKind(k === "all" ? "" : k)} options={options} className="w-fit" />
            </div>
          }
          empty={
            kind === "all"
              ? <EmptyState icon={ClockCounterClockwiseIcon} title={t("Nothing recorded yet")} body={t("Changes to members, branches and departments will show up here.")} />
              : <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{t("No {kind} recorded yet.", { kind: t(KINDS[kind].label).toLowerCase() })}</p>
          }
        />
      </div>
    </Page>
  );
}
