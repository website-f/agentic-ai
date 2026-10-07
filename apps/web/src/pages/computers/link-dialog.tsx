/** "Link a computer": a one-time code, then either the desktop app (with pictures of the
 * one-time "Run anyway" / "Open Anyway" step) or one command that installs and links in one
 * paste. Both watch the code and turn into "Linked" the moment the PC claims it. */
import {
  AppleLogoIcon, ArrowClockwiseIcon, CheckCircleIcon, CopyIcon, DownloadSimpleIcon, FolderOpenIcon,
  TerminalWindowIcon, TimerIcon, WindowsLogoIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  countdown, createLinkCode, detectOs, deviceKeys, devicesQuery, linkStatus, prettyCode, secondsLeft, type DeviceOs, type LinkCode,
} from "@/lib/devices";
import { cn } from "@/lib/utils";

import { MacGatekeeper, WindowsSmartScreen } from "./illustrations";

export function copyText(text: string) {
  const done = () => toast.success(tr("Copied."));
  const blocked = () => toast.error(tr("Copy blocked by the browser."));
  if (!navigator.clipboard) return blocked();
  void navigator.clipboard.writeText(text).then(done, blocked);
}

const OS_LABEL: Record<DeviceOs, string> = { windows: "Windows", mac: "Mac" };

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="grid gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex min-w-0 items-start gap-2.5 text-[13.5px]">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent tabular">{i + 1}</span>
          <span className="min-w-0 pt-0.5">{it}</span>
        </li>
      ))}
    </ol>
  );
}

