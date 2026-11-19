/** P116 (feedback 19 Nov: "chat with AI from a floating button"): "Ask my AI" on every page. A
 * round button at the bottom right opens a chat with the person's own AI (their twin) in a panel
 * over the page (full screen on a phone), the same chat as /chat/$agentId; "Full screen" carries
 * the conversation over. Without an AI of their own it says where to get one. */
import { ArrowsOutSimpleIcon, ChatCircleDotsIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { ChatView } from "@/components/chat/chat-view";
import { chatRoute } from "@/components/chat/links";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { useBackClose } from "@/lib/back-close";
import { meQuery } from "@/lib/queries";
import { twinQuery } from "@/lib/twin";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

export const useAiFab = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Pages that already are a chat with the AI, and Prima inside the office (its own launcher with
 * Arisha sits in that corner): no button on top of them. */
const NOT_ON = ["/my-worker", "/twin", "/chat", "/prima"];

export function AiFab() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open, setOpen } = useAiFab();
  const phone = useIsPhone();
  const reduce = useReducedMotion();
  useBackClose(open, () => setOpen(false));
  useEffect(() => setOpen(false), [pathname, setOpen]);
  const mayHaveAi = me.permissions.includes("agents.own") || me.permissions.includes("assistants.use");
  if (!mayHaveAi || NOT_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("Ask my AI")}
          title={t("Ask my AI")}
          data-feedback-ignore=""
          className={cn(
            "fixed right-4 z-30 grid size-13 place-items-center rounded-full bg-accent text-white shadow-[var(--shadow-pop)] transition-[transform,background-color] hover:scale-105 hover:bg-accent/90 active:scale-95 md:right-6",
            "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6",
          )}
        >
          <ChatCircleDotsIcon size={26} weight="fill" />
        </button>
      ) : null}
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label={t("Ask my AI")}
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            data-feedback-ignore=""
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden bg-surface",
              phone
                ? "inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
                : "right-6 bottom-6 h-[min(44rem,calc(100dvh-5rem))] w-[min(27rem,calc(100vw-3rem))] rounded-[var(--radius-lg)] border border-border shadow-[var(--shadow-pop)]",
            )}
          >
            <AiPanel onClose={() => setOpen(false)} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function AiPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const twin = useQuery(twinQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [session, setSession] = useState<string | null>(null);
  const agent = twin.data?.twin ?? null;
  if (twin.isLoading) {
    return <div className="grid gap-3 p-5"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-24 w-full" /></div>;
  }
  if (!agent) {
    const owns = me.permissions.includes("agents.own");
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
          <p className="text-[14.5px] font-semibold">{t("Ask my AI")}</p>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("Close")}><XIcon size={18} /></Button>
        </div>
        <div className="grid flex-1 content-center justify-items-center gap-3 p-6 text-center">
          <ChatCircleDotsIcon size={36} weight="duotone" className="text-accent" />
          <p className="max-w-[30ch] text-[14px] text-muted">
            {owns ? t("You have no AI of your own yet. Make it once and it is here on every page.") : t("Chat with your assistants, or any AI you work with.")}
          </p>
          <Button asChild onClick={onClose}>
            {owns ? <Link to="/my-worker">{t("Make my AI")}</Link> : <Link to="/chat">{t("Open chats")}</Link>}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ChatView
      key={agent.id}
      agent={agent}
      docked
      canWrite={me.permissions.includes("work.write")}
      onBack={onClose}
      resumeLatest
      initialSession={session}
      onSessionChange={setSession}
      headerExtra={
        <Button size="icon" variant="ghost" aria-label={t("Full screen")} title={t("Full screen")}
          onClick={() => { onClose(); void navigate(chatRoute(agent.id, { from: pathname, session: session ?? undefined })); }}>
          <ArrowsOutSimpleIcon size={17} />
        </Button>
      }
    />
  );
}
