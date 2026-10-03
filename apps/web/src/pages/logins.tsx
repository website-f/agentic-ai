import { DotsThreeIcon, GlobeIcon, LockKeyIcon, PencilSimpleIcon, PlusIcon, ShieldCheckIcon, ShieldWarningIcon, TrashIcon, UserIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/lib/api";
import { loginsQuery, officeKeys, type SavedLogin } from "@/lib/office-data";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

const WHOLE = "workspace";

function LoginDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: SavedLogin }) {
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const manager = me.permissions.includes("vault.manage");
  const everything = !me.scope || me.scope.kind === "all";
  const [name, setName] = useState(editing?.name ?? "");
  const [hosts, setHosts] = useState(editing?.hosts.join(", ") ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [personal, setPersonal] = useState(!manager);
  const [branch, setBranch] = useState(everything ? WHOLE : me.scope?.branch_id ?? WHOLE);
  const [only, setOnly] = useState<string[]>(editing?.agent_ids ?? []);
  const mine = agents.filter((a) => !a.clone_of && (personal ? a.owner_user_id === me.user.id : branch === WHOLE || a.branch_id === branch));

  const save = useMutation({
    mutationFn: () => {
      const list = hosts.split(/[\s,]+/).filter(Boolean);
      if (editing) {
        return api(`/api/vault/logins/${editing.id}`, "PATCH", {
          hosts: list, agent_ids: only, ...(username ? { username } : {}), ...(password ? { password } : {}),
        });
      }
      return api("/api/vault/logins", "POST", {
        name, hosts: list, username, password, personal, agent_ids: only,
        branch_id: personal || branch === WHOLE ? null : branch,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: officeKeys.logins });
      toast.success(editing ? `${editing.name} saved.` : `${name} saved. Agents can now sign in with it.`);
      onOpenChange(false);
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const ready = editing ? !!hosts.trim() : !!(name.trim() && hosts.trim() && username && password);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${editing.name}` : "Save a login for agents"}
      description="Agents never see it. The browser types it in for them, only on the sites you list."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>Save login</Button></>}>
      <form className="grid grid-cols-[minmax(0,1fr)] gap-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        {editing ? null : <Field label="Name agents use" placeholder="supplier-portal" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} hint="Letters, numbers, dashes. Tell the agent this name in its task or SOP." />}
        <Field label="Site address" placeholder="portal.example.com" value={hosts} onChange={(e) => setHosts(e.target.value)} error={fields.hosts}
          hint="The login is typed in only on this site (and its subdomains). Several: separate with commas." />
        <Field label={editing ? "New username (blank keeps it)" : "Username"} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" error={fields.username} />
        <Field label={editing ? "New password (blank keeps it)" : "Password"} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" error={fields.password} />
        {!editing && manager ? (
          <div className="grid gap-3">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-border px-3 py-2.5 text-[13.5px] hover:bg-surface-2/50">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
              <span>My own login<span className="block text-[12.5px] text-muted">Only your personal agents may use it.</span></span>
            </label>
            {!personal && everything ? (
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">Who may use it</span>
                <Select value={branch} onValueChange={setBranch} label="Branch" options={[{ value: WHOLE, label: "Agents in every branch" }, ...branches.map((b) => ({ value: b.id, label: `Agents in ${b.name}` }))]} />
              </div>
            ) : null}
          </div>
        ) : null}
        {mine.length ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Only these agents (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {mine.map((a) => {
                const on = only.includes(a.id);
                return (
                  <button type="button" key={a.id} aria-pressed={on} onClick={() => setOnly((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))}
                    className={on ? "min-h-9 rounded-full border border-accent bg-accent-soft px-3 py-1 text-[12.5px] font-medium text-accent" : "min-h-9 rounded-full border border-border px-3 py-1 text-[12.5px] hover:bg-surface-2"}>
                    {a.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-muted">None picked: any agent that may use logins here. Helpers count as the agent they help.</p>
          </fieldset>
        ) : null}
        <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

function LoginRow({ l, agentNames }: { l: SavedLogin; agentNames: Map<string, string> }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/api/vault/logins/${l.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: officeKeys.logins }); toast.success(`${l.name} deleted.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const who = l.owner_user_id ? "Personal" : l.branch_name ? l.branch_name : "Every branch";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
      <IconTile icon={l.owner_user_id ? UserIcon : LockKeyIcon} tone={l.last_used_at ? "accent" : "neutral"} />
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 font-mono text-[13.5px] font-semibold break-all">{l.name}</span>
          <Pill tone={l.owner_user_id ? "accent" : "neutral"}>{who}</Pill>
        </p>
        <p className="flex min-w-0 items-start gap-1.5 text-[12.5px] text-muted">
          <GlobeIcon size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-all">{l.hosts.join(", ")}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
          <Meta items={[`User ${l.username_hint}`, l.last_used_at ? `Used ${timeAgo(l.last_used_at).toLowerCase()}` : "Not used yet"]} />
        </p>
        {l.agent_ids.length ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[12px] text-muted">Only</span>
            {l.agent_ids.map((a) => (
              <Pill key={a} tone="info" className="max-w-full whitespace-normal break-words">{agentNames.get(a) ?? "agent"}</Pill>
            ))}
          </div>
        ) : null}
      </div>
      {l.can_manage ? (
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Options for ${l.name}`} className="-mt-1 -mr-2"><DotsThreeIcon size={20} weight="bold" /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>Edit sites, agents or password</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Delete</MenuItem>
          </MenuContent>
        </Menu>
      ) : <span />}
      {editing ? <LoginDialog open={editing} onOpenChange={setEditing} editing={l} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Delete ${l.name}?`} body="Agents that use it will ask a person to sign in instead." confirmLabel="Delete" danger onConfirm={async () => { await del.mutateAsync(); }} />
    </li>
  );
}

export function LoginsPage() {
  const { data: logins = [], isLoading, error } = useQuery(loginsQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const [adding, setAdding] = useState(0);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return (
    <Page>
      <PageHeader
        title="Logins"
        description="Website logins your agents may use. They are encrypted, never shown again, never sent to an AI model, and typed in only on the sites listed. Every use is in the activity log."
        actions={<Button onClick={() => setAdding((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Save a login</Button>}
      />
      {isLoading ? (
        <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[4.5rem] rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load logins. {errorMessage(error)}</div>
      ) : !logins.length ? (
        <EmptyState icon={ShieldCheckIcon} title="No saved logins" body="Save a login for a site your agents work on. On the sign-in page they call browser_login with its name, and the browser types it in for them."
          action={<Button onClick={() => setAdding((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Save a login</Button>} />
      ) : (
        <Section title="Saved logins" description={`${logins.length} ${logins.length === 1 ? "login" : "logins"} agents may use.`}>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
            {logins.map((l) => <LoginRow key={l.id} l={l} agentNames={names} />)}
          </ul>
        </Section>
      )}
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
        <IconTile icon={ShieldWarningIcon} tone="warn" size="sm" />
        <p className="min-w-0 max-w-[75ch] text-[12.5px] text-muted">
          Only save logins you are allowed to share with software. Sites that need a one-time code, a captcha or a personal signing PIN stay with a person: the agent stops and asks.
        </p>
      </div>
      {adding ? <LoginDialog key={adding} open onOpenChange={(o) => { if (!o) setAdding(0); }} /> : null}
    </Page>
  );
}
