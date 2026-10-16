/** Deals (P35): the sales pipeline as a board, lead → qualified → proposal → negotiation → won or
 * lost. Drag a deal along (press and hold on a phone; Space and the arrow keys on a keyboard);
 * each column shows how many deals it holds and what they are worth. */
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Over,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarIcon, HandshakeIcon, PlusIcon, UserIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  byStage,
  DEAL_STAGES,
  dealKeys,
  dealsQuery,
  dealSummaryQuery,
  isPast,
  partyKeys,
  placeDeal,
  STAGE_HINT,
  STAGE_LABEL,
  STAGE_TONE,
  summarize,
  updateDeal,
  type Deal,
  type DealStage,
  type ListResult,
} from "@/lib/crm";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CompanySelect, LoadError, useCompanyFilter, useFormat } from "@/pages/contacts/bits";

import { DealSheet, LostDialog, NewDealDialog, useOwners } from "./deal-forms";

const DOT: Record<(typeof STAGE_TONE)[DealStage], string> = {
  neutral: "bg-muted/60",
  info: "bg-info",
  accent: "bg-accent",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
};

type DragData = { type: "deal"; deal: Deal } | { type: "col"; stage: DealStage };
const dataOf = (x: Active | Over | null | undefined) => x?.data.current as DragData | undefined;
const stageOfOver = (d: DragData | undefined): DealStage | null => (d ? (d.type === "col" ? d.stage : d.deal.stage) : null);

/** Pointer: the column under it, then the nearest card in that column. Keyboard: nearest card or column. */
const collide: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const col = pointerWithin(args).find((h) => String(h.id).startsWith("col:"));
    if (!col) return [];
    const stage = String(col.id).slice(4);
    const cards = args.droppableContainers.filter((c) => {
      const d = c.data.current as DragData | undefined;
      return d?.type === "deal" && d.deal.stage === stage;
    });
    if (!cards.length) return [col];
    const near = closestCenter({ ...args, droppableContainers: cards });
    return near.length ? [near[0]!] : [col];
  }
  return closestCenter(args);
};

const CARD = "relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-left shadow-[0_1px_2px_hsl(var(--shadow)/0.05)]";

function CardBody({ deal, owner }: { deal: Deal; owner: string }) {
  const { money, day } = useFormat();
  const late = isPast(deal.next_step_due) && deal.stage !== "won" && deal.stage !== "lost";
  return (
    <>
      <p className="line-clamp-2 text-[13.5px] leading-snug font-medium break-words">{deal.title}</p>
      <p className="truncate text-[12.5px] text-muted">{deal.party_name}</p>
      <p className="text-[14px] font-semibold tabular">{money(deal.value, deal.currency)}</p>
      {deal.next_step ? (
        <p className={cn("flex min-w-0 items-start gap-1 text-[12px]", late ? "text-danger" : "text-fg/80")}>
          <CalendarIcon size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{deal.next_step}{deal.next_step_due ? ` · ${day(deal.next_step_due)}` : ""}</span>
        </p>
      ) : null}
      {owner ? (
        <p className="flex min-w-0 items-center gap-1 border-t border-border/70 pt-1.5 text-[11.5px] text-muted">
          <UserIcon size={12} className="shrink-0" /> <span className="truncate">{owner}</span>
        </p>
      ) : null}
    </>
  );
}

function DealCard({ deal, owner, draggable, onOpen }: { deal: Deal; owner: string; draggable: boolean; onOpen: () => void }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    disabled: !draggable,
    data: { type: "deal", deal } satisfies DragData,
  });
  return (
    <button ref={setNodeRef} type="button" onClick={onOpen}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...(draggable ? { ...listeners, ...attributes, "aria-roledescription": t("draggable deal") } : {})}
      className={cn(CARD,
        "transition-[border-color,box-shadow,opacity] hover:border-accent/40 hover:shadow-[var(--shadow-soft)] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none",
        draggable && "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        isDragging && "border-dashed border-accent/50 bg-accent-soft/30 opacity-45 shadow-none")}>
      <CardBody deal={deal} owner={owner} />
    </button>
  );
}

