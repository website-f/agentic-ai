/**
 * P99: what a member reaches. "Agentic + Prima" (the office and Prima: everyone by default) or
 * "Prima only" (they sign in on the same page and land in Prima; the office's pages are closed
 * to them). And their Prima modules: everything their Prima role allows, or a chosen list, in
 * Prima's own apps and groups. A choice only narrows: Prima's own role still decides inside.
 * Who may set it: owners, admins, management and HR (members.manage), never for themselves or
 * an owner, and never beyond what they have themselves (api/routers/members.py).
 */
import { ShieldCheckIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { MultiSelect, type PickOption } from "@/components/ui/search-select";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Access, Me, Member } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PrimaModule { id: string; title: string; blurb: string; always: boolean }
export interface PrimaApp { id: string; title: string; blurb: string; groups: { title: string; modules: PrimaModule[] }[] }
export interface PrimaCatalog {
  enabled: boolean;
  /** Modules everyone keeps (the home screen and their own things). */
  always: string[];
  /** The modules the reader may give (null: all of Prima). */
  mine: string[] | null;
  apps: PrimaApp[];
}

export interface AccessValue { access: Access; modules: string[] | null }

export const DEFAULT_ACCESS: AccessValue = { access: "agentic", modules: null };

/** Who may set what someone reaches (the server checks again). */
export const setsAccess = (me: Me) => me.permissions.includes("members.manage");

export const accessOf = (m: Member): AccessValue => ({ access: m.access ?? "agentic", modules: m.prima_modules ?? null });

export const primaCatalogQuery = {
  queryKey: ["members", "prima-modules"],
  queryFn: () => api<PrimaCatalog>("/api/members/prima-modules"),
  staleTime: 5 * 60_000,
};

