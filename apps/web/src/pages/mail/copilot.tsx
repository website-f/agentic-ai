/** P147: "Microsoft 365 Copilot" on the Microsoft 365 page: whether the person's plain questions
 * to their own AI go to Copilot first (free with their Copilot licence) and, when not, the one
 * thing to do: Allow Copilot (a reconnect that asks for Copilot's permissions), check the licence
 * again, or wait while Microsoft asks to slow down. Shown once an owner switched Copilot first on
 * (AI Engine > Settings); never for a personal Microsoft account. */
import { ArrowClockwiseIcon, CheckCircleIcon, ShieldCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  copilotStatusQuery,
  refreshCopilotStatus,
  startCopilotConnect,
  type CopilotState,
  type MicrosoftAccount,
} from "@/lib/microsoft";
import { cn } from "@/lib/utils";

const LOOK: Record<CopilotState, { pill: string; tone: "ok" | "warn" | "neutral"; text: string }> = {
  ready: {
    pill: msg("Ready"),
    tone: "ok",
    text: msg("Your plain questions to your AI (summaries, drafts, translations, explanations) go to Microsoft 365 Copilot first, free with your licence. Bigger work uses the office's AI engine."),
  },
  no_scope: {
    pill: msg("Needs permission"),
    tone: "warn",
    text: msg("Allow Copilot once. Your Microsoft 365 admin must have approved the Copilot permissions for this app first."),
  },
  no_licence: {
    pill: msg("No licence"),
    tone: "neutral",
    text: msg("Your account has no Microsoft 365 Copilot licence, or it could not be checked just now. Your AI uses the office's AI engine."),
  },
  throttled: {
    pill: msg("Paused"),
    tone: "warn",
    text: msg("Microsoft asked to slow down. The office's AI engine answers until {time}."),
  },
  no_microsoft: {
    pill: msg("Not available"),
    tone: "neutral",
    text: msg("Copilot needs your own Microsoft 365 work account connected here."),
  },
};

function clock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CopilotStatusRow({ account }: { account: MicrosoftAccount }) {
  const t = useT();
  const qc = useQueryClient();
  const status = useQuery({ ...copilotStatusQuery, enabled: !account.personal });
  const allow = useMutation({
    mutationFn: startCopilotConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const recheck = useMutation({
    mutationFn: refreshCopilotStatus,
    onSuccess: (d) => qc.setQueryData(copilotStatusQuery.queryKey, d),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (account.personal) return null;
  if (status.isPending) return <Skeleton className="h-14" />;
  if (status.isError || !status.data.on) return null; // an older server, or the owner left it off
  const s = status.data;
  const look = LOOK[s.state] ?? LOOK.no_licence;
  const until = clock(s.until);
  return (
    <div data-guide="mail.copilot"
      className={cn("flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2.5", s.state === "ready" ? "border-border" : "border-dashed border-warn/40 bg-warn/5")}>
      <SparkleIcon size={18} weight="duotone" className={cn("mt-0.5 shrink-0", s.state === "ready" ? "text-info" : "text-muted")} />
      <span className="grid min-w-0 flex-1 basis-64 gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
          {t("Microsoft 365 Copilot")}
          <Pill tone={look.tone} className="py-0 text-[11.5px]">
            {s.state === "ready" ? <CheckCircleIcon size={11} weight="fill" /> : null}
            {s.state === "throttled" && until ? t("Paused (busy until {time})", { time: until }) : t(look.pill)}
          </Pill>
        </span>
        <span className="text-[12.5px] break-words text-muted">{t(look.text, { time: until || "-" })}</span>
        {s.state === "ready" && s.use_retrieval ? (
          <span className="flex items-start gap-1.5 text-[12px] text-muted">
            <ShieldCheckIcon size={14} className="mt-0.5 shrink-0 text-ok" />
            {t("Your AI can also search your SharePoint and OneDrive files through Copilot, only what you can already open.")}
          </span>
        ) : null}
      </span>
      {s.state === "no_scope" ? (
        <Button size="sm" variant="outline" loading={allow.isPending} onClick={() => allow.mutate()}>
          <SparkleIcon size={14} /> {t("Allow Copilot")}
        </Button>
      ) : s.state === "no_licence" ? (
        <Button size="sm" variant="ghost" loading={recheck.isPending} onClick={() => recheck.mutate()}>
          <ArrowClockwiseIcon size={14} /> {t("Check again")}
        </Button>
      ) : null}
    </div>
  );
}
