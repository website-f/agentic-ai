import { FileTextIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, FormError } from "@/components/ui/field";
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
              <RadioGroup.Root value={scope} onValueChange={(v) => { setScope(v as Scope); setScopeId(null); }} className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <RadioGroup.Item key={s.value} value={s.value} className="rounded-sm border border-border px-3 py-2 text-left data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
                    <span className="block text-[13px] font-medium">{s.label}</span>
                    <span className="block text-[12px] text-muted">{s.hint}</span>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </fieldset>
            {scope === "branch" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            ) : scope === "department" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label="Department" options={departments} />
            ) : null}
          </>
        ) : null}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium">Procedure</span>
            <RadioGroup.Root value={view} onValueChange={(v) => setView(v as "write" | "preview")} className="inline-flex rounded-sm border border-border p-0.5" aria-label="Editor view">
              {(["write", "preview"] as const).map((v) => (
                <RadioGroup.Item key={v} value={v} className="rounded-[6px] px-2.5 py-1 text-[12.5px] text-muted capitalize data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">{v}</RadioGroup.Item>
              ))}
            </RadioGroup.Root>
          </div>
          {view === "write" && canManage ? (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} aria-label="Procedure (Markdown)"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          ) : (
            <div className="rounded-sm border border-border bg-surface px-4 py-3"><Markdown>{body || "_Empty_"}</Markdown></div>
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
  const openSop = sops?.find((s) => s.id === search.sop) ?? null;

  const groups = useMemo(() => {
    const order: Scope[] = ["workspace", "branch", "department", "library"];
    return order.map((scope) => ({
      scope,
      label: SCOPES.find((s) => s.value === scope)!.label,
      items: (sops ?? []).filter((s) => s.scope === scope),
    })).filter((g) => g.items.length);
  }, [sops]);

  return (
    <Page>
      <PageHeader
        title="SOPs"
        description="Written procedures your agents follow. Company and department SOPs apply automatically; library SOPs are attached to specific agents."
        actions={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New SOP</Button> : null}
      />
      {isLoading ? <Skeleton className="h-40 rounded-[var(--radius-md)]" /> : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !groups.length ? (
        <EmptyState icon={FileTextIcon} title="No SOPs yet" body="Write down how your company does things once (month-end close, quotation checks, report formats) and every agent in scope follows it."
          action={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Write the first SOP</Button> : undefined} />
      ) : (
        <div className="grid gap-6">
          {groups.map((g) => (
            <section key={g.scope} className="grid gap-2">
              <h2 className="text-[14px] font-semibold">{g.label}</h2>
              <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
                {g.items.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => navigate({ to: "/sops", search: { sop: s.id } })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
                      <FileTextIcon size={18} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{s.title}</span>
                        <span className="block truncate text-[12px] text-muted">{s.scope_label} · v{s.version} · updated {timeAgo(s.updated_at).toLowerCase()}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {openSop ? <Editor key={openSop.id + openSop.version} sop={openSop} open canManage={canManage} onOpenChange={(o) => !o && navigate({ to: "/sops", search: {} })} /> : null}
      {creating ? <Editor key={`new-${creating}`} sop={null} open canManage={canManage} onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
