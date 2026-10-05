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
import { ArrowsDownUpIcon, DotsSixVerticalIcon, PlusIcon, SnowflakeIcon, StackIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
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

import { aiKeys, groupsQuery, modelsQuery, providerColors, providersQuery, type AIModel, type Group, type GroupMember, type Provider } from "./data";

const memberKey = (m: GroupMember) => `${m.provider_id}::${m.model_id}`;

function MemberRow({
  member,
  index,
  provider,
  model,
  color,
  canManage,
  onRemove,
}: {
  member: GroupMember;
  index: number;
  provider?: Provider;
  model?: AIModel;
  color: string;
  canManage: boolean;
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
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[11px] text-muted tabular">{index + 1}</span>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px]" title={member.model_id}>{member.model_id}</span>
        <span className="block truncate text-[11.5px] text-muted">{provider?.name ?? t("Removed provider")}</span>
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
          className="z-50 w-[min(92vw,22rem)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-pop)] data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <Command label={t("Pick a model")} loop>
            <Command.Input autoFocus placeholder={t("Search models")} className="h-10 w-full border-b border-border bg-transparent px-3 text-[13.5px] outline-none placeholder:text-muted" />
            <Command.List className="max-h-72 overflow-y-auto p-1">
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
}: {
  group: Group;
  providers: Map<string, Provider>;
  models: AIModel[];
  colors: Map<string, string>;
  canManage: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const save = useMutation({
    mutationFn: (members: GroupMember[]) => api<Group>(`/api/ai/groups/${group.name}`, "PUT", { members }),
    onMutate: async (members) => {
      await qc.cancelQueries({ queryKey: aiKeys.groups });
      const prev = qc.getQueryData<Group[]>(aiKeys.groups);
      qc.setQueryData<Group[]>(aiKeys.groups, (old) => old?.map((g) => (g.name === group.name ? { ...g, members } : g)));
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

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    save.mutate(arrayMove(group.members, from, to));
  };

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]">
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
                onRemove={() => save.mutate(group.members.filter((x) => memberKey(x) !== memberKey(m)))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
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
  const providers = useMemo(() => new Map(providerList.map((p) => [p.id, p])), [providerList]);
  const colors = useMemo(() => providerColors(providerList), [providerList]);

  if (isLoading) return <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-[var(--radius-md)]" />)}</div>;

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        <IconTile icon={ArrowsDownUpIcon} size="sm" tone="info" />
        <p className="min-w-0 text-[13px] text-muted">
          {t("Agents ask for a group, never a provider. The first model answers; if it is down, rate limited or out of credit, the next one does.")}{" "}
          {canManage ? <span className="text-fg">{t("Drag the handle to change the order.")}</span> : null}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups?.map((g) => (
          <GroupCard key={g.name} group={g} providers={providers} models={models} colors={colors} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}
