/** /chat/$agentId: one agent's chat, full screen without the app shell, so the conversation
 * gets the whole screen. ?session= opens a conversation, ?from= is the page Back returns to. */
import { ArrowLeftIcon, EyeIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { ChatView } from "@/components/chat/chat-view";
import { safeFrom } from "@/components/chat/links";
import { TaskComposerHost } from "@/components/task-composer/task-composer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { agentQuery } from "@/lib/work";
import { useAssistantChat } from "@/pages/assistants/chat-extras";

/** Back: to where the chat was opened from, else one step back in the app, else the chat list. */
function useBack() {
  const router = useRouter();
  const navigate = useNavigate();
  const search = useSearch({ from: "/chat/$agentId" });
  return () => {
    const from = safeFrom(search.from);
    if (from) void navigate({ href: from, replace: true });
    else if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: "/chat" });
  };
}

/** Loading, errors and "you only watch this agent": still full screen, with the way back. */
function Frame({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="dialog"], [role="alertdialog"]')) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-1.5 sm:px-3">
        <Button size="icon" variant="ghost" onClick={onBack} aria-label={t("Back")} title={t("Back (Esc)")}><ArrowLeftIcon size={19} /></Button>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6">{children}</div>
    </div>
  );
}

export function ChatFullPage() {
  const t = useT();
  const { agentId } = useParams({ from: "/chat/$agentId" });
  const search = useSearch({ from: "/chat/$agentId" });
  const navigate = useNavigate();
  const back = useBack();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: agent, isLoading, error } = useQuery(agentQuery(agentId));
  const extras = useAssistantChat(agent);
  const canWrite = me.permissions.includes("work.write");

  if (isLoading) {
    return (
      <Frame onBack={back}>
        <div className="grid w-full max-w-[760px] gap-5" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className={i % 2 ? "ml-auto h-12 w-2/3 rounded-[var(--radius-lg)]" : "h-20 w-4/5 rounded-[var(--radius-lg)]"} />)}
        </div>
      </Frame>
    );
  }
  if (error || !agent) {
    return (
      <Frame onBack={back}>
        <div role="alert" className="grid max-w-sm justify-items-center gap-3 text-center">
          <WarningCircleIcon size={30} weight="duotone" className="text-warn" />
          <p className="text-[14px]">{error ? errorMessage(error) : t("This agent is not here.")}</p>
          <Button variant="outline" onClick={back}>{t("Back")}</Button>
        </div>
      </Frame>
    );
  }
  // Colleagues' agents the viewer only watches can't be chatted with (the API answers 404).
  if (agent.view_only) {
    return (
      <Frame onBack={back}>
        <div className="grid max-w-sm justify-items-center gap-3 text-center">
          <EyeIcon size={30} weight="duotone" className="text-muted" />
          <p className="text-[14px]">
            {agent.owner_name ? t("You're watching {name}. Only {owner} can instruct or change it.", { name: agent.name, owner: agent.owner_name })
              : t("You're watching {name}. Only its manager can instruct or change it.", { name: agent.name })}
          </p>
          <Button variant="outline" onClick={back}>{t("Back")}</Button>
        </div>
      </Frame>
    );
  }
  // An assistant waits for its extras (prompts, drafts badge) so it opens on the right conversation.
  if (extras.loading) {
    return <Frame onBack={back}><Skeleton className="h-20 w-full max-w-[760px] rounded-[var(--radius-lg)]" /></Frame>;
  }

  return (
    <>
      <ChatView
        key={agent.id}
        agent={agent}
        canWrite={canWrite}
        onBack={back}
        initialSession={search.session}
        onSessionChange={(id) => {
          if ((id ?? undefined) === search.session) return;
          void navigate({ to: "/chat/$agentId", params: { agentId }, search: (s) => ({ ...s, session: id ?? undefined }), replace: true });
        }}
        {...extras.props}
      />
      {/* No app shell here: the task composer ("Give a task", "Make this a task") lives with the chat. */}
      <TaskComposerHost />
    </>
  );
}
