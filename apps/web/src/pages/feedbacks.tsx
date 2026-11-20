/** P73 Feedbacks: the developer's page. Everything people sent from the floating button (notes,
 * and screenshots of any page with their marks), newest first: filter by where it stands, kind
 * or words; open one to see it full size, who sent it from which page and screen, move it along
 * (new, planned, in progress, done, won't do) and answer (the sender sees the answer under My
 * feedback). Also the switch that shows the button to everyone, and the house rules everyone
 * reads under Rules & guide.
 * P109: owners and management (feedback.read) read every piece too and talk about it in
 * comments, @mentioning each other (the mentioned person is told in the app and by email);
 * moving a piece along, answering, deleting, the switch and the house rules stay the
 * developer's (feedback.manage). */
import {
  ArrowSquareOutIcon,
  AtIcon,
  CameraIcon,
  ChatTeardropTextIcon,
  GavelIcon,
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
import { DataTable, filterOf, TableFilter, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { MultiSelect } from "@/components/ui/search-select";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addComment,
  CATEGORIES,
  categoryOf,
  commentsQuery,
  feedbackReadersQuery,
  deleteFeedback,
  feedbackConfigQuery,
  feedbackKeys,
  saveFeedbackConfig,
  screenshotUrl,
  STATUSES,
  statusOf,
  updateFeedback,
  type FeedbackItem,
  type FeedbackList,
  type FeedbackStatus,
  type RuleDraft,
} from "@/lib/feedback";
import { onLiveEvent } from "@/lib/live";
import { meQuery } from "@/lib/queries";
import { everyRow } from "@/lib/table-export";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { ALL_NAV } from "@/nav";

type Tab = "inbox" | "rules";

/** P109: the developer manages feedback; owners and management read it and comment. */
function useIsDeveloper() {
  const { data: me } = useQuery(meQuery);
  return !!me?.permissions.includes("feedback.manage");
}

export function FeedbacksPage() {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("inbox");
  const dev = useIsDeveloper();
  const cfg = useQuery({ ...feedbackConfigQuery, enabled: dev });

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
        description={dev
          ? t("What people say about the system, sent from the feedback button on every page. Read it, move it along, answer.")
          : t("What people say about the system, sent from the feedback button on every page. Read it and talk about it in comments; mention someone with @ to bring them in.")}
      />
      {dev ? <>
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
      </> : null}
      {tab === "inbox" || !dev ? <Inbox /> : <RulesEditor />}
    </Page>
  );
}

// ------------------------------------------------------------------ inbox

