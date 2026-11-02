/** P61 file labels: the chips on every file (each label keeps one colour, from its text) and
 * the Labels editor for one file or many (add, take off, suggestions from labels already in
 * use). The "Made by AI" chip is provenance.MadeBy: round, with the agent's face; labels are
 * square-cornered tags with a dot, so the two never look alike. */
import { PlusIcon, TagIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys } from "@/lib/documents";
import { changeLabels, cleanLabel, LABEL_TONES, labelsQuery, labelTone, MAX_LABEL_LENGTH, MAX_LABELS, type ExplorerFile } from "@/lib/explorer";
import { cn } from "@/lib/utils";

export function LabelChip({ label, onRemove, className }: { label: string; onRemove?: () => void; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-[5px] px-1.5 text-[11.5px] leading-none font-medium ring-1 ring-inset", LABEL_TONES[labelTone(label)], className)}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={t("Take off {label}", { label })}
          className="-mr-1 grid size-4 shrink-0 place-items-center rounded-sm hover:bg-black/10 pointer-coarse:size-6">
          <XIcon size={10} weight="bold" />
        </button>
      ) : null}
    </span>
  );
}

/** A file's labels in a row; past `max`, a "+3" with the rest in its tooltip. */
export function LabelChips({ labels, max = 3, className }: { labels?: string[] | null; max?: number; className?: string }) {
  if (!labels?.length) return null;
  const shown = labels.slice(0, max);
  const rest = labels.slice(max);
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((l) => <LabelChip key={l} label={l} />)}
      {rest.length ? <span title={rest.join(", ")} className="text-[11.5px] font-medium text-muted tabular">+{rest.length}</span> : null}
    </span>
  );
}

export function LabelsDialog({ open, onOpenChange, files, branchId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: Pick<ExplorerFile, "id" | "labels" | "name">[];
  branchId: string | null;
}) {
  const t = useT();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="w-[min(94vw,30rem)]"
      title={files.length === 1 ? t("Labels") : t("Labels for {n} files", { n: files.length })}
      description={files.length === 1 ? files[0]?.name : t("Add a label to all of them, or take one off all of them.")}>
      {/* Unmounted while closed: each opening starts from the files' labels. */}
      <LabelsForm files={files} branchId={branchId} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function LabelsForm({ files, branchId, onDone }: { files: Pick<ExplorerFile, "id" | "labels">[]; branchId: string | null; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: known = [] } = useQuery(labelsQuery(branchId));
  const [text, setText] = useState("");
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Each label on these files, with how many carry it.
  const on = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const f of files) for (const l of f.labels ?? []) {
      const k = l.toLowerCase();
      m.set(k, { label: m.get(k)?.label ?? l, n: (m.get(k)?.n ?? 0) + 1 });
    }
    return m;
  }, [files]);
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const removed = lower(remove);
  const added = lower(add);
  const shown = [
    ...[...on.values()].filter((x) => !removed.has(x.label.toLowerCase())),
    ...add.filter((l) => !on.has(l.toLowerCase()) || removed.has(l.toLowerCase())).map((l) => ({ label: l, n: files.length })),
  ];
  const full = files.length === 1 && shown.length >= MAX_LABELS;

  const needle = cleanLabel(text).toLowerCase();
  const suggestions = known
    .filter((k) => !shown.some((s) => s.label.toLowerCase() === k.label.toLowerCase() && s.n === files.length))
    .filter((k) => !needle || k.label.toLowerCase().includes(needle))
    .slice(0, 12);

  const put = (raw: string) => {
    const l = cleanLabel(raw);
    if (!l) return;
    const k = l.toLowerCase();
    setRemove((r) => r.filter((x) => x.toLowerCase() !== k));
    if (!added.has(k) && on.get(k)?.n !== files.length) setAdd((a) => [...a, l]);
    setText("");
  };
  const takeOff = (label: string) => {
    const k = label.toLowerCase();
    setAdd((a) => a.filter((x) => x.toLowerCase() !== k));
    if (on.has(k)) setRemove((r) => [...r, label]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (!full) put(text);
    }
  };
  const save = async () => {
    const extra = cleanLabel(text);
    const finalAdd = extra && !full ? [...add, extra] : add;
    if (!finalAdd.length && !remove.length) return onDone();
    setBusy(true);
    try {
      await changeLabels(files, finalAdd, remove);
      void qc.invalidateQueries({ queryKey: docKeys.files });
      toast.success(tr("Labels saved."));
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5">
        {shown.length ? shown.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <LabelChip label={s.label} onRemove={() => takeOff(s.label)} className="h-7 px-2 text-[12.5px] pointer-coarse:h-9" />
            {files.length > 1 && s.n < files.length ? <span className="text-[11.5px] text-muted tabular">{t("{n} of {total}", { n: s.n, total: files.length })}</span> : null}
          </span>
        )) : <span className="text-[13px] text-muted">{t("No labels yet.")}</span>}
      </div>
      <div className="grid gap-1.5">
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} maxLength={MAX_LABEL_LENGTH} disabled={full}
            placeholder={full ? t("Up to {n} labels per file.", { n: MAX_LABELS }) : t("Type a label, e.g. Urgent or Q3 audit")} aria-label={t("New label")} autoFocus />
          <Button variant="outline" onClick={() => put(text)} disabled={!cleanLabel(text) || full} className="pointer-coarse:h-11"><PlusIcon size={15} /> {t("Add")}</Button>
        </div>
        {suggestions.length ? (
          <div className="grid gap-1.5 pt-1">
            <span className="text-[12px] text-muted">{t("Labels in use")}</span>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s.label} type="button" onClick={() => put(s.label)} disabled={full}
                  className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-dashed border-border px-2 text-[12.5px] text-muted transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-50 pointer-coarse:h-9">
                  <TagIcon size={12} /> {s.label} <span className="tabular text-muted/80">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        <Button loading={busy} onClick={() => void save()}>{t("Save labels")}</Button>
      </div>
    </div>
  );
}
