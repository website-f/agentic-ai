import { ClockCounterClockwiseIcon, SealCheckIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { ApprovalCard } from "@/components/approval-card";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { approvalsQuery } from "@/lib/work";

type Tab = "pending" | "history";

function List({ state, canDecide }: { state: Tab; canDecide: boolean }) {
  const { data, isLoading, error } = useQuery(approvalsQuery(state));
  if (isLoading) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <div className="flex items-center gap-3"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-4 w-2/3" /></div>
            <Skeleton className="h-16" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data?.length) {
    return state === "pending" ? (
      <EmptyState icon={SealCheckIcon} title="Nothing waiting on you" body="When an agent needs permission or has a question, it shows up here and as a notification." />
    ) : (
      <EmptyState icon={ClockCounterClockwiseIcon} title="No decisions yet" body="Every approval, denial and answer is kept here with who made it and when." />
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
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const tab: Tab = search.tab === "history" ? "history" : "pending";
  const { data: pending } = useQuery(approvalsQuery("pending"));
  const { data: history } = useQuery({ ...approvalsQuery("history"), enabled: tab === "history" });
  return (
    <Page>
      <PageHeader
        title="Approvals"
        description={canDecide ? "Agents stop and wait here before risky actions, and when they need an answer from you." : "Your role can see decisions but not make them. Ask an approver or admin."}
      />
      <Segmented<Tab>
        label="Approvals"
        className="w-fit"
        value={tab}
        onChange={(v) => navigate({ to: "/approvals", search: { tab: v }, replace: true })}
        options={[
          { value: "pending", label: "Waiting", count: pending?.length },
          { value: "history", label: "History", count: history?.length },
        ]}
      />
      {tab === "pending" ? <List state="pending" canDecide={canDecide} /> : <List state="history" canDecide={false} />}
    </Page>
  );
}
