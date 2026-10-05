import { CheckCircleIcon, QuestionIcon, SealWarningIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";

import { ApprovalCard } from "@/components/approval-card";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import type { Approval } from "@/lib/work";

const ALREADY: Partial<Record<Approval["status"], string>> = {
  approved: msg("Already approved"),
  denied: msg("Already denied"),
  answered: msg("Already answered"),
  expired: msg("Already expired"),
  cancelled: msg("Already cancelled"),
};

/** The one-screen page a notification opens (iPhone has no notification buttons). */
export function ApprovePage() {
  const t = useT();
  const { approvalId } = useParams({ strict: false }) as { approvalId: string };
  const { data: me } = useSuspenseQuery(meQuery);
  const canDecide = me.permissions.includes("approvals.decide");
  const { data: a, isLoading, error } = useQuery({
    queryKey: ["approvals", "one", approvalId],
    queryFn: () => api<Approval>(`/api/approve/${approvalId}`),
    refetchInterval: 10_000,
  });
  return (
    <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6 sm:py-10">
      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !a ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : a.status === "pending" ? (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={a.kind === "question" ? QuestionIcon : SealWarningIcon} tone={a.kind === "question" ? "info" : "warn"} />
            <div className="min-w-0">
              <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{t("Approval")}</p>
              <h1 className="text-[20px] leading-tight font-semibold break-words">{a.kind === "question" ? t("{name} has a question", { name: a.agent_name }) : t("{name} needs a decision", { name: a.agent_name })}</h1>
            </div>
          </div>
          <ApprovalCard approval={a} canDecide={canDecide} />
          <Button asChild variant="ghost" className="w-fit justify-self-center"><Link to="/approvals">{t("All approvals")}</Link></Button>
        </>
      ) : (
        <div className="grid justify-items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-6 py-10 text-center shadow-[var(--shadow-soft)]">
          <span className="grid size-14 place-items-center rounded-full bg-ok/10 text-ok"><CheckCircleIcon size={32} weight="duotone" /></span>
          <p className="text-[16px] font-semibold">{ALREADY[a.status] ? t(ALREADY[a.status]!) : a.status}</p>
          <p className="text-[13.5px] text-muted">{t("{name} has its answer. Nothing else to do here.", { name: a.agent_name })}</p>
          <Button asChild variant="outline"><Link to="/approvals">{t("All approvals")}</Link></Button>
        </div>
      )}
    </div>
  );
}
