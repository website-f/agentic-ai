/** P50 building the CRM (owner): three ways in, from the quickest. 1) What the office already
 * has (contacts, deals, invoices... found automatically, with how many of each). 2) A starter
 * for the kind of business. 3) A blank list for anything else. Other systems are one tap away
 * in Connections. */
import { ArrowCounterClockwiseIcon, CheckCircleIcon, PlugsConnectedIcon, PlusIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { addBuiltin, addObject, applyTemplate, crmKeys, deleteObject, resetCrm, type CrmObject, type CrmOverview } from "@/lib/crm-hub";
import { cn } from "@/lib/utils";

import { crmIcon, PICKABLE } from "./icons";

const COLORS = ["#2f6db5", "#7c5cc4", "#0e7490", "#15803d", "#b45309", "#be185d", "#dc2626", "#475569"];

export function CrmSetup({ overview, onOpenObject }: { overview: CrmOverview; onOpenObject: (key: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [blank, setBlank] = useState(false);
  const have = new Set(overview.objects.filter((o) => !o.archived).map((o) => o.source ?? o.key));
  const refresh = () => void qc.invalidateQueries({ queryKey: crmKeys.all });

  const builtin = useMutation({
    mutationFn: addBuiltin,
    onSuccess: (o) => { refresh(); toast.success(t("{name} added to the CRM.", { name: o.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const template = useMutation({
    mutationFn: applyTemplate,
    onSuccess: (r) => { refresh(); toast.success(t("Your CRM is ready: {n} lists added.", { n: r.objects.length })); if (r.objects[0]) onOpenObject(r.objects[0]); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const found = overview.discover ?? [];
  const templates = overview.templates ?? [];
  const first = !overview.objects.length;

  return (
    <div className="grid gap-6">
      {first ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 p-4">
          <SparkleIcon size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
          <div className="grid gap-1 text-[13.5px]">
            <p className="font-semibold">{t("Let's build your CRM")}</p>
            <p className="text-muted">{t("Start with what your office already has, pick a starter for your kind of business, or make your own list. You can add, rename or remove anything later, and only you see it until you share it.")}</p>
          </div>
        </div>
      ) : null}

      <Section title={t("1. Already in your office")} description={t("Found automatically. Add any of them and they stay up to date by themselves.")}>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {found.map((d) => {
            const Ico = crmIcon(d.icon);
            const added = have.has(d.key);
            return (
              <li key={d.key} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-sm" style={{ background: `${d.color}1f`, color: d.color }}><Ico size={20} weight="duotone" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{d.name}</p>
                  <p className="line-clamp-2 text-[12px] text-muted">{t("{n} now", { n: d.count.toLocaleString() })} · {d.description}</p>
                </div>
                {added ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-ok"><CheckCircleIcon size={16} weight="fill" /> {t("Added")}</span>
                ) : (
                  <Button size="sm" variant="outline" loading={builtin.isPending && builtin.variables === d.key} onClick={() => builtin.mutate(d.key)}>{t("Add")}</Button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("2. A starter for your kind of business")} description={t("Adds ready-made lists with the usual fields, views and dashboard tiles. Change anything afterwards.")}>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tp) => {
            const Ico = crmIcon(tp.icon);
            return (
              <li key={tp.key}>
                <button type="button" disabled={template.isPending} onClick={() => template.mutate(tp.key)}
                  className="flex h-full w-full items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left transition-colors hover:border-accent/50 disabled:opacity-60">
                  <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent"><Ico size={20} weight="duotone" /></span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[14px] font-medium">{t(tp.name)}</span>
                    <span className="text-[12px] text-muted">{t(tp.description)}</span>
                    {template.isPending && template.variables === tp.key ? <span className="text-[12px] text-accent">{t("Setting up…")}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("3. Anything else")} description={t("Track whatever your business needs: equipment, vehicles, members, complaints, suppliers' prices...")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setBlank(true)}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border bg-surface p-4 text-left hover:border-accent/50">
            <PlusIcon size={22} className="shrink-0 text-accent" />
            <span className="grid gap-0.5"><span className="text-[14px] font-medium">{t("Make my own list")}</span><span className="text-[12px] text-muted">{t("Name it, then add the fields you want.")}</span></span>
          </button>
          <button type="button" onClick={() => void navigate({ to: "/crm", search: { tab: "connections" } as never })}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border bg-surface p-4 text-left hover:border-accent/50">
            <PlugsConnectedIcon size={22} className="shrink-0 text-accent" />
            <span className="grid gap-0.5"><span className="text-[14px] font-medium">{t("Bring in data from another system")}</span><span className="text-[12px] text-muted">{t("Shopify, Stripe, HubSpot, a Google Sheet, any web API or a CSV. The fields are worked out for you.")}</span></span>
          </button>
        </div>
      </Section>

      {!first ? <YourCrm objects={overview.objects.filter((o) => !o.archived)} /> : null}

      {blank ? <BlankListDialog onClose={(key) => { setBlank(false); if (key) onOpenObject(key); }} /> : null}
    </div>
  );
}

/** What is in the CRM now: remove a list added by mistake, or start over. */
function YourCrm({ objects }: { objects: CrmObject[] }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<CrmObject | null>(null);
  const [restart, setRestart] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: crmKeys.all });
  const remove = useMutation({
    mutationFn: (key: string) => deleteObject(key),
    onSuccess: () => { refresh(); toast.success(t("Removed from the CRM.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: resetCrm,
    onSuccess: () => { refresh(); toast.success(t("Your CRM is empty again. Build it the way you want.")); void navigate({ to: "/crm", search: { tab: "setup" } as never }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title={t("Your CRM now")} description={t("Added something by mistake? Remove it here and add another. Your office's own data is never deleted.")}>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {objects.map((o) => {
          const Ico = crmIcon(o.icon);
          return (
            <li key={o.key} className="flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-sm" style={{ background: `${o.color}1f`, color: o.color }}><Ico size={18} weight="duotone" /></span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-[14px] font-medium">{o.name}</span>
                <span className="truncate text-[12px] text-muted">
                  {o.kind === "builtin" ? t("From your office") : o.kind === "synced" ? t("From another system") : t("Your own list")}
                  {typeof o.count === "number" ? ` · ${t("{n} records", { n: o.count.toLocaleString() })}` : ""}
                </span>
              </span>
              <Button size="sm" variant="ghost" className="min-h-10 shrink-0 text-danger" loading={remove.isPending && remove.variables === o.key} onClick={() => setRemoving(o)}>
                <TrashIcon size={15} /> {t("Remove")}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-danger/25 bg-danger/5 px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted">{t("Want a clean slate? Start over removes every list, the dashboard, the connections and the sharing.")}</p>
        <Button size="sm" variant="outline" className="min-h-10 shrink-0" loading={reset.isPending} onClick={() => setRestart(true)}>
          <ArrowCounterClockwiseIcon size={15} /> {t("Start over")}
        </Button>
      </div>
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger confirmLabel={t("Remove")}
        title={removing ? t("Remove {name} from the CRM?", { name: removing.name }) : ""}
        body={removing?.kind === "builtin" ? t("The office's own data stays where it is; only the fields you added in the CRM are removed.") : t("Its records and fields are removed for everyone. Download a CSV first if you may need them.")}
        onConfirm={() => { if (removing) remove.mutate(removing.key); }} />
      <ConfirmDialog open={restart} onOpenChange={setRestart} danger confirmLabel={t("Start over")} title={t("Start the CRM over?")}
        body={t("Every list you made with its records, every tile, connection and share is removed. The office's own contacts, deals, invoices and tasks stay exactly as they are. This cannot be undone.")}
        onConfirm={() => reset.mutate()} />
    </Section>
  );
}

function BlankListDialog({ onClose }: { onClose: (key?: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [singular, setSingular] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("cube");
  const [color, setColor] = useState(COLORS[0]!);
  const save = useMutation({
    mutationFn: () => addObject({ name: name.trim(), singular: singular.trim() || undefined, description: description.trim(), icon, color }),
    onSuccess: (o) => { void qc.invalidateQueries({ queryKey: crmKeys.all }); toast.success(t("{name} is ready. Add its fields from the ... menu.", { name: o.name })); onClose(o.key); },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Make my own list")}
      description={t("It starts with a Name field and a table. Add more fields any time.")}
      footer={<><Button variant="outline" onClick={() => onClose()}>{t("Cancel")}</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{t("Create")}</Button></>}>
      <div className="grid gap-3">
        <Field label={t("What is it called?")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Vehicles, Members, Complaints")} autoFocus
          error={save.error ? errorMessage(save.error) : undefined} />
        <Field label={t("One of them is called")} hint={t("Used for buttons like \"New vehicle\".")} value={singular} onChange={(e) => setSingular(e.target.value)} placeholder={t("e.g. Vehicle")} />
        <TextareaField label={t("What is it for? (optional)")} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">{t("Icon and colour")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {PICKABLE.map((k) => {
              const Ico = crmIcon(k);
              return (
                <button key={k} type="button" onClick={() => setIcon(k)} aria-label={k} aria-pressed={icon === k}
                  className={cn("grid size-10 place-items-center rounded-sm border", icon === k ? "border-accent bg-accent-soft" : "border-border")}>
                  <Ico size={18} style={{ color }} />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={cn("size-8 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-fg")} style={{ background: c }} />
            ))}
          </div>
        </fieldset>
      </div>
    </ResponsiveDialog>
  );
}
