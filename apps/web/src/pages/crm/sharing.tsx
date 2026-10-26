/** P50 sharing the CRM (owner): the CRM is the owner's alone until they share parts of it with
 * specific people: the dashboard (yes or no) and each list as "can see" or "can change", with
 * some fields hidden from that person. Saving replaces everything that person may see. */
import {
  CaretDownIcon, CheckIcon, ChartBarIcon, EyeSlashIcon, InfoIcon, PencilSimpleIcon, ShareNetworkIcon, UserPlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { crmAccessQuery, crmKeys, crmObjectQuery, crmPeopleQuery, setAccess, type CrmObject, type Grant } from "@/lib/crm-hub";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { crmIcon } from "./icons";

type Level = "none" | "view" | "edit";
type Draft = Record<string, { level: Exclude<Level, "none">; hidden: string[] }>;
interface Person { user_id: string; name: string; email: string }

const TAP = "pointer-coarse:h-11";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function CrmSharing({ objects }: { objects: CrmObject[] }) {
  const t = useT();
  const qc = useQueryClient();
  const access = useQuery(crmAccessQuery);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [stopping, setStopping] = useState<Grant | null>(null);

  const grants = useMemo(
    () => (access.data ?? []).filter((g) => g.dashboard || g.objects.length).sort((a, b) => a.name.localeCompare(b.name)),
    [access.data],
  );
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const grantOf = (userId: string) => access.data?.find((g) => g.user_id === userId);

  const summary = (g: Grant): string => {
    const parts: string[] = [];
    if (g.dashboard) parts.push(t("Dashboard"));
    for (const x of g.objects) {
      const o = byId.get(x.object_id);
      if (!o) continue;
      parts.push(x.level === "edit" ? t("{name} (can change)", { name: o.name }) : t("{name} (can see)", { name: o.name }));
    }
    return parts.join(", ") || t("Nothing yet");
  };

  const stop = async (g: Grant) => {
    try {
      await setAccess(g.user_id, { dashboard: false, objects: [] });
      await qc.invalidateQueries({ queryKey: crmKeys.access });
      toast.success(t("{name} no longer sees the CRM.", { name: g.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const shareButton = (
    <Button onClick={() => setPicking(true)} className={TAP}>
      <UserPlusIcon size={16} /> {t("Share with someone")}
    </Button>
  );

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 p-4">
        <ShareNetworkIcon size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
        <div className="grid gap-1 text-[13.5px]">
          <p className="font-semibold">{t("Only you see the CRM")}</p>
          <p className="text-muted">
            {t("Share parts of it with specific people: the dashboard, and each list to look at or to change. You can hide some fields from them. Once something is shared, they see the CRM in their menu.")}
          </p>
        </div>
      </div>

      <Section
        title={t("Who can see it")}
        description={grants.length ? t("Tap Edit to change what someone sees.") : undefined}
        actions={grants.length ? shareButton : undefined}
      >
        {access.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : access.isError ? (
          <p className="text-[13.5px] text-danger">{errorMessage(access.error)}</p>
        ) : !grants.length ? (
          <EmptyState
            icon={ShareNetworkIcon}
            title={t("Nobody else sees your CRM yet")}
            body={t("Share the dashboard or a list with someone in your office. They only see what you choose.")}
            action={shareButton}
          />
        ) : (
          <ul className="grid gap-2">
            {grants.map((g) => (
              <li key={g.user_id} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
                    {initials(g.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{g.name}</p>
                    {g.email ? <p className="truncate text-[12.5px] text-muted">{g.email}</p> : null}
                    <p className="mt-1 text-[12.5px] break-words text-fg/80">{summary(g)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" className={cn("flex-1 sm:flex-none", TAP)}
                    onClick={() => setEditing({ user_id: g.user_id, name: g.name, email: g.email })}>
                    <PencilSimpleIcon size={14} /> {t("Edit")}
                  </Button>
                  <Button size="sm" variant="ghost" className={cn("flex-1 text-danger hover:text-danger sm:flex-none", TAP)} onClick={() => setStopping(g)}>
                    {t("Stop sharing")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {picking ? (
        <PickPerson
          sharedIds={new Set(grants.map((g) => g.user_id))}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false);
            const g = grantOf(p.user_id);
            setEditing({ user_id: p.user_id, name: p.name, email: g?.email ?? p.email });
          }}
        />
      ) : null}

      {editing ? (
        <ShareEditor
          key={editing.user_id}
          person={editing}
          grant={grantOf(editing.user_id)}
          objects={objects}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!stopping}
        onOpenChange={(o) => !o && setStopping(null)}
        title={t("Stop sharing with {name}?", { name: stopping?.name ?? "" })}
        body={t("They will no longer see the CRM in their menu. Nothing in the CRM is deleted, and you can share again any time.")}
        confirmLabel={t("Stop sharing")}
        danger
        onConfirm={() => (stopping ? stop(stopping) : undefined)}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------- pick a person

function PickPerson({ sharedIds, onPick, onClose }: { sharedIds: Set<string>; onPick: (p: Person) => void; onClose: () => void }) {
  const t = useT();
  const people = useQuery(crmPeopleQuery);
  const me = useQuery(meQuery);
  const [q, setQ] = useState("");
  const myId = me.data?.user.id;
  const list = (people.data ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Share with someone")}
      description={t("Pick a person from your office. You choose what they see next.")}>
      <div className="grid gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={t("Search people")} className="basis-auto" />
        {people.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : people.isError ? (
          <p className="text-[13.5px] text-danger">{errorMessage(people.error)}</p>
        ) : !list.length ? (
          <p className="py-6 text-center text-[13.5px] text-muted">{q ? t("Nobody by that name.") : t("There is nobody else in your office yet.")}</p>
        ) : (
          <ul className="grid gap-1">
            {list.map((p) => {
              const self = p.id === myId || !!p.owner;
              const shared = sharedIds.has(p.id);
              return (
                <li key={p.id}>
                  <button type="button" disabled={self} onClick={() => onPick({ user_id: p.id, name: p.name, email: p.email ?? "" })}
                    className="flex min-h-11 w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-60 disabled:hover:bg-transparent">
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{initials(p.name)}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
                    {self ? (
                      <span className="shrink-0 text-[12px] text-muted">{p.id === myId ? t("You see everything") : t("An owner sees everything")}</span>
                    ) : shared ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok"><CheckIcon size={13} weight="bold" /> {t("Already shared")}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ResponsiveDialog>
  );
}

// ------------------------------------------------------------------------------- the editor

function toDraft(grant: Grant | undefined): Draft {
  const d: Draft = {};
  for (const x of grant?.objects ?? []) d[x.object_id] = { level: x.level, hidden: [...x.hidden_fields] };
  return d;
}

function ShareEditor({ person, grant, objects, onClose }: { person: Person; grant: Grant | undefined; objects: CrmObject[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [dashboard, setDashboard] = useState(grant?.dashboard ?? false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(grant));
  const shown = objects.filter((o) => !o.archived);

  const setLevel = (id: string, level: Level) =>
    setDraft((d) => {
      const next = { ...d };
      if (level === "none") delete next[id];
      else next[id] = { level, hidden: d[id]?.hidden ?? [] };
      return next;
    });
  const setHidden = (id: string, hidden: string[]) => setDraft((d) => (d[id] ? { ...d, [id]: { ...d[id], hidden } } : d));

  const save = useMutation({
    mutationFn: () =>
      setAccess(person.user_id, {
        dashboard,
        objects: Object.entries(draft).map(([object_id, v]) => ({ object_id, level: v.level, hidden_fields: v.hidden })),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: crmKeys.access });
      const any = dashboard || Object.keys(draft).length > 0;
      toast.success(any ? t("Saved. {name} sees the CRM in their menu now.", { name: person.name }) : t("{name} no longer sees the CRM.", { name: person.name }));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={t("What {name} can see", { name: person.name })}
      description={person.email || undefined}
      className="w-[min(92vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending} className={TAP}>{t("Cancel")}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()} className={TAP}>{t("Save")}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border p-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent"><ChartBarIcon size={20} weight="duotone" /></span>
          <div className="min-w-0 flex-1">
            <SwitchField
              checked={dashboard}
              onCheckedChange={setDashboard}
              label={t("Dashboard")}
              hint={t("The tiles and charts, only for the lists they can see.")}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">{t("Lists")}</h3>
          {!shown.length ? (
            <p className="text-[13px] text-muted">{t("There are no lists in your CRM yet.")}</p>
          ) : (
            <ul className="grid gap-2">
              {shown.map((o) => (
                <ObjectRow
                  key={o.id}
                  object={o}
                  value={draft[o.id]}
                  onLevel={(l) => setLevel(o.id, l)}
                  onHidden={(h) => setHidden(o.id, h)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function ObjectRow({
  object: o, value, onLevel, onHidden,
}: {
  object: CrmObject;
  value: Draft[string] | undefined;
  onLevel: (l: Level) => void;
  onHidden: (h: string[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const level: Level = value?.level ?? "none";
  const hidden = value?.hidden ?? [];
  const choices: { value: Level; label: string }[] = [
    { value: "none", label: t("Not shared") },
    { value: "view", label: t("Can see") },
    { value: "edit", label: t("Can change") },
  ];

  return (
    <li className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-sm" style={{ background: `${o.color}1f`, color: o.color }}>
            {createElement(crmIcon(o.icon), { size: 20, weight: "duotone" })}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium">{o.name}</p>
            {o.description ? <p className="line-clamp-1 text-[12px] text-muted">{o.description}</p> : null}
          </div>
        </div>
        <div role="radiogroup" aria-label={t("Sharing for {list}", { list: o.name })}
          className="grid shrink-0 grid-cols-3 gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface-2/60 p-0.5">
          {choices.map((c) => {
            const on = c.value === level;
            return (
              <button key={c.value} type="button" role="radio" aria-checked={on} onClick={() => onLevel(c.value)}
                className={cn(
                  "h-8 rounded-[calc(var(--radius-sm)-2px)] px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-10",
                  on
                    ? c.value === "none" ? "bg-surface text-fg ring-1 ring-border" : "bg-accent text-accent-fg"
                    : "text-muted hover:text-fg",
                )}>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {level !== "none" ? (
        <div className="grid gap-2 border-t border-border pt-2">
          {o.kind === "builtin" ? (
            <p className="flex items-start gap-1.5 text-[12px] text-muted">
              <InfoIcon size={14} className="mt-0.5 shrink-0" />
              {t("This is your office's own data, so it is only changed where it lives. \"Can change\" lets them edit the extra fields you added here.")}
            </p>
          ) : null}
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            className="flex min-h-10 items-center gap-2 rounded-sm text-left text-[13px] font-medium text-muted hover:text-fg pointer-coarse:min-h-11">
            <EyeSlashIcon size={16} className="shrink-0" />
            <span className="min-w-0 flex-1">
              {hidden.length ? t("{n} fields hidden from them", { n: hidden.length }) : t("Hide some fields")}
            </span>
            <CaretDownIcon size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
          </button>
          {open ? <HiddenFields object={o} hidden={hidden} onChange={onHidden} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function HiddenFields({ object: o, hidden, onChange }: { object: CrmObject; hidden: string[]; onChange: (h: string[]) => void }) {
  const t = useT();
  const detail = useQuery(crmObjectQuery(o.key));
  if (detail.isPending) {
    return (
      <div className="grid gap-1.5">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (detail.isError) return <p className="text-[13px] text-danger">{errorMessage(detail.error)}</p>;
  const fields = detail.data.fields.filter((f) => f.key !== o.title_field);
  if (!fields.length) return <p className="text-[12.5px] text-muted">{t("This list has no other fields to hide.")}</p>;
  const set = new Set(hidden);
  const toggle = (key: string) => onChange(set.has(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);

  return (
    <div className="grid gap-1">
      <p className="text-[12px] text-muted">{t("Ticked fields are hidden from them everywhere: in the list, on cards, in exports and on the dashboard.")}</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-3 sm:grid-cols-2">
        {fields.map((f) => (
          <li key={f.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-1 text-[13px] hover:bg-surface-2 pointer-coarse:min-h-11">
              <input type="checkbox" checked={set.has(f.key)} onChange={() => toggle(f.key)} className="size-4 shrink-0 accent-[var(--accent)]" />
              <span className="min-w-0 truncate">{f.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
