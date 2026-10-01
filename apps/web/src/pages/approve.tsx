import { CheckCircleIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";

import { ApprovalCard } from "@/components/approval-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import type { Approval } from "@/lib/work";

/** The one-screen page a notification opens (iPhone has no notification buttons). */
export function ApprovePage() {
  const { approvalId } = useParams({ strict: false }) as { approvalId: string };
  const { data: me } = useSuspenseQuery(meQuery);
  const canDecide = me.permissions.includes("approvals.decide");
  const { data: a, isLoading, error } = useQuery({
    queryKey: ["approvals", "one", approvalId],
    queryFn: () => api<Approval>(`/api/approve/${approvalId}`),
    refetchInterval: 10_000,
  });
  return (
    <div className="mx-auto grid w-full max-w-lg gap-4 px-4 py-6 sm:py-10">
      {isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" /> : error || !a ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : a.status === "pending" ? (
        <>
          <h1 className="text-[20px] font-semibold">{a.kind === "question" ? `${a.agent_name} has a question` : `${a.agent_name} needs a decision`}</h1>
          <ApprovalCard approval={a} canDecide={canDecide} />
        </>
      ) : (
        <div className="grid justify-items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-6 py-10 text-center">
          <CheckCircleIcon size={40} weight="duotone" className="text-ok" />
          <p className="text-[16px] font-semibold">Already {a.status}</p>
          <p className="text-[13.5px] text-muted">{a.agent_name} has its answer. Nothing else to do here.</p>
          <Button asChild variant="outline"><Link to="/approvals">All approvals</Link></Button>
        </div>
      )}
    </div>
  );
}