function Column({ stage, deals, count, value, hovered, dragging, ownerOf, canWrite, onOpen }: {
  stage: DealStage;
  deals: Deal[];
  count: number;
  value: number;
  hovered: boolean;
  dragging: boolean;
  ownerOf: (d: Deal) => string;
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const { short } = useFormat();
  const { setNodeRef } = useDroppable({ id: `col:${stage}`, data: { type: "col", stage } satisfies DragData });
  return (
    <section ref={setNodeRef} aria-label={t(STAGE_LABEL[stage])}
      className={cn("flex min-h-48 w-[80vw] max-w-[18rem] shrink-0 snap-start flex-col rounded-[var(--radius-md)] border border-border/60 bg-surface-2/50 transition-[border-color,background-color] sm:w-64 xl:w-auto xl:max-w-none xl:min-w-0",
        dragging && "border-dashed border-accent/40", hovered && "border-solid border-accent bg-accent-soft/40")}>
      <header className="grid grid-cols-[minmax(0,1fr)] gap-0.5 border-b border-border/60 px-3 pt-3 pb-2.5">
        <h2 className="flex min-w-0 items-center justify-between gap-2 text-[13px] font-semibold">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[STAGE_TONE[stage]])} />
            <span className="truncate">{t(STAGE_LABEL[stage])}</span>
          </span>
          <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-medium text-muted tabular ring-1 ring-border/70">{count}</span>
        </h2>
        <p className="flex min-w-0 items-baseline gap-1.5 pl-4 text-[11.5px] text-muted">
          <span className="shrink-0 font-medium text-fg/80 tabular" title={t("Total value")}>{short(value)}</span>
          <span aria-hidden className="text-muted/50">·</span>
          <span className="min-w-0 truncate" title={t(STAGE_HINT[stage])}>{t(STAGE_HINT[stage])}</span>
        </p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2 p-2">
        <SortableContext id={stage} items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((d) => <DealCard key={d.id} deal={d} owner={ownerOf(d)} draggable={canWrite} onOpen={() => onOpen(d.id)} />)}
        </SortableContext>
        {!deals.length ? (
          <p className={cn("grid min-h-20 place-items-center rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-5 text-center text-[12px] text-muted", dragging && "border-accent/60 text-accent")}>
            {dragging ? t("Drop here") : t("No deals here.")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface Pending {
  deal: Deal;
  stage: DealStage;
  index: number;
}

export function DealsPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/deals" });
  const search = useSearch({ from: "/app/deals" });
  const { data: me } = useSuspenseQuery(meQuery);
  const meId = me.user.id;
  const canWrite = me.permissions.includes("work.write");
  const company = useCompanyFilter();
  const owners = useOwners(meId);
  const [owner, setOwner] = useState("all");
  const [q, setQ] = useState("");
  const [creatingOn, setCreatingOn] = useState(false);
  const [active, setActive] = useState<Deal | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);
  const [losing, setLosing] = useState<Pending | null>(null);

  const params = useMemo(() => ({ branch_id: company.branchId, owner: owner === "all" ? undefined : owner }), [company.branchId, owner]);
  const listKey = dealsQuery(params).queryKey;
  const deals = useQuery(dealsQuery(params));
  const summary = useQuery(dealSummaryQuery(company.branchId));
  const all = useMemo(() => deals.data?.items ?? [], [deals.data]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? all.filter((d) => `${d.title} ${d.party_name} ${d.next_step}`.toLowerCase().includes(needle)) : all), [all, needle]);
  const cols = useMemo(() => byStage(shown), [shown]);
  // Counts and values: the server's summary when nothing narrows the board, else what is shown.
  const local = useMemo(() => summarize(shown), [shown]);
  const useServer = !needle && owner === "all" && !!summary.data;
  const totalOf = (s: DealStage) => (useServer ? (summary.data?.[s] ?? local[s]) : local[s]);

  // Links like /deals?new=1&party=… open the form; closing it drops both.
  const creating = creatingOn || (!!search.new && canWrite);
  const setCreating = (o: boolean) => {
    setCreatingOn(o);
    if (!o && (search.new || search.party)) void navigate({ search: (s) => ({ ...s, new: undefined, party: undefined }), replace: true });
  };

  // The deal a link opens may be outside the board's filters: look it up across every company.
  const onBoard = search.deal ? all.find((d) => d.id === search.deal) : undefined;
  const wide = useQuery({ ...dealsQuery({}), enabled: !!search.deal && !onBoard && !deals.isLoading });
  const open = onBoard ?? (search.deal ? wide.data?.items.find((d) => d.id === search.deal) : undefined);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  const move = useMutation({
    mutationFn: (m: { deal: Deal; stage: DealStage; position: number; lost_reason?: string }) =>
      updateDeal(m.deal.id, { stage: m.stage, position: m.position, ...(m.lost_reason ? { lost_reason: m.lost_reason } : {}) }),
    onMutate: async (m) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<ListResult<Deal>>(listKey);
      if (prev) {
        qc.setQueryData<ListResult<Deal>>(listKey, {
          ...prev,
          items: prev.items.map((d) => (d.id === m.deal.id ? { ...d, stage: m.stage, position: m.position, ...(m.lost_reason ? { lost_reason: m.lost_reason } : {}) } : d)),
        });
      }
      return { prev };
    },
    onError: (e, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (_d, m) => {
      if (m.lost_reason) setLosing(null);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: dealKeys.all });
      void qc.invalidateQueries({ queryKey: partyKeys.all });
    },
  });

  const commit = (p: Pending, lost_reason?: string) => {
    const placed = placeDeal(all, p.deal.id, p.stage, p.index);
    if (!placed) return;
    move.mutate({ deal: p.deal, stage: p.stage, position: placed.position, lost_reason });
  };

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const d = dataOf(a);
    if (d?.type === "deal") setActive(d.deal);
  };
  const onDragOver = ({ over }: { over: Over | null }) => setOverStage(stageOfOver(dataOf(over)));
  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    setOverStage(null);
    const from = dataOf(a);
    const d = dataOf(over);
    if (from?.type !== "deal" || !over || !d) return;
    const stage = stageOfOver(d)!;
    const column = cols[stage].filter((x) => x.id !== from.deal.id);
    let index = column.length;
    if (d.type === "deal") {
      if (d.deal.id === from.deal.id) return;
      const i = column.findIndex((x) => x.id === d.deal.id);
      const box = a.rect.current.translated;
      const below = !!box && box.top + box.height / 2 > over.rect.top + over.rect.height / 2;
      index = i < 0 ? column.length : i + (below ? 1 : 0);
    }
    const p: Pending = { deal: from.deal, stage, index };
    if (stage === "lost" && from.deal.stage !== "lost") {
      setLosing(p); // ask why before it moves
      return;
    }
    commit(p);
    if (stage !== from.deal.stage) toast.success(t("Moved to {stage}.", { stage: t(STAGE_LABEL[stage]) }), { duration: 1800 });
  };

  const labelOf = (id: string | number | undefined) => {
    const s = String(id ?? "");
    if (s.startsWith("col:")) return t("the {stage} column", { stage: t(STAGE_LABEL[s.slice(4) as DealStage]) });
    const hit = all.find((x) => x.id === s);
    return hit ? `"${hit.title}"` : t("the board");
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => t("Picked up {item}. Use the arrow keys to move it, Space to drop, Escape to cancel.", { item: labelOf(a.id) }),
    onDragOver: ({ over }) => (over ? t("Over {item}.", { item: labelOf(over.id) }) : t("Not over a column.")),
    onDragEnd: ({ over }) => (over ? t("Dropped on {item}.", { item: labelOf(over.id) }) : t("Dropped outside the board. Nothing moved.")),
    onDragCancel: () => t("Move cancelled. Nothing changed."),
  };

  const ownerOf = (d: Deal) => owners.nameOf(d.owner_user_id);
  const openDeal = (id: string) => {
    if (active) return;
    void navigate({ to: "/deals", search: (s) => ({ ...s, deal: id }) });
  };

  return (
    <Page wide>
      <PageHeader title={t("Deals")}
        description={t("Every opportunity from first contact to won or lost. Drag a deal to the next stage as it moves (press and hold on a phone).")}
        actions={canWrite ? <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New deal")}</Button> : null} />

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={t("Search deals, contacts or next steps")} />
        <CompanySelect value={company.value} onChange={company.set} />
        <Select value={owner} onValueChange={setOwner} label={t("Owner")} className="sm:w-48"
          options={[{ value: "all", label: t("Everyone's deals") }, ...owners.options.filter((o) => o.value !== "-").map((o) => ({ value: o.value, label: o.value === meId ? t("My deals") : o.label }))]} />
      </Toolbar>

      {deals.isLoading ? (
        <div className="flex gap-3 overflow-hidden" aria-hidden>
          {DEAL_STAGES.map((s) => <Skeleton key={s} className="h-64 w-[80vw] max-w-[18rem] shrink-0 rounded-[var(--radius-md)] sm:w-64 xl:flex-1" />)}
        </div>
      ) : deals.error ? (
        <LoadError error={deals.error} />
      ) : !all.length && owner === "all" ? (
        <EmptyState icon={HandshakeIcon} title={t("No deals yet")} body={t("Add a quote, a tender or any opportunity you are chasing. Agents can add deals from mail too.")}
          action={canWrite ? <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New deal")}</Button> : undefined} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={collide}
          autoScroll={{ threshold: { x: 0.14, y: 0.16 }, acceleration: 14 }}
          accessibility={{ announcements, screenReaderInstructions: { draggable: t("To move a deal, press Space. Use the arrow keys to choose a stage or a place in it, then press Space again to drop it, or Escape to cancel.") } }}
          onDragStart={onDragStart} onDragOver={onDragOver} onDragCancel={() => { setActive(null); setOverStage(null); }} onDragEnd={onDragEnd}>
          <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 xl:mx-0 xl:grid xl:grid-cols-6 xl:overflow-visible xl:px-0">
            {DEAL_STAGES.map((s) => (
              <Column key={s} stage={s} deals={cols[s]} count={totalOf(s).count} value={totalOf(s).value} hovered={overStage === s} dragging={!!active}
                ownerOf={ownerOf} canWrite={canWrite} onOpen={openDeal} />
            ))}
          </div>
          {createPortal(
            <DragOverlay zIndex={60}>{active ? <div className={cn(CARD, "cursor-grabbing border-accent/50 shadow-[var(--shadow-pop)] ring-1 ring-accent/25")}><CardBody deal={active} owner={ownerOf(active)} /></div> : null}</DragOverlay>,
            document.body,
          )}
        </DndContext>
      )}

      {creating ? <NewDealDialog open={creating} onOpenChange={setCreating} partyId={search.party} meId={meId} /> : null}
      {open ? <DealSheet key={open.id} deal={open} meId={meId} canWrite={canWrite} onClose={() => void navigate({ to: "/deals", search: (s) => ({ ...s, deal: undefined }) })} /> : null}
      {search.deal && !open && !deals.isLoading && !wide.isLoading && wide.isFetched ? (
        <p role="status" className="text-[13px] text-muted">{t("That deal was not found. It may have been removed, or belong to a company you cannot see.")}</p>
      ) : null}
      <LostDialog key={losing?.deal.id ?? "none"} deal={losing?.deal ?? null} busy={move.isPending} onCancel={() => setLosing(null)} onConfirm={(reason) => losing && commit(losing, reason)} />
    </Page>
  );
}
