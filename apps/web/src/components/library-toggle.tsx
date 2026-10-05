/** Knowledge library (P18) pieces shared by the Library page and the file sheet. */
import { BooksIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys } from "@/lib/documents";
import { libraryKeys, libraryQuery, setLibrary, type LibraryFile, type LibraryScopeIn, type LibraryStatus } from "@/lib/library";
import { branchesQuery, meQuery } from "@/lib/queries";
import type { Branch, Me } from "@/lib/types";

export const WHOLE = "ws";

/** Where a guideline may apply, limited to the person's own scope. */
export function scopeOptions(me: Me | undefined, branches: Branch[]): { value: string; label: string }[] {
  const sc = me?.scope;
  const dept = (b: Branch) => b.departments.map((d) => ({ value: `d:${d.id}`, label: `${d.name} · ${b.name}` }));
  if (!sc || sc.kind === "all") {
    return [
      { value: WHOLE, label: tr("Whole company (every agent)") },
      ...branches.map((b) => ({ value: `b:${b.id}`, label: b.name })),
      ...branches.flatMap(dept),
    ];
  }
  const mine = branches.find((b) => b.id === sc.branch_id);
  if (sc.kind === "branch") return mine ? [{ value: `b:${mine.id}`, label: mine.name }, ...dept(mine)] : [];
  if (sc.department_id) {
    const d = mine?.departments.find((x) => x.id === sc.department_id);
    return [{ value: `d:${sc.department_id}`, label: d && mine ? `${d.name} · ${mine.name}` : sc.department_name ?? tr("My department") }];
  }
  return mine ? [{ value: `b:${mine.id}`, label: mine.name }] : [];
}

export function scopeValue(branchId: string | null | undefined, departmentId: string | null | undefined): string {
  if (departmentId) return `d:${departmentId}`;
  return branchId ? `b:${branchId}` : WHOLE;
}

export function parseScope(value: string, branches: Branch[]): LibraryScopeIn {
  if (value.startsWith("d:")) {
    const id = value.slice(2);
    const b = branches.find((x) => x.departments.some((d) => d.id === id));
    return { branch_id: b?.id ?? null, department_id: id };
  }
  if (value.startsWith("b:")) return { branch_id: value.slice(2), department_id: null };
  return { branch_id: null, department_id: null };
}

export function ScopeSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const options = scopeOptions(me, branches);
  const current = options.some((o) => o.value === value) ? value : (options[0]?.value ?? WHOLE);
  return <Select value={current} onValueChange={onChange} options={options} label={t("Who it is for")} className={className} />;
}

export function LibraryStatusPill({ status, passages }: { status: LibraryStatus; passages: number }) {
  const t = useT();
  if (status === "reading") return <Pill tone="info" live>{t("Reading…")}</Pill>;
  if (status === "failed") return <Pill tone="danger">{t("Could not read")}</Pill>;
  if (status === "indexed") return <Pill tone="ok">{passages === 1 ? t("Indexed · 1 passage") : t("Indexed · {n} passages", { n: passages })}</Pill>;
  if (status === "empty") return <Pill tone="warn">{t("No text found")}</Pill>;
  return <Pill tone="neutral">{t("Not indexed yet")}</Pill>;
}

/** "Use as a guideline (library)" on a file: agents search it and cite its pages. */
export function LibraryToggle({ file, disabled }: { file: LibraryFile; disabled?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const on = !!file.library;
  const { data: lib } = useQuery({ ...libraryQuery, enabled: on });
  const source = lib?.sources.find((s) => s.kind === "file" && s.id === file.id);
  const options = scopeOptions(me, branches);
  const value = scopeValue(file.branch_id, file.department_id);

  const save = useMutation({
    mutationFn: (v: { library: boolean; scope?: string }) =>
      setLibrary(file.id, v.library, v.scope ? parseScope(v.scope, branches) : undefined),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: docKeys.files });
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      toast.success(v.library ? t("Agents can now search this file and cite it.") : t("Taken out of the library."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const turnOn = () => {
    // Keep the file where it is when the person may publish there; else their own scope.
    const keep = options.some((o) => o.value === value) ? value : options[0]?.value;
    save.mutate({ library: true, scope: keep });
  };

  return (
    <section data-guide="files.library" className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3">
      <div className="flex items-start gap-3">
        <BooksIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <SwitchField
            label={t("Use as a guideline (library)")}
            hint={t("Agents search it when the work needs it and cite the page they used.")}
            checked={on}
            disabled={disabled || save.isPending || !options.length}
            onCheckedChange={(v) => (v ? turnOn() : save.mutate({ library: false }))}
          />
        </div>
      </div>
      {on ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <ScopeSelect value={value} onChange={(v) => save.mutate({ library: true, scope: v })} className="w-full" />
          {source ? <span className="justify-self-start"><LibraryStatusPill status={source.status} passages={source.passages} /></span> : null}
        </div>
      ) : null}
    </section>
  );
}
