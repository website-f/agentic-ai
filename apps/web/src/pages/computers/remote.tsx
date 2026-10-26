/** P42: a person's own computer, reached from the web while they are away — the way AnyDesk or
 * a remote desktop works, but only for your OWN computers, and only as far as each one allows.
 *
 * Three things, each behind its own lock:
 *  - Health: how the computer is doing (always, when it is online).
 *  - Files: browse the shared folders and download a file (the same folders the AI may see).
 *  - Screen: see the screen live, and — with control on — use its mouse and keyboard.
 *
 * Two switches must both allow a level: `agentic-pc remote view|control` on the computer, and
 * the toggle here (which asks for the person's password). The computer shows a notice on its own
 * screen while it is watched or used. Owner only: the route is already behind agents.own /
 * assistants.use, and the API refuses anyone but the computer's own person.
 */
import {
  ArrowClockwiseIcon, ArrowLeftIcon, CaretRightIcon, CheckCircleIcon, CopyIcon, CpuIcon, CursorClickIcon, DownloadSimpleIcon, FileIcon,
  FolderSimpleIcon, HardDriveIcon, HouseIcon, KeyboardIcon, LockKeyIcon, MemoryIcon, MonitorPlayIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { msg, useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import {
  bytes, deviceFiles, deviceHealth, deviceKeys, devicesQuery, downloadFromDevice, keyOf, remoteBlock,
  screenFrame, sendInput, setRemote, type Device, type DeviceFile, type RemoteLevel,
} from "@/lib/devices";
import { cn, timeAgo } from "@/lib/utils";

export function RemotePage() {
  const t = useT();
  const navigate = useNavigate();
  const { deviceId } = useParams({ from: "/app/computers/$deviceId/remote" });
  const { data: devices } = useSuspenseQuery(devicesQuery);
  const device = devices.find((d) => d.id === deviceId);

  useEffect(() => {
    if (devices.length && !device) void navigate({ to: "/computers", replace: true });
  }, [devices.length, device, navigate]);

  if (!device) return null;

  return (
    <Page wide>
      <PageHeader icon={MonitorPlayIcon} eyebrow={t("My computers")}
        title={t("{name} — from the web", { name: device.name })}
        description={t("See how this computer is doing, open its shared folders, and — when you turn it on — watch its screen and use it, from anywhere.")}
        actions={<Button variant="outline" asChild><Link to="/computers"><ArrowLeftIcon size={15} /> {t("All computers")}</Link></Button>} />

      {!device.online ? (
        <Card className="flex items-center gap-3 px-4 py-3.5 text-[13.5px]">
          <WarningIcon size={18} weight="duotone" className="shrink-0 text-warn" />
          <span>{t("This computer is offline. It must be on, signed in, and connected for you to reach it. Last seen {when}.", { when: timeAgo(device.last_seen_at) })}</span>
        </Card>
      ) : device.paused ? (
        <Card className="flex items-center gap-3 px-4 py-3.5 text-[13.5px]">
          <WarningIcon size={18} weight="duotone" className="shrink-0 text-warn" />
          <span>{t("This computer is paused. Resume it on the My computers page to reach it.")}</span>
        </Card>
      ) : (
        <>
          <HealthCard device={device} />
          <FilesCard device={device} />
          <ScreenCard device={device} />
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- health

function HealthCard({ device }: { device: Device }) {
  const t = useT();
  const health = useQuery({
    queryKey: deviceKeys.health(device.id),
    queryFn: () => deviceHealth(device.id),
    refetchInterval: 15_000,
    retry: false,
  });

  return (
    <Section title={t("How it is doing")}
      actions={<Button size="sm" variant="ghost" onClick={() => health.refetch()} loading={health.isFetching}><ArrowClockwiseIcon size={14} /> {t("Refresh")}</Button>}>
      {health.isLoading ? (
        <p className="text-[13px] text-muted">{t("Asking the computer…")}</p>
      ) : health.error ? (
        <p role="alert" className="text-[13px] text-danger">{errorMessage(health.error)}</p>
      ) : health.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Meter icon={CpuIcon} label={t("Processor")} value={health.data.cpu?.busy_pct != null ? `${health.data.cpu.busy_pct}%` : "—"}
            pct={health.data.cpu?.busy_pct ?? null} hint={health.data.cpu?.cores ? t("{n} cores", { n: health.data.cpu.cores }) : undefined} />
          <Meter icon={MemoryIcon} label={t("Memory")}
            value={health.data.memory ? `${bytes(health.data.memory.total - health.data.memory.free)} / ${bytes(health.data.memory.total)}` : "—"}
            pct={health.data.memory ? Math.round(100 * (1 - health.data.memory.free / health.data.memory.total)) : null} />
          {(health.data.disks ?? []).slice(0, 1).map((d) => (
            <Meter key={d.path} icon={HardDriveIcon} label={t("Disk ({path})", { path: d.path })}
              value={`${bytes(d.total - d.free)} / ${bytes(d.total)}`} pct={d.total ? Math.round(100 * (1 - d.free / d.total)) : null} />
          ))}
          <div className="grid content-start gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-3 text-[12.5px] text-muted">
            <span>{t("Signed in as {user}", { user: health.data.user || "—" })}</span>
            {health.data.uptime_s != null ? <span>{t("On for {time}", { time: forDuration(health.data.uptime_s, t) })}</span> : null}
            {health.data.version ? <span>{t("Agent {version}", { version: health.data.version })}</span> : null}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function Meter({ icon: Icon, label, value, pct, hint }: { icon: typeof CpuIcon; label: string; value: string; pct: number | null; hint?: string }) {
  const high = pct != null && pct >= 90;
  return (
    <div className="grid content-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted"><Icon size={15} weight="duotone" /> {label}</span>
      </div>
      <span className="text-[15px] font-semibold tabular">{value}</span>
      {pct != null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={cn("h-full rounded-full", high ? "bg-danger" : "bg-accent")} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </div>
      ) : null}
      {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
    </div>
  );
}

function forDuration(seconds: number, t: ReturnType<typeof useT>): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return t("{d}d {h}h", { d, h });
  if (h) return t("{h}h {m}m", { h, m });
  return t("{m}m", { m });
}

// ---------------------------------------------------------------- files

function FilesCard({ device }: { device: Device }) {
  const t = useT();
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // No path chosen yet: the shared folders are the starting points.
  const files = useQuery({
    queryKey: deviceKeys.files(device.id, path, query),
    queryFn: () => deviceFiles(device.id, path, query),
    enabled: !!path || !!query,
    retry: false,
  });

  const roots = device.folders;
  const open = (f: DeviceFile) => { if (f.is_dir) { setQuery(""); setPath(f.path); } };
  const download = async (f: DeviceFile) => {
    setBusy(f.path);
    try {
      await downloadFromDevice(device.id, f.path);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const items = files.data?.items ?? [];

  return (
    <Section title={t("Files")}
      description={t("The same folders your AI may see. Open a folder, or search by name, then download what you need.")}>
      <Card className="grid gap-3 p-3.5 sm:p-4">
        {/* where you are + search */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={path || query ? "ghost" : "outline"} onClick={() => { setPath(""); setQuery(""); }}>
            <HouseIcon size={14} /> {t("Shared folders")}
          </Button>
          {path ? (
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[12px] text-muted">
              <CaretRightIcon size={11} /> <span className="min-w-0 truncate">{path}</span>
            </span>
          ) : null}
          <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); }}>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPath(""); }}
              placeholder={t("Search files by name…")} spellCheck={false}
              className="h-9 w-48 rounded-sm border border-border bg-surface px-3 text-[13px] focus-visible:border-accent focus-visible:outline-none" />
          </form>
        </div>

        {/* the list */}
        {!path && !query ? (
          <ul className="grid gap-1.5">
            {roots.length ? roots.map((f) => (
              <li key={f}>
                <button type="button" onClick={() => setPath(f)}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-sm border border-border px-3 text-left hover:border-accent/40 hover:bg-surface-2">
                  <FolderSimpleIcon size={17} weight="duotone" className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{f}</span>
                  <CaretRightIcon size={13} className="shrink-0 text-muted" />
                </button>
              </li>
            )) : <li className="px-1 py-2 text-[13px] text-muted">{t("No folders are shared on this computer yet.")}</li>}
          </ul>
        ) : files.isLoading ? (
          <p className="px-1 py-2 text-[13px] text-muted">{t("Loading…")}</p>
        ) : files.error ? (
          <p role="alert" className="px-1 py-2 text-[13px] text-danger">{errorMessage(files.error)}</p>
        ) : !items.length ? (
          <p className="px-1 py-2 text-[13px] text-muted">{query ? t("No files match “{q}”.", { q: query }) : t("This folder is empty.")}</p>
        ) : (
          <ul className="grid min-w-0 divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
            {items.slice(0, 200).map((f) => (
              <li key={f.path} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                {f.is_dir
                  ? <FolderSimpleIcon size={16} weight="duotone" className="shrink-0 text-accent" />
                  : <FileIcon size={16} weight="duotone" className="shrink-0 text-muted" />}
                {f.is_dir ? (
                  <button type="button" onClick={() => open(f)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent">{f.name}</button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
                )}
                {!f.is_dir ? <span className="shrink-0 text-[11.5px] text-muted tabular">{bytes(f.size)}</span> : null}
                {!f.is_dir ? (
                  <Button size="icon-sm" variant="ghost" loading={busy === f.path} onClick={() => download(f)} aria-label={t("Download {name}", { name: f.name })}>
                    <DownloadSimpleIcon size={15} />
                  </Button>
                ) : <span className="inline-block size-8" />}
              </li>
            ))}
            {files.data?.truncated ? <li className="px-3 py-2 text-[12px] text-muted">{t("Showing the first results. Search to narrow them.")}</li> : null}
          </ul>
        )}
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------- screen + control

function ScreenCard({ device }: { device: Device }) {
  const t = useT();
  const level = device.remote ?? "off";
  const canView = level === "view" || level === "control";
  const canControl = level === "control";

  const [live, setLive] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [screen, setScreen] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [err, setErr] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const urlRef = useRef<string | null>(null);

  // Poll one JPEG after another while live. Each frame waits for the last, so a slow computer
  // simply updates less often instead of piling up requests.
  useEffect(() => {
    if (!live || !canView) return;
    let stop = false;
    const control = new AbortController();
    (async () => {
      while (!stop) {
        try {
          const { blob, w, h } = await screenFrame(device.id, 1440, 60, control.signal);
          if (stop) break;
          const url = URL.createObjectURL(blob);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = url;
          setFrame(url);
          if (w && h) setScreen({ w, h });
          setErr(null);
        } catch (e) {
          if (stop || (e instanceof DOMException && e.name === "AbortError")) break;
          setErr(errorMessage(e));
          setLive(false);
          break;
        }
      }
    })();
    return () => { stop = true; control.abort(); };
  }, [live, canView, device.id]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // A click on the picture → the same spot on the real screen, as a share of width and height.
  const point = (e: React.MouseEvent): { x: number; y: number } | null => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };

  const act = useMutation({ mutationFn: (body: Parameters<typeof sendInput>[1]) => sendInput(device.id, body) });
  const send = (body: Parameters<typeof sendInput>[1]) => {
    if (!canControl) return;
    act.mutate(body, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const onClick = (e: React.MouseEvent, action: "click" | "double" | "right") => {
    if (!canControl) return;
    e.preventDefault();
    const p = point(e);
    if (p) send({ kind: "mouse", ...p, action });
    surface.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!canControl) return;
    const mapped = keyOf(e);
    if (!mapped) return;
    e.preventDefault();
    send({ kind: "key", ...mapped });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!canControl) return;
    send({ kind: "mouse", x: 0.5, y: 0.5, action: "scroll", dy: e.deltaY > 0 ? 1 : -1 });
  };

  const ready = canView;
  return (
    <Section title={t("Screen")}
      description={!ready ? t("Watch this computer's screen live from anywhere, and use its mouse and keyboard. Two quick steps turn it on.")
        : canControl ? t("Watch the screen and use the mouse and keyboard. A notice shows on the computer while you do.")
        : t("Watch the screen live. A notice shows on the computer while you watch.")}
      actions={ready ? <RemoteSwitch device={device} /> : null}>
      {!ready ? <RemoteSetup device={device} /> : (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => { setErr(null); setLive((v) => !v); }} variant={live ? "outline" : "primary"}>
              {live ? t("Stop") : t("Start watching")}
            </Button>
            {canControl ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><CursorClickIcon size={14} /> {t("Click the screen to click. Type to send keys.")}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">{t("Viewing only. Choose Full control above to use the mouse and keyboard.")}</span>
            )}
            {live ? <Pill tone="ok" live className="ml-auto">{t("Live")}</Pill> : null}
          </div>

          {err ? <p role="alert" className="text-[13px] text-danger">{err}</p> : null}

          <div
            ref={surface}
            tabIndex={canControl ? 0 : -1}
            role={canControl ? "application" : undefined}
            aria-label={canControl ? t("Remote screen: click and type to control") : undefined}
            onClick={(e) => onClick(e, "click")}
            onDoubleClick={(e) => onClick(e, "double")}
            onContextMenu={(e) => onClick(e, "right")}
            onKeyDown={onKey}
            onWheel={onWheel}
            className={cn(
              "relative grid aspect-video w-full place-items-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-[#0b0f1a]",
              canControl && "cursor-crosshair focus-visible:outline-2 focus-visible:outline-accent",
            )}
            style={screen.w && screen.h ? { aspectRatio: `${screen.w} / ${screen.h}` } : undefined}
          >
            {frame ? (
              <img src={frame} alt={t("The computer's screen")} className="h-full w-full object-contain" draggable={false} />
            ) : (
              <span className="text-[13px] text-muted">{live ? t("Waiting for the first picture…") : t("Press Start watching.")}</span>
            )}
          </div>

          {canControl ? (
            <div className="flex flex-wrap gap-1.5">
              {([["Enter", "enter"], ["Esc", "esc"], ["Tab", "tab"], ["Backspace", "backspace"], ["↑", "up"], ["↓", "down"], ["Alt+Tab", "alt+tab"], ["Win/Cmd", "cmd"]] as const).map(([label, key]) => (
                <button key={key} type="button" onClick={() => send({ kind: "key", key })}
                  className="inline-flex min-h-8 items-center gap-1 rounded-sm border border-border px-2.5 text-[12px] font-medium hover:border-accent/40 hover:text-accent">
                  <KeyboardIcon size={12} /> {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- turning it on (two locks)

const LEVEL_LABEL: Record<RemoteLevel, string> = { off: msg("Off"), view: msg("See screen"), control: msg("Full control") };

/** Turning a level on here asks for the person's password; turning it off never does. */
function useRemoteChange(device: Device) {
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Exclude<RemoteLevel, "off"> | null>(null);
  const [password, setPassword] = useState("");
  const change = useMutation({
    mutationFn: ({ level, pw }: { level: RemoteLevel; pw: string }) => setRemote(device.id, level, pw),
    onSuccess: (next) => {
      qc.setQueryData<Device[]>(deviceKeys.list, (list) => list?.map((d) => (d.id === next.id ? { ...d, ...next } : d)));
      void qc.invalidateQueries({ queryKey: deviceKeys.list });
      setAsk(null);
      setPassword("");
    },
  });
  const choose = (level: RemoteLevel) => {
    if (level === "off") change.mutate({ level, pw: "" });
    else setAsk(level);
  };
  return { ask, setAsk, password, setPassword, change, choose };
}

function PasswordDialog({ state }: { state: ReturnType<typeof useRemoteChange> }) {
  const t = useT();
  const { ask, setAsk, password, setPassword, change } = state;
  const close = () => { setAsk(null); setPassword(""); change.reset(); };
  return (
    <ResponsiveDialog open={!!ask} onOpenChange={(o) => { if (!o) close(); }}
      title={ask === "control" ? t("Allow full control from the web") : t("Allow seeing the screen from the web")}
      description={ask === "control"
        ? t("You will be able to see this computer's screen and use its mouse and keyboard from any browser you are signed in on. The computer shows a notice while you do. Enter your password to confirm.")
        : t("You will be able to watch this computer's screen from any browser you are signed in on. The computer shows a notice while you watch. Enter your password to confirm.")}
      footer={<>
        <Button variant="outline" onClick={close}>{t("Cancel")}</Button>
        <Button loading={change.isPending} disabled={!password}
          onClick={() => ask && change.mutate({ level: ask, pw: password })}>{t("Turn it on")}</Button>
      </>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ask && password) change.mutate({ level: ask, pw: password }); }}>
        <Field label={t("Your password")} type="password" autoFocus value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} />
        <FormError message={change.error ? (change.error instanceof ApiError ? change.error.message : errorMessage(change.error)) : null} />
      </form>
    </ResponsiveDialog>
  );
}

/** Once both steps are done: switch between off, seeing and full control (up to what the
 * computer allows). */
function RemoteSwitch({ device }: { device: Device }) {
  const t = useT();
  const state = useRemoteChange(device);
  const current = device.remote_allowed ?? "off";
  const allows = (lvl: RemoteLevel) => remoteBlock(device, lvl === "off" ? "view" : lvl) !== "pc" || lvl === "off";
  return (
    <>
      <div role="radiogroup" aria-label={t("Remote access")} className="flex items-center gap-1 rounded-full border border-border bg-surface p-0.5">
        {(["off", "view", "control"] as const).filter(allows).map((lvl) => (
          <button key={lvl} type="button" role="radio" aria-checked={current === lvl} onClick={() => current !== lvl && state.choose(lvl)}
            disabled={state.change.isPending}
            className={cn("min-h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors",
              current === lvl ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}>
            {t(LEVEL_LABEL[lvl])}
          </button>
        ))}
      </div>
      <PasswordDialog state={state} />
    </>
  );
}

/** Not on yet: the two steps, each with where it stands and what to do. The first is done on
 * the computer itself, on purpose: a stolen password alone must never be enough to watch
 * someone's screen. */
function RemoteSetup({ device }: { device: Device }) {
  const t = useT();
  const state = useRemoteChange(device);
  const pc = device.remote_pc ?? "off";
  const web = device.remote_allowed ?? "off";
  const pcDone = pc !== "off";
  const shell = device.os === "windows" ? t("PowerShell (press Start, type PowerShell)") : t("Terminal");
  return (
    <Card className="grid gap-0 overflow-hidden p-0">
      <ol className="grid divide-y divide-border">
        <li className="grid gap-3 p-4 sm:grid-cols-[2rem_minmax(0,1fr)] sm:p-5">
          <StepMark n={1} done={pcDone} />
          <div className="grid min-w-0 gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14.5px] font-semibold">{t("Allow it on the computer (once)")}</h3>
              <Pill tone={pcDone ? "ok" : "warn"}>{pcDone ? t("Allowed: {level}", { level: t(LEVEL_LABEL[pc]) }) : t("Not allowed yet")}</Pill>
            </div>
            {pcDone ? (
              <p className="text-[13px] text-muted">{t("Done. To take it back, run agentic-pc remote off on the computer.")}</p>
            ) : (
              <>
                <p className="text-[13px] text-muted">
                  {t("On {name}, open {shell} and run this line. Do it before you travel: it stays on until you turn it off.", { name: device.name, shell })}
                </p>
                <CommandLine text="agentic-pc remote control" />
                <p className="text-[12.5px] text-muted">
                  {t("Only want to watch, never click? Use agentic-pc remote view instead. If the computer says it does not know agentic-pc, close and reopen the window and try again.")}
                </p>
                <div className="flex items-start gap-2 rounded-sm border border-info/30 bg-info/8 px-3 py-2 text-[12.5px]">
                  <LockKeyIcon size={15} weight="duotone" className="mt-0.5 shrink-0 text-info" />
                  <span>{t("Why on the computer? So that someone who learns your password still cannot watch your screen. This page ticks itself the moment the computer says yes.")}</span>
                </div>
              </>
            )}
          </div>
        </li>
        <li className={cn("grid gap-3 p-4 sm:grid-cols-[2rem_minmax(0,1fr)] sm:p-5", !pcDone && "opacity-60")}>
          <StepMark n={2} done={web !== "off"} />
          <div className="grid min-w-0 gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14.5px] font-semibold">{t("Turn it on here")}</h3>
              <Pill tone={web !== "off" ? "ok" : "neutral"}>{web !== "off" ? t("On: {level}", { level: t(LEVEL_LABEL[web]) }) : t("Off")}</Pill>
            </div>
            <p className="text-[13px] text-muted">{t("Choose what you want to do from the web. You confirm with your password.")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!pcDone} onClick={() => state.choose("view")}>
                <MonitorPlayIcon size={15} /> {t("See the screen")}
              </Button>
              <Button disabled={pc !== "control"} onClick={() => state.choose("control")}>
                <CursorClickIcon size={15} /> {t("See and use it (full control)")}
              </Button>
            </div>
            {pcDone && pc === "view" ? <p className="text-[12.5px] text-muted">{t("Full control needs agentic-pc remote control on the computer.")}</p> : null}
          </div>
        </li>
      </ol>
      <PasswordDialog state={state} />
    </Card>
  );
}

function StepMark({ n, done }: { n: number; done: boolean }) {
  return done ? (
    <CheckCircleIcon size={28} weight="fill" className="text-ok" aria-hidden />
  ) : (
    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent tabular">{n}</span>
  );
}

function CommandLine({ text }: { text: string }) {
  const t = useT();
  const copy = () => {
    if (!navigator.clipboard) return toast.error(t("Copy blocked by the browser."));
    void navigator.clipboard.writeText(text).then(() => toast.success(t("Copied.")), () => toast.error(t("Copy blocked by the browser.")));
  };
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-[#0f172a] px-3.5 py-2.5 font-mono text-[13px] text-[#e2e8f0]"><code>{text}</code></pre>
      <Button variant="outline" className="h-auto" onClick={copy} aria-label={t("Copy the command")}><CopyIcon size={15} /> <span className="max-sm:hidden">{t("Copy")}</span></Button>
    </div>
  );
}
