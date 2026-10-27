/** P53 Staff computers (owner/managers): every linked company computer, who linked it and
 * where, searchable, with a link to see and use each one from the web (the same two-lock
 * remote path, with the on-screen notice on the computer). The owner can also turn on a
 * company backup of the folders staff computers share, to a storage place they choose. */
import {
  AppleLogoIcon, ArchiveBoxIcon, DesktopTowerIcon, LinuxLogoIcon, MonitorPlayIcon,
  WindowsLogoIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  backupSettingsQuery, orgComputersQuery, setBackup, type StaffComputer,
} from "@/lib/devices";
import { meQuery } from "@/lib/queries";
import { useDebounced } from "@/lib/paged";
import { cn, timeAgo } from "@/lib/utils";

const OS_ICON: Record<string, Icon> = { mac: AppleLogoIcon, linux: LinuxLogoIcon, windows: WindowsLogoIcon };

export function StaffComputersPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const roster = useQuery(orgComputersQuery(needle));
  const [backupOpen, setBackupOpen] = useState(false);

  const list = useMemo(() => roster.data?.computers ?? [], [roster.data]);
  const byCompany = useMemo(() => {
    const groups = new Map<string, StaffComputer[]>();
    for (const c of list) {
      const key = c.company || t("No company");
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list, t]);
  const online = list.filter((c) => c.online).length;

  return (
    <Page wide>
      <PageHeader
        title={t("Staff computers")}
        description={t("Every company computer your staff have linked: who linked it, whether it is online, and the folders it shares. Open one to see its screen and fetch files — the computer shows a notice while you do.")}
        actions={roster.data?.can_backup ? (
          <Button variant="outline" onClick={() => setBackupOpen(true)}><ArchiveBoxIcon size={16} /> {t("Backup settings")}</Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={t("Search by person, company or computer")} className="sm:max-w-sm" />
        {!roster.isLoading ? (
          <span className="text-[12.5px] text-muted">{t("{n} computers · {online} online", { n: list.length.toLocaleString(locale()), online })}</span>
        ) : null}
      </div>

      {roster.isLoading ? (
        <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
      ) : roster.error ? (
        <p role="alert" className="text-danger">{errorMessage(roster.error)}</p>
      ) : !list.length ? (
        <EmptyState icon={DesktopTowerIcon} title={needle ? t("Nothing matches") : t("No computers linked yet")}
          body={needle ? t("Try another name.") : t("Staff link a company computer from My computers. Once linked, it shows here.")} />
      ) : (
        byCompany.map(([company, rows]) => (
          <Section key={company} title={company} description={t("{n} computers", { n: rows.length })}>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
              {rows.map((c) => <ComputerRow key={c.id} c={c} canView={me.permissions.includes("agents.own") || me.permissions.includes("assistants.use") || me.permissions.includes("members.manage") || me.permissions.includes("team.manage")} />)}
            </ul>
          </Section>
        ))
      )}

      {backupOpen ? <BackupDialog onClose={() => setBackupOpen(false)} /> : null}
    </Page>
  );
}

function ComputerRow({ c, canView }: { c: StaffComputer; canView: boolean }) {
  const t = useT();
  const OsIcon = OS_ICON[c.os] ?? DesktopTowerIcon;
  return (
    <li className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="relative shrink-0">
          <IconTile icon={OsIcon} tone="neutral" />
          <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface", c.paused ? "bg-warn" : c.online ? "bg-ok" : "bg-border")} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[14.5px] font-semibold">{c.name}</span>
            <Pill tone={c.paused ? "warn" : c.online ? "ok" : "neutral"} live={c.online && !c.paused}>
              {c.paused ? t("Paused") : c.online ? t("Online") : t("Offline")}
            </Pill>
          </span>
          <span className="truncate text-[13px] text-muted">{c.person.name} · {c.person.email}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
            <span>{c.os === "mac" ? "macOS" : c.os === "linux" ? "Linux" : "Windows"}{c.os_version ? ` ${c.os_version}` : ""}</span>
            {c.hostname ? <span>· {c.hostname}</span> : null}
            {!c.online && c.last_seen_at ? <span>· {t("last seen {when}", { when: timeAgo(c.last_seen_at) })}</span> : null}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <span className="min-w-0 truncate text-[12px] text-muted">
          {c.folders.length ? t("Shares {n} folders", { n: c.folders.length }) : t("No folders shared")}
          {c.remote && c.remote !== "off" ? ` · ${c.remote === "control" ? t("Remote control on") : t("Remote view on")}` : ""}
        </span>
        {canView ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/computers/$deviceId/remote" params={{ deviceId: c.id }} search={{ staff: "1" } as never}>
              <MonitorPlayIcon size={15} /> {t("Open")}
            </Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const current = useQuery(backupSettingsQuery);
  const [enabled, setEnabled] = useState(false);
  const [target, setTarget] = useState("");
  const [hours, setHours] = useState("6");
  const [seeded, setSeeded] = useState(false);
  if (current.data && !seeded) {
    setSeeded(true);
    setEnabled(current.data.enabled);
    setTarget(current.data.target_id || current.data.targets[0]?.id || "");
    setHours(String(current.data.every_hours));
  }
  const save = useMutation({
    mutationFn: () => setBackup({ enabled, target_id: target, every_hours: Number(hours) || 6 }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["org", "computers"] }); toast.success(t("Saved.")); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const targets = current.data?.targets ?? [];
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Back up staff computers")}
      description={t("Keep a copy of the folders each computer shares, so the company's work is safe if a computer is wiped or lost. The staff member sees it in their own computer's activity.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-4">
        <SwitchField checked={enabled} onCheckedChange={setEnabled} label={t("Back up shared folders automatically")}
          hint={t("Only the folders staff already share with their AI — never the whole computer, and never passwords, keys or browser data.")} />
        {!targets.length ? (
          <p className="rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]">
            {t("Add a place to keep the backup first:")} <Link to="/settings/storage" className="font-medium text-accent hover:underline">{t("Settings → Storage")}</Link>
          </p>
        ) : (
          <>
            <Select value={target} onValueChange={setTarget} label={t("Keep the backup in")} disabled={!enabled}
              options={targets.map((x) => ({ value: x.id, label: `${x.name} (${x.kind})` }))} />
            <label className="grid gap-1 text-[13px] font-medium">
              {t("How often")}
              <Select value={hours} onValueChange={setHours} label={t("How often")} disabled={!enabled}
                options={[{ value: "3", label: t("Every 3 hours") }, { value: "6", label: t("Every 6 hours") }, { value: "12", label: t("Twice a day") }, { value: "24", label: t("Once a day") }]} />
            </label>
          </>
        )}
        <p className="text-[12px] text-muted">{t("Each run copies only what changed, a little at a time, so it never slows the computer or the line.")}</p>
      </div>
    </ResponsiveDialog>
  );
}