function Inbox() {
  const t = useT();
  const dev = useIsDeveloper();
  const search = useSearch({ from: "/app/feedbacks" });
  const navigate = useNavigate({ from: "/feedbacks" });
  const qc = useQueryClient();
  // P107: a data table. The server finds words (note, page, person), filters where it stands
  // and the kind, sorts and sends one numbered page; the address keeps all of it.
  const control = useTableState({ size: 25 }, { filters: ["status", "category"] });
  const [statusParam, setStatus] = filterOf(control, "status");
  const status = (STATUSES.some((s) => s.value === statusParam) ? statusParam : "all") as FeedbackStatus | "all";
  const table = useServerTable<FeedbackItem, FeedbackList>([...feedbackKeys.all, "list"], "/api/feedback", control.state, {},
    { pick: (b) => b.items, refetchInterval: 60_000 });
  const counts = table.body?.counts ?? {};
  const total = table.body?.total ?? 0;
  // The open piece stays open when a change moves it off this page (or out of the filter).
  const found = table.rows.find((i) => i.id === search.f) ?? null;
  const [held, setHeld] = useState<FeedbackItem | null>(null);
  if (found && found !== held) setHeld(found);
  const open = found ?? (held && held.id === search.f ? held : null);
  const select = (id: string | undefined) => void navigate({ search: (prev) => ({ ...prev, f: id }), replace: true });

  const columns: Column<FeedbackItem>[] = [
    {
      id: "note", header: t("Feedback"), card: "title", exportValue: (f) => f.note,
      cell: (f) => (
        <span className="flex min-w-0 items-start gap-3">
          {f.has_screenshot ? (
            <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-sm border border-border bg-surface-2">
              <img src={screenshotUrl(f.id)} alt="" loading="lazy" className="size-full object-cover object-top" />
              {f.marks ? (
                <span className="absolute right-0.5 bottom-0.5 rounded-full bg-neutral-900/80 px-1.5 text-[10.5px] font-medium text-white tabular">
                  {f.marks === 1 ? t("1 mark") : t("{n} marks", { n: f.marks })}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="grid h-12 w-20 shrink-0 place-items-center rounded-sm border border-dashed border-border text-muted">
              <ChatTeardropTextIcon size={18} aria-label={t("Written feedback")} />
            </span>
          )}
          <span className="grid min-w-0 gap-0.5">
            <span className={cn("line-clamp-2 text-[13px] whitespace-pre-line", !f.note && "text-muted")}>{f.note || t("Screenshot with marks")}</span>
            {f.dev_note ? <span className="truncate text-[11.5px] text-accent">{t("Answered")}: {f.dev_note}</span> : null}
            {f.comments ? <span className="text-[11.5px] text-muted">{f.comments === 1 ? t("1 comment") : t("{n} comments", { n: f.comments })}</span> : null}
          </span>
        </span>
      ),
    },
    {
      id: "status", header: t("Where it stands"), sortable: true, exportValue: (f) => t(statusOf(f.status).label),
      cell: (f) => { const s = statusOf(f.status); return <Pill tone={s.tone}>{t(s.label)}</Pill>; },
    },
    {
      id: "kind", header: t("Kind"), sortable: true, exportValue: (f) => t(categoryOf(f.category).label),
      cell: (f) => { const c = categoryOf(f.category); return <Pill tone={c.tone === "accent" ? "neutral" : c.tone}>{t(c.label)}</Pill>; },
    },
    {
      id: "from", header: t("From"), sortable: true, hideBelow: "lg", exportValue: (f) => f.author_name,
      cell: (f) => (
        <span className="grid min-w-0">
          <span className="break-words">{f.author_name || t("Someone who left")}</span>
          <span className="text-[12px] text-muted">{roleLabel(t, f.author_role)}</span>
        </span>
      ),
    },
    { id: "page", header: t("Page"), hideBelow: "xl", exportValue: (f) => f.page_title || f.page_path, cell: (f) => <span className="break-words text-muted">{f.page_title || f.page_path || "-"}</span> },
    {
      id: "when", header: t("When"), sortable: true, kind: "date", className: "whitespace-nowrap", exportValue: (f) => f.created_at,
      cell: (f) => <time dateTime={f.created_at} className="text-[12.5px] text-muted">{timeAgo(f.created_at)}</time>,
    },
  ];

  return (
    <>
      <Segmented<FeedbackStatus | "all">
        value={status}
        onChange={(v) => setStatus(v === "all" ? "" : v)}
        label={t("Where it stands")}
        size="sm"
        options={[
          { value: "all", label: t("All"), count: total },
          ...STATUSES.map((s) => ({ value: s.value, label: t(s.label), count: counts[s.value] ?? 0 })),
        ]}
      />
      <DataTable
        label={t("Feedback")}
        mode="server"
        columns={columns}
        rows={table.rows}
        total={table.total}
        rowId={(f) => f.id}
        rowLabel={(f) => f.note || f.author_name}
        control={control}
        loading={table.loading}
        fetching={table.fetching}
        error={table.error}
        onRetry={table.refetch}
        searchPlaceholder={t("Search notes, pages, people")}
        filters={
          <TableFilter control={control} id="category" label={t("Kind")} allLabel={t("Every kind")}
            options={CATEGORIES.map((c) => ({ value: c.value, label: t(c.label) }))} />
        }
        onOpen={(f) => select(f.id)}
        exportName={t("feedback")}
        exportRows={() => everyRow<FeedbackItem, FeedbackList>("/api/feedback", control.state, {}, (b) => b.items)}
        rowActions={dev ? {
          view: (f) => select(f.id),
          remove: async (f) => {
            await deleteFeedback(f.id);
            if (f.id === search.f) select(undefined);
            void qc.invalidateQueries({ queryKey: feedbackKeys.all });
          },
          removeBody: () => t("It is gone for good, screenshot included. The sender no longer sees it."),
        } : { view: (f) => select(f.id) }}
        rowClassName={(f) => (f.id === search.f ? "bg-accent-soft/40" : undefined)}
        empty={<EmptyState icon={ChatTeardropTextIcon} title={t("No feedback yet")} body={t("Once the button is on, what people send shows up here, newest first.")} />}
      />
      <Detail item={open} onClose={() => select(undefined)} />
    </>
  );
}

function roleLabel(t: (s: string) => string, role: string): string {
  const info = ROLE_INFO[role as Role];
  return info ? t(info.label) : role;
}

function Detail({ item, onClose }: { item: FeedbackItem | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const dev = useIsDeveloper();
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
            {dev ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                <TrashIcon size={15} /> {t("Delete")}
              </Button>
            ) : null}
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
              {dev ? (
                <Segmented<FeedbackStatus>
                  value={item.status}
                  onChange={(s) => patch.mutate({ status: s })}
                  label={t("Where it stands")}
                  size="sm"
                  options={STATUSES.map((s) => ({ value: s.value, label: t(s.label) }))}
                />
              ) : <span><Pill tone={statusOf(item.status).tone}>{t(statusOf(item.status).label)}</Pill></span>}
            </div>
            {!dev ? (
              item.dev_note ? (
                <div className="grid gap-1.5">
                  <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("The developer's answer")}</p>
                  <p className="text-[13.5px] whitespace-pre-line">{item.dev_note}</p>
                </div>
              ) : null
            ) : <label className="grid gap-2">
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
            </label>}
            <Comments feedbackId={item.id} />
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

// ------------------------------------------------------------------ P109 comments


/** Comments on one piece, oldest first, and a box to add one, @mentioning other readers. */
function Comments({ feedbackId }: { feedbackId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const list = useQuery(commentsQuery(feedbackId));
  const readers = useQuery(feedbackReadersQuery);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const others = (readers.data ?? []).filter((r) => r.user_id !== me?.user.id);
  const send = useMutation({
    mutationFn: () => addComment(feedbackId, body.trim(), mentions),
    onSuccess: (c) => {
      setBody("");
      setMentions([]);
      void qc.invalidateQueries({ queryKey: ["feedback", "comments", feedbackId] });
      void qc.invalidateQueries({ queryKey: feedbackKeys.all });
      toast.success(c.mentions.length ? t("Comment added. The people you mentioned are told.") : t("Comment added."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Picking someone also puts "@Name" in the text, where it reads naturally.
  const pick = (ids: string[]) => {
    const added = ids.filter((id) => !mentions.includes(id));
    const names = added.map((id) => others.find((r) => r.user_id === id)?.name).filter(Boolean);
    if (names.length) setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}${names.map((n) => `@${n}`).join(" ")} `);
    setMentions(ids);
  };
  return (
    <section className="grid gap-3" aria-label={t("Comments")}>
      <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("Comments")}</p>
      {list.isLoading ? <Skeleton className="h-16" /> : list.data?.length ? (
        <ul className="grid gap-2">
          {list.data.map((c) => (
            <li key={c.id} className={cn("grid gap-1 rounded-[var(--radius-md)] border border-border px-3 py-2.5", c.mine && "bg-accent-soft/30")}>
              <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12.5px]">
                <span className="font-medium">{c.author_name || t("Someone who left")}</span>
                <time dateTime={c.created_at} className="text-muted">{timeAgo(c.created_at)}</time>
              </p>
              <p className="text-[13.5px] break-words whitespace-pre-line">{c.body}</p>
              {c.mentions.length ? (
                <p className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
                  <AtIcon size={12} /> {c.mentions.map((m) => m.name).join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">{t("No comments yet. Start the conversation.")}</p>}
      <div className="grid gap-2 rounded-[var(--radius-md)] border border-border p-3">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} aria-label={t("Write a comment")}
          placeholder={t("Write a comment")}
          className="w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[13.5px] outline-none focus:border-accent" />
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-medium">{t("Mention")}</span>
          <MultiSelect selectAll={false} value={mentions} onValueChange={pick} label={t("Mention")} placeholder={t("Pick people to tell")}
            searchPlaceholder={t("Search people")}
            options={others.map((r) => ({ value: r.user_id, label: r.name, hint: roleLabel(t, r.role) }))} />
          <p className="text-[12px] text-muted">{t("They are told in the app and by email, with a link to this feedback.")}</p>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="pointer-coarse:h-11" disabled={!body.trim()} loading={send.isPending} onClick={() => send.mutate()}>{t("Comment")}</Button>
        </div>
      </div>
    </section>
  );
}
