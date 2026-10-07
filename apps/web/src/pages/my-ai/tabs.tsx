/** My AI (P30): a person's one personal AI, their twin, as one page with tabs. Today is
 * /my-worker; Chat opens full screen; Tasks, What it knows, Teach it and Profile are the twin
 * page (/twin). Each keeps its own address, so links, the guide and the tutorial still open
 * the right one. Shown on both pages, once the person has a twin. */
import { BrainIcon, ChatsCircleIcon, GraduationCapIcon, IdentificationBadgeIcon, KanbanIcon, SunHorizonIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { chatRoute } from "@/components/chat/links";
import { PageTabs } from "@/components/page-tabs";
import { useT } from "@/i18n";
import { myAiTab, type MyAiTab } from "@/lib/my-ai";
import { twinQuery } from "@/lib/twin";
import { cn } from "@/lib/utils";
import { ComputersLink } from "@/pages/computers/indicator";

export function MyAiTabs({ className }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname, tab } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, tab: (s.location.search as { tab?: string }).tab }),
  });
  const { data } = useQuery(twinQuery);
  const twin = data?.twin;
  if (!twin) return null;
  const go = (v: MyAiTab) => {
    if (v === "today") return void navigate({ to: "/my-worker" });
    if (v === "chat") return void navigate(chatRoute(twin.id, { from: "/my-worker" }));
    void navigate({ to: "/twin", search: { tab: v === "profile" ? undefined : v } });
  };
  return (
    // P31: the computers the twin may use, at the end of the tab row (below it on phones).
    <div className={cn("flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end", className)}>
      <PageTabs<MyAiTab>
        label={t("My AI")}
        guide="my-ai.tabs"
        className="sm:min-w-0 sm:flex-1"
        value={myAiTab(pathname, tab)}
        onChange={go}
        tabs={[
          { value: "today", label: t("Today"), icon: SunHorizonIcon },
          { value: "chat", label: t("Chat"), icon: ChatsCircleIcon },
          { value: "tasks", label: t("Tasks"), icon: KanbanIcon, count: twin.open_tasks },
          { value: "memory", label: t("What it knows"), icon: BrainIcon },
          { value: "teach", label: t("Teach it"), icon: GraduationCapIcon },
          { value: "profile", label: t("Profile"), icon: IdentificationBadgeIcon },
        ]}
      />
      <ComputersLink className="shrink-0 self-start sm:self-auto sm:border-b sm:border-border sm:pb-1.5" />
    </div>
  );
}
