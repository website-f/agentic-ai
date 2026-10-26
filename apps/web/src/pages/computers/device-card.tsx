/** One linked computer: its name (rename in place), whether it is on, its browsers, pause,
 * the folders the AI may look in, what the AI did on it, and Unlink. */
import {
  WarningCircleIcon,
  AppleLogoIcon, BrowserIcon, CaretRightIcon, CheckIcon, CursorClickIcon, DownloadSimpleIcon, FileArrowDownIcon, FileArrowUpIcon,
  FileTextIcon, FolderOpenIcon, FolderPlusIcon, FolderSimpleIcon, GearSixIcon, GoogleChromeLogoIcon, LinkBreakIcon, LinuxLogoIcon,
  MagnifyingGlassIcon, MonitorPlayIcon, PencilSimpleIcon, PlusIcon, PulseIcon, ScreencastIcon, WindowsLogoIcon, XIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  activityError, activityKind, activityQuery, activityTarget, activityTime, defaultFolders, deviceKeys, folderName, folderProblem, normalizeFolder,
  unlinkDevice, updateDevice, type ActivityKind, type Device, type DevicePatch, type FolderProblem,
} from "@/lib/devices";
import { cn, timeAgo } from "@/lib/utils";

const PROBLEM: Record<FolderProblem, string> = {
  empty: msg("Type or paste a folder."),
  not_absolute: msg("Use the full path, e.g. C:\\Users\\you\\Documents on Windows, /Users/you/Documents on a Mac or /home/you/Documents on Linux."),
  wrong_os: msg("That path is for the other kind of computer."),
  too_wide: msg("That is a whole disk. Pick a folder inside it."),
  dots: msg("Write the folder's full path without . or .."),
  blocked: msg("That folder holds passwords or keys, so it is always refused."),
  duplicate: msg("That folder is already on the list."),
};

const KIND_ICON: Record<ActivityKind, Icon> = {
  search: MagnifyingGlassIcon,
  list: FolderOpenIcon,
  read: FileTextIcon,
  copy: FileArrowUpIcon,
  save: FileArrowDownIcon,
  download: DownloadSimpleIcon,
  browse: BrowserIcon,
  screen: ScreencastIcon,
  control: CursorClickIcon,
  settings: GearSixIcon,
  other: PulseIcon,
};

const KIND_LABEL: Record<ActivityKind, string> = {
  search: msg("Searched for files"),
  list: msg("Looked in a folder"),
  read: msg("Read a file"),
  copy: msg("Copied a file to your workspace"),
  save: msg("Saved a file to the computer"),
  download: msg("You downloaded a file from the web"),
  browse: msg("Browsed"),
  screen: msg("You viewed the screen from the web"),
  control: msg("You used the mouse and keyboard from the web"),
  settings: msg("Settings changed"),
  other: msg("Checked the computer"),
};

const ERROR_LABEL: Record<string, string> = {
  paused: msg("Paused"),
  not_allowed: msg("Outside your folders"),
  not_found: msg("Not found"),
  too_big: msg("Too big"),
  no_browser: msg("No browser"),
  busy: msg("Busy"),
  offline: msg("Offline"),
  timeout: msg("No answer"),
  revoked: msg("Unlinked"),
  no_screen: msg("No screen"),
  failed: msg("Failed"),
};

const BROWSER: Record<string, { label: string; icon: Icon }> = {
  chrome: { label: "Chrome", icon: GoogleChromeLogoIcon },
  edge: { label: "Edge", icon: BrowserIcon },
};

