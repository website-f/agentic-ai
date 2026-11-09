/** P53 Staff computers (owner/managers): every linked company computer, who linked it and
 * where, searchable, with a link to see and use each one from the web (the same two-lock
 * remote path, with the on-screen notice on the computer). The owner can also turn on a
 * company backup of the folders staff computers share, to a storage place they choose. */
import {
  AppleLogoIcon, ArchiveBoxIcon, DesktopTowerIcon, GlobeIcon, LinuxLogoIcon, MonitorPlayIcon,
  WindowsLogoIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, filterOf, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  backupSettingsQuery, orgComputersQuery, setBackup, type StaffComputer,
} from "@/lib/devices";
import { meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";


const OS_ICON: Record<string, Icon> = { mac: AppleLogoIcon, linux: LinuxLogoIcon, windows: WindowsLogoIcon };
const ALL = "all";
const osName = (c: StaffComputer) => `${c.os === "mac" ? "macOS" : c.os === "linux" ? "Linux" : "Windows"}${c.os_version ? ` ${c.os_version}` : ""}`;

export function StaffComputersPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  // P96: one list of every computer (a company has a few hundred at most), searched, sorted and
  // paged in the browser by the shared data table; the address keeps where you were.
  const roster = useQuery(orgComputersQuery(""));
  const control = useTableState({ size: 25, sort: "company" }, { filters: ["company", "state"] });
  const [company, setCompany] = filterOf(control, "company");
  const [state, setState] = filterOf(control, "state");
  const [backupOpen, setBackupOpen] = useState(false);
  const canView = me.permissions.includes("agents.own") || me.permissions.includes("assistants.use") || me.permissions.includes("members.manage") || me.permissions.includes("team.manage");

  const list = useMemo(() => roster.data?.computers ?? [], [roster.data]);
  const companies = useMemo(() => [...new Set(list.map((c) => c.company || ""))].sort((a, b) => a.localeCompare(b)), [list]);
  const rows = useMemo(() => list.filter((c) =>
    (!company || (c.company || "") === (company === "none" ? "" : company))
    && (!state || (state === "paused" ? c.paused : state === "online" ? c.online && !c.paused : !c.online))), [list, company, state]);
  const online = list.filter((c) => c.online).length;
  const status = (c: StaffComputer) => (c.paused ? t("Paused") : c.online ? t("Online") : t("Offline"));

  const columns: Column<StaffComputer>[] = [
    {
      id: "name", header: t("Computer"), sortValue: (c) => c.name.toLowerCase(), card: "title",
      cell: (c) => {
        const OsIcon = OS_ICON[c.os] ?? DesktopTowerIcon;
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="relative shrink-0">
              <IconTile icon={OsIcon} tone="neutral" size="sm" />
              <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface", c.paused ? "bg-warn" : c.online ? "bg-ok" : "bg-border")} />
            </span>
            <span className="grid min-w-0">
              <span className="text-[13.5px] font-semibold break-words">{c.name}</span>
              {c.hostname ? <span className="text-[12px] break-all text-muted">{c.hostname}</span> : null}
            </span>
          </span>
        );
      },
    },
    {
      id: "state", header: t("Status"), sortValue: (c) => (c.paused ? 1 : c.online ? 0 : 2),
      cell: (c) => <Pill tone={c.paused ? "warn" : c.online ? "ok" : "neutral"} live={c.online && !c.paused}>{status(c)}</Pill>,
    },
    {
      id: "person", header: t("Linked by"), sortValue: (c) => c.person.name.toLowerCase(),
      cell: (c) => (
        <span className="grid min-w-0">
          <span className="break-words">{c.person.name}</span>
          <span className="text-[12px] break-all text-muted">{c.person.email}</span>
        </span>
      ),
    },
    { id: "company", header: t("Company"), sortValue: (c) => c.company || null, cell: (c) => c.company || <span className="text-muted">{t("No company")}</span> },
    { id: "os", header: t("System"), sortValue: osName, hideBelow: "xl", cell: osName },
    {
      id: "seen", header: t("Last seen"), kind: "date", hideBelow: "lg",
      sortValue: (c) => (c.online ? "9999" : c.last_seen_at ?? null),
      cell: (c) => (c.online ? <span className="text-ok">{t("Now")}</span> : c.last_seen_at ? <span className="text-muted">{timeAgo(c.last_seen_at)}</span> : <span className="text-muted">-</span>),
    },
    {
      id: "folders", header: t("Folders"), sortValue: (c) => c.folders.length, kind: "number", hideBelow: "xl",
      cell: (c) => (
        <span className="text-[12.5px] text-muted">
          {c.folders.length ? t("Shares {n} folders", { n: c.folders.length }) : t("No folders shared")}
          {c.remote && c.remote !== "off" ? ` · ${c.remote === "control" ? t("Remote control on") : t("Remote view on")}` : ""}
        </span>
      ),
    },
  ];

  return (
    <Page wide>
      <PageHeader
        title={t("Staff computers")}
        description={t("Every company computer your staff have linked: who linked it, whether it is online, and the folders it shares. Open one to see its screen and fetch files — the computer shows a notice while you do.")}
        actions={roster.data?.can_backup ? (
          <>
            <Button asChild variant="outline"><Link to="/web-connections"><GlobeIcon size={16} /> {t("Web connections")}</Link></Button>
            <Button variant="outline" onClick={() => setBackupOpen(true)}><ArchiveBoxIcon size={16} /> {t("Backup settings")}</Button>
          </>
        ) : undefined}
      />

      {!roster.isLoading && list.length ? (
        <p className="text-[12.5px] text-muted">{t("{n} computers · {online} online", { n: list.length.toLocaleString(locale()), online })}</p>
      ) : null}

      {!roster.isLoading && !roster.error && !list.length ? (
        <EmptyState icon={DesktopTowerIcon} title={t("No computers linked yet")}
          body={t("Staff link a company computer from My computers. Once linked, it shows here.")}
          action={<Button asChild variant="outline"><Link to="/computers" search={{ link: 1 }}><DesktopTowerIcon size={16} /> {t("Link my own computer")}</Link></Button>} />
      ) : (
        <DataTable
          label={t("Staff computers")}
          columns={columns}
          rows={rows}
          rowId={(c) => c.id}
          rowLabel={(c) => c.name}
          control={control}
          loading={roster.isLoading}
          error={roster.error}
          onRetry={() => void roster.refetch()}
          searchText={(c) => `${c.name} ${c.hostname ?? ""} ${c.person.name} ${c.person.email} ${c.company}`}
          searchPlaceholder={t("Search by person, company or computer")}
          filters={
            <>
              {companies.length > 1 ? (
                <Select className="w-full sm:w-48" label={t("Company")} value={company || ALL} onValueChange={(v) => setCompany(v === ALL ? "" : v)}
                  options={[{ value: ALL, label: t("All companies") }, ...companies.map((c) => (c ? { value: c, label: c } : { value: "none", label: t("No company") }))]} />
              ) : null}
              <Select className="w-full sm:w-40" label={t("Status")} value={state || ALL} onValueChange={(v) => setState(v === ALL ? "" : v)}
                options={[{ value: ALL, label: t("All statuses") }, { value: "online", label: t("Online") }, { value: "offline", label: t("Offline") }, { value: "paused", label: t("Paused") }]} />
            </>
          }
          actions={canView ? (c) => (
            <Button size="sm" variant="outline" asChild>
              <Link to="/computers/$deviceId/remote" params={{ deviceId: c.id }} search={{ staff: "1" } as never} aria-label={t("Open {name}", { name: c.name })}>
                <MonitorPlayIcon size={15} /> {t("Open")}
              </Link>
            </Button>
          ) : undefined}
        />
      )}

      {backupOpen ? <BackupDialog onClose={() => setBackupOpen(false)} /> : null}
    </Page>
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
