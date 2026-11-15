import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowsClockwiseIcon, ArrowsDownUpIcon, DotsSixVerticalIcon, PlusIcon, SnowflakeIcon, StackIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  aiKeys,
  answerTime,
  groupsQuery,
  groupStatsQuery,
  modelsQuery,
  providerColors,
  providersQuery,
  sharedFirst,
  withShared,
  type AIModel,
  type Group,
  type GroupMember,
  type MemberStats,
  type Provider,
} from "./data";

const memberKey = (m: Pick<GroupMember, "provider_id" | "model_id">) => `${m.provider_id}::${m.model_id}`;

/** P105: "1.2 s · 98% ok · 140 calls" over the last 24 hours. */
function StatsLine({ stats }: { stats?: MemberStats }) {
  const t = useT();
  if (!stats || !stats.calls) return <span className="text-muted/80">{t("No calls in the last 24 hours")}</span>;
  const rate = stats.success_rate === null ? null : Math.round(stats.success_rate * 100);
  return (
    <span
      className="tabular"
      title={t("Last 24 hours: {n} calls, {ok} answered, average answer time {time}", {
        n: stats.calls,
        ok: stats.ok,
        time: stats.avg_ms === null ? "-" : answerTime(stats.avg_ms),
      })}
    >
      {stats.avg_ms !== null ? <>{answerTime(stats.avg_ms)} · </> : null}
      <span className={cn(rate !== null && rate < 80 && "text-warn")}>{t("{rate}% ok", { rate: rate ?? 0 })}</span>
      {" · "}
      {stats.calls === 1 ? t("1 call") : t("{n} calls", { n: stats.calls })}
    </span>
  );
}

function MemberRow({
  member,
  index,
  provider,
  model,
  color,
  canManage,
  stats,
  onShare,
  onRemove,
}: {
  member: GroupMember;
  index: number;
  provider?: Provider;
  model?: AIModel;
  color: string;
  canManage: boolean;
  stats?: MemberStats;
  onShare: (on: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: memberKey(member), disabled: !canManage });
  const warning = !provider
    ? t("Provider removed")
    : !provider.enabled
      ? t("Provider is off")
      : model?.stale
        ? t("No longer offered")
        : null;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface px-1.5 py-1.5 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]",
        isDragging && "relative z-10 shadow-[var(--shadow-pop)]",
      )}
    >
      {canManage ? (
        <button
          {...attributes}
          {...listeners}
          aria-label={t("Reorder {model}", { model: member.model_id })}
          className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-muted hover:bg-surface-2 active:cursor-grabbing sm:size-8"
        >
          <DotsSixVerticalIcon size={16} weight="bold" />
        </button>
      ) : null}
      {member.shared ? (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent/15 text-accent" title={t("Shares the work")}>
          <ArrowsClockwiseIcon size={12} weight="bold" />
        </span>
      ) : (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[11px] text-muted tabular">{index + 1}</span>
      )}
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px]" title={member.model_id}>{member.model_id}</span>
        <span className="block truncate text-[11.5px] text-muted">{provider?.name ?? t("Removed provider")}</span>
        <span className="block truncate text-[11.5px] text-muted">
          <StatsLine stats={stats} />
        </span>
      </span>
      {warning ? (
        <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-warn" title={warning}>
          <WarningIcon size={13} weight="fill" /> <span className="hidden sm:inline">{warning}</span>
        </span>
      ) : provider && provider.cooling_seconds > 0 ? (
        <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-info" title={t("Resting after an error")}>
          <SnowflakeIcon size={13} />
        </span>
      ) : null}
      {canManage ? (
        <button
          type="button"
          role="switch"
          aria-checked={!!member.shared}
          aria-label={t("Share the work: {model}", { model: member.model_id })}
          title={member.shared ? t("Shares the work. Click to make it a backup again.") : t("Share the work with the other shared models")}
          onClick={() => onShare(!member.shared)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1 rounded-sm border px-2 text-[12px] transition-colors sm:h-8",
            member.shared ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted hover:border-accent hover:text-accent",
          )}
        >
          <ArrowsClockwiseIcon size={14} weight={member.shared ? "bold" : "regular"} />
          <span className="hidden @md:inline">{member.shared ? t("Sharing") : t("Share")}</span>
        </button>
      ) : null}
      {canManage ? (
        <button type="button" onClick={onRemove} aria-label={t("Remove {model}", { model: member.model_id })} className="grid size-9 shrink-0 place-items-center rounded-sm text-muted hover:bg-danger/10 hover:text-danger sm:size-8">
          <XIcon size={14} />
        </button>
      ) : null}
    </li>
  );
}

