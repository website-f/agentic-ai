import { ClockCounterClockwiseIcon, SealCheckIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useMemo } from "react";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { auditQuery } from "@/lib/queries";
import type { AuditItem } from "@/lib/types";

/** Plain-language sentence for each audit action. */
function describe(item: AuditItem): string {
  const a = item.after ?? {};
  const b = item.before ?? {};
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (item.action) {
    case "workspace.created": return `created the workspace ${s(a.name)}`;
    case "auth.login": return "signed in";
    case "auth.password_changed": return "changed their password";
    case "member.added": return `added ${s(a.email)} as ${s(a.role)}`;
    case "member.role_changed": return `changed a role from ${s(b.role)} to ${s(a.role)}`;
    case "member.removed": return `removed ${s(b.email)}`;
    case "member.password_reset": return "reset a member's password";
    case "branch.created": return `created the branch ${s(a.name)}`;
    case "branch.updated": return `updated the branch ${s(a.name)}`;
    case "branch.deleted": return `deleted the branch ${s(b.name)}`;
    case "department.created": return `added the ${s(a.name)} department to ${s(a.branch)}`;
    case "department.updated": return b.name !== a.name ? `renamed ${s(b.name)} to ${s(a.name)}` : `updated ${s(a.name)}`;
    case "department.deleted": return `removed the ${s(b.name)} department`;
    default: return item.action;
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export function ActivityPage() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(auditQuery);
  const verify = useMutation({ mutationFn: () => api<{ ok: boolean; checked: number; broken_at: number | null }>("/api/audit/verify") });

  const groups = useMemo(() => {
    const out: { day: string; items: AuditItem[] }[] = [];
    for (const item of data?.pages.flatMap((p) => p.items) ?? []) {
      const day = dayLabel(item.ts);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [data]);

  return (
    <Page>
      <PageHeader
        title="Activity"
        description="Every change in this workspace. Entries are chained by hash, so editing or deleting one is detectable."
        actions={
          <div className="flex items-center gap-2">
            {verify.data ? (
              verify.data.ok ? (
                <Pill tone="ok"><SealCheckIcon size={13} weight="fill" /> {verify.data.checked} entries intact</Pill>
              ) : (
                <Pill tone="danger"><WarningOctagonIcon size={13} weight="fill" /> Broken at entry {verify.data.broken_at}</Pill>
              )
            ) : null}
            <Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}>
              Verify log
            </Button>
          </div>
        }
      />
      {verify.error ? <p className="mb-4 text-[13px] text-danger">{errorMessage(verify.error)}</p> : null}

      {isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          Could not load activity. {errorMessage(error)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={ClockCounterClockwiseIcon} title="Nothing recorded yet" body="Changes to members, branches and departments will show up here." />
      ) : (
        <div className="grid gap-6">
          {groups.map((g) => (
            <section key={g.day}>
              <h2 className="mb-2 text-[12.5px] font-medium text-muted">{g.day}</h2>
              <ol className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
                {g.items.map((item) => (
                  <li key={item.id} className="flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
                    <time className="w-[4.75rem] shrink-0 whitespace-nowrap font-mono text-[12px] text-muted tabular" dateTime={item.ts}>
                      {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <p className="min-w-0 flex-1 text-[13.5px]">
                      <span className="font-medium">{item.actor_name ?? item.actor}</span>{" "}
                      <span className="text-muted">{describe(item)}</span>
                      {item.note ? <span className="text-muted"> ({item.note})</span> : null}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {hasNextPage ? (
            <Button variant="outline" className="justify-self-center" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              Load older activity
            </Button>
          ) : null}
        </div>
      )}
    </Page>
  );
}