export function LinkDialog({ onClose, onLinked }: { onClose: () => void; onLinked: (deviceId: string | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  // The one line is the way in; the desktop app only once a build is published (P31).
  const [pickedTab, setTab] = useState<"app" | "command">("command");
  const [os, setOs] = useState<DeviceOs>(() => {
    const mine = detectOs();
    return mine === "other" ? "windows" : mine;
  });
  const [now, setNow] = useState(() => Date.now());

  // ---- the code (asked for once on open; React's dev double-mount must not ask twice)
  const make = useMutation({ mutationFn: createLinkCode });
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    make.mutate();
  }, [make]);
  const link: LinkCode | undefined = make.data;
  const hasApp = !!link?.downloads;
  const tab = hasApp ? pickedTab : "command";
  const left = link ? secondsLeft(link.expires_at, now) : 0;
  const expired = !!link && left <= 0;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // ---- watch it: every 3 s, and at once on a device.status event (lib/live.ts)
  const status = useQuery({
    queryKey: deviceKeys.link(link?.code ?? ""),
    queryFn: () => linkStatus(link!.code),
    enabled: !!link,
    refetchInterval: (q) => (q.state.data?.status === "claimed" || q.state.data?.status === "expired" ? false : 3000),
    retry: false,
  });
  const claimed = status.data?.status === "claimed";
  const gone = expired || status.data?.status === "expired";

  useEffect(() => {
    if (claimed) void qc.invalidateQueries({ queryKey: deviceKeys.list });
  }, [claimed, qc]);
  // The status says which device; its name comes from the (refreshed) list.
  const { data: devices } = useQuery({ ...devicesQuery, enabled: claimed });
  const linked = devices?.find((d) => d.id === status.data?.device_id);

  const fresh = () => make.mutate();

  if (claimed) {
    const name = status.data?.device_name || linked?.name || t("your computer");
    return (
      <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Linked: {name}", { name })} className="w-[min(94vw,32rem)]"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>{t("Done")}</Button>
            <Button onClick={() => onLinked(status.data?.device_id ?? null)}><FolderOpenIcon size={16} /> {t("Set the folders")}</Button>
          </>
        }>
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <CheckCircleIcon size={48} weight="duotone" className="text-ok" />
          <p className="text-[15px] font-semibold">{t("Linked: {name}", { name })}</p>
          <p className="max-w-sm text-[13.5px] text-muted">
            {t("Your AI can now look in Documents, Desktop and Downloads on it. Pick other folders, or remove these, any time.")}
          </p>
        </div>
      </ResponsiveDialog>
    );
  }

  const codeRow = (
    <div className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-muted">{t("Your link code")}</p>
          {link ? (
            <p className={cn("font-mono text-[30px] leading-tight font-semibold tracking-[0.12em] tabular sm:text-[34px]", gone && "text-muted line-through")}>
              {prettyCode(link.code)}
            </p>
          ) : (
            <p className="h-10 w-48 animate-pulse rounded-sm bg-surface-2" aria-label={t("Loading…")} />
          )}
        </div>
        {link && !gone ? (
          <Button variant="outline" onClick={() => copyText(link.code)}><CopyIcon size={16} /> {t("Copy")}</Button>
        ) : null}
      </div>
      {link ? (
        gone ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-warn">{t("This code has expired.")}</p>
            <Button size="sm" onClick={fresh} loading={make.isPending}><ArrowClockwiseIcon size={14} /> {t("Get a new code")}</Button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <TimerIcon size={14} /> {t("Works once. Expires in {time}.", { time: countdown(left) })}
            <span className="ml-auto inline-flex items-center gap-1.5"><span className="size-2 animate-pulse rounded-full bg-accent" /> {t("Waiting for your computer…")}</span>
          </p>
        )
      ) : null}
    </div>
  );

  const osPick = (
    <Segmented label={t("Your computer")} value={os} onChange={setOs} size="sm"
      options={[{ value: "windows", label: "Windows" }, { value: "mac", label: "Mac" }]} />
  );

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Link a computer")}
      description={t("Install a small program on your computer and link it with a one-time code. Only your own AI can use it.")}
      className="w-[min(94vw,46rem)]"
      footer={<Button variant="outline" onClick={onClose}>{t("Close")}</Button>}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <FormError message={make.error ? errorMessage(make.error) : null} />
        {hasApp ? (
          <Segmented label={t("How to install")} value={tab} onChange={setTab} className="w-full [&>button]:flex-1 [&>button]:justify-center"
            options={[{ value: "app", label: t("Download the app") }, { value: "command", label: t("Install with one command — no warnings") }]} />
        ) : null}

        {tab === "app" ? (
          <div className="grid min-w-0 gap-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["windows", "mac"] as const).map((o) => {
                const OsIcon = o === "windows" ? WindowsLogoIcon : AppleLogoIcon;
                return (
                  <a key={o} href={link?.downloads?.[o] ?? "#"} onClick={(e) => { if (!link) e.preventDefault(); setOs(o); }}
                    aria-disabled={!link || undefined}
                    className={cn(
                      "flex min-h-16 min-w-0 items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 transition-colors",
                      os === o ? "border-accent bg-accent-soft/50" : "border-border bg-surface hover:border-accent/40",
                      !link && "pointer-events-none opacity-60",
                    )}>
                    <OsIcon size={28} weight="fill" className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold">{t("Download for {os}", { os: OS_LABEL[o] })}</span>
                      <span className="block text-[12px] text-muted">{o === "windows" ? t("Windows 10 or 11 · .exe") : t("macOS 12 or newer · .dmg")}</span>
                    </span>
                    <DownloadSimpleIcon size={18} className="shrink-0 text-muted" />
                  </a>
                );
              })}
            </div>
            {codeRow}
            <div className="grid min-w-0 gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold">{t("Then open it")}</h3>
                {osPick}
              </div>
              <p className="text-[13px] text-muted">
                {t("The app is not signed yet, so your computer asks once whether to trust it. This is what you will see:")}
              </p>
              {os === "windows" ? (
                <>
                  <Steps items={[
                    t("Open the downloaded file."),
                    t("If you see “Windows protected your PC”, click More info → Run anyway."),
                    t("Paste the code in the app and click Link."),
                  ]} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <WindowsSmartScreen step={1} />
                    <WindowsSmartScreen step={2} />
                  </div>
                </>
              ) : (
                <>
                  <Steps items={[
                    t("Open the downloaded file and drag Agentic Office into Applications, then open it."),
                    t("If macOS says it can't check the app: open System Settings → Privacy & Security, scroll down, click Open Anyway, then open the app again."),
                    t("Paste the code in the app and click Link."),
                  ]} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MacGatekeeper step={1} />
                    <MacGatekeeper step={2} />
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-[13px] text-muted">{t("No download, no warnings: one line installs the program and links this computer.")}</p>
              {osPick}
            </div>
            <div className="grid min-w-0 gap-2">
              <div className="flex min-w-0 items-stretch gap-2">
                <pre className={cn(
                  "min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-[#0f172a] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#e2e8f0]",
                  gone && "opacity-50",
                )}>
                  <code>{link ? link.install[os] : "…"}</code>
                </pre>
                <Button className="h-auto" disabled={!link || gone} onClick={() => link && copyText(link.install[os])} aria-label={t("Copy the command")}>
                  <CopyIcon size={16} /> <span className="max-sm:hidden">{t("Copy")}</span>
                </Button>
              </div>
              <p className="text-[12px] text-muted">{t("The code inside works once and expires in 10 minutes.")}</p>
            </div>
            <Steps items={os === "windows" ? [
              <span key="a" className="inline-flex flex-wrap items-center gap-1"><TerminalWindowIcon size={15} className="text-accent" /> {t("Press Start, type PowerShell, open it, paste, press Enter.")}</span>,
              t("Wait for “Linked” (about a minute: it downloads Node.js from nodejs.org and the agent)."),
              t("It starts by itself with your computer from now on. No admin rights needed."),
            ] : [
              <span key="a" className="inline-flex flex-wrap items-center gap-1"><TerminalWindowIcon size={15} className="text-accent" /> {t("Open Terminal (Spotlight → Terminal), paste, press Enter.")}</span>,
              t("Wait for “Linked” (about a minute: it downloads Node.js from nodejs.org and the agent)."),
              t("It starts by itself with your computer from now on. No admin rights needed."),
            ]} />
            {codeRow}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}
