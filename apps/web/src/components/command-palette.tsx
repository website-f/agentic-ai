import {
  AddressBookIcon, ArrowElbowDownLeftIcon, ArrowsDownUpIcon, ClipboardTextIcon, FileMagnifyingGlassIcon, FileTextIcon, KanbanIcon, MagnifyingGlassIcon, MonitorIcon, MoonIcon, PlusIcon,
  PushPinIcon, SignOutIcon, SparkleIcon, SunIcon, TextAlignLeftIcon, UserFocusIcon, UserGearIcon, UserIcon, UserPlusIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { askDesk, deskKeys, findQuery, pinItem, type Found } from "@/lib/desk";
import { meQuery } from "@/lib/queries";
import { suggestQuery, useDebounced } from "@/lib/search";

import { useT } from "@/i18n";
import { usePalette, useTheme } from "@/lib/stores";
import { NAV, navItemFor } from "@/nav";

import { useSignOut } from "@/lib/use-sign-out";

import { typeLabel, useOpenTarget } from "./search-box";
import { openTaskComposer } from "./task-composer/store";

const GROUP =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase";

function Item({ onSelect, icon, children, hint, value, keywords }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: string; value?: string; keywords?: string[] }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="group flex min-h-10 cursor-default items-center gap-3 rounded-sm px-2.5 py-2 text-[13.5px] data-[selected=true]:bg-surface-2"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-muted ring-1 ring-border/60 group-data-[selected=true]:bg-accent-soft group-data-[selected=true]:text-accent group-data-[selected=true]:ring-accent/15 [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11px] text-muted">{hint}</span> : null}
      <ArrowElbowDownLeftIcon size={14} className="hidden shrink-0 text-muted group-data-[selected=true]:block max-sm:!hidden" aria-hidden />
    </Command.Item>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-border bg-surface px-1 font-sans text-[11px] text-muted">{children}</kbd>;
}