function ModelPicker({
  models,
  providers,
  exclude,
  onPick,
}: {
  models: AIModel[];
  providers: Map<string, Provider>;
  exclude: Set<string>;
  onPick: (m: GroupMember) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const byProvider = useMemo(() => {
    const out = new Map<string, AIModel[]>();
    for (const m of models) {
      if (m.stale || exclude.has(memberKey({ provider_id: m.provider_id, model_id: m.model_id }))) continue;
      const list = out.get(m.provider_id) ?? [];
      list.push(m);
      out.set(m.provider_id, list);
    }
    return out;
  }, [models, exclude]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="flex h-10 w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border bg-surface/60 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent">
          <PlusIcon size={14} /> {t("Add model")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          // Fits the room left on screen; the model list scrolls inside it.
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-pop)] data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <Command label={t("Pick a model")} loop className="flex min-h-0 flex-col">
            <Command.Input autoFocus placeholder={t("Search models")} className="h-10 w-full shrink-0 border-b border-border bg-transparent px-3 text-[13.5px] outline-none placeholder:text-muted" />
            <Command.List className="max-h-72 min-h-0 overflow-y-auto overscroll-contain p-1">
              <Command.Empty className="px-3 py-5 text-center text-[13px] text-muted">
                {models.length ? t("No model matches.") : t("No models listed yet. Test a provider first.")}
              </Command.Empty>
              {[...byProvider.entries()].map(([pid, list]) => (
                <Command.Group key={pid} heading={providers.get(pid)?.name ?? pid} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted">
                  {list.map((m) => (
                    <Command.Item
                      key={m.id}
                      value={`${providers.get(pid)?.name ?? ""} ${m.model_id}`}
                      onSelect={() => {
                        onPick({ provider_id: pid, model_id: m.model_id });
                        setOpen(false);
                      }}
                      className="cursor-default truncate rounded-sm px-2 py-2 font-mono text-[12.5px] data-[selected=true]:bg-surface-2"
                    >
                      {m.model_id}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function GroupCard({
  group,
  providers,
  models,
  colors,
  canManage,
  stats,
}: {
  group: Group;
  providers: Map<string, Provider>;
  models: AIModel[];
  colors: Map<string, string>;
  canManage: boolean;
  stats: Map<string, MemberStats>;
}) {
  const t = useT();
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const save = useMutation({
    // P105: the API keeps shared members on top; the screen does the same straight away.
    mutationFn: (members: GroupMember[]) => api<Group>(`/api/ai/groups/${group.name}`, "PUT", { members: sharedFirst(members) }),
    onMutate: async (members) => {
      await qc.cancelQueries({ queryKey: aiKeys.groups, exact: true });
      const prev = qc.getQueryData<Group[]>(aiKeys.groups);
      qc.setQueryData<Group[]>(aiKeys.groups, (old) => old?.map((g) => (g.name === group.name ? { ...g, members: sharedFirst(members) } : g)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(aiKeys.groups, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: aiKeys.groups }),
  });
  const modelLookup = useMemo(() => new Map(models.map((m) => [memberKey({ provider_id: m.provider_id, model_id: m.model_id }), m])), [models]);
  const ids = group.members.map(memberKey);
  const sharing = group.members.filter((m) => m.shared).length;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    save.mutate(arrayMove(group.members, from, to));
  };

  return (
    <section className="@container flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <IconTile icon={StackIcon} size="sm" tone={group.members.length ? "accent" : "neutral"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <h3 className="min-w-0 text-[14px] font-semibold break-words">{group.label}</h3>
            <span className="font-mono text-[11.5px] text-muted">{group.name}</span>
          </div>
          <p className="text-[12.5px] text-muted">{group.description}</p>
          <p className="mt-1 text-[12px] text-muted tabular">
            {group.members.length
              ? group.members.length === 1
                ? t("1 model in fallback order")
                : t("{n} models in fallback order", { n: group.members.length })
              : t("No models yet")}
          </p>
          {sharing >= 2 ? (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-accent">
              <ArrowsClockwiseIcon size={13} weight="bold" className="mt-0.5 shrink-0" />
              <span>{t("{n} models share the work and take turns. The others step in when they cannot answer.", { n: sharing })}</span>
            </p>
          ) : null}
        </div>
      </header>
      <div className="flex flex-1 flex-col bg-surface-2/30 p-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="grid min-w-0 gap-1.5">
            {group.members.map((m, i) => (
              <MemberRow
                key={memberKey(m)}
                member={m}
                index={i}
                provider={providers.get(m.provider_id)}
                model={modelLookup.get(memberKey(m))}
                color={colors.get(m.provider_id) ?? "var(--series-other)"}
                canManage={canManage}
                stats={stats.get(memberKey(m))}
                onShare={(on) => save.mutate(withShared(group.members, m, on))}
                onRemove={() => save.mutate(group.members.filter((x) => memberKey(x) !== memberKey(m)))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {canManage && group.members.length >= 2 && sharing < 2 ? (
        <p className="mt-2 text-[12px] text-muted">{t("Share the work between these: turn on Share for two or more models and they take turns answering.")}</p>
      ) : null}
      {!group.members.length ? (
        <p className="rounded-sm border border-dashed border-border bg-surface/60 px-3 py-4 text-center text-[12.5px] text-muted">
          {t("Empty. Agents asking for {group} will get an error until you add a model.", { group: group.label.toLowerCase() })}
        </p>
      ) : null}
      {canManage ? (
        <div className="mt-auto pt-2">
          <ModelPicker models={models} providers={providers} exclude={new Set(ids)} onPick={(m) => save.mutate([...group.members, m])} />
        </div>
      ) : null}
      </div>
    </section>
  );
}

export function GroupsTab({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { data: groups, isLoading } = useQuery(groupsQuery);
  const { data: providerList = [] } = useQuery(providersQuery);
  const { data: models = [] } = useQuery(modelsQuery());
  const { data: statList = [] } = useQuery(groupStatsQuery);
  const stats = useMemo(() => new Map(statList.map((s) => [memberKey(s), s])), [statList]);
  const providers = useMemo(() => new Map(providerList.map((p) => [p.id, p])), [providerList]);
  const colors = useMemo(() => providerColors(providerList), [providerList]);

  if (isLoading) return <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-[var(--radius-md)]" />)}</div>;

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        <IconTile icon={ArrowsDownUpIcon} size="sm" tone="info" />
        <p className="min-w-0 text-[13px] text-muted">
          {t("Agents ask for a group, never a provider. The first model answers; if it is down, rate limited or out of credit, the next one does.")}{" "}
          {canManage ? <span className="text-fg">{t("Drag the handle to change the order.")}</span> : null}{" "}
          {t("Models marked Share take turns at the top, so the work is spread and answers stay fast. Answer times and success are for the last 24 hours.")}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups?.map((g) => (
          <GroupCard key={g.name} group={g} providers={providers} models={models} colors={colors} canManage={canManage} stats={stats} />
        ))}
      </div>
    </div>
  );
}
