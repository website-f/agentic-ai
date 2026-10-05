import { DotsThreeIcon, GlobeIcon, LockKeyIcon, PencilSimpleIcon, PlusIcon, ShieldCheckIcon, ShieldWarningIcon, SignOutIcon, TrashIcon, UserIcon } from "@phosphor-icons/react";
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
import { locale, t as tr, useT } from "@/i18n";
import { timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

const WHOLE = "workspace";

function LoginDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: SavedLogin }) {
  const t = useT();
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
  const mine = agents.filter((a) => !a.clone_of && !a.view_only && (personal ? a.owner_user_id === me.user.id : branch === WHOLE || a.branch_id === branch));

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
      toast.success(editing ? tr("{name} saved.", { name: editing.name }) : tr("{name} saved. Agents can now sign in with it.", { name }));
      onOpenChange(false);
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const ready = editing ? !!hosts.trim() : !!(name.trim() && hosts.trim() && username && password);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={editing ? t("Edit {name}", { name: editing.name }) : t("Save a login for agents")}
      description={t("Agents never see it. The browser types it in for them, only on the sites you list.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button><Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t("Save login")}</Button></>}>
      <form className="grid grid-cols-[minmax(0,1fr)] gap-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        {editing ? null : <Field label={t("Name agents use")} placeholder="supplier-portal" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} hint={t("Letters, numbers, dashes. Tell the agent this name in its task or SOP.")} />}
        <Field label={t("Site address")} placeholder="portal.example.com" value={hosts} onChange={(e) => setHosts(e.target.value)} error={fields.hosts}
          hint={t("The login is typed in only on this site (and its subdomains). Several: separate with commas.")} />
        <Field label={editing ? t("New username (blank keeps it)") : t("Username")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" error={fields.username} />
        <Field label={editing ? t("New password (blank keeps it)") : t("Password")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" error={fields.password} />
        {!editing && manager ? (
          <div className="grid gap-3">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-border px-3 py-2.5 text-[13.5px] hover:bg-surface-2/50">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
              <span>{t("My own login")}<span className="block text-[12.5px] text-muted">{t("Only your personal agents may use it.")}</span></span>
            </label>
            {!personal && everything ? (
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">{t("Who may use it")}</span>
                <Select value={branch} onValueChange={setBranch} label={t("Branch")} options={[{ value: WHOLE, label: t("Agents in every branch") }, ...branches.map((b) => ({ value: b.id, label: t("Agents in {branch}", { branch: b.name }) }))]} />
              </div>
            ) : null}
          </div>
        ) : null}
        {mine.length ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t("Only these agents (optional)")}</legend>
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
            <p className="text-[12px] text-muted">{t("None picked: any agent that may use logins here. Helpers count as the agent they help.")}</p>
          </fieldset>
        ) : null}
        <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

function LoginRow({ l, agentNames }: { l: SavedLogin; agentNames: Map<string, string> }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/api/vault/logins/${l.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: officeKeys.logins }); toast.success(tr("{name} deleted.", { name: l.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const forget = useMutation({
    mutationFn: () => api(`/api/vault/logins/${l.id}/session`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: officeKeys.logins }); toast.success(tr("Agents will sign in to {name} again next time.", { name: l.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const who = l.owner_user_id ? t("Personal") : l.branch_name ? l.branch_name : t("Every branch");
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
          <Meta items={[t("User {hint}", { hint: l.username_hint }), l.last_used_at ? t("Used {ago}", { ago: timeAgo(l.last_used_at).toLowerCase() }) : t("Not used yet")]} />
        </p>
        {l.session_saved_at ? (
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted" title={l.session_expires_at ? t("Kept until {date}; then agents sign in again.", { date: new Date(l.session_expires_at).toLocaleDateString(locale()) }) : undefined}>
            <ShieldCheckIcon size={14} className="shrink-0 text-accent" />
            <span>{t("Stays signed in · saved {ago}", { ago: timeAgo(l.session_saved_at).toLowerCase() })}</span>
          </p>
        ) : null}
        {l.agent_ids.length ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[12px] text-muted">{t("Only")}</span>
            {l.agent_ids.map((a) => (
              <Pill key={a} tone="info" className="max-w-full whitespace-normal break-words">{agentNames.get(a) ?? t("agent")}</Pill>
            ))}
          </div>
        ) : null}
      </div>
      {l.can_manage ? (
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("Options for {name}", { name: l.name })} className="-mt-1 -mr-2"><DotsThreeIcon size={20} weight="bold" /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>{t("Edit sites, agents or password")}</MenuItem>
            {l.session_saved_at ? <MenuItem icon={<SignOutIcon />} onSelect={() => forget.mutate()}>{t("Forget saved session")}</MenuItem> : null}
            <MenuSeparator />
            <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>{t("Delete")}</MenuItem>
          </MenuContent>
        </Menu>
      ) : <span />}
      {editing ? <LoginDialog open={editing} onOpenChange={setEditing} editing={l} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("Delete {name}?", { name: l.name })} body={t("Agents that use it will ask a person to sign in instead.")} confirmLabel={t("Delete")} danger onConfirm={async () => { await del.mutateAsync(); }} />
    </li>
  );
}

export function LoginsPage() {
  const t = useT();
  const { data: logins = [], isLoading, error } = useQuery(loginsQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const [adding, setAdding] = useState(0);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return (
    <Page>
      <PageHeader
        title={t("Logins")}
        description={t("Website logins your agents may use. They are encrypted, never shown again, never sent to an AI model, and typed in only on the sites listed. Every use is in the activity log.")}
        actions={<Button data-guide="logins.new" onClick={() => setAdding((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("Save a login")}</Button>}
      />
      {isLoading ? (
        <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[4.5rem] rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">{t("Could not load logins.")} {errorMessage(error)}</div>
      ) : !logins.length ? (
        <EmptyState icon={ShieldCheckIcon} title={t("No saved logins")} body={t("Save a login for a site your agents work on. On the sign-in page they call browser_login with its name, and the browser types it in for them.")}
          action={<Button onClick={() => setAdding((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("Save a login")}</Button>} />
      ) : (
        <Section title={t("Saved logins")} description={logins.length === 1 ? t("1 login agents may use.") : t("{n} logins agents may use.", { n: logins.length })}>
          <ul data-guide="logins.list" className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
            {logins.map((l) => <LoginRow key={l.id} l={l} agentNames={names} />)}
          </ul>
        </Section>
      )}
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
        <IconTile icon={ShieldWarningIcon} tone="warn" size="sm" />
        <p className="min-w-0 max-w-[75ch] text-[12.5px] text-muted">
          {t("Only save logins you are allowed to share with software. Sites that need a one-time code, a captcha or a personal signing PIN stay with a person: the agent stops and asks.")}
        </p>
      </div>
      {adding ? <LoginDialog key={adding} open onOpenChange={(o) => { if (!o) setAdding(0); }} /> : null}
    </Page>
  );
}
