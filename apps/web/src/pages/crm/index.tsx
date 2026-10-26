/** P50 the CRM: one place to follow everything about the business. A row of tabs (the
 * dashboard, each list, connections and sharing) that scrolls sideways on a phone. The owner
 * builds it (templates, the office's own data, blank lists, other systems); others see only
 * what the owner shared. */
import { ChartPieSliceIcon, PlugsConnectedIcon, PlusIcon, ShareNetworkIcon, LockKeyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import { crmOverviewQuery } from "@/lib/crm-hub";
import { cn } from "@/lib/utils";

import { CrmConnections } from "./connections";
import { CrmDashboard } from "./dashboard";
import { crmIcon } from "./icons";
import { ObjectPage } from "./object";
import { CrmSetup } from "./setup";
import { CrmSharing } from "./sharing";

export type CrmTab = "dashboard" | "connections" | "sharing" | "setup";
export interface CrmSearch { o?: string; v?: string; r?: string; tab?: CrmTab }

export function CrmPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as CrmSearch;
  const overview = useQuery(crmOverviewQuery);
  const go = (s: CrmSearch, replace = false) => void navigate({ to: "/crm", search: s as never, replace });

  if (overview.isLoading) {
    return <Page><PageHeader title={t("CRM")} /><Skeleton className="h-12 rounded-[var(--radius-md)]" /><Skeleton className="h-80 rounded-[var(--radius-md)]" /></Page>;
  }
  if (overview.error) {
    const denied = overview.error instanceof ApiError && overview.error.status === 403;
    return (
      <Page>
        <PageHeader title={t("CRM")} />
        {denied ? (
          <EmptyState icon={LockKeyIcon} title={t("The CRM is not shared with you")}
            body={t("The owner decides who sees which parts of the CRM. Ask them to share what you need.")} />
        ) : <p role="alert" className="text-danger">{errorMessage(overview.error)}</p>}
      </Page>
    );
  }

  const data = overview.data!;
  const owner = data.access.owner;
  const objects = data.objects.filter((o) => !o.archived);
  const canDash = owner || data.access.dashboard;

  // First visit for the owner: build the CRM. Someone with nothing shared: say so.
  const empty = !objects.length;
  let tab: CrmTab | undefined = search.tab;
  let objectKey = search.o && objects.some((o) => o.key === search.o) ? search.o : undefined;
  if (!tab && !objectKey) {
    if (empty && owner) tab = "setup";
    else if (canDash) tab = "dashboard";
    else objectKey = objects[0]?.key;
  }
  if (!owner && (tab === "connections" || tab === "sharing" || tab === "setup")) tab = canDash ? "dashboard" : undefined;

  const current = objectKey ? objects.find((o) => o.key === objectKey) : undefined;

  let body: ReactNode;
  if (tab === "setup") body = <CrmSetup overview={data} onOpenObject={(key) => go({ o: key })} />;
  else if (tab === "connections") body = <CrmConnections onOpenObject={(key) => go({ o: key })} />;
  else if (tab === "sharing") body = <CrmSharing objects={objects} />;
  else if (tab === "dashboard") body = <CrmDashboard objects={objects} canEdit={owner} onOpenObject={(key, r) => go({ o: key, r })} />;
  else if (current) body = <ObjectPage key={current.key} objectKey={current.key} isOwner={owner} />;
  else body = (
    <EmptyState icon={LockKeyIcon} title={t("Nothing is shared with you yet")}
      body={t("The owner decides who sees which parts of the CRM. Ask them to share what you need.")} />
  );

  return (
    <Page wide>
      <PageHeader
        title={current ? current.name : t("CRM")}
        description={current?.description || t("Everything about your business in one place: customers, sales, money, work and anything else you track, including data from your other systems.")}
        actions={owner && tab !== "setup" ? (
          <Button variant="outline" onClick={() => go({ tab: "setup" })}><PlusIcon size={16} weight="bold" /> {t("Add to CRM")}</Button>
        ) : undefined}
      />

      <nav aria-label={t("CRM sections")} className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {canDash ? <Tab active={tab === "dashboard"} onClick={() => go({ tab: "dashboard" })} icon={<ChartPieSliceIcon size={15} />}>{t("Dashboard")}</Tab> : null}
        {objects.map((o) => {
          const Ico = crmIcon(o.icon);
          return (
            <Tab key={o.key} active={!tab && objectKey === o.key} onClick={() => go({ o: o.key })}
              icon={<Ico size={15} style={{ color: o.color }} />}
              count={o.count}>
              {o.name}
            </Tab>
          );
        })}
        {owner ? (
          <>
            <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-border" />
            <Tab active={tab === "connections"} onClick={() => go({ tab: "connections" })} icon={<PlugsConnectedIcon size={15} />}>{t("Connections")}</Tab>
            <Tab active={tab === "sharing"} onClick={() => go({ tab: "sharing" })} icon={<ShareNetworkIcon size={15} />}>{t("Sharing")}</Tab>
          </>
        ) : null}
      </nav>

      <div className="min-w-0">{body}</div>
    </Page>
  );
}

function Tab({ active, onClick, icon, count, children }: { active: boolean; onClick: () => void; icon: ReactNode; count?: number | null; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={cn("inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors",
        active ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg hover:border-accent/40")}>
      <span className={cn("[&_svg]:shrink-0", active && "[&_svg]:!text-current")}>{icon}</span>
      {children}
      {typeof count === "number" ? <span className={cn("text-[12px] tabular", active ? "opacity-80" : "text-muted")}>{count.toLocaleString()}</span> : null}
    </button>
  );
}
