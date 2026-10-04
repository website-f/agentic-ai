import { BookBookmarkIcon, BuildingsIcon, FileTextIcon, GlobeHemisphereEastIcon, PlusIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, FormError } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { sopsQuery, workKeys, type SOP } from "@/lib/work";

type Scope = SOP["scope"];
const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "workspace", label: "Every company", hint: "Every agent in every branch follows it." },
  { value: "branch", label: "One company", hint: "Every agent in that branch." },
  { value: "department", label: "One department", hint: "Every agent in that department." },
  { value: "library", label: "Library", hint: "Only agents you attach it to, like a skill pack." },
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
      toast.success(sop ? `Saved as version ${s.version}.` : "SOP created. Agents in scope follow it from their next step.");
      onOpenChange(false);
    },
  });
  const needsTarget = !sop && (scope === "branch" || scope === "department") && !scopeId;

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={sop ? sop.title : "New SOP"}
      description={sop ? `${sop.scope_label} · version ${sop.version} · updated ${timeAgo(sop.updated_at).toLowerCase()}` : "Agents read SOPs before every step, so they follow them without being reminded."}
      actions={canManage ? (
        <>
          <Button size="sm" loading={save.isPending} disabled={!title.trim() || needsTarget} onClick={() => save.mutate()}>
            {sop ? "Save new version" : "Create SOP"}
          </Button>
          {sop ? <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><TrashIcon size={14} /> Delete</Button> : null}
        </>
      ) : null}
    >
      <div className="grid gap-4">
        <Field label="Title" value={title} disabled={!canManage} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Month-end close" />
        {!sop ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">Who follows it</legend>
              <RadioGroup.Root value={scope} onValueChange={(v) => { setScope(v as Scope); setScopeId(null); }} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <RadioGroup.Item key={s.value} value={s.value} className="flex min-w-0 items-start gap-2.5 rounded-sm border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
                    <IconTile icon={SCOPE_LOOK[s.value].icon} tone={SCOPE_LOOK[s.value].tone} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{s.label}</span>
                      <span className="block text-[12px] text-muted">{s.hint}</span>
                    </span>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </fieldset>
            {scope === "branch" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label="Branch" placeholder="Pick a company" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            ) : scope === "department" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label="Department" placeholder="Pick a department" options={departments} />
            ) : null}
          </>
        ) : null}
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium">Procedure</span>
            {canManage ? (
              <Segmented<"write" | "preview"> label="Editor view" size="sm" value={view} onChange={setView}
                options={[{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }]} />
            ) : null}
          </div>
          {view === "write" && canManage ? (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} aria-label="Procedure (Markdown)"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          ) : (
            <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"><Markdown>{body || "_Empty_"}</Markdown></div>
          )}
          <p className="text-[12px] text-muted">Markdown: ## headings, - lists, 1. steps, **bold**, tables.</p>
        </div>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
      {sop ? (
        <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete ${sop.title}?`} danger confirmLabel="Delete SOP"
          body="Agents stop following it immediately and it is detached from every agent."
          onConfirm={async () => {
            try {
              await api(`/api/sops/${sop.id}`, "DELETE");
              qc.invalidateQueries({ queryKey: workKeys.sops });
              toast.success("SOP deleted.");
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
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("org.manage");
  const { data: sops, isLoading, error } = useQuery(sopsQuery);
  const search = useSearch({ strict: false }) as { sop?: string };
  const navigate = useNavigate();
  const [creating, setCreating] = useState(0);
  const [filter, setFilter] = useState<Scope | "all">("all");
  const [q, setQ] = useState("");
  const openSop = sops?.find((s) => s.id === search.sop) ?? null;

  const groups = useMemo(() => {
    const order: Scope[] = ["workspace", "branch", "department", "library"];
    const needle = q.trim().toLowerCase();
    return order.filter((scope) => filter === "all" || filter === scope).map((scope) => ({
      scope,
      label: SCOPES.find((s) => s.value === scope)!.label,
      hint: SCOPES.find((s) => s.value === scope)!.hint,
      items: (sops ?? []).filter((s) => s.scope === scope && (!needle || s.title.toLowerCase().includes(needle) || s.scope_label.toLowerCase().includes(needle))),
    })).filter((g) => g.items.length);
  }, [sops, filter, q]);
  const count = (scope: Scope) => (sops ?? []).filter((s) => s.scope === scope).length;

  return (
    <Page>
      <PageHeader
        title="SOPs"
        description="Written procedures your agents follow. Company and department SOPs apply automatically; library SOPs are attached to specific agents."
        actions={canManage ? <Button data-guide="sops.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New SOP</Button> : null}
      />
      {isLoading ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-none" />)}
        </div>
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !sops?.length ? (
        <EmptyState icon={FileTextIcon} title="No SOPs yet" body="Write down how your company does things once (month-end close, quotation checks, report formats) and every agent in scope follows it."
          action={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Write the first SOP</Button> : undefined} />
      ) : (
        <>
          <Toolbar>
            <Segmented<Scope | "all"> label="Who follows it" value={filter} onChange={setFilter}
              options={[{ value: "all", label: "All", count: sops.length }, ...SCOPES.map((sc) => ({ value: sc.value, label: sc.label, count: count(sc.value) }))]} />
            <SearchInput value={q} onChange={setQ} placeholder="Search SOPs" className="sm:ml-auto sm:max-w-72" />
          </Toolbar>
          {!groups.length ? (
            <EmptyState icon={FileTextIcon} title="No SOP matches" body="Try another word, or show every scope." />
          ) : (
            <div data-guide="sops.list" className="grid grid-cols-[minmax(0,1fr)] gap-6">
              {groups.map((g) => {
                const look = SCOPE_LOOK[g.scope];
                return (
                  <section key={g.scope} className="grid min-w-0 gap-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <h2 className="text-[15px] font-semibold">{g.label} <span className="font-normal text-muted tabular">{g.items.length}</span></h2>
                      <p className="text-[12.5px] text-muted">{g.hint}</p>
                    </div>
                    <ListCard>
                      {g.items.map((s) => (
                        <ListRow key={s.id} onClick={() => navigate({ to: "/sops", search: { sop: s.id } })} active={s.id === search.sop}
                          leading={<IconTile icon={look.icon} tone={look.tone} size="sm" />}
                          title={<span className="block whitespace-normal break-words">{s.title}</span>}
                          meta={<Meta items={[s.scope_label, <span key="v" className="tabular">v{s.version}</span>, `updated ${timeAgo(s.updated_at).toLowerCase()}`]} />} />
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
