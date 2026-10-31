/** P48 "Needs you": a bell in the top bar with everything waiting on this person (approvals,
 * decisions, work to accept, drafts to send, bills to approve...), each a link to where it is
 * done. Only what they may act on (GET /api/me/needs).
 * P56: one line per thing, newest first, scrolling inside the panel; the kinds at the top
 * filter it; "Mark all as read" makes the badge count only what comes after. */
import {
  ArrowRightIcon,
  BellIcon,
  CheckCircleIcon,
  ChecksIcon,
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
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { msg, useT } from "@/i18n";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

export interface NeedItem {
  key: "approvals" | "blocked" | "reviews" | "documents" | "failed" | "drafts" | "bills" | "skills" | "routines";
  count: number;
  to: string;
  search: Record<string, string>;
}

export interface NeedEntry {
  key: NeedItem["key"];
  id: string;
  title: string;
  at: string | null;
  to: string;
  search: Record<string, string>;
  new: boolean;
}

export const needsQuery = queryOptions({
  queryKey: ["me", "needs"],
  queryFn: () => api<{ total: number; unread?: number; items: NeedItem[]; entries?: NeedEntry[] }>("/api/me/needs"),
  refetchInterval: 30_000,
  staleTime: 10_000,
  retry: false,
});

const LOOK: Record<NeedItem["key"], { icon: Icon; label: string; one: string; tone: string }> = {
  approvals: { icon: SealCheckIcon, label: msg("{n} approvals and questions from your AI"), one: msg("Approval or question"), tone: "text-warn" },
  blocked: { icon: HandIcon, label: msg("{n} tasks wait for your decision"), one: msg("Waits for your decision"), tone: "text-warn" },
  reviews: { icon: KanbanIcon, label: msg("{n} finished tasks for you to accept"), one: msg("Finished, to accept"), tone: "text-info" },
  documents: { icon: FileTextIcon, label: msg("{n} documents made by AI to review"), one: msg("Document to review"), tone: "text-info" },
  failed: { icon: WarningCircleIcon, label: msg("{n} of your tasks failed this week"), one: msg("Task failed"), tone: "text-danger" },
  drafts: { icon: EnvelopeSimpleIcon, label: msg("{n} email drafts to check and send"), one: msg("Email draft"), tone: "text-info" },
  bills: { icon: ReceiptIcon, label: msg("{n} bills and receipts to approve"), one: msg("Bill to approve"), tone: "text-warn" },
  skills: { icon: SparkleIcon, label: msg("{n} skill proposals to decide"), one: msg("Skill proposal"), tone: "text-accent" },
  routines: { icon: GraduationCapIcon, label: msg("{n} learned routines to trust"), one: msg("Learned routine"), tone: "text-accent" },
};

const chip = "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] tabular";

export function NeedsBell() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery(needsQuery);
  const items = q.data?.items ?? [];
  const entries = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;
  const unread = q.data?.unread ?? total;
  const [kind, setKind] = useState<NeedItem["key"] | null>(null);
  const shown = kind ? entries.filter((e) => e.key === kind) : entries;
  const picked = kind ? items.find((x) => x.key === kind) : undefined;
  const seen = useMutation({
    mutationFn: () => api("/api/me/needs/seen", "POST", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: needsQuery.queryKey }),
  });
  const go = (to: string, search: Record<string, string>) => void navigate({ to, search: search as never });
  return (
    <Menu onOpenChange={(o) => { if (!o) setKind(null); }}>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative"
          aria-label={unread ? t("{n} new things need you", { n: unread }) : total ? t("{n} things need you", { n: total }) : t("Nothing needs you")}
          title={t("Needs you")}>
          <BellIcon size={18} weight={total ? "fill" : "regular"} className={cn(unread && "text-warn")} />
          {unread ? (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white tabular">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="flex max-h-[min(36rem,80dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col p-0">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-[13px] font-semibold">{t("Needs you")}{total ? ` · ${total}` : ""}</span>
          {unread ? (
            <button type="button" onClick={() => seen.mutate()} disabled={seen.isPending}
              className="inline-flex min-h-8 items-center gap-1 rounded-sm px-1.5 text-[12.5px] font-medium text-accent hover:bg-accent-soft/50 disabled:opacity-60">
              <ChecksIcon size={14} weight="bold" /> {t("Mark all as read")}
            </button>
          ) : null}
        </div>
        {items.length ? (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => setKind(null)}
              className={cn(chip, kind === null ? "border-accent bg-accent-soft/60 text-accent" : "border-border text-muted hover:text-fg")}>
              {t("All")}
            </button>
            {items.map((i) => {
              const look = LOOK[i.key];
              if (!look) return null;
              const Ico = look.icon;
              return (
                <button key={i.key} type="button" onClick={() => setKind(kind === i.key ? null : i.key)} title={t(look.label, { n: i.count })}
                  className={cn(chip, kind === i.key ? "border-accent bg-accent-soft/60 text-accent" : "border-border text-muted hover:text-fg")}>
                  <Ico size={13} weight="duotone" className={look.tone} /> {i.count}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {picked && LOOK[picked.key] ? (
            <MenuItem onSelect={() => go(picked.to, picked.search)} className="text-[12.5px] font-medium text-accent">
              <span className="min-w-0 flex-1">{t(LOOK[picked.key].label, { n: picked.count })}</span>
              <ArrowRightIcon size={13} />
            </MenuItem>
          ) : null}
          {shown.length ? shown.map((e) => {
            const look = LOOK[e.key];
            const Ico = look?.icon ?? BellIcon;
            return (
              <MenuItem key={`${e.key}:${e.id}`} onSelect={() => go(e.to, e.search)} className="items-start gap-2.5 py-2">
                <Ico size={17} weight="duotone" className={cn("mt-0.5 shrink-0", look?.tone)} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className={cn("truncate text-[13px]", e.new && "font-semibold")}>{e.title || t("Untitled")}</span>
                  <span className="truncate text-[11.5px] text-muted">
                    {look ? t(look.one) : ""}{e.at ? ` · ${timeAgo(e.at).toLowerCase()}` : ""}
                  </span>
                </span>
                {e.new ? <span aria-label={t("New")} className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" /> : null}
              </MenuItem>
            );
          }) : items.length ? (
            items.map((i) => {
              const look = LOOK[i.key];
              if (!look) return null;
              const Ico = look.icon;
              return (
                <MenuItem key={i.key} onSelect={() => go(i.to, i.search)}>
                  <Ico size={17} weight="duotone" className={cn("shrink-0", look.tone)} />
                  <span className="min-w-0 flex-1">{t(look.label, { n: i.count })}</span>
                </MenuItem>
              );
            })
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-3 text-[13px] text-muted">
              <CheckCircleIcon size={17} weight="duotone" className="text-ok" /> {t("All clear. Nothing waits for you.")}
            </div>
          )}
        </div>
      </MenuContent>
    </Menu>
  );
}
