import { BookBookmarkIcon, BuildingsIcon, CheckCircleIcon, FileTextIcon, GlobeHemisphereEastIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile, Page, type Tone } from "@/components/page";
import { PinButton } from "@/components/pin-button";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { sopsQuery, workKeys, type SOP } from "@/lib/work";

import { LibraryHeader } from "./library-hub/hub";
import { sopScopeLabel } from "./library-hub/views";

type Scope = SOP["scope"];
const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "workspace", label: msg("Every company"), hint: msg("Every agent in every branch follows it.") },
  { value: "branch", label: msg("One company"), hint: msg("Every agent in that branch.") },
  { value: "department", label: msg("One department"), hint: msg("Every agent in that department.") },
  { value: "library", label: msg("Attached to agents"), hint: msg("Only agents you attach it to, like a skill pack.") },
];
const SCOPE_LOOK: Record<Scope, { icon: typeof FileTextIcon; tone: Tone }> = {
  workspace: { icon: GlobeHemisphereEastIcon, tone: "accent" },
  branch: { icon: BuildingsIcon, tone: "info" },
  department: { icon: UsersThreeIcon, tone: "violet" },
  library: { icon: BookBookmarkIcon, tone: "orange" },
};

const STARTER = `## Purpose
What this procedure is for, in one sentence.

## Steps
1. First step
2. Second step

## Rules
- Always ...
- Never ...

## Output
What the finished work must look like.`;