export function DeviceCard({ device, focus, onFocused }: { device: Device; focus?: boolean; onFocused?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const card = useRef<HTMLDivElement>(null);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const [folder, setFolder] = useState("");
  const [problem, setProblem] = useState<FolderProblem | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  // Opened from "Set the folders": bring the card into view and the folder box into focus.
  useEffect(() => {
    if (!focus) return;
    card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const id = setTimeout(() => document.getElementById(`add-folder-${device.id}`)?.focus({ preventScroll: true }), 400);
    onFocused?.();
    return () => clearTimeout(id);
  }, [focus, onFocused, device.id]);

  const save = useMutation({
    mutationFn: (patch: DevicePatch) => updateDevice(device.id, patch),
    onSuccess: (next) => {
      if (next && typeof next === "object" && "id" in next) {
        qc.setQueryData<Device[]>(deviceKeys.list, (list) => list?.map((d) => (d.id === next.id ? { ...d, ...next } : d)));
      }
      void qc.invalidateQueries({ queryKey: deviceKeys.list });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const activity = useQuery({ ...activityQuery(device.id), enabled: showActivity });

  const OsIcon = device.os === "mac" ? AppleLogoIcon : device.os === "linux" ? LinuxLogoIcon : WindowsLogoIcon;
  const suggestions = defaultFolders(device).filter((f) => folderProblem(f, device.os, device.folders) === null);

  const rename = () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== device.name) save.mutate({ name: next.slice(0, 80) });
    else setName(device.name);
  };

  const addFolder = (raw: string) => {
    const path = normalizeFolder(raw, device.home);
    const why = folderProblem(path, device.os, device.folders);
    setProblem(why);
    if (why) return;
    save.mutate({ folders: [...device.folders, path] }, {
      onSuccess: () => {
        setFolder("");
        toast.success(t("{folder} added.", { folder: folderName(path) }));
      },
    });
  };

  const removeFolder = (path: string) => save.mutate({ folders: device.folders.filter((f) => f !== path) });

  const unlink = async () => {
    try {
      await unlinkDevice(device.id);
      qc.setQueryData<Device[]>(deviceKeys.list, (list) => list?.filter((d) => d.id !== device.id));
      void qc.invalidateQueries({ queryKey: deviceKeys.list });
      toast.success(t("{name} is unlinked.", { name: device.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const state = device.paused
    ? { tone: "warn" as const, label: t("Paused") }
    : device.online ? { tone: "ok" as const, label: t("Online") } : { tone: "neutral" as const, label: t("Offline") };

  return (
    <div ref={card} id={`device-${device.id}`} data-guide="computers.device" className="min-w-0 scroll-mt-20">
      <Card>
        {/* ---- who it is */}
        <div className="flex min-w-0 flex-wrap items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <span className="relative">
            <IconTile icon={OsIcon} tone="neutral" />
            <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface",
              device.paused ? "bg-warn" : device.online ? "bg-ok" : "bg-border")} />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            {renaming ? (
              <form className="flex min-w-0 items-center gap-2" onSubmit={(e) => { e.preventDefault(); rename(); }}>
                <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label={t("Computer name")}
                  onKeyDown={(e) => { if (e.key === "Escape") { setName(device.name); setRenaming(false); } }} className="h-9 max-w-xs" />
                <Button type="submit" size="icon-sm" aria-label={t("Save")}><CheckIcon size={15} weight="bold" /></Button>
              </form>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="min-w-0 truncate text-[15.5px] font-semibold">{device.name}</h2>
                <button type="button" onClick={() => setRenaming(true)} aria-label={t("Rename {name}", { name: device.name })}
                  className="grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg">
                  <PencilSimpleIcon size={14} />
                </button>
              </div>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
              <Pill tone={state.tone} live={device.online && !device.paused}>{state.label}</Pill>
              {!device.online ? <span>{t("Last seen {when}", { when: timeAgo(device.last_seen_at) })}</span> : null}
              <span>{device.os === "mac" ? "macOS" : device.os === "linux" ? "Linux" : "Windows"}{device.os_version ? ` ${device.os_version}` : ""}</span>
              {device.version ? <span>{t("Agent {version}", { version: device.version })}</span> : null}
            </div>
          </div>
          <Link to="/computers/$deviceId/remote" params={{ deviceId: device.id }}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-[13px] font-medium hover:border-accent/40 hover:text-accent">
            <MonitorPlayIcon size={15} /> {t("Open from the web")}
          </Link>
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setUnlinking(true)}>
            <LinkBreakIcon size={15} /> {t("Unlink")}
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-4 sm:p-5">
          {!device.online ? <OfflineHelp device={device} /> : null}
          {/* ---- pause + browsers */}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <SwitchField checked={device.paused} onCheckedChange={(paused) => save.mutate({ paused })} disabled={save.isPending}
              label={t("Paused")} hint={t("While paused, your AI cannot use this computer at all.")} />
            <div className="grid content-start gap-1.5">
              <span className="text-[13.5px] font-medium">{t("Browsers it can use")}</span>
              {device.browsers.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {device.browsers.map((b) => {
                    const known = BROWSER[b.toLowerCase()];
                    const BIcon = known?.icon ?? BrowserIcon;
                    return (
                      <span key={b} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/60 px-2.5 py-0.5 text-[12.5px]">
                        <BIcon size={14} className="text-accent" /> {known?.label ?? b}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12.5px] text-muted">{t("No Chrome or Edge found, so browsing on this computer is off.")}</p>
              )}
              <p className="text-[12px] text-muted">{t("It opens its own window with a separate profile, never yours.")}</p>
            </div>
          </div>

          {/* ---- folders */}
          <section data-guide="computers.folders" className="grid min-w-0 gap-2.5" aria-labelledby={`folders-${device.id}`}>
            <div>
              <h3 id={`folders-${device.id}`} className="text-[13.5px] font-semibold">{t("Folders")}</h3>
              <p className="text-[12.5px] text-muted">{t("Your AI can only look in these folders, and the folders inside them.")}</p>
            </div>
            {device.folders.length ? (
              <ul className="grid min-w-0 divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
                {device.folders.map((f) => (
                  <li key={f} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                    <FolderSimpleIcon size={16} weight="duotone" className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{f}</span>
                    <button type="button" onClick={() => removeFolder(f)} disabled={save.isPending} aria-label={t("Remove {name}", { name: f })}
                      className="grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50">
                      <XIcon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-3 text-[13px] text-muted">
                {t("No folders: your AI cannot see any file on this computer.")}
              </p>
            )}
            <form className="grid min-w-0 gap-1.5" onSubmit={(e) => { e.preventDefault(); addFolder(folder); }}>
              <label htmlFor={`add-folder-${device.id}`} className="text-[12.5px] font-medium">{t("Add a folder")}</label>
              <div className="flex min-w-0 gap-2">
                <Input id={`add-folder-${device.id}`} value={folder} className="min-w-0 font-mono text-[13px]"
                  onChange={(e) => { setFolder(e.target.value); setProblem(null); }}
                  placeholder={device.os === "mac" ? "/Users/you/Projects" : device.os === "linux" ? "/home/you/Projects" : "C:\\Users\\you\\Projects"}
                  aria-invalid={problem ? true : undefined} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
                <Button type="submit" variant="outline" loading={save.isPending && !!folder}><PlusIcon size={15} /> {t("Add")}</Button>
              </div>
              {problem ? <p role="alert" className="text-[12.5px] text-danger">{t(PROBLEM[problem])}</p> : (
                <p className="text-[12px] text-muted">
                  {device.os === "mac"
                    ? t("Tip: in Finder, right-click the folder, hold Option and choose Copy as Pathname.")
                    : device.os === "linux" ? t("Tip: in a terminal, cd to the folder and run pwd.")
                    : t("Tip: in File Explorer, right-click the folder and choose Copy as path.")}
                </p>
              )}
              {suggestions.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-muted">{t("Add back:")}</span>
                  {suggestions.map((f) => (
                    <button key={f} type="button" title={f} onClick={() => addFolder(f)} disabled={save.isPending}
                      className="inline-flex min-h-8 items-center gap-1 rounded-full border border-accent/30 bg-accent-soft/40 px-2.5 text-[12.5px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
                      <FolderPlusIcon size={14} /> {folderName(f)}
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          </section>

          {/* ---- activity */}
          <section data-guide="computers.activity" className="grid min-w-0 gap-2">
            <button type="button" onClick={() => setShowActivity((s) => !s)} aria-expanded={showActivity}
              className="flex min-h-9 items-center gap-2 justify-self-start rounded-sm text-[13.5px] font-semibold hover:text-accent">
              <CaretRightIcon size={13} weight="bold" className={cn("transition-transform", showActivity && "rotate-90")} /> {t("Recent activity")}
            </button>
            {showActivity ? (
              activity.isLoading ? <p className="text-[13px] text-muted">{t("Loading…")}</p>
              : activity.error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(activity.error)}</p>
              : !activity.data?.length ? (
                <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-3 text-[13px] text-muted">{t("Nothing yet. Everything your AI does on this computer shows here.")}</p>
              ) : (
                <ul className="grid min-w-0 divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
                  {activity.data.slice(0, 50).map((a) => {
                    const k = activityKind(a.kind);
                    const KIcon = KIND_ICON[k];
                    const target = activityTarget(a);
                    return (
                      <li key={String(a.id)} className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
                        <KIcon size={16} weight="duotone" className={cn("mt-0.5 shrink-0", a.ok ? "text-accent" : "text-danger")} />
                        <div className="grid min-w-0 flex-1 gap-0.5">
                          <span className="text-[13px] font-medium">{t(KIND_LABEL[k])}</span>
                          {target ? <span className="min-w-0 font-mono text-[12px] break-all text-muted">{target}</span> : null}
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                            {a.agent_id && a.agent_name ? (
                              <Link to="/agents/$agentId" params={{ agentId: a.agent_id }} className="font-medium text-fg hover:text-accent hover:underline">{a.agent_name}</Link>
                            ) : a.agent_name ? <span>{a.agent_name}</span> : null}
                            {a.task_id ? (
                              <Link to="/tasks" search={{ task: a.task_id }} className="min-w-0 truncate hover:text-accent hover:underline">{a.task_title || t("Open the task")}</Link>
                            ) : null}
                            <span>{timeAgo(activityTime(a))}</span>
                          </span>
                        </div>
                        <Pill tone={a.ok ? "ok" : "danger"} className="shrink-0">
                          {a.ok ? t("OK") : t(ERROR_LABEL[activityError(a)] ?? ERROR_LABEL.failed!)}
                        </Pill>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </section>
        </div>

        <ConfirmDialog open={unlinking} onOpenChange={setUnlinking} danger title={t("Unlink {name}?", { name: device.name })} confirmLabel={t("Unlink")}
          body={t("Your AI can no longer use this computer, and the program on it forgets this account at once. To use it again, link it with a new code.")}
          onConfirm={unlink} />
      </Card>
    </div>
  );
}

/** P52: what to do when a computer shows Offline, in order, for its kind of computer. */
function OfflineHelp({ device }: { device: Device }) {
  const t = useT();
  const old = !device.version || newer("0.3.0", device.version);
  const steps: ReactNode[] = [
    t("Is it switched on, awake and on the internet? A computer that sleeps shows Offline, and comes back by itself within a minute after it wakes."),
    device.os === "windows"
      ? t("On that computer, open Start → Agentic Office: it shows whether it is connected and has a Reconnect now button.")
      : t("On that computer, run agentic-pc doctor in a terminal: it checks everything and starts the agent if it stopped."),
    t("Restart the computer: the agent starts by itself when you sign in."),
    t("Still offline? Press Link a computer above and install again on that computer: the new install replaces this one."),
  ];
  return (
    <section className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-warn/30 bg-warn/5 p-3.5" aria-label={t("It shows Offline: what to do")}>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold"><WarningCircleIcon size={16} className="text-warn" /> {t("It shows Offline: what to do")}</h3>
      {old ? (
        <p className="text-[12.5px]">
          {t("This computer runs an older agent ({version}) that can stay offline after the office server restarts. Install it again (Link a computer) to get the version that always reconnects.", { version: device.version || "?" })}
        </p>
      ) : null}
      <ol className="grid gap-1.5 pl-5 text-[12.5px] [&>li]:list-decimal">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {device.os !== "windows" ? <code className="justify-self-start rounded-sm bg-surface-2 px-2 py-1 font-mono text-[12px]">agentic-pc doctor</code> : null}
    </section>
  );
}

/** a > b for dotted versions ("0.3.0" > "0.2.9"). */
function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}
