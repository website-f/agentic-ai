/** P31 My computers: the person's own Windows or Mac computers, linked so their own AI (twin
 * or private assistant) can find files in the folders they chose and browse on their screen.
 * See docs/PC-AGENT.md. */
import { DesktopTowerIcon, InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { devicesQuery, isMyOwnAi } from "@/lib/devices";
import { meQuery } from "@/lib/queries";
import { agentsQuery } from "@/lib/work";

import { DeviceCard } from "./device-card";
import { LinkDialog } from "./link-dialog";
import { SafetyBox } from "./safety";

export function ComputersPage() {
  const t = useT();
  const search = useSearch({ from: "/app/computers" });
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: devices, isLoading, error } = useQuery(devicesQuery);
  const { data: agents } = useQuery(agentsQuery);
  const [linking, setLinking] = useState(!!search.link);
  const [focus, setFocus] = useState<string | null>(search.device ?? null);

  const mine = (agents ?? []).filter((a) => isMyOwnAi(a, me.user.id) && a.status !== "retired");
  const noAi = !!agents && !mine.length;
  const aiHome = me.permissions.includes("agents.own") ? "/my-worker" : "/assistants";

  const closeLink = () => {
    setLinking(false);
    if (search.link) void navigate({ to: "/computers", search: {}, replace: true });
  };
  const clearFocus = useCallback(() => setFocus(null), []);

  const list = devices ?? [];
  const linkButton = (
    <Button data-guide="computers.link" onClick={() => setLinking(true)}><PlusIcon size={16} weight="bold" /> {t("Link a computer")}</Button>
  );

  return (
    <Page>
      <PageHeader title={t("My computers")}
        description={t("Let your own AI find files on your computer and browse on your screen. Only your AI can use it, only in the folders you choose.")}
        actions={list.length ? linkButton : null} />

      {noAi ? (
        <div className="flex min-w-0 flex-wrap items-start gap-3 rounded-[var(--radius-md)] border border-info/30 bg-info/8 px-4 py-3 text-[13.5px]">
          <InfoIcon size={18} weight="duotone" className="mt-0.5 shrink-0 text-info" />
          <p className="min-w-0 flex-1">
            {aiHome === "/my-worker"
              ? t("You have no personal AI yet. Only your own AI twin can use your computer: set it up first.")
              : t("You have no personal assistant yet. Only your own private assistant can use your computer: make one first.")}
          </p>
          <Button asChild size="sm" variant="outline"><Link to={aiHome}>{aiHome === "/my-worker" ? t("Open My AI") : t("Open My assistants")}</Link></Button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4"><Skeleton className="h-64 rounded-[var(--radius-md)]" /></div>
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !list.length ? (
        <EmptyState icon={DesktopTowerIcon} title={t("No computer linked yet")}
          body={t("Install a small program on your Windows or Mac computer and link it with a one-time code. It takes about two minutes.")}
          action={<Button size="lg" onClick={() => setLinking(true)}><PlusIcon size={18} weight="bold" /> {t("Link a computer")}</Button>} />
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {list.map((d) => (
            <DeviceCard key={d.id} device={d} focus={focus === d.id} onFocused={clearFocus} />
          ))}
        </div>
      )}

      <SafetyBox />

      {linking ? (
        <LinkDialog onClose={closeLink}
          onLinked={(id) => {
            closeLink();
            if (id) setFocus(id);
          }} />
      ) : null}
    </Page>
  );
}