function Editor({ sop, open, onOpenChange, canManage }: { sop: SOP | null; open: boolean; onOpenChange: (o: boolean) => void; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const [title, setTitle] = useState(sop?.title ?? "");
  const [scope, setScope] = useState<Scope>(sop?.scope ?? "department");
  const [scopeId, setScopeId] = useState<string | null>(sop?.scope_id ?? null);
  const [body, setBody] = useState(sop?.body ?? STARTER);
  const [view, setView] = useState<"write" | "preview">(sop ? "preview" : "write");
  const [deleting, setDeleting] = useState(false);
  const departments = branches.flatMap((b) => b.departments.map((d) => ({ value: d.id, label: `${d.name}, ${b.name}` })));

  const save = useMutation({
    mutationFn: () => sop
      ? api<SOP>(`/api/sops/${sop.id}`, "PATCH", { title, body })
      : api<SOP>("/api/sops", "POST", { title, body, scope, scope_id: scope === "branch" || scope === "department" ? scopeId : null }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: workKeys.sops });
      toast.success(sop ? tr("Saved as version {n}.", { n: s.version }) : tr("SOP created. Agents in scope follow it from their next step."));
      onOpenChange(false);
    },
  });
  const needsTarget = !sop && (scope === "branch" || scope === "department") && !scopeId;
  // P24: an AI-written draft waits for a person; approving saves any edits too.
  const isDraft = sop?.status === "draft";
  const approve = useMutation({
    mutationFn: () => api<SOP>(`/api/sops/${sop!.id}`, "PATCH", { title, body, status: "active" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workKeys.sops });
      toast.success(tr("Approved. Agents in scope follow it from their next step."));
      onOpenChange(false);
    },
  });

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={sop ? sop.title : t("New SOP")}
      description={sop ? `${sopScopeLabel(sop)} · ${t("version {n}", { n: sop.version })} · ${t("updated {when}", { when: timeAgo(sop.updated_at).toLowerCase() })}` : t("Agents read SOPs before every step, so they follow them without being reminded.")}
      actions={canManage ? (
        <>
          {isDraft ? (
            <>
              <Button size="sm" loading={approve.isPending} disabled={!title.trim()} onClick={() => approve.mutate()}><CheckCircleIcon size={15} /> {t("Approve")}</Button>
              {view === "preview" ? <Button size="sm" variant="outline" onClick={() => setView("write")}><PencilSimpleIcon size={14} /> {t("Edit before approving")}</Button> : null}
            </>
          ) : null}
          <Button size="sm" variant={isDraft ? "outline" : "primary"} loading={save.isPending} disabled={!title.trim() || needsTarget} onClick={() => save.mutate()}>
            {isDraft ? t("Save draft") : sop ? t("Save new version") : t("Create SOP")}
          </Button>
          {sop ? <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><TrashIcon size={14} /> {t("Delete")}</Button> : null}
          {sop ? <PinButton kind="sop" refId={sop.id} title={sop.title} /> : null}
        </>
      ) : sop ? (
        <PinButton kind="sop" refId={sop.id} title={sop.title} withLabel />
      ) : null}
    >
      <div className="grid gap-4">
        {isDraft ? (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warn/40 bg-warn/8 px-3 py-2.5 text-[12.5px]">
            <Pill tone="warn">{t("Draft")}</Pill>
            <span className="min-w-0">{t("Written by AI from your documents. Agents don't see it until someone approves it. Check the steps, amounts and deadlines against the source first.")}</span>
          </div>
        ) : null}
        {sop?.source_files?.length ? (
          <p className="flex min-w-0 items-start gap-1.5 text-[12.5px] text-muted">
            <FileTextIcon size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{t("Built from: {names}", { names: sop.source_files.map((f) => f.name).join(", ") })}</span>
          </p>
        ) : null}
        <Field label={t("Title")} value={title} disabled={!canManage} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Month-end close")} />
        {!sop ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">{t("Who follows it")}</legend>
              <RadioGroup.Root value={scope} onValueChange={(v) => { setScope(v as Scope); setScopeId(null); }} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <RadioGroup.Item key={s.value} value={s.value} className="flex min-w-0 items-start gap-2.5 rounded-sm border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
                    <IconTile icon={SCOPE_LOOK[s.value].icon} tone={SCOPE_LOOK[s.value].tone} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{t(s.label)}</span>
                      <span className="block text-[12px] text-muted">{t(s.hint)}</span>
                    </span>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </fieldset>
            {scope === "branch" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label={t("Branch")} placeholder={t("Pick a company")} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            ) : scope === "department" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label={t("Department")} placeholder={t("Pick a department")} options={departments} />
            ) : null}
          </>
        ) : null}
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium">{t("Procedure")}</span>
            {canManage ? (
              <Segmented<"write" | "preview"> label={t("Editor view")} size="sm" value={view} onChange={setView}
                options={[{ value: "write", label: t("Write") }, { value: "preview", label: t("Preview") }]} />
            ) : null}
          </div>
          {view === "write" && canManage ? (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} aria-label={t("Procedure (Markdown)")}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          ) : (
            <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"><Markdown>{body || t("_Empty_")}</Markdown></div>
          )}
          <p className="text-[12px] text-muted">{t("Markdown: ## headings, - lists, 1. steps, **bold**, tables.")}</p>
        </div>
        <FormError message={save.error ? errorMessage(save.error) : approve.error ? errorMessage(approve.error) : null} />
      </div>
      {sop ? (
        <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t("Delete {name}?", { name: sop.title })} danger confirmLabel={t("Delete SOP")}
          body={t("Agents stop following it immediately and it is detached from every agent.")}
          onConfirm={async () => {
            try {
              await api(`/api/sops/${sop.id}`, "DELETE");
              qc.invalidateQueries({ queryKey: workKeys.sops });
              toast.success(tr("SOP deleted."));
              onOpenChange(false);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }} />
      ) : null}
    </SideSheet>
  );
}

