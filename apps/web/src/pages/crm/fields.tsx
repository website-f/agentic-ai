/** P50 the fields of one CRM list (owner): rename the list, pick what names each record, and
 * add, change, reorder, hide or remove its fields. A side sheet on desktop, a tall bottom sheet
 * on a phone. Fields from the office's own data can only be renamed or hidden; fields filled by
 * another system keep working, they are just refilled on each sync. */
import {
  ArrowDownIcon, ArrowLeftIcon, ArrowsLeftRightIcon, ArrowUpIcon, CalendarBlankIcon, CaretCircleDownIcon, CaretRightIcon, CheckSquareIcon,
  ClockIcon, CurrencyCircleDollarIcon, DotsThreeVerticalIcon, EnvelopeSimpleIcon, HashIcon, LinkIcon, ListNumbersIcon, PaperclipIcon,
  PencilSimpleIcon, PercentIcon, PhoneIcon, PlusIcon, StarIcon, TagIcon, TextAlignLeftIcon, TextTIcon, TrashIcon, UserIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import {
  addField, CHOICE_TONE, crmKeys, crmObjectQuery, crmOverviewQuery, deleteField, FIELD_TYPES, updateField, updateObject,
  type Choice, type CrmField, type CrmObject, type FieldType,
} from "@/lib/crm-hub";
import { cn } from "@/lib/utils";

import { ChoiceChip } from "./field-input";
import { crmIcon, PICKABLE } from "./icons";

const TYPE_ICON: Record<FieldType, Icon> = {
  text: TextTIcon, long_text: TextAlignLeftIcon, number: HashIcon, money: CurrencyCircleDollarIcon, percent: PercentIcon,
  date: CalendarBlankIcon, datetime: ClockIcon, checkbox: CheckSquareIcon, select: CaretCircleDownIcon, multi_select: TagIcon,
  email: EnvelopeSimpleIcon, phone: PhoneIcon, url: LinkIcon, rating: StarIcon, person: UserIcon, relation: ArrowsLeftRightIcon,
  file: PaperclipIcon, auto: ListNumbersIcon,
};

/** The same list as setup.tsx's new-list dialog. */
const COLORS = ["#2f6db5", "#7c5cc4", "#0e7490", "#15803d", "#b45309", "#be185d", "#dc2626", "#475569"];

/** Choice colours (fields.py CHOICE_COLORS), in order, with names a person reads. */
const CHOICE_COLORS: { key: string; label: string }[] = [
  { key: "gray", label: msg("Grey") }, { key: "green", label: msg("Green") }, { key: "blue", label: msg("Blue") },
  { key: "amber", label: msg("Amber") }, { key: "red", label: msg("Red") }, { key: "violet", label: msg("Violet") },
  { key: "pink", label: msg("Pink") }, { key: "teal", label: msg("Teal") }, { key: "orange", label: msg("Orange") },
];

const CURRENCIES = ["RM", "SGD", "USD", "EUR", "GBP", "AUD", "IDR", "THB", "CNY", "JPY", "INR"];
const MAX_CHOICE = 60;

const typeLabel = (type: FieldType) => FIELD_TYPES.find((x) => x.type === type)?.label ?? type;
const hasChoices = (type: FieldType) => type === "select" || type === "multi_select";

let seq = 0;
const uid = () => `c${++seq}`;

/** A choice while it is being edited: `value` is kept for choices already saved (records hold
 * the value), new ones get theirs from the label. */
interface DraftChoice { uid: string; value?: string; label: string; color: string }

const sorted = (fields: CrmField[]) => [...fields].sort((a, b) => a.position - b.position);

// ------------------------------------------------------------------------------- the sheet

export function FieldsSheet({ objectKey, open, onOpenChange }: { objectKey: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const detail = useQuery(crmObjectQuery(objectKey));
  const [editing, setEditing] = useState<CrmField | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CrmField | null>(null);

  const obj = detail.data?.object;
  const fields = useMemo(() => sorted(detail.data?.fields ?? []), [detail.data?.fields]);
  const owner = obj?.can_add_fields ?? false;
  const system = detail.data?.connector?.name ?? obj?.source ?? t("another system");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: crmKeys.object(objectKey) });
    void qc.invalidateQueries({ queryKey: crmKeys.rows(objectKey) });
  };

  const move = useMutation({
    mutationFn: async (order: CrmField[]) => {
      const changes = order.map((f, i) => ({ f, position: i + 1 })).filter(({ f, position }) => f.position !== position);
      await Promise.all(changes.map(({ f, position }) => updateField(f.id, { position })));
    },
    onMutate: (order) => {
      qc.setQueryData(crmObjectQuery(objectKey).queryKey, (d) => (d ? { ...d, fields: order.map((f, i) => ({ ...f, position: i + 1 })) } : d));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
  const moveBy = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= fields.length) return;
    const order = [...fields];
    [order[i], order[j]] = [order[j]!, order[i]!];
    move.mutate(order);
  };

  const remove = useMutation({
    mutationFn: (f: CrmField) => deleteField(f.id),
    onSuccess: (_r, f) => { toast.success(t("{name} removed.", { name: f.label })); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <SideSheet open={open} onOpenChange={onOpenChange} size="md"
      title={obj ? t("Fields of {name}", { name: obj.name }) : t("Fields")}
      description={owner ? t("What each record holds. Changes show for everyone you shared this list with.") : undefined}
      actions={owner ? <Button onClick={() => setAdding(true)}><PlusIcon size={16} /> {t("Add a field")}</Button> : undefined}>
      {detail.isLoading ? (
        <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : detail.error || !obj ? (
        <p role="alert" className="text-danger">{detail.error ? errorMessage(detail.error) : t("That is not in your CRM.")}</p>
      ) : (
        <div className="grid gap-5">
          {!owner ? (
            <p className="rounded-sm bg-surface-2/70 px-3 py-2 text-[12.5px] text-muted">{t("Only the owner can change how this list is set up.")}</p>
          ) : null}

          <AboutList key={`${obj.name}|${obj.icon}|${obj.color}|${obj.title_field}`} obj={obj} fields={fields} owner={owner} />

          <section className="grid gap-2">
            <h3 className="text-[13px] font-semibold">{t("{n} fields", { n: fields.length })}</h3>
            <ul className="grid gap-2">
              {fields.map((f, i) => {
                const Ico = TYPE_ICON[f.type] ?? TextTIcon;
                return (
                  <li key={f.id} className={cn("flex min-w-0 items-center rounded-[var(--radius-md)] border border-border bg-surface", f.hidden && "bg-surface-2/40")}>
                    <button type="button" disabled={!owner} onClick={() => setEditing(f)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors hover:bg-surface-2/60 disabled:hover:bg-transparent">
                      <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted"><Ico size={18} /></span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className={cn("truncate text-[14px] font-medium", f.hidden && "text-muted")}>{f.label}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-muted">
                          <span>{t(typeLabel(f.type))}</span>
                          {f.key === obj.title_field ? <Badge tone="accent">{t("Name of each record")}</Badge> : null}
                          {f.required ? <Badge>{t("Required")}</Badge> : null}
                          {f.hidden ? <Badge>{t("Hidden")}</Badge> : null}
                          {f.builtin ? <Badge>{t("From the office")}</Badge> : null}
                          {f.source_path ? <Badge>{t("From {system}", { system })}</Badge> : null}
                        </span>
                      </span>
                      {owner ? <CaretRightIcon size={16} className="shrink-0 text-muted" /> : null}
                    </button>
                    {owner ? (
                      <div className="flex shrink-0 items-center pr-1">
                        <IconButton label={t("Move {name} up", { name: f.label })} disabled={i === 0 || move.isPending} onClick={() => moveBy(i, -1)}><ArrowUpIcon size={16} /></IconButton>
                        <IconButton label={t("Move {name} down", { name: f.label })} disabled={i === fields.length - 1 || move.isPending} onClick={() => moveBy(i, 1)}><ArrowDownIcon size={16} /></IconButton>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {owner ? (
              <button type="button" onClick={() => setAdding(true)}
                className="flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border text-[13.5px] font-medium text-accent hover:border-accent/50">
                <PlusIcon size={16} /> {t("Add a field")}
              </button>
            ) : null}
          </section>
        </div>
      )}

      {obj && (adding || editing) ? (
        <FieldDialog key={editing?.id ?? "new"} obj={obj} field={editing} system={system}
          onClose={() => { setAdding(false); setEditing(null); }}
          onRemove={(f) => { setEditing(null); setRemoving(f); }} />
      ) : null}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger
        title={t("Remove {name}?", { name: removing?.label ?? "" })} confirmLabel={t("Remove")}
        body={t("The values in this field are removed too, from every record. This cannot be undone.")}
        onConfirm={async () => { if (removing) await remove.mutateAsync(removing).catch(() => undefined); }} />
    </SideSheet>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: "accent" }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium whitespace-nowrap", tone === "accent" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>
      {children}
    </span>
  );
}

function IconButton({ label, children, ...props }: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} {...props}
      className="grid size-11 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

// ------------------------------------------------------------------------------- about this list

function AboutList({ obj, fields, owner }: { obj: CrmObject; fields: CrmField[]; owner: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(obj.name);
  const [singular, setSingular] = useState(obj.singular === obj.name ? "" : obj.singular);
  const [description, setDescription] = useState(obj.description ?? "");
  const [icon, setIcon] = useState(obj.icon || "cube");
  const [color, setColor] = useState(obj.color || COLORS[0]!);
  const [titleField, setTitleField] = useState(obj.title_field);
  const colors = COLORS.includes(color) ? COLORS : [...COLORS, color];
  const icons = PICKABLE.includes(icon) ? PICKABLE : [icon, ...PICKABLE];
  const titleOptions = fields.filter((f) => !["file", "checkbox"].includes(f.type) || f.key === obj.title_field).map((f) => ({ value: f.key, label: f.label }));
  const titleLabel = fields.find((f) => f.key === obj.title_field)?.label ?? obj.title_field;

  const save = useMutation({
    mutationFn: () => {
      const body: Parameters<typeof updateObject>[1] = {};
      if (name.trim() !== obj.name) body.name = name.trim();
      if (singular.trim() !== (obj.singular === obj.name ? "" : obj.singular)) body.singular = singular.trim();
      if (description.trim() !== (obj.description ?? "")) body.description = description.trim();
      if (icon !== obj.icon) body.icon = icon;
      if (color !== obj.color) body.color = color;
      if (titleField !== obj.title_field) body.title_field = titleField;
      return updateObject(obj.key, body);
    },
    onSuccess: () => {
      toast.success(t("Saved."));
      setEditing(false);
      void qc.invalidateQueries({ queryKey: crmKeys.object(obj.key) });
      void qc.invalidateQueries({ queryKey: crmKeys.overview });
      void qc.invalidateQueries({ queryKey: crmKeys.rows(obj.key) });
    },
  });
  const problems = save.error instanceof ApiError ? save.error.fields : {};
  const other = Object.entries(problems).filter(([k]) => !["name", "singular", "description", "icon", "color", "title_field"].includes(k));
  const cancel = () => {
    setEditing(false);
    save.reset();
    setName(obj.name); setSingular(obj.singular === obj.name ? "" : obj.singular); setDescription(obj.description ?? "");
    setIcon(obj.icon || "cube"); setColor(obj.color || COLORS[0]!); setTitleField(obj.title_field);
  };

  if (!editing) {
    return (
      <section className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-sm" style={{ background: `${obj.color}1f`, color: obj.color }}>{createElement(crmIcon(obj.icon), { size: 20, weight: "duotone" })}</span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-[12px] font-medium text-muted">{t("About this list")}</p>
          <p className="truncate text-[14px] font-semibold">{obj.name}</p>
          {obj.description ? <p className="line-clamp-2 text-[12.5px] text-muted">{obj.description}</p> : null}
          <p className="text-[12.5px] text-muted">{t("Shown as the name: {field}", { field: titleLabel })}</p>
        </div>
        {owner ? (
          <Button variant="outline" className="max-sm:h-11" onClick={() => setEditing(true)}><PencilSimpleIcon size={15} /> {t("Change")}</Button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <h3 className="text-[13px] font-semibold">{t("About this list")}</h3>
      <FormError message={save.error && !Object.keys(problems).length ? errorMessage(save.error) : other.length ? other.map(([, v]) => v).join(" ") : null} />
      <Field label={t("What is it called?")} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={problems.name} />
      <Field label={t("One of them is called")} hint={t("Used for buttons like \"New vehicle\".")} value={singular} maxLength={80}
        onChange={(e) => setSingular(e.target.value)} placeholder={obj.name} error={problems.singular} />
      <TextareaField label={t("What is it for? (optional)")} rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} error={problems.description} />
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">{t("Icon and colour")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {icons.map((k) => {
            const I = crmIcon(k);
            return (
              <button key={k} type="button" onClick={() => setIcon(k)} aria-label={k} aria-pressed={icon === k}
                className={cn("grid size-11 place-items-center rounded-sm border", icon === k ? "border-accent bg-accent-soft" : "border-border")}>
                <I size={18} style={{ color }} />
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {colors.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
              className="grid size-11 place-items-center rounded-full">
              <span className={cn("size-8 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-fg")} style={{ background: c }} />
            </button>
          ))}
        </div>
        {problems.icon || problems.color ? <p className="text-[12.5px] text-danger">{problems.icon ?? problems.color}</p> : null}
      </fieldset>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Shown as the name")}</span>
        <Select value={titleField} onValueChange={setTitleField} options={titleOptions} label={t("Shown as the name")} className="w-full max-sm:h-11" />
        {problems.title_field ? <p className="text-[12.5px] text-danger">{problems.title_field}</p>
          : <p className="text-[12.5px] text-muted">{t("The field that names each record in lists, cards and links.")}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="outline" className="max-sm:h-11" onClick={cancel}>{t("Cancel")}</Button>
        <Button className="max-sm:h-11" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{t("Save")}</Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------- one field

function FieldDialog({ obj, field, system, onClose, onRemove }: {
  obj: CrmObject;
  /** null: a new field */
  field: CrmField | null;
  system: string;
  onClose: () => void;
  onRemove: (f: CrmField) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const overview = useQuery(crmOverviewQuery);
  const isNew = field === null;
  const builtin = !!field?.builtin;
  const isTitle = field?.key === obj.title_field;

  const [type, setType] = useState<FieldType | null>(field?.type ?? null);
  const [label, setLabel] = useState(field?.label ?? "");
  const [required, setRequired] = useState(field?.required ?? false);
  const [hidden, setHidden] = useState(field?.hidden ?? false);
  const [choices, setChoices] = useState<DraftChoice[]>(() => (field?.options.choices ?? []).map((c) => ({ ...c, uid: uid() })));
  const [currency, setCurrency] = useState(field?.options.currency || "RM");
  const [max, setMax] = useState(String(field?.options.max ?? 5));
  const [target, setTarget] = useState(field?.options.object ?? "");
  const [many, setMany] = useState(field?.options.many ?? true);

  const lists = (overview.data?.objects ?? []).filter((o) => !o.archived);
  const done = () => {
    void qc.invalidateQueries({ queryKey: crmKeys.object(obj.key) });
    void qc.invalidateQueries({ queryKey: crmKeys.rows(obj.key) });
  };

  const options = (ft: FieldType): CrmField["options"] | undefined => {
    if (hasChoices(ft)) return { choices: toChoices(choices) };
    if (ft === "money") return { currency };
    if (ft === "rating") return { max: Number(max) };
    if (ft === "relation") return { object: target, many };
    return undefined;
  };

  const save = useMutation({
    mutationFn: () => {
      const ft = type!;
      if (isNew) return addField(obj.key, { label: label.trim(), type: ft, options: options(ft), required });
      if (builtin) return updateField(field.id, { label: label.trim(), hidden });
      const opts = options(ft);
      return updateField(field.id, { label: label.trim(), required, hidden, ...(opts ? { options: opts } : {}) });
    },
    onSuccess: (f) => {
      toast.success(isNew ? t("{name} added.", { name: f.label }) : t("Saved."));
      done();
      onClose();
    },
  });

  const problems = save.error instanceof ApiError ? save.error.fields : {};
  const optionProblem = Object.entries(problems).filter(([k]) => k.startsWith("options")).map(([, v]) => v).join(" ")
    || (save.error instanceof ApiError && save.error.code === "crm_bad_relation" ? save.error.message : "");
  const otherProblems = Object.entries(problems).filter(([k]) => k !== "label" && !k.startsWith("options")).map(([, v]) => v).join(" ");
  const generalError = save.error && !Object.keys(problems).length && !optionProblem ? errorMessage(save.error) : otherProblems || null;

  const labels = choices.map((c) => c.label.trim().toLowerCase()).filter(Boolean);
  const duplicate = labels.length !== new Set(labels).size;
  const missing = type && !builtin && ((hasChoices(type) && !labels.length) || (type === "relation" && !target));
  const canSave = !!type && !!label.trim() && !duplicate && !missing;

  // ---- step 1 (new field): what kind of field
  if (isNew && type === null) {
    return (
      <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Add a field")}
        description={t("What kind of information is it? Pick the closest; the label is up to you.")}
        footer={<Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>}>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {FIELD_TYPES.map((ft) => {
            const Ico = TYPE_ICON[ft.type];
            return (
              <li key={ft.type}>
                <button type="button"
                  onClick={() => {
                    setType(ft.type);
                    if (ft.type === "relation" && !target) setTarget(lists.find((o) => o.key !== obj.key)?.key ?? lists[0]?.key ?? "");
                  }}
                  className="flex h-full min-h-14 w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-2.5 text-left transition-colors hover:border-accent/50">
                  <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent"><Ico size={18} /></span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[13.5px] font-medium">{t(ft.label)}</span>
                    <span className="text-[12px] text-muted">{t(ft.hint)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </ResponsiveDialog>
    );
  }

  const ft = type!;
  const TypeIco = TYPE_ICON[ft];
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}
      title={isNew ? t("Add a field") : t("Change {name}", { name: field.label })}
      footer={
        <>
          {isNew ? <Button variant="outline" onClick={() => { setType(null); save.reset(); }}><ArrowLeftIcon size={15} /> {t("Back")}</Button>
            : <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>}
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>{isNew ? t("Add") : t("Save")}</Button>
        </>
      }>
      <div className="grid gap-4">
        <FormError message={generalError} />
        <div className="flex items-center gap-2.5 rounded-sm bg-surface-2/70 px-3 py-2">
          <TypeIco size={18} className="shrink-0 text-muted" />
          <div className="grid min-w-0 text-[12.5px]">
            <span className="font-medium">{t(typeLabel(ft))}</span>
            <span className="text-muted">{t(FIELD_TYPES.find((x) => x.type === ft)?.hint ?? "")}</span>
          </div>
        </div>

        {builtin ? (
          <p className="text-[12.5px] text-muted">{t("This comes from the office's own data: you can rename it or hide it, nothing else.")}</p>
        ) : field?.source_path ? (
          <p className="text-[12.5px] text-muted">{t("Filled in from {system} on each sync.", { system })}</p>
        ) : null}

        <Field label={t("Label")} value={label} maxLength={80} autoFocus={isNew} onChange={(e) => setLabel(e.target.value)}
          placeholder={t("e.g. Plate number, Status, Due date")} error={problems.label}
          onKeyDown={(e) => { if (e.key === "Enter" && canSave && !hasChoices(ft)) save.mutate(); }} />

        {!builtin ? (
          <TypeOptions type={ft} isNew={isNew} objKey={obj.key} lists={lists} error={optionProblem || (duplicate ? t("Each choice needs its own name.") : "")}
            choices={choices} setChoices={setChoices} currency={currency} setCurrency={setCurrency} max={max} setMax={setMax}
            target={target} setTarget={setTarget} many={many} setMany={setMany} />
        ) : null}

        <div className="grid gap-3 border-t border-border pt-4">
          <SwitchField checked={required && !builtin && ft !== "auto"} onCheckedChange={setRequired} disabled={builtin || ft === "auto"}
            label={t("Required")}
            hint={builtin ? t("Set by the office's own data.") : ft === "auto" ? t("Given by itself, so always filled in.") : t("A record cannot be saved without it.")} />
          {!isNew ? (
            <SwitchField checked={hidden && !isTitle} onCheckedChange={setHidden} disabled={isTitle}
              label={t("Hide from tables and forms")}
              hint={isTitle ? t("This names each record, so it always shows.") : t("The values are kept. Turn it back on any time.")} />
          ) : null}
        </div>

        {!isNew ? (
          <div className="grid gap-1.5 border-t border-border pt-4">
            <Button variant="ghost" className="justify-self-start text-danger hover:text-danger max-sm:h-11" disabled={builtin || isTitle} onClick={() => onRemove(field)}>
              <TrashIcon size={15} /> {t("Remove this field")}
            </Button>
            {builtin ? <p className="text-[12.5px] text-muted">{t("This comes from the office's own data; hide it instead.")}</p>
              : isTitle ? <p className="text-[12.5px] text-muted">{t("This is the name of each record; pick another one in About this list first.")}</p>
              : null}
          </div>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

/** Saved choices keep their value; new ones take the label (made unique against the others). */
function toChoices(drafts: DraftChoice[]): Choice[] {
  const kept = drafts.filter((c) => c.label.trim());
  const taken = new Set(kept.filter((c) => c.value).map((c) => c.value!.toLowerCase()));
  return kept.map((c) => {
    const label = c.label.trim().slice(0, MAX_CHOICE);
    let value = c.value;
    if (!value) {
      value = label;
      for (let n = 2; taken.has(value.toLowerCase()); n++) value = `${label.slice(0, MAX_CHOICE - 4)} (${n})`;
      taken.add(value.toLowerCase());
    }
    return { value, label, color: c.color };
  });
}

function TypeOptions(p: {
  type: FieldType;
  isNew: boolean;
  objKey: string;
  lists: CrmObject[];
  error: string;
  choices: DraftChoice[];
  setChoices: (c: DraftChoice[]) => void;
  currency: string;
  setCurrency: (v: string) => void;
  max: string;
  setMax: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  many: boolean;
  setMany: (v: boolean) => void;
}) {
  const t = useT();
  const error = p.error ? <p className="text-[12.5px] text-danger">{p.error}</p> : null;

  if (hasChoices(p.type)) {
    return <div className="grid gap-1.5"><ChoicesEditor choices={p.choices} onChange={p.setChoices} />{error}</div>;
  }
  if (p.type === "money") {
    const opts = (CURRENCIES.includes(p.currency) ? CURRENCIES : [p.currency, ...CURRENCIES]).map((c) => ({ value: c, label: c }));
    return (
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Currency")}</span>
        <Select value={p.currency} onValueChange={p.setCurrency} options={opts} label={t("Currency")} className="w-full max-sm:h-11" />
        {error}
      </div>
    );
  }
  if (p.type === "rating") {
    const opts = Array.from({ length: 8 }, (_, i) => String(i + 3)).map((n) => ({ value: n, label: t("{n} stars", { n }) }));
    return (
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Highest rating")}</span>
        <Select value={p.max} onValueChange={p.setMax} options={opts} label={t("Highest rating")} className="w-full max-sm:h-11" />
        {error}
      </div>
    );
  }
  if (p.type === "relation") {
    const opts = p.lists.map((o) => ({ value: o.key, label: o.key === p.objKey ? t("{name} (this list)", { name: o.name }) : o.name }));
    if (p.target && !opts.some((o) => o.value === p.target)) opts.unshift({ value: p.target, label: p.target });
    return (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Links to")}</span>
          <Select value={p.target} onValueChange={p.setTarget} options={opts} label={t("Links to")} disabled={!p.isNew}
            placeholder={t("Pick a list")} className="w-full max-sm:h-11" />
          {error ?? (!p.isNew ? <p className="text-[12.5px] text-muted">{t("To link to a different list, add a new field.")}</p> : null)}
        </div>
        <SwitchField checked={p.many} onCheckedChange={p.setMany} label={t("Can link many")}
          hint={t("On: several, like many contacts for one company. Off: just one.")} />
      </div>
    );
  }
  if (p.type === "auto") return <p className="text-[12.5px] text-muted">{t("Each new record gets the next number by itself: 1, 2, 3…")}</p>;
  return error;
}

function ChoicesEditor({ choices, onChange }: { choices: DraftChoice[]; onChange: (c: DraftChoice[]) => void }) {
  const t = useT();
  const [adding, setAdding] = useState("");
  const set = (u: string, patch: Partial<DraftChoice>) => onChange(choices.map((c) => (c.uid === u ? { ...c, ...patch } : c)));
  const moveBy = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= choices.length) return;
    const next = [...choices];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    // "Red, Green, Blue" adds three (commas cannot be inside a choice: they separate several).
    const parts = adding.split(/[,\n]/).map((s) => s.trim().slice(0, MAX_CHOICE)).filter(Boolean);
    if (!parts.length) return;
    onChange([...choices, ...parts.map((label, k) => ({ uid: uid(), label, color: CHOICE_COLORS[(choices.length + k) % CHOICE_COLORS.length]!.key }))]);
    setAdding("");
  };
  const shown = choices.filter((c) => c.label.trim());

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-medium">{t("Choices")}</legend>
      {shown.length ? (
        <div className="flex flex-wrap gap-1.5 rounded-sm bg-surface-2/50 p-2" aria-label={t("Preview")}>
          {shown.map((c) => <ChoiceChip key={c.uid} c={{ label: c.label, color: c.color }} />)}
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">{t("Add at least one choice, like New, In progress, Done.")}</p>
      )}
      <ul className="grid gap-1.5">
        {choices.map((c, i) => (
          <li key={c.uid} className="flex min-w-0 items-center gap-1">
            <Menu>
              <MenuTrigger asChild>
                <button type="button" aria-label={t("Colour of {name}", { name: c.label || t("this choice") })}
                  className="grid size-11 shrink-0 place-items-center rounded-sm hover:bg-surface-2">
                  <span className={cn("size-5 rounded-full border-2 border-current", CHOICE_TONE[c.color] ?? CHOICE_TONE.gray)} />
                </button>
              </MenuTrigger>
              <MenuContent align="start">
                {CHOICE_COLORS.map((col) => (
                  <MenuItem key={col.key} onSelect={() => set(c.uid, { color: col.key })} className="min-h-11">
                    <ChoiceChip c={{ label: c.label.trim() || t(col.label), color: col.key }} />
                    <span className="text-[12.5px] text-muted">{t(col.label)}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Input value={c.label} maxLength={MAX_CHOICE} aria-label={t("Choice {n}", { n: i + 1 })} className="min-w-0 flex-1 max-sm:h-11"
              onChange={(e) => set(c.uid, { label: e.target.value.replace(/,/g, "") })} />
            <Menu>
              <MenuTrigger asChild>
                <button type="button" aria-label={t("More for {name}", { name: c.label || t("this choice") })}
                  className="grid size-11 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg">
                  <DotsThreeVerticalIcon size={18} />
                </button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<ArrowUpIcon />} disabled={i === 0} onSelect={() => moveBy(i, -1)} className="min-h-11">{t("Move up")}</MenuItem>
                <MenuItem icon={<ArrowDownIcon />} disabled={i === choices.length - 1} onSelect={() => moveBy(i, 1)} className="min-h-11">{t("Move down")}</MenuItem>
                <MenuItem icon={<TrashIcon />} danger onSelect={() => onChange(choices.filter((x) => x.uid !== c.uid))} className="min-h-11">{t("Remove")}</MenuItem>
              </MenuContent>
            </Menu>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 items-center gap-2">
        <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t("New choice")} aria-label={t("New choice")}
          className="min-w-0 flex-1 max-sm:h-11" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button variant="outline" className="max-sm:h-11" disabled={!adding.trim()} onClick={add}><PlusIcon size={15} /> {t("Add")}</Button>
      </div>
      {choices.some((c) => c.value) ? (
        <p className="text-[12.5px] text-muted">{t("Renaming a choice keeps it on the records that already have it.")}</p>
      ) : null}
    </fieldset>
  );
}
