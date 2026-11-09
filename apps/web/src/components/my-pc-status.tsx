/** P92: the card shown BEFORE any ePerolehan work starts (the task composer, its tender form):
 * whether the person's own computer is ready, in plain words, with the one thing to do next.
 *  - green: "Your computer <name> is ready"
 *  - amber: "Turn on your computer and open Agentic Office PC" (Check again; checks by itself)
 *  - amber: "Press Allow on your computer" (the request was sent to it; Send the request again)
 *  - amber: an older app (get the new one) or a paused computer (turn it back on)
 *  - red: "Link your computer first — about 2 minutes" with a big button: the link wizard,
 *    with "allow ePerolehan on this computer" already chosen.
 * Starting waits until it is ready (`pcReady`). */
import {
  ArrowClockwiseIcon, CheckCircleIcon, DesktopTowerIcon, HandPointingIcon, LinkSimpleIcon, PauseCircleIcon,
  PowerIcon, WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { askMyPc, myPcStatusQuery, pcTone, type MyPcStatus } from "@/lib/my-pc";
import { cn, timeAgo } from "@/lib/utils";
import { LinkDialog } from "@/pages/computers/link-dialog";

const TONE = {
  ok: "border-ok/40 bg-ok/8",
  warn: "border-warn/40 bg-warn/8",
  bad: "border-danger/40 bg-danger/8",
} as const;
const ICON_TONE = { ok: "text-ok", warn: "text-warn", bad: "text-danger" } as const;

export function MyPcStatusCard({ site, className }: { site: string; className?: string }) {
  const t = useT();
  const q = useQuery(myPcStatusQuery(site));
  const [linking, setLinking] = useState(false);
  if (q.isLoading) {
    return <div className={cn("h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-2", className)} aria-label={t("Checking your computer…")} />;
  }
  if (q.error || !q.data) {
    return (
      <div role="alert" className={cn("flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-warn/40 bg-warn/8 p-3 text-[13px]", className)}>
        <span className="min-w-0 flex-1">{t("Could not check your computer.")} {q.error ? errorMessage(q.error) : null}</span>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}><ArrowClockwiseIcon size={14} /> {t("Check again")}</Button>
      </div>
    );
  }
  if (!q.data.needed) return null;
  return (
    <>
      <PcCard s={q.data} className={className} checking={q.isFetching} onCheck={() => void q.refetch()} onLink={() => setLinking(true)} />
      {linking ? (
        <LinkDialog allowSite={site} onClose={() => { setLinking(false); void q.refetch(); }} onLinked={() => { setLinking(false); void q.refetch(); }} />
      ) : null}
    </>
  );
}

/** One state of the card (exported for its tests). */
export function PcCard({ s, className, checking, onCheck, onLink }: {
  s: MyPcStatus; className?: string; checking?: boolean; onCheck: () => void; onLink: () => void;
}) {
  const t = useT();
  const tone = pcTone(s.state);
  const name = s.device?.name ?? t("your computer");
  const again = useMutation({
    mutationFn: () => askMyPc(s.site),
    onSuccess: (r) => {
      if (r.asked) toast.success(t("Sent. Look at {name} and press Allow.", { name: r.device?.name ?? name }));
      else if (!r.online) toast.message(t("Your computer is not on. It is asked as soon as it comes on."));
      else toast.message(t("Already sent a moment ago. Look at {name}.", { name }));
      onCheck();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const checkAgain = (
    <Button size="lg" variant="outline" onClick={onCheck} loading={checking}><ArrowClockwiseIcon size={16} /> {t("Check again")}</Button>
  );

  let icon: ReactNode;
  let title: string;
  let body: ReactNode;
  let actions: ReactNode = null;
  switch (s.state) {
    case "ready":
      icon = <CheckCircleIcon size={26} weight="fill" />;
      title = t("Your computer {name} is ready", { name });
      body = t("ePerolehan opens on {name}, from your own internet line. Keep it on until the work is done.", { name });
      break;
    case "offline":
      icon = <PowerIcon size={26} weight="bold" />;
      title = t("Turn on your computer and open Agentic Office PC");
      body = (
        <>
          {t("{name} is off or the app is closed.", { name })}{" "}
          {s.device?.last_seen_at ? t("Last seen {when}.", { when: timeAgo(s.device.last_seen_at) }) : null}{" "}
          {t("This page checks again by itself.")}
        </>
      );
      actions = checkAgain;
      break;
    case "not_allowed":
      icon = <HandPointingIcon size={26} weight="fill" />;
      title = t("Press Allow on your computer");
      body = t("We sent the request to {name}. On that computer, the Agentic Office page shows Allow: press it once.", { name });
      actions = (
        <>
          <Button size="lg" onClick={() => again.mutate()} loading={again.isPending}><HandPointingIcon size={16} /> {t("Send the request again")}</Button>
          {checkAgain}
        </>
      );
      break;
    case "needs_update":
      icon = <WarningCircleIcon size={26} weight="fill" />;
      title = t("Get the new Agentic Office PC on your computer");
      body = t("{name} has an older app that cannot show Allow. On that computer, download the app again and run it. Then press Allow.", { name });
      actions = (
        <>
          <Button size="lg" onClick={onLink}><LinkSimpleIcon size={16} /> {t("Get the new app")}</Button>
          {checkAgain}
        </>
      );
      break;
    case "paused":
      icon = <PauseCircleIcon size={26} weight="fill" />;
      title = t("Your computer {name} is paused", { name });
      body = t("Turn it back on in My computers, then come back here.");
      actions = (
        <>
          <Button size="lg" asChild><Link to="/computers" search={s.device ? { device: s.device.id } : {}}><DesktopTowerIcon size={16} /> {t("Open My computers")}</Link></Button>
          {checkAgain}
        </>
      );
      break;
    default:
      icon = <DesktopTowerIcon size={26} weight="duotone" />;
      title = t("Link your computer first — about 2 minutes");
      body = t("ePerolehan work runs on your own Windows computer, from your own internet line, so the portal does not block it. You only do this once.");
      actions = (
        <Button size="lg" className="h-12 px-6 text-[15.5px] max-sm:w-full" onClick={onLink}>
          <LinkSimpleIcon size={18} weight="bold" /> {t("Link my computer")}
        </Button>
      );
  }

  return (
    <section aria-live="polite" data-state={s.state}
      className={cn("grid min-w-0 gap-3 rounded-[var(--radius-md)] border p-3.5 sm:p-4", TONE[tone], className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", ICON_TONE[tone])}>{icon}</span>
        <div className="grid min-w-0 gap-1">
          <h3 className="text-[16px] leading-snug font-semibold">{title}</h3>
          <p className="text-[13.5px] leading-relaxed text-fg/80">{body}</p>
        </div>
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
