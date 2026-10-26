/** P50 one CRM field: how its value shows (FieldValue) and how a person fills it in
 * (FieldInput), for every field type. Built for thumbs as much as mice: big targets, native
 * date pickers, choices as chips. */
import { EnvelopeSimpleIcon, LinkSimpleIcon, PaperclipIcon, PhoneIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { FilePicker } from "@/components/file-drop";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { locale, useT } from "@/i18n";
import { CHOICE_TONE, crmPeopleQuery, relationOptions, valueText, type Choice, type CrmField } from "@/lib/crm-hub";
import { cn } from "@/lib/utils";

const NONE = "__none";

export function ChoiceChip({ c }: { c: Choice | { label: string; color?: string } }) {
  return (
    <span className={cn("inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[12px] font-medium", CHOICE_TONE[c.color ?? "gray"] ?? CHOICE_TONE.gray)}>
      {c.label}
    </span>
  );
}

/** A value as it shows in a list, a card or a record. */
export function FieldValue({ field, value, refs = {} }: { field: CrmField; value: unknown; refs?: Record<string, string> }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    return <span className="text-muted/60">—</span>;
  }
  const choices = new Map((field.options.choices ?? []).map((c) => [c.value, c]));
  switch (field.type) {
    case "select":
    case "multi_select":
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(value) ? value : [value]).map((v) => (
            <ChoiceChip key={String(v)} c={choices.get(String(v)) ?? { label: String(v), color: "gray" }} />
          ))}
        </span>
      );
    case "checkbox":
      return value ? <span className="text-ok">✓</span> : <span className="text-muted/60">—</span>;
    case "email":
      return <a href={`mailto:${String(value)}`} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline"><EnvelopeSimpleIcon size={13} className="shrink-0" />{String(value)}</a>;
    case "phone":
      return <a href={`tel:${String(value).replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline"><PhoneIcon size={13} className="shrink-0" />{String(value)}</a>;
    case "url":
      return <a href={String(value)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline"><LinkSimpleIcon size={13} className="shrink-0" />{String(value).replace(/^https?:\/\//, "")}</a>;
    case "rating": {
      const top = field.options.max ?? 5;
      return <span className="text-warn" aria-label={`${String(value)} / ${top}`}>{"★".repeat(Number(value))}<span className="text-muted/40">{"★".repeat(Math.max(0, top - Number(value)))}</span></span>;
    }
    case "relation":
    case "file":
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(value) ? value : [value]).map((v) => (
            <span key={String(v)} className="inline-flex max-w-full items-center gap-1 truncate rounded-sm border border-border bg-surface-2/60 px-1.5 py-0.5 text-[12px]">
              {field.type === "file" ? <PaperclipIcon size={11} /> : null}{refs[String(v)] ?? String(v)}
            </span>
          ))}
        </span>
      );
    case "long_text":
      return <span className="line-clamp-2 whitespace-pre-wrap">{String(value)}</span>;
    case "money": case "number": case "percent": case "auto":
      return <span className="tabular">{valueText(field, value, refs, locale())}</span>;
    default:
      return <span className="break-words">{valueText(field, value, refs, locale())}</span>;
  }
}

/** Filling a field in. `value` is what the record holds; `onChange` hands back the new one. */
export function FieldInput({ field, value, onChange, refs = {}, disabled }: {
  field: CrmField;
  value: unknown;
  onChange: (v: unknown) => void;
  refs?: Record<string, string>;
  disabled?: boolean;
}) {
  const t = useT();
  const id = `crm-${field.key}`;
  const str = value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "long_text":
      return (
        <textarea id={id} rows={4} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[14px] focus-visible:border-accent focus-visible:outline-none" />
      );
    case "number": case "money": case "percent":
      return (
        <div className="relative">
          {field.type === "money" ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-muted">{field.options.currency || "RM"}</span> : null}
          <Input id={id} inputMode="decimal" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}
            className={cn("tabular", field.type === "money" && "pl-11")} />
          {field.type === "percent" ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted">%</span> : null}
        </div>
      );
    case "date":
      return <Input id={id} type="date" value={str.slice(0, 10)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return <Input id={id} type="datetime-local" value={str ? toLocalInput(str) : ""} disabled={disabled}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")} />;
    case "checkbox":
      return (
        <button type="button" role="switch" aria-checked={!!value} aria-label={field.label} disabled={disabled} onClick={() => onChange(!value)}
          className={cn("relative h-7 w-12 rounded-full transition-colors disabled:opacity-60", value ? "bg-accent" : "bg-border")}>
          <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-[left]", value ? "left-6" : "left-1")} />
        </button>
      );
    case "select":
      return (
        <Select value={str || NONE} disabled={disabled} label={field.label} onValueChange={(v) => onChange(v === NONE ? "" : v)}
          options={[{ value: NONE, label: t("(none)") }, ...(field.options.choices ?? []).map((c) => ({ value: c.value, label: c.label }))]} />
      );
    case "multi_select": {
      const picked = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options.choices ?? []).map((c) => {
            const on = picked.has(c.value);
            return (
              <button key={c.value} type="button" disabled={disabled} aria-pressed={on}
                onClick={() => onChange(on ? [...picked].filter((x) => x !== c.value) : [...picked, c.value])}
                className={cn("min-h-9 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  on ? cn("border-transparent", CHOICE_TONE[c.color] ?? CHOICE_TONE.gray) : "border-border text-muted hover:text-fg")}>
                {c.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "rating": {
      const top = field.options.max ?? 5;
      const n = Number(value) || 0;
      return (
        <div className="flex gap-1" role="radiogroup" aria-label={field.label}>
          {Array.from({ length: top }, (_, i) => i + 1).map((k) => (
            <button key={k} type="button" disabled={disabled} role="radio" aria-checked={n === k} aria-label={String(k)}
              onClick={() => onChange(n === k ? 0 : k)} className="grid size-9 place-items-center rounded-sm hover:bg-surface-2">
              <StarIcon size={20} weight={k <= n ? "fill" : "regular"} className={k <= n ? "text-warn" : "text-muted"} />
            </button>
          ))}
        </div>
      );
    }
    case "person":
      return <PersonInput field={field} value={str} onChange={onChange} disabled={disabled} />;
    case "relation":
      return <RelationInput field={field} value={Array.isArray(value) ? value.map(String) : []} onChange={onChange} refs={refs} disabled={disabled} />;
    case "file":
      return <FilesInput value={Array.isArray(value) ? value.map(String) : []} onChange={onChange} refs={refs} disabled={disabled} />;
    case "auto":
      return <p className="text-[13.5px] text-muted tabular">{str || t("Given when saved")}</p>;
    default:
      return (
        <Input id={id} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "phone" ? "tel" : "text"}
          inputMode={field.type === "phone" ? "tel" : undefined} />
      );
  }
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PersonInput({ field, value, onChange, disabled }: { field: CrmField; value: string; onChange: (v: unknown) => void; disabled?: boolean }) {
  const t = useT();
  const people = useQuery(crmPeopleQuery);
  return (
    <Select value={value || NONE} disabled={disabled} label={field.label} onValueChange={(v) => onChange(v === NONE ? "" : v)}
      options={[{ value: NONE, label: t("(nobody)") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
  );
}

function RelationInput({ field, value, onChange, refs, disabled }: {
  field: CrmField; value: string[]; onChange: (v: unknown) => void; refs: Record<string, string>; disabled?: boolean;
}) {
  const t = useT();
  const target = field.options.object ?? "";
  const [q, setQ] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const found = useQuery({ queryKey: ["crm", "options", target, q], queryFn: () => relationOptions(target, q), enabled: !!target && !disabled, staleTime: 15_000 });
  const many = field.options.many !== false;
  const add = (id: string, title: string) => {
    setNames((n) => ({ ...n, [id]: title }));
    onChange(many ? [...new Set([...value, id])] : [id]);
    setQ("");
  };
  return (
    <div className="grid gap-2">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2/60 py-0.5 pr-1 pl-2 text-[13px]">
              {names[id] ?? refs[id] ?? id}
              {!disabled ? (
                <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={t("Remove {name}", { name: names[id] ?? refs[id] ?? id })}
                  className="grid size-6 place-items-center rounded-sm text-muted hover:text-danger"><XIcon size={12} /></button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {!disabled && (many || !value.length) ? (
        <div className="relative">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search to link…")} aria-label={t("Search to link")} />
          {q.trim() && found.data?.length ? (
            <ul className="absolute inset-x-0 top-11 z-30 max-h-56 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-[var(--shadow-pop)]">
              {found.data.filter((o) => !value.includes(o.id)).map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => add(o.id, o.title)} className="w-full truncate rounded-sm px-2.5 py-2 text-left text-[13.5px] hover:bg-surface-2">{o.title}</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FilesInput({ value, onChange, refs, disabled }: { value: string[]; onChange: (v: unknown) => void; refs: Record<string, string>; disabled?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2/60 py-0.5 pr-1 pl-2 text-[13px]">
            <PaperclipIcon size={12} /> {names[id] ?? refs[id] ?? id}
            {!disabled ? <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={t("Remove")} className="grid size-6 place-items-center rounded-sm text-muted hover:text-danger"><XIcon size={12} /></button> : null}
          </span>
        ))}
        {!disabled ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-8 items-center gap-1 rounded-sm border border-dashed border-border px-2.5 text-[13px] text-muted hover:text-accent">
            <PaperclipIcon size={13} /> {t("Attach from the Library")}
          </button>
        ) : null}
      </div>
      <FilePicker open={open} onOpenChange={setOpen} title={t("Attach a file")}
        onPick={(f) => { setNames((n) => ({ ...n, [f.id]: f.name })); onChange([...new Set([...value, f.id])]); setOpen(false); }} />
    </div>
  );
}