export function SopsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("org.manage");
  const { data: sops, isLoading, error } = useQuery(sopsQuery);
  const search = useSearch({ strict: false }) as { sop?: string };
  const navigate = useNavigate();
  const [creating, setCreating] = useState(0);
  const [filter, setFilter] = useState<Scope | "all" | "draft">("all");
  const [q, setQ] = useState("");
  const openSop = sops?.find((s) => s.id === search.sop) ?? null;

  const groups = useMemo(() => {
    const order: Scope[] = ["workspace", "branch", "department", "library"];
    const needle = q.trim().toLowerCase();
    return order.filter((scope) => filter === "all" || filter === "draft" || filter === scope).map((scope) => ({
      scope,
      label: SCOPES.find((s) => s.value === scope)!.label,
      hint: SCOPES.find((s) => s.value === scope)!.hint,
      items: (sops ?? []).filter((s) => s.scope === scope && (filter !== "draft" || s.status === "draft") && (!needle || s.title.toLowerCase().includes(needle) || sopScopeLabel(s).toLowerCase().includes(needle))),
    })).filter((g) => g.items.length);
  }, [sops, filter, q]);
  const count = (scope: Scope) => (sops ?? []).filter((s) => s.scope === scope).length;
  const drafts = (sops ?? []).filter((s) => s.status === "draft").length;

  return (
    <Page>
      <LibraryHeader tab="/sops"
        actions={<>
          {/* P24: turn a company's uploaded procedures into SOPs from Company files. */}
          <Button variant="ghost" asChild><Link to="/files">{t("Upload in Browse →")}</Link></Button>
          {canManage ? <Button data-guide="sops.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("New SOP")}</Button> : null}
        </>} />
      {isLoading ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-none" />)}
        </div>
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !sops?.length ? (
        <EmptyState icon={FileTextIcon} title={t("No SOPs yet")} body={t("Write down how your company does things once (month-end close, quotation checks, report formats) and every agent in scope follows it.")}
          action={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("Write the first SOP")}</Button> : undefined} />
      ) : (
        <>
          <Toolbar>
            <Segmented<Scope | "all" | "draft"> label={t("Who follows it")} value={filter} onChange={setFilter}
              options={[
                { value: "all", label: t("All"), count: sops.length },
                ...SCOPES.map((sc) => ({ value: sc.value, label: t(sc.label), count: count(sc.value) })),
                ...(drafts ? [{ value: "draft" as const, label: t("Drafts"), count: drafts }] : []),
              ]} />
            <SearchInput value={q} onChange={setQ} placeholder={t("Search SOPs")} className="sm:ml-auto sm:max-w-72" />
          </Toolbar>
          {!groups.length ? (
            <EmptyState icon={FileTextIcon} title={t("No SOP matches")} body={t("Try another word, or show every scope.")} />
          ) : (
            <div data-guide="sops.list" className="grid grid-cols-[minmax(0,1fr)] gap-6">
              {groups.map((g) => {
                const look = SCOPE_LOOK[g.scope];
                return (
                  <section key={g.scope} className="grid min-w-0 gap-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <h2 className="text-[15px] font-semibold">{t(g.label)} <span className="font-normal text-muted tabular">{g.items.length}</span></h2>
                      <p className="text-[12.5px] text-muted">{t(g.hint)}</p>
                    </div>
                    <ListCard>
                      {g.items.map((s) => (
                        <ListRow key={s.id} onClick={() => navigate({ to: "/sops", search: { sop: s.id } })} active={s.id === search.sop}
                          leading={<IconTile icon={look.icon} tone={look.tone} size="sm" />}
                          title={<span className="block whitespace-normal break-words">{s.title}</span>}
                          trailing={s.status === "draft" ? <Pill tone="warn">{t("Draft")}</Pill> : undefined}
                          meta={<Meta items={[sopScopeLabel(s), <span key="v" className="tabular">v{s.version}</span>, t("updated {when}", { when: timeAgo(s.updated_at).toLowerCase() })]} />} />
                      ))}
                    </ListCard>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      {openSop ? <Editor key={openSop.id + openSop.version} sop={openSop} open canManage={canManage} onOpenChange={(o) => !o && navigate({ to: "/sops", search: {} })} /> : null}
      {creating ? <Editor key={`new-${creating}`} sop={null} open canManage={canManage} onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
