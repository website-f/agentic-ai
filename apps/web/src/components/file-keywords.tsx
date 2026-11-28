/** P149c keywords: the chips input the upload dialog asks with ("Keywords for these files"),
 * the small chips on a file, and the Keywords editor for one file or many (add to all, take
 * off all). Keywords are lower case; suggestions come from the keywords already used in the
 * same company or unit. */
import { HashIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys } from "@/lib/documents";
import { changeKeywords, cleanKeywords, keywordsQuery, MAX_KEYWORD_LENGTH, MAX_KEYWORDS } from "@/lib/organize";
import { cn } from "@/lib/utils";

export function KeywordChip({ keyword, onRemove, on, className }: { keyword: string; onRemove?: () => void; on?: boolean; className?: string }) {
  const t = useT();
  return (
    <span className={cn(
      "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border px-2 text-[12px] leading-none font-medium",
      on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-2/60 text-fg",
      className,
    )}>
      <HashIcon size={11} weight="bold" className="shrink-0 text-muted" aria-hidden />
      <span className="truncate">{keyword}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={t("Take off {label}", { label: keyword })}
          className="-mr-1 grid size-4 shrink-0 place-items-center rounded-full hover:bg-black/10 pointer-coarse:size-6">
          <XIcon size={10} weight="bold" />
        </button>
      ) : null}
    </span>
  );
}

/** Chips typed or picked: Enter or a comma adds one; pasting "a, b, c" adds three. */
export function KeywordInput({ value, onChange, branchId, departmentId, disabled, autoFocus }: {
  value: string[];
  onChange: (next: string[]) => void;
  branchId: string | null;
  departmentId?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const t = useT();
  const { data: known = [] } = useQuery(keywordsQuery(branchId, departmentId));
  const [text, setText] = useState("");
  const full = value.length >= MAX_KEYWORDS;
  const put = (raw: string) => {
    const add = cleanKeywords(raw).filter((k) => !value.includes(k));
    if (add.length) onChange(cleanKeywords([...value, ...add]));
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && text.trim()) {
      e.preventDefault();
      put(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const needle = text.trim().toLowerCase();
  const suggestions = known.filter((k) => !value.includes(k.keyword) && (!needle || k.keyword.includes(needle))).slice(0, 10);
  return (
    <div className="grid gap-1.5">
      <div className={cn("flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1.5 focus-within:border-accent", disabled && "opacity-60")}>
        {value.map((k) => <KeywordChip key={k} keyword={k} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== k))} />)}
        <input value={text} disabled={disabled || full} autoFocus={autoFocus} maxLength={MAX_KEYWORD_LENGTH * 4}
          onChange={(e) => (e.target.value.includes(",") ? put(e.target.value) : setText(e.target.value))}
          onKeyDown={onKey} onBlur={() => text.trim() && put(text)}
          placeholder={value.length ? "" : t("e.g. payroll, nov 2026, staff A")} aria-label={t("Keywords for these files")}
          className="min-w-[8rem] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
      </div>
      {suggestions.length && !disabled ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted">{t("Used here")}</span>
          {suggestions.map((s) => (
            <button key={s.keyword} type="button" onClick={() => put(s.keyword)} disabled={full}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[12px] text-muted transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-50 pointer-coarse:h-9">
              <PlusIcon size={10} /> {s.keyword} <span className="tabular text-muted/80">{s.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A file's keywords in a row; past `max`, a "+3" with the rest in its tooltip. */
export function KeywordChips({ keywords, max = 3, className }: { keywords?: string[] | null; max?: number; className?: string }) {
  if (!keywords?.length) return null;
  const rest = keywords.slice(max);
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {keywords.slice(0, max).map((k) => <KeywordChip key={k} keyword={k} className="h-5 text-[11.5px]" />)}
      {rest.length ? <span title={rest.join(", ")} className="text-[11.5px] font-medium text-muted tabular">+{rest.length}</span> : null}
    </span>
  );
}

export function KeywordsDialog({ open, onOpenChange, files, branchId, departmentId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: { id: string; name: string; keywords?: string[] }[];
  branchId: string | null;
  departmentId?: string | null;
}) {
  const t = useT();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="w-[min(94vw,32rem)]"
      title={files.length === 1 ? t("Keywords") : t("Keywords for {n} files", { n: files.length })}
      description={files.length === 1 ? files[0]?.name : t("Add keywords to all of them, or take one off all of them.")}>
      <KeywordsForm files={files} branchId={branchId} departmentId={departmentId} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function KeywordsForm({ files, branchId, departmentId, onDone }: {
  files: { id: string; keywords?: string[] }[];
  branchId: string | null;
  departmentId?: string | null;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const on = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) for (const k of f.keywords ?? []) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [files]);
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!add.length && !remove.length) return onDone();
    setBusy(true);
    try {
      await changeKeywords(files.map((f) => f.id), add, remove);
      void qc.invalidateQueries({ queryKey: docKeys.files });
      toast.success(tr("Keywords saved."));
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const kept = [...on.entries()].filter(([k]) => !remove.includes(k));
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-[12px] font-semibold text-muted">{t("On these files")}</span>
        <div className="flex min-h-7 flex-wrap items-center gap-1.5">
          {kept.length ? kept.map(([k, n]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <KeywordChip keyword={k} onRemove={() => setRemove((r) => [...r, k])} />
              {files.length > 1 && n < files.length ? <span className="text-[11.5px] text-muted tabular">{t("{n} of {total}", { n, total: files.length })}</span> : null}
            </span>
          )) : <span className="text-[13px] text-muted">{t("No keywords yet.")}</span>}
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[12px] font-semibold text-muted">{t("Add")}</span>
        <KeywordInput value={add} onChange={setAdd} branchId={branchId} departmentId={departmentId} autoFocus />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        <Button loading={busy} onClick={() => void save()}><HashIcon size={14} /> {t("Save keywords")}</Button>
      </div>
    </div>
  );
}