const sameList = (a: string[] | null, b: string[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && [...a].sort().join() === [...b].sort().join());

/** The body to send: only what changed (nothing when nothing did). */
export function accessChanges(before: AccessValue, after: AccessValue): { access?: Access; prima_modules?: string[] | null } {
  return {
    ...(after.access !== before.access ? { access: after.access } : {}),
    ...(!sameList(after.modules, before.modules) ? { prima_modules: after.modules } : {}),
  };
}

/** The choosable modules as grouped options (Prima's apps), the ones everyone keeps left out;
 * a module the reader does not have (and the person does not have already) cannot be picked. */
export function moduleOptions(cat: PrimaCatalog, had: string[] | null): PickOption[] {
  const may = (id: string) => cat.mine === null || cat.mine.includes(id) || had === null || had.includes(id);
  return cat.apps.flatMap((a) =>
    a.groups.flatMap((g) =>
      g.modules
        .filter((m) => !m.always)
        .map((m) => ({
          value: m.id,
          label: m.title,
          hint: [g.title !== a.title ? g.title : "", m.blurb].filter(Boolean).join(" · "),
          group: a.title,
          keywords: [a.title, g.title],
          disabled: !may(m.id),
        })),
    ),
  );
}

const ACCESS_CHOICES: { value: Access; title: string; line: string }[] = [
  { value: "agentic", title: msg("Agentic + Prima"), line: msg("The office (desk, AI, tasks, chat) and Prima.") },
  { value: "prima_only", title: msg("Prima only"), line: msg("Signs in on the same page and goes straight to Prima. No office pages, AI or chat.") },
];

/** The Access section of the member editor. */
export function AccessFields({ value, onChange, member, ownerTarget }: {
  value: AccessValue;
  onChange: (v: AccessValue) => void;
  /** Editing someone already here: their Prima role is shown, and what they had counts as theirs. */
  member?: Member;
  /** An owner keeps everything: shown, not editable. */
  ownerTarget?: boolean;
}) {
  const t = useT();
  const cat = useQuery(primaCatalogQuery);
  const had = member ? (member.prima_modules ?? null) : null;
  const choose = value.modules !== null;
  // "All" only from someone who has all of Prima (or for someone who has it already).
  const allowedAll = cat.data ? cat.data.mine === null || (!!member && had === null) : true;
  const alwaysNames = cat.data
    ? cat.data.apps.flatMap((a) => a.groups.flatMap((g) => g.modules)).filter((m) => m.always).map((m) => m.title)
    : [];
  if (ownerTarget) {
    return (
      <fieldset className="grid gap-1.5 rounded-[var(--radius-md)] border border-border p-3">
        <legend className="px-1 text-[13px] font-medium">{t("Access")}</legend>
        <p className="text-[12.5px] text-muted">{t("Owners always have the office and all of Prima.")}</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3" data-testid="access-fields">
      <legend className="px-1 text-[13px] font-medium">{t("Access")}</legend>
      <div role="radiogroup" aria-label={t("What they can open")} className="grid gap-2 sm:grid-cols-2">
        {ACCESS_CHOICES.map((c) => {
          const on = value.access === c.value;
          return (
            <button key={c.value} type="button" role="radio" aria-checked={on}
              onClick={() => onChange({ ...value, access: c.value })}
              className={cn(
                "grid min-h-11 content-start gap-0.5 rounded-sm border p-2.5 text-left focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none",
                on ? "border-accent bg-accent-soft/50" : "border-border bg-surface hover:bg-surface-2",
              )}>
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                <span aria-hidden className={cn("grid size-4 place-items-center rounded-full border", on ? "border-accent" : "border-border")}>
                  {on ? <span className="size-2 rounded-full bg-accent" /> : null}
                </span>
                {t(c.title)}
              </span>
              <span className="text-[12.5px] text-muted">{t(c.line)}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Prima modules")}</span>
        <div role="radiogroup" aria-label={t("Prima modules")} className="flex flex-wrap gap-2">
          {[
            { on: !choose, label: t("All modules their Prima role allows"), pick: () => onChange({ ...value, modules: null }), disabled: !allowedAll },
            { on: choose, label: t("Choose modules"), pick: () => onChange({ ...value, modules: had ?? [] }), disabled: false },
          ].map((o) => (
            <button key={o.label} type="button" role="radio" aria-checked={o.on} disabled={o.disabled && !o.on} onClick={o.pick}
              className={cn(
                "min-h-9 rounded-sm border px-3 py-1.5 text-[13px] disabled:opacity-50",
                o.on ? "border-accent bg-accent-soft/50 font-medium" : "border-border bg-surface hover:bg-surface-2",
              )}>
              {o.label}
            </button>
          ))}
        </div>
        {choose ? (
          cat.isLoading ? <Skeleton className="h-10 rounded-sm" /> : cat.data ? (
            <>
              <MultiSelect value={value.modules ?? []} onValueChange={(v) => onChange({ ...value, modules: v })}
                options={moduleOptions(cat.data, had)} label={t("Prima modules")} placeholder={t("Pick the Prima modules")}
                searchPlaceholder={t("Search Prima modules")} maxChips={8} />
              <p className="text-[12.5px] text-muted">
                {t("Always included: {names}.", { names: alwaysNames.join(", ") })}{" "}
                {t("A module not picked is hidden in Prima, and Prima refuses it with a plain message.")}
              </p>
              {cat.data.mine !== null ? <p className="text-[12.5px] text-muted">{t("You can give only the Prima modules you have yourself.")}</p> : null}
            </>
          ) : <FormError message={cat.error ? errorMessage(cat.error) : null} />
        ) : (
          <p className="text-[12.5px] text-muted">{t("Everything their Prima role allows. Prima's own role checks always apply.")}</p>
        )}
        {cat.data && !cat.data.enabled ? <p className="text-[12.5px] text-muted">{t("Prima is not set up on this server yet; this applies once it is.")}</p> : null}
      </div>
      {member ? <PrimaRoleLine member={member} /> : null}
    </fieldset>
  );
}

interface PrimaRole { enabled: boolean; role: string | null; role_label: string | null; where: string; record: string | null }

/** The Prima role this person has and where it is set (their Prima staff record, their office role, or owner). */
function PrimaRoleLine({ member }: { member: Member }) {
  const t = useT();
  const q = useQuery({ queryKey: ["members", member.user_id, "prima"], queryFn: () => api<PrimaRole>(`/api/members/${member.user_id}/prima`), staleTime: 60_000 });
  if (q.isLoading) return <Skeleton className="h-9 rounded-sm" />;
  if (!q.data) return null;
  return (
    <div className="grid gap-0.5 rounded-sm bg-surface-2/70 px-3 py-2 text-[12.5px]" data-testid="prima-role">
      <span className="font-medium">{q.data.role_label ? t("Prima role: {role}", { role: q.data.role_label }) : t("Prima role")}</span>
      <span className="text-muted">{q.data.where}</span>
    </div>
  );
}

/** Small badges for the members list: "Prima only", "N Prima modules". */
export function AccessBadges({ member }: { member: Member }) {
  const t = useT();
  const n = member.prima_modules?.length;
  if (member.access !== "prima_only" && member.prima_modules == null) return null;
  return (
    <>
      {member.access === "prima_only" ? <Pill tone="info"><ShieldCheckIcon size={12} weight="fill" /> {t("Prima only")}</Pill> : null}
      {member.prima_modules != null ? (
        <Pill tone="neutral" title={t("Their chosen Prima modules (the home screen and their own things always come too)")}>
          <SquaresFourIcon size={12} /> {n === 1 ? t("1 Prima module") : t("{n} Prima modules", { n: n ?? 0 })}
        </Pill>
      ) : null}
    </>
  );
}

interface BulkOut { results: { user_id: string; ok: boolean; message: string | null }[]; done: number; skipped: number }

/** Access for everyone ticked at once (owners and the person themselves are skipped and say why). */
export function BulkAccessDialog({ userIds, open, onOpenChange, onDone }: {
  userIds: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState<AccessValue>(DEFAULT_ACCESS);
  const save = useMutation({
    mutationFn: () => api<BulkOut>("/api/members/bulk", "POST", { user_ids: userIds, action: "prima", access: value.access, prima_modules: value.modules }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      if (r.done) toast.success(r.done === 1 ? tr("1 person changed.") : tr("{n} people changed.", { n: r.done }));
      if (r.skipped) {
        const first = r.results.find((x) => !x.ok)?.message;
        const line = r.skipped === 1 ? tr("1 person skipped.") : tr("{n} people skipped.", { n: r.skipped });
        toast.warning(first ? `${line} ${first}` : line);
      }
      onDone?.();
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}
      title={userIds.length === 1 ? t("Access for 1 person") : t("Access for {n} people", { n: userIds.length })}
      description={t("Everyone ticked gets this access. Anyone the rules stop is skipped and keeps what they have.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-4">
        <AccessFields value={value} onChange={setValue} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}
