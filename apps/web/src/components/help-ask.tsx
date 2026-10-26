/** P49 "Ask how": ask the AI, in your own words, how to do something in the app. It answers in
 * plain steps with links to the pages you can open (POST /api/help/ask), knowing your role,
 * the page you are on and your setup steps. Opened from the sidebar, its search box, the
 * phone's More menu, and the "Ask how" buttons in the setup list. */
import { ArrowRightIcon, ChatCircleDotsIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { SideSheet } from "@/components/ui/side-sheet";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { stepsFor } from "@/lib/setup";
import { tutorialProgressQuery } from "@/lib/tutorial";
import { staffOnly } from "@/lib/twin";
import { ALL_NAV } from "@/nav";

interface HelpState {
  open: boolean;
  question: string;
  ask: (question?: string) => void;
  close: () => void;
}

export const useHelpAsk = create<HelpState>((set) => ({
  open: false,
  question: "",
  ask: (question = "") => set({ open: true, question }),
  close: () => set({ open: false, question: "" }),
}));

const STAFF_SUGGESTIONS = [
  msg("How do I give my AI a task?"),
  msg("How do I claim a receipt I paid for?"),
  msg("How do I set my AI's working hours?"),
  msg("How do I see my computer's files from home?"),
];
const MANAGER_SUGGESTIONS = [
  msg("What should I set up first?"),
  msg("How do I add my company's SOPs?"),
  msg("How do I approve supplier bills?"),
  msg("How do I give an agent a daily duty?"),
];

interface Turn {
  q: string;
  a?: string;
  error?: string;
}

export function HelpAskSheet() {
  const t = useT();
  const { open, question, close } = useHelpAsk();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useSuspenseQuery(meQuery);
  const progress = useQuery({ ...tutorialProgressQuery, enabled: open });
  const staff = staffOnly(me.permissions);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const pages = ALL_NAV.filter((i) => !i.perm || [i.perm].flat().some((p) => me.permissions.includes(p)))
    .map((i) => ({ to: i.to, label: t(i.label), about: t(i.blurb).slice(0, 280) }));
  const setup = stepsFor(staff, me.permissions, progress.data?.signals ?? {}).map((s) => ({ label: t(s.title), done: s.done }));

  const ask = useMutation({
    mutationFn: (q: string) => api<{ answer: string }>("/api/help/ask", "POST", { question: q, path: pathname, pages: pages.slice(0, 90), setup }),
    onMutate: (q) => setTurns((ts) => [...ts, { q }]),
    onSuccess: (r) => setTurns((ts) => ts.map((x, i) => (i === ts.length - 1 ? { ...x, a: r.answer } : x))),
    onError: (e) => setTurns((ts) => ts.map((x, i) => (i === ts.length - 1 ? { ...x, error: errorMessage(e) } : x))),
  });

  // A question handed in from elsewhere (the sidebar search): ask it once on open.
  const asked = useRef("");
  useEffect(() => {
    if (open && question && asked.current !== question && !ask.isPending) {
      asked.current = question;
      ask.mutate(question);
    }
    if (!open) asked.current = "";
  }, [open, question, ask]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);

  const send = () => {
    const q = text.trim();
    if (q.length < 2 || ask.isPending) return;
    setText("");
    ask.mutate(q);
  };

  const go = (href: string) => {
    if (!href.startsWith("/")) return;
    close();
    void navigate({ to: href });
  };

  return (
    <SideSheet open={open} onOpenChange={(o) => !o && close()} size="md" title={t("Ask how")}
      description={t("Ask in your own words how to do something here. The AI answers in plain steps and takes you to the right page.")}>
      <div className="grid min-h-full grid-rows-[1fr_auto] gap-3">
        <div className="grid content-start gap-4">
          {!turns.length ? (
            <div className="grid gap-2">
              <span className="text-[12.5px] font-medium text-muted">{t("For example")}</span>
              {(staff ? STAFF_SUGGESTIONS : MANAGER_SUGGESTIONS).map((s) => (
                <button key={s} type="button" onClick={() => ask.mutate(t(s))}
                  className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 text-left text-[13.5px] hover:border-accent/40 hover:bg-accent-soft/30">
                  <ChatCircleDotsIcon size={16} className="shrink-0 text-accent" /> <span className="min-w-0 flex-1">{t(s)}</span>
                  <ArrowRightIcon size={13} className="shrink-0 text-muted" />
                </button>
              ))}
            </div>
          ) : null}
          {turns.map((x, i) => (
            <div key={i} className="grid gap-2">
              <p className="justify-self-end rounded-[var(--radius-md)] bg-accent px-3 py-2 text-[13.5px] text-accent-fg">{x.q}</p>
              {x.a ? (
                <div className="md rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <button type="button" onClick={() => go(href ?? "")} className="inline font-medium text-accent underline underline-offset-2">
                          {children}
                        </button>
                      ),
                    }}>
                    {x.a}
                  </ReactMarkdown>
                </div>
              ) : x.error ? (
                <p role="alert" className="text-[13px] text-danger">{x.error}</p>
              ) : (
                <p className="text-[13px] text-muted">{t("Thinking…")}</p>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form className="sticky bottom-0 flex gap-2 border-t border-border bg-surface pt-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoFocus
            placeholder={t("e.g. How do I send a quotation?")} aria-label={t("Your question")}
            className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-[14px] focus-visible:border-accent focus-visible:outline-none" />
          <Button type="submit" className="h-11" loading={ask.isPending} disabled={text.trim().length < 2} aria-label={t("Ask")}>
            <PaperPlaneRightIcon size={16} />
          </Button>
        </form>
      </div>
    </SideSheet>
  );
}
