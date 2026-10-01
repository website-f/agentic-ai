import { SealCheckIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs } from "radix-ui";

import { ApprovalCard } from "@/components/approval-card";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { approvalsQuery } from "@/lib/work";

function List({ state, canDecide }: { state: "pending" | "history"; canDecide: boolean }) {
  const { data, isLoading, error } = useQuery(approvalsQuery(state));
  if (isLoading) return <div className="grid gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-[var(--radius-md)]" />)}</div>;
  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data?.length) {
    return state === "pending" ? (
      <EmptyState icon={SealCheckIcon} title="Nothing waiting on you" body="When an agent needs permission or has a question, it shows up here and as a notification." />
    ) : (
      <p className="text-[13.5px] text-muted">No decisions yet.</p>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
      {data.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={canDecide} />)}
    </div>
  );
}

export function ApprovalsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canDecide = me.permissions.includes("approvals.decide");
  const search = useSearch({ strict: false }) as { tab?: "pending" | "history" };
  const navigate = useNavigate();
  const tab = search.tab === "history" ? "history" : "pending";
  const { data: pending } = useQuery(approvalsQuery("pending"));
  return (
    <Page>
      <PageHeader
        title="Approvals"
        description={canDecide ? "Agents stop and wait here before risky actions, and when they need an answer from you." : "Your role can see decisions but not make them. Ask an approver or admin."}
      />
      <Tabs.Root value={tab} onValueChange={(v) => navigate({ to: "/approvals", search: { tab: v as "pending" | "history" }, replace: true })}>
        <Tabs.List className="mb-5 flex gap-1 border-b border-border" aria-label="Approvals">
          {(["pending", "history"] as const).map((t) => (
            <Tabs.Trigger key={t} value={t} className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
              {t === "pending" ? "Waiting" : "History"}
              {t === "pending" && pending?.length ? <span className="rounded-full bg-warn/15 px-1.5 text-[11.5px] font-semibold text-warn tabular">{pending.length}</span> : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="pending" className="outline-none"><List state="pending" canDecide={canDecide} /></Tabs.Content>
        <Tabs.Content value="history" className="outline-none"><List state="history" canDecide={false} /></Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}
