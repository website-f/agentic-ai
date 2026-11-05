/** P73 Feedbacks: the developer's page. Everything people sent from the floating button (notes,
 * and screenshots of any page with their marks), newest first: filter by where it stands, kind
 * or words; open one to see it full size, who sent it from which page and screen, move it along
 * (new, planned, in progress, done, won't do) and answer (the sender sees the answer under My
 * feedback). Also the switch that shows the button to everyone, and the house rules everyone
 * reads under Rules & guide. */
import {
  ArrowSquareOutIcon,
  CameraIcon,
  ChatTeardropTextIcon,
  GavelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  CATEGORIES,
  categoryOf,
  deleteFeedback,
  feedbackConfigQuery,
  feedbackKeys,
  feedbackListQuery,
  saveFeedbackConfig,
  screenshotUrl,
  STATUSES,
  statusOf,
  updateFeedback,
  type FeedbackItem,
  type FeedbackStatus,
  type RuleDraft,
} from "@/lib/feedback";
import { onLiveEvent } from "@/lib/live";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { ALL_NAV } from "@/nav";

type Tab = "inbox" | "rules";

export function FeedbacksPage() {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("inbox");
  const cfg = useQuery(feedbackConfigQuery);

  // New and changed feedback shows up without reloading.
  useEffect(
    () =>
      onLiveEvent((ev) => {
        if (ev.type.startsWith("feedback.")) void qc.invalidateQueries({ queryKey: feedbackKeys.all });
      }),
    [qc],
  );

  const toggle = useMutation({
    mutationFn: (on: boolean) => saveFeedbackConfig({ enabled: on }),
    onSuccess: (d) => {
      qc.setQueryData(feedbackConfigQuery.queryKey, d);
      toast.success(d.enabled ? t("The feedback button is on for everyone.") : t("The feedback button is off."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Page wide>
      <PageHeader
        title={t("Feedbacks")}
        description={t("What people say about the system, sent from the feedback button on every page. Read it, move it along, answer.")}
      />
      <div>
        <div className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5">
          {cfg.isPending ? (
            <Skeleton className="h-10" />
          ) : (
            <SwitchField
              checked={!!cfg.data?.enabled}
              onCheckedChange={(on) => toggle.mutate(on)}
              disabled={toggle.isPending || cfg.isError}
              label={t("Feedback button for everyone")}
              hint={cfg.data?.enabled
                ? t("On: everyone signed in sees the button on the right of every page.")
                : t("Off: nobody sees the button. Switch it on while the system is new.")}
            />
          )}
        </div>
      </div>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        label={t("Feedbacks")}
        options={[
          { value: "inbox", label: t("Feedback") },
          { value: "rules", label: t("House rules"), count: cfg.data?.rules.length },
        ]}
      />
      {tab === "inbox" ? <Inbox /> : <RulesEditor />}
    </Page>
  );
}

// ------------------------------------------------------------------ inbox

function Inbox() {
  const t = useT();
  const search = useSearch({ from: "/app/feedbacks" });
  const navigate = useNavigate({ from: "/feedbacks" });
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const [category, setCategory] = useState<string>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const list = useQuery(feedbackListQuery({ status: status === "all" ? undefined : status, category: category === "all" ? undefined : category, q: q || undefined }));
  const items = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};
  const total = list.data?.total ?? 0;
  const open = items.find((i) => i.id === search.f) ?? null;
  const select = (id: string | undefined) => void navigate({ search: { f: id }, replace: true });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<FeedbackStatus | "all">
          value={status}
          onChange={setStatus}
          label={t("Where it stands")}
          size="sm"
          options={[
            { value: "all", label: t("All"), count: total },
            ...STATUSES.map((s) => ({ value: s.value, label: t(s.label), count: counts[s.value] ?? 0 })),
          ]}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <Select
            size="sm"
            value={category}
            onValueChange={setCategory}
            label={t("Kind")}
            options={[{ value: "all", label: t("Every kind") }, ...CATEGORIES.map((c) => ({ value: c.value, label: t(c.label) }))]}
          />
          <label className="relative flex min-w-[12rem] flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("Search notes, pages, people")}
              aria-label={t("Search notes, pages, people")}
              className="h-8 w-full rounded-sm border border-border bg-surface pr-2.5 pl-8 text-[13px] outline-none focus:border-accent pointer-coarse:h-10"
            />
          </label>
        </div>
      </div>

      {list.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : list.isError ? (
        <p className="text-[13px] text-danger">{errorMessage(list.error)}</p>
      ) : !items.length ? (
        <EmptyState
          icon={ChatTeardropTextIcon}
          title={total ? t("Nothing matches") : t("No feedback yet")}
          body={total ? t("Try another filter or other words.") : t("Once the button is on, what people send shows up here, newest first.")}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((f) => (
            <li key={f.id}>
              <Card f={f} onOpen={() => select(f.id)} />
            </li>
          ))}
        </ul>
      )}
      <Detail item={open} onClose={() => select(undefined)} />
    </>
  );
}

function roleLabel(t: (s: string) => string, role: string): string {
  const info = ROLE_INFO[role as Role];
  return info ? t(info.label) : role;
}

function Card({ f, onOpen }: { f: FeedbackItem; onOpen: () => void }) {
  const t = useT();
  const s = statusOf(f.status);
  const c = categoryOf(f.category);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid h-full w-full content-start overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface text-left transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
    >
      {f.has_screenshot ? (
        <div className="relative aspect-[16/9] overflow-hidden border-b border-border bg-surface-2">
          <img src={screenshotUrl(f.id)} alt="" loading="lazy" className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]" />
          {f.marks ? (
            <span className="absolute right-2 bottom-2 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[11px] font-medium text-white">
              {f.marks === 1 ? t("1 mark") : t("{n} marks", { n: f.marks })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={s.tone}>{t(s.label)}</Pill>
          <Pill tone={c.tone === "accent" ? "neutral" : c.tone}>{t(c.label)}</Pill>
          {!f.has_screenshot ? <ChatTeardropTextIcon size={14} className="text-muted" aria-label={t("Written feedback")} /> : null}
          <span className="ml-auto text-[11.5px] text-muted">{timeAgo(f.created_at)}</span>
        </div>
        <p className={cn("line-clamp-3 text-[13px] whitespace-pre-line", !f.note && "text-muted")}>{f.note || t("Screenshot with marks")}</p>
        <p className="truncate text-[11.5px] text-muted">
          {f.author_name || t("Someone who left")} · {roleLabel(t, f.author_role)}
          {f.page_title || f.page_path ? ` · ${f.page_title || f.page_path}` : ""}
        </p>
        {f.dev_note ? <p className="truncate text-[11.5px] text-accent">{t("Answered")}: {f.dev_note}</p> : null}
      </div>
    </button>
  );
}

function Detail({ item, onClose }: { item: FeedbackItem | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [answer, setAnswer] = useState(item?.dev_note ?? "");
  const [confirm, setConfirm] = useState(false);
  const saved = item?.dev_note ?? "";
  // Another piece opened (or its answer changed): the box shows its saved answer.
  const key = `${item?.id ?? ""}:${saved}`;
  const [shownFor, setShownFor] = useState(key);
  if (shownFor !== key) {
    setShownFor(key);
    setAnswer(saved);
  }
  const done = () => void qc.invalidateQueries({ queryKey: feedbackKeys.all });
  const patch = useMutation({
    mutationFn: (body: { status?: FeedbackStatus; dev_note?: string }) => updateFeedback(item!.id, body),
    onSuccess: (_, body) => {
      done();
      if (body.dev_note !== undefined) toast.success(t("Answer saved. The sender sees it under My feedback."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteFeedback(item!.id),
    onSuccess: () => {
      done();
      setConfirm(false);
      onClose();
      toast.success(t("Feedback deleted."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ctx = item?.context ?? {};
  const facts: [string, string][] = item
    ? [
        [t("Sent by"), `${item.author_name || t("Someone who left")}${item.author_email ? ` (${item.author_email})` : ""}`],
        [t("Role"), roleLabel(t, item.author_role)],
        [t("Page"), item.page_title ? `${item.page_title} (${item.page_path})` : item.page_path || t("The whole system")],
        [t("Sent"), new Date(item.created_at).toLocaleString()],
        ...(ctx.viewport ? [[t("Screen"), ctx.viewport] as [string, string]] : []),
        ...(ctx.language ? [[t("Language"), ctx.language === "ms" ? "Bahasa Melayu" : "English"] as [string, string]] : []),
        ...(ctx.theme ? [[t("Theme"), ctx.theme] as [string, string]] : []),
        ...(ctx.browser ? [[t("Browser"), ctx.browser] as [string, string]] : []),
      ]
    : [];
  const pageIsApp = !!item?.page_path && item.page_path.startsWith("/") && !item.page_path.startsWith("//");
  // P75: Prima (/prima/#staffpay) is its own app beside the office: a plain link, a full load.
  const pageIsPrima = pageIsApp && !!item && item.page_path.startsWith("/prima/");

  return (
    <>
      <SideSheet
        open={!!item}
        onOpenChange={(o) => !o && onClose()}
        title={item ? t(categoryOf(item.category).label) : ""}
        description={item ? `${item.author_name || t("Someone who left")} · ${timeAgo(item.created_at)}` : undefined}
        size="lg"
        actions={item ? (
          <>
            {pageIsPrima ? (
              <Button variant="outline" size="sm" asChild>
                <a href={item.page_path} target="_blank" rel="noreferrer">
                  <ArrowSquareOutIcon size={15} /> {t("Open that page")}
                </a>
              </Button>
            ) : pageIsApp ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={item.page_path as "/"} onClick={onClose}>
                  <ArrowSquareOutIcon size={15} /> {t("Open that page")}
                </Link>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              <TrashIcon size={15} /> {t("Delete")}
            </Button>
          </>
        ) : undefined}
      >
        {item ? (
          <div className="grid gap-5">
            {item.has_screenshot ? (
              <a href={screenshotUrl(item.id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2" title={t("Open full size")}>
                <img src={screenshotUrl(item.id)} alt={t("Screenshot of {page}", { page: item.page_title || item.page_path })} className="w-full" />
              </a>
            ) : null}
            <div className="grid gap-1.5">
              <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("Their note")}</p>
              <p className={cn("text-[14px] whitespace-pre-line", !item.note && "text-muted")}>{item.note || t("No note: see the marks on the screenshot.")}</p>
            </div>
            <div className="grid gap-2">
              <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("Where it stands")}</p>
              <Segmented<FeedbackStatus>
                value={item.status}
                onChange={(s) => patch.mutate({ status: s })}
                label={t("Where it stands")}
                size="sm"
                options={STATUSES.map((s) => ({ value: s.value, label: t(s.label) }))}
              />
            </div>
            <label className="grid gap-2">
              <span className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("Your answer")}</span>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={t("Optional: what you did or will do. The sender sees it.")}
                className="w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[13.5px] outline-none focus:border-accent"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={() => patch.mutate({ dev_note: answer })} disabled={answer.trim() === saved.trim()} loading={patch.isPending}>
                  {t("Save answer")}
                </Button>
              </div>
            </label>
            <dl className="grid gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-border px-4 py-3 text-[12.5px] sm:grid-cols-[8rem_1fr]">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </SideSheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Delete this feedback?")}
        body={t("It is gone for good, screenshot included. The sender no longer sees it.")}
        confirmLabel={t("Delete")}
        danger
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}

// ------------------------------------------------------------------ house rules

function RulesEditor() {
  const t = useT();
  const qc = useQueryClient();
  const cfg = useQuery(feedbackConfigQuery);
  const [rules, setRules] = useState<RuleDraft[] | null>(null);
  const saved = cfg.data?.rules;
  if (saved && rules === null) setRules(saved.map((r) => ({ ...r })));
  const pages = useMemo(
    () => [
      { value: "all", label: t("Every page") },
      ...ALL_NAV.filter((n) => n.to !== "/feedbacks").map((n) => ({ value: n.to, label: `${t(n.label)} (${n.to})` })),
    ],
    [t],
  );
  const dirty = JSON.stringify(rules ?? []) !== JSON.stringify(saved ?? []);
  const save = useMutation({
    mutationFn: () => saveFeedbackConfig({ rules: (rules ?? []).map((r) => ({ ...r, title: r.title.trim(), body: r.body.trim() })) }),
    onSuccess: (d) => {
      qc.setQueryData(feedbackConfigQuery.queryKey, d);
      setRules(d.rules.map((r) => ({ ...r })));
      toast.success(t("House rules saved. Everyone sees them under Rules & guide."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const edit = (i: number, patch: Partial<RuleDraft>) => setRules((all) => (all ?? []).map((r, k) => (k === i ? { ...r, ...patch } : r)));

  if (!rules) return <Skeleton className="h-40" />;
  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-[13px] text-muted">
        {t("Rules everyone reads from the feedback button, under Rules & guide: how the company wants the system used. Tie a rule to one page and it shows on that page; otherwise it shows everywhere. What each page is for and the system's own rules are added by themselves.")}
      </p>
      {!rules.length ? (
        <EmptyState icon={GavelIcon} title={t("No house rules yet")} body={t("For example: claims above RM 500 need the receipt photo, or only HR edits staff records.")} />
      ) : (
        <ul className="grid gap-3">
          {rules.map((r, i) => (
            <li key={r.id ?? `new-${i}`} className="grid gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={r.title}
                  onChange={(e) => edit(i, { title: e.target.value })}
                  maxLength={160}
                  placeholder={t("Rule, in a few words")}
                  aria-label={t("Rule, in a few words")}
                  className="h-9 min-w-[12rem] flex-1 rounded-sm border border-border bg-surface px-3 text-[13.5px] font-medium outline-none focus:border-accent"
                />
                <Select size="sm" value={r.page || "all"} onValueChange={(v) => edit(i, { page: v === "all" ? "" : v })} label={t("Shows on")} options={pages} />
                <Button variant="ghost" size="icon-sm" onClick={() => setRules((all) => (all ?? []).filter((_, k) => k !== i))} aria-label={t("Remove this rule")} title={t("Remove this rule")}>
                  <TrashIcon size={15} />
                </Button>
              </div>
              <textarea
                value={r.body}
                onChange={(e) => edit(i, { body: e.target.value })}
                rows={2}
                maxLength={2000}
                placeholder={t("What it means and why (optional)")}
                aria-label={t("What it means and why (optional)")}
                className="w-full resize-y rounded-sm border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setRules((all) => [...(all ?? []), { title: "", body: "", page: "" }])} disabled={rules.length >= 60}>
          <PlusIcon size={15} /> {t("Add a rule")}
        </Button>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button variant="ghost" onClick={() => setRules((saved ?? []).map((x) => ({ ...x })))}>
              {t("Undo changes")}
            </Button>
          ) : null}
          <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
            {t("Save house rules")}
          </Button>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <CameraIcon size={13} /> {t("Tip: open Rules & guide from the feedback button on any page to see what people read there.")}
      </p>
    </div>
  );
}