export function CommandPalette() {
  const t = useT();
  const { open, setOpen } = usePalette();
  const navigate = useNavigate();
  const setTheme = useTheme((s) => s.setPref);
  const signOut = useSignOut();
  // P25: what is typed also searches inside every document.
  const [q, setQ] = useState("");
  const typed = useDebounced(q.trim(), 150);
  const co = useCompanies();
  const openTarget = useOpenTarget();
  const { data: me } = useQuery(meQuery);
  const { data: sug } = useQuery(suggestQuery(typed, co.isAll ? undefined : co.selected?.id, open && typed.length >= 2));
  const titles = typed.length >= 2 ? (sug?.suggestions ?? []).filter((s) => s.kind === "title" || s.kind === "heading").slice(0, 4) : [];
  // P97: tasks, agents, people, contacts and reports by name (only what this person may open).
  const { data: found } = useQuery(findQuery(typed, open));
  const qc = useQueryClient();
  const where = useRouterState({ select: (s) => s.location });
  const here = `${where.pathname}${where.searchStr ?? ""}${where.hash ? `#${where.hash}` : ""}`;
  const pinHere = useMutation({
    mutationFn: () => {
      const item = navItemFor(where.pathname);
      return pinItem("route", here, item ? t(item.label) : document.title || where.pathname);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(t("Pinned to your workspace."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ask = useMutation({
    mutationFn: (text: string) => askDesk({ text, make: "answer" }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(t("{name} is on it. The answer appears under My work.", { name: r.agent.name }), {
        action: { label: t("Follow it"), onClick: () => void navigate({ to: "/tasks", search: { task: r.task_id } as never }) },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const FOUND: { key: keyof Found; heading: string; icon: Icon }[] = [
    { key: "tasks", heading: t("Tasks"), icon: KanbanIcon },
    { key: "people", heading: t("People"), icon: UserIcon },
    { key: "agents", heading: t("Agents"), icon: UserFocusIcon },
    { key: "contacts", heading: t("Contacts"), icon: AddressBookIcon },
    { key: "reports", heading: t("Reports"), icon: ClipboardTextIcon },
  ];

  const run = (fn: () => void) => {
    setOpen(false);
    setQ("");
    fn();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-[10dvh] left-1/2 z-50 w-[min(calc(100vw-1.5rem),38rem)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[dialog-in_160ms_cubic-bezier(0.16,1,0.3,1)]">
          <Dialog.Title className="sr-only">{t("Command palette")}</Dialog.Title>
          <Dialog.Description className="sr-only">{t("Jump to a page or run an action.")}</Dialog.Description>
          <Command label={t("Command palette")} loop>
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <MagnifyingGlassIcon size={18} className="shrink-0 text-muted" aria-hidden />
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder={t("Search pages, people, tasks, documents, agents…")}
                className="h-13 w-full min-w-0 bg-transparent text-[14.5px] outline-none placeholder:text-muted"
              />
              <span className="max-sm:hidden"><Key>Esc</Key></span>
            </div>
            <Command.List className="max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">
                {t("Nothing matches that.")}
              </Command.Empty>
              {q.trim().length >= 2 ? (
                <Command.Group heading={t("Search documents")} className={GROUP}>
                  <Item value={`search-documents ${q}`} keywords={[q]} icon={<FileMagnifyingGlassIcon />} onSelect={() => run(() => navigate({ to: "/search", search: { q: q.trim() } }))}>
                    {t("Search all documents for “{q}”", { q: q.trim() })}
                  </Item>
                  {titles.map((s) => (
                    <Item key={`${s.kind}:${s.id}:${s.page ?? ""}`} value={`doc ${s.kind} ${s.id} ${s.page ?? ""} ${s.text}`} keywords={[q]}
                      icon={s.kind === "heading" ? <TextAlignLeftIcon /> : <FileTextIcon />}
                      hint={s.kind === "heading" && s.page ? t("p.{n}", { n: s.page }) : typeLabel(t, s.type)}
                      onSelect={() => run(() => openTarget(s.url, s.type, s.branch_id))}>
                      {s.text}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}
              {typed.length >= 2 && found
                ? FOUND.filter((g) => found[g.key]?.length).map((g) => (
                    <Command.Group key={g.key} heading={g.heading} className={GROUP}>
                      {found[g.key].map((f) => (
                        <Item key={`${f.kind}:${f.id}`} value={`find ${f.kind} ${f.id} ${f.title}`} keywords={[q]} icon={<g.icon />} hint={f.sub || undefined}
                          onSelect={() => run(() => navigate({ href: f.url }))}>
                          {f.title}
                        </Item>
                      ))}
                    </Command.Group>
                  ))
                : null}
              {NAV.map((section) => (
                <Command.Group key={section.title} heading={t(section.title)} className={GROUP}>
                  {/* Only pages the person may open (the sidebar's rule; hidden tabs stay findable). */}
                  {section.items.filter((n) => !n.perm || [n.perm].flat().some((p) => me?.permissions.includes(p))).map((n) => {
                    const IconCmp = n.icon;
                    return (
                      <Item key={n.to} value={`${t(section.title)} ${t(n.label)} ${section.title} ${n.label} ${n.to}`} icon={<IconCmp weight="duotone" />} hint={n.phase} onSelect={() => run(() => navigate({ to: n.to }))}>
                        {t(n.label)}
                      </Item>
                    );
                  })}
                </Command.Group>
              ))}
              <Command.Group heading={t("Actions")} className={GROUP}>
                {q.trim().length >= 3 && me?.permissions.includes("work.write") ? (
                  <Item value={`ask-my-ai ${q}`} keywords={[q]} icon={<SparkleIcon />} onSelect={() => { const text = q.trim(); run(() => ask.mutate(text)); }}>
                    {t("Ask my AI: “{q}”", { q: q.trim() })}
                  </Item>
                ) : null}
                {where.pathname !== "/workspace" ? (
                  <Item icon={<PushPinIcon />} keywords={["pin", "semat", "desk", "workspace"]} onSelect={() => run(() => pinHere.mutate())}>
                    {t("Pin this page to my desk")}
                  </Item>
                ) : null}
                {me?.permissions.includes("work.write") ? (
                  <Item icon={<KanbanIcon />} keywords={["task", "tugasan", "research", "browse", "schedule"]} onSelect={() => run(() => openTaskComposer())}>
                    {t("New task")}
                  </Item>
                ) : null}
                {/* P48: only what this person may open (staff were sent back to their workspace) */}
                {me?.permissions.includes("org.manage") ? (
                  <Item icon={<PlusIcon />} onSelect={() => run(() => navigate({ to: "/organization", search: { new: 1 } }))}>
                    {t("New company")}
                  </Item>
                ) : null}
                {/* P98: where the owner sets what each role may do, found by any of these words. */}
                {me?.permissions.includes("roles.manage") ? (
                  <Item icon={<UserGearIcon />} keywords={["roles", "permissions", "access", "rights", "peranan", "akses", "kebenaran", "hak"]}
                    onSelect={() => run(() => navigate({ to: "/settings/roles" }))}>
                    {t("Change what each role can do")}
                  </Item>
                ) : null}
                {me?.permissions.includes("members.manage") || me?.permissions.includes("team.manage") ? (
                  <Item icon={<UserPlusIcon />} onSelect={() => run(() => navigate({ to: "/settings/members", search: { add: 1 } }))}>
                    {t("Add member")}
                  </Item>
                ) : null}
                <Item icon={<SunIcon />} onSelect={() => run(() => setTheme("light"))}>{t("Light theme")}</Item>
                <Item icon={<MoonIcon />} onSelect={() => run(() => setTheme("dark"))}>{t("Dark theme")}</Item>
                <Item icon={<MonitorIcon />} onSelect={() => run(() => setTheme("system"))}>{t("Match system theme")}</Item>
                <Item icon={<SignOutIcon />} onSelect={() => run(signOut)}>{t("Sign out")}</Item>
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border bg-surface-2/40 px-4 py-2 text-[11.5px] text-muted max-sm:hidden">
              <span className="flex items-center gap-1.5"><Key><ArrowsDownUpIcon size={11} /></Key> {t("Move")}</span>
              <span className="flex items-center gap-1.5"><Key><ArrowElbowDownLeftIcon size={11} /></Key> {t("Open|verb")}</span>
              <span className="ml-auto flex items-center gap-1.5"><Key>Ctrl</Key><Key>K</Key> {t("Toggle")}</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
