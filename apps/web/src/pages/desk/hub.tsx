/** P51 My workspace as a home base: big shortcuts to every page this person uses (only the ones
 * they may open), a "How do I…?" helper that finds the company's own SOPs and workflows for a
 * job (a tender, a claim, leave…) and has their AI walk them through it, and one way to hand
 * any question or file to their AI. */
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CompassIcon,
  FileTextIcon,
  FlowArrowIcon,
  LifebuoyIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useHelpAsk } from "@/components/help-ask";
import { IconTile, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { askDesk, deskKeys, type Desk } from "@/lib/desk";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { navItemFor, type AppPath } from "@/nav";

import type { DeskTab } from "./index";

// ---------------------------------------------------------------- hand it to my AI

/** Give a question or a file to the person's AI from anywhere on the desk; the toast links to
 * the task so they can follow it. */
export function useAskMyAi() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (body: { text: string; file_ids?: string[]; make?: "answer" | "document"; agent_id?: string | null }) =>
      askDesk({ make: "answer", ...body }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(r.note ? t("{name} will do it: {note}", { name: r.agent.name, note: r.note }) : t("{name} is on it. The answer appears under My work.", { name: r.agent.name }), {
        action: { label: t("Follow it"), onClick: () => void navigate({ to: "/tasks", search: { task: r.task_id } as never }) },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

// ---------------------------------------------------------------- shortcuts

interface Shortcut {
  to?: AppPath;
  tab?: DeskTab;
  label: string;
  hint: string;
  icon: Icon;
  tone: Tone;
  count?: number;
  attention?: boolean;
}

/** One tap to everything: the desk's own tabs and the pages this person may open. */
export function DeskShortcuts({ desk, onTab }: { desk: Desk; onTab: (tab: DeskTab) => void }) {
  const t = useT();
  const me = useQuery(meQuery);
  const perms = me.data?.permissions ?? [];
  const allowed = (to: AppPath) => {
    const item = navItemFor(to);
    return !!item && (!item.perm || [item.perm].flat().some((p) => perms.includes(p)));
  };
  const waiting = desk.waiting.approvals.length + desk.waiting.reviews.length + desk.waiting.documents.length;
  const open = desk.work.filter((w) => ["triage", "ready", "running", "blocked"].includes(w.status)).length;
  const page = (to: AppPath, tone: Tone, hint: string, extra: Partial<Shortcut> = {}): Shortcut | null => {
    const item = navItemFor(to);
    if (!item || !allowed(to)) return null;
    return { to, label: t(item.label), hint, icon: item.icon, tone, ...extra };
  };
  const all: (Shortcut | null)[] = [
    page("/tasks", "info", t("Every task as a board, from new to done"), { count: open }),
    page("/approvals", "warn", t("Decisions your AI waits on"), { count: waiting, attention: waiting > 0 }),
    { tab: "files", label: t("My files"), hint: t("Search, open or ask about any file"), icon: navItemFor("/files")!.icon, tone: "accent", count: desk.file_counts.total + desk.document_total },
    { tab: "procedures", label: t("Workflows & SOPs"), hint: t("How each job is done here"), icon: FlowArrowIcon, tone: "violet", count: desk.procedures.workflow_total + desk.procedures.sop_total },
    page("/my-worker", "ok", t("Your AI twin: chat, teach and follow it")),
    page("/chat", "neutral", t("Talk to any agent")),
    page("/mail", "info", t("Mail and what the AI did with it")),
    page("/files", "accent", t("The company's documents, in folders")),
    page("/crm", "pink", t("Customers, sales and anything you track")),
    page("/contacts", "orange", t("Customers and suppliers")),
    page("/money", "ok", t("Invoices, bills and receipts")),
    page("/computers", "neutral", t("Your own PC, from anywhere")),
  ];
  const items = all.filter((x): x is Shortcut => !!x);
  return (
    <section aria-label={t("Go to")} data-guide="desk.shortcuts" className="grid gap-2">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-muted"><CompassIcon size={15} /> {t("Go to")}</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {items.map((s) => {
          const body = (
            <>
              <span className="flex items-start justify-between gap-2">
                <IconTile icon={s.icon} tone={s.tone} size="sm" />
                {typeof s.count === "number" && s.count > 0 ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular", s.attention ? "bg-warn text-white" : "bg-surface-2 text-muted")}>{s.count}</span>
                ) : null}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-[14px] font-semibold">{s.label}</span>
                <span className="line-clamp-2 text-[12px] leading-snug text-muted">{s.hint}</span>
              </span>
            </>
          );
          const cls = "grid h-full min-h-[6.5rem] content-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/20 focus-visible:border-accent focus-visible:outline-none";
          return (
            <li key={s.to ?? s.tab}>
              {s.tab ? (
                <button type="button" className={cn(cls, "w-full")} onClick={() => onTab(s.tab!)}>{body}</button>
              ) : (
                <Link to={s.to!} className={cls}>{body}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- how do I…?

const EXAMPLES = [msg("submit a tender"), msg("claim a receipt"), msg("apply for leave"), msg("quote a customer"), msg("onboard a new staff")];

/** "How do I…?": the company's own SOPs and workflows for a job, matched as you type, and
 * the person's AI to walk them through it (or the app's help, for how to use the app). */
export function HowDoI({ desk, compact = false }: { desk: Desk; compact?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const help = useHelpAsk();
  const ask = useAskMyAi();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  const score = (text: string) => words.reduce((n, w) => n + (text.toLowerCase().includes(w) ? 1 : 0), 0);
  const sops = useMemo(
    () => (words.length ? desk.procedures.sops.map((s) => ({ s, n: score(s.title) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5).map((x) => x.s) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- score reads `words`, derived from needle
    [desk.procedures.sops, needle],
  );
  const flows = useMemo(
    () => (words.length ? desk.procedures.workflows.map((w) => ({ w, n: score(`${w.name} ${w.description}`) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 4).map((x) => x.w) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- score reads `words`, derived from needle
    [desk.procedures.workflows, needle],
  );
  const walk = () =>
    ask.mutate({
      text: t("How do I {job} at our company? Use our own SOPs, workflows, templates and documents. Give me the steps in order, the documents and forms I need, who approves, deadlines, and links to the files. Say clearly if our documents do not cover something.", { job: q.trim() }),
    });
  return (
    <Card data-guide="desk.howto" className="overflow-hidden">
      <div className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <IconTile icon={LifebuoyIcon} size="sm" tone="info" />
          <h2 className="text-[15px] font-semibold">{t("How do I…?")}</h2>
          {!compact ? <span className="text-[12.5px] text-muted">{t("Find how a job is done here, step by step.")}</span> : null}
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3 && desk.can_ask) walk(); }}>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("How do I…?")}</span>
            <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("e.g. submit a tender, claim a receipt, apply for leave")}
              className="h-12 w-full rounded-sm border border-border bg-surface pr-3 pl-10 text-[15px] placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          </label>
          {desk.can_ask ? (
            <Button type="submit" size="lg" disabled={q.trim().length < 3} loading={ask.isPending}>
              <SparkleIcon size={16} /> {t("Walk me through it")}
            </Button>
          ) : null}
        </form>
        {!needle ? (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => setQ(t(e))} className="min-h-9 rounded-full border border-border bg-surface px-3 text-[12.5px] hover:border-accent/40 hover:bg-accent-soft/40">
                {t(e)}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {sops.length || flows.length ? (
              <ul className="grid gap-1.5">
                {sops.map((s) => (
                  <li key={`s${s.id}`}>
                    <button type="button" onClick={() => void navigate({ href: s.url })} className="flex min-h-11 w-full items-center gap-2.5 rounded-sm border border-border bg-surface px-3 text-left hover:border-accent/40">
                      <FileTextIcon size={16} className="shrink-0 text-info" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{s.title}</span>
                      <span className="shrink-0 text-[11.5px] text-muted">SOP</span>
                    </button>
                  </li>
                ))}
                {flows.map((w) => (
                  <li key={`w${w.id}`}>
                    <Link to="/workflows" search={{ w: w.id } as never} className="flex min-h-11 w-full items-center gap-2.5 rounded-sm border border-border bg-surface px-3 hover:border-accent/40">
                      <FlowArrowIcon size={16} className="shrink-0 text-[var(--series-7)]" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{w.name}</span>
                      <span className="shrink-0 text-[11.5px] text-muted">{t("Workflow")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted">{t("No SOP or workflow has that name. Your AI can still look through the company's documents for you.")}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              <button type="button" onClick={() => help.ask(t("How do I {job} in this app?", { job: q.trim() }))} className="inline-flex min-h-9 items-center gap-1 font-medium text-accent hover:underline">
                <BookOpenTextIcon size={14} /> {t("How to do it in this app")}
              </button>
              <Link to="/search" search={{ q: q.trim() } as never} className="inline-flex min-h-9 items-center gap-1 font-medium text-accent hover:underline">
                {t("Search every document")} <ArrowRightIcon size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
