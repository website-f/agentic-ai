/** P48 "Needs you": a bell in the top bar with everything waiting on this person (approvals,
 * decisions, work to accept, drafts to send, bills to approve...), each a link to where it is
 * done. Only what they may act on (GET /api/me/needs). */
import {
  BellIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  GraduationCapIcon,
  HandIcon,
  KanbanIcon,
  ReceiptIcon,
  SealCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { msg, useT } from "@/i18n";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface NeedItem {
  key: "approvals" | "blocked" | "reviews" | "documents" | "failed" | "drafts" | "bills" | "skills" | "routines";
  count: number;
  to: string;
  search: Record<string, string>;
}

export const needsQuery = queryOptions({
  queryKey: ["me", "needs"],
  queryFn: () => api<{ total: number; items: NeedItem[] }>("/api/me/needs"),
  refetchInterval: 30_000,
  staleTime: 10_000,
  retry: false,
});

const LOOK: Record<NeedItem["key"], { icon: Icon; label: string; tone: string }> = {
  approvals: { icon: SealCheckIcon, label: msg("{n} approvals and questions from your AI"), tone: "text-warn" },
  blocked: { icon: HandIcon, label: msg("{n} tasks wait for your decision"), tone: "text-warn" },
  reviews: { icon: KanbanIcon, label: msg("{n} finished tasks for you to accept"), tone: "text-info" },
  documents: { icon: FileTextIcon, label: msg("{n} documents made by AI to review"), tone: "text-info" },
  failed: { icon: WarningCircleIcon, label: msg("{n} of your tasks failed this week"), tone: "text-danger" },
  drafts: { icon: EnvelopeSimpleIcon, label: msg("{n} email drafts to check and send"), tone: "text-info" },
  bills: { icon: ReceiptIcon, label: msg("{n} bills and receipts to approve"), tone: "text-warn" },
  skills: { icon: SparkleIcon, label: msg("{n} skill proposals to decide"), tone: "text-accent" },
  routines: { icon: GraduationCapIcon, label: msg("{n} learned routines to trust"), tone: "text-accent" },
};

export function NeedsBell() {
  const t = useT();
  const navigate = useNavigate();
  const q = useQuery(needsQuery);
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={total ? t("{n} things need you", { n: total }) : t("Nothing needs you")}
          title={t("Needs you")}>
          <BellIcon size={18} weight={total ? "fill" : "regular"} className={cn(total && "text-warn")} />
          {total ? (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white tabular">
              {total > 99 ? "99+" : total}
            </span>
          ) : null}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-80">
        <MenuLabel>{t("Needs you")}</MenuLabel>
        {items.length ? items.map((i) => {
          const look = LOOK[i.key];
          if (!look) return null;
          const Ico = look.icon;
          return (
            <MenuItem key={i.key} onSelect={() => void navigate({ to: i.to, search: i.search as never })}>
              <Ico size={17} weight="duotone" className={cn("shrink-0", look.tone)} />
              <span className="min-w-0 flex-1">{t(look.label, { n: i.count })}</span>
            </MenuItem>
          );
        }) : (
          <div className="flex items-center gap-2 px-2.5 py-3 text-[13px] text-muted">
            <CheckCircleIcon size={17} weight="duotone" className="text-ok" /> {t("All clear. Nothing waits for you.")}
          </div>
        )}
      </MenuContent>
    </Menu>
  );
}
