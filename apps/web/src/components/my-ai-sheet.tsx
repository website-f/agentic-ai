/** P123 (Fitri, 23 Nov 2026: "under Agentic, one more entry at the bottom called My AI: it comes up
 * from the bottom over the whole page, with an X to close, to give a task to the AI or to
 * teammates and chat with their AI; a shortcut from Prima, and in the office as usual"):
 * the My AI sheet. Opened from Prima's "My AI" entry (a message from Prima, components/prima-host.tsx)
 * or anywhere in the office (useMyAiSheet.getState().setOpen(true)). "Give a task" opens the
 * office's task composer (to an AI or to people) over it; below, the chat with the person's own AI,
 * the same as "Ask my AI" (components/ai-fab.tsx). */
import { ArrowsOutSimpleIcon, ChatCircleDotsIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { ChatView } from "@/components/chat/chat-view";
import { chatRoute } from "@/components/chat/links";
import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { useBackClose } from "@/lib/back-close";
import { meQuery } from "@/lib/queries";
import { twinQuery } from "@/lib/twin";

export const useMyAiSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function MyAiSheet() {
  const t = useT();
  const { open, setOpen } = useMyAiSheet();
  const reduce = useReducedMotion();
  const close = () => setOpen(false);
  useBackClose(open, close);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // The chat and the composer close themselves first (they stop the event).
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="my-ai-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("My AI")}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 40 }}
          data-feedback-ignore=""
          className="fixed inset-0 z-[45] flex flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-pop)]"
        >
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 sm:px-5">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="truncate text-[16px] font-semibold">{t("My AI")}</p>
              <p className="truncate text-[12.5px] text-muted max-sm:hidden">{t("Give a task to your AI or to teammates, and chat with your AI.")}</p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => openTaskComposer()}>
              <PlusIcon size={15} weight="bold" /> {t("Give a task")}
            </Button>
            <Button size="icon" variant="ghost" onClick={close} aria-label={t("Close")} title={t("Close")}>
              <XIcon size={20} />
            </Button>
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-[60rem] flex-1 flex-col">
            <SheetChat onClose={close} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SheetChat({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const twin = useQuery(twinQuery);
  const [session, setSession] = useState<string | null>(null);
  const agent = twin.data?.twin ?? null;
  if (twin.isLoading) {
    return (
      <div className="grid gap-3 p-5">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!agent) {
    const owns = me.permissions.includes("agents.own");
    return (
      <div className="grid flex-1 content-center justify-items-center gap-3 p-6 text-center">
        <ChatCircleDotsIcon size={40} weight="duotone" className="text-accent" />
        <p className="max-w-[34ch] text-[14px] text-muted">
          {owns ? t("You have no AI of your own yet. Make it once and it is here on every page.") : t("Chat with your assistants, or any AI you work with.")}
        </p>
        <Button asChild variant="outline" onClick={onClose}>
          {owns ? <Link to="/my-worker">{t("Make my AI")}</Link> : <Link to="/chat">{t("Open chats")}</Link>}
        </Button>
      </div>
    );
  }
  return (
    <ChatView
      key={agent.id}
      agent={agent}
      docked
      canWrite={me.permissions.includes("work.write")}
      resumeLatest
      initialSession={session}
      onSessionChange={setSession}
      headerExtra={
        <Button size="icon" variant="ghost" aria-label={t("Full screen")} title={t("Full screen")}
          onClick={() => { onClose(); void navigate(chatRoute(agent.id, { session: session ?? undefined })); }}>
          <ArrowsOutSimpleIcon size={17} />
        </Button>
      }
    />
  );
}
