/** "Install the app": a dismissible card in the signed-in shell (banner), and the same help
 * in Settings (inline). Chromium installs with its own prompt (lib/push.ts keeps the deferred
 * beforeinstallprompt); iPhone and iPad add to the Home Screen from Safari's Share menu. */
import { CheckCircleIcon, CopyIcon, DownloadSimpleIcon, ExportIcon, PlusSquareIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";

import { useT } from "@/i18n";
import { canInstall, install, isIOS, isStandalone, onInstallChange } from "@/lib/push";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { Trans } from "./trans";
import { Button } from "./ui/button";

/** How this browser installs the app. */
type How = "prompt" | "ios" | "ios-other" | "mac-safari" | "menu";

function howToInstall(installable: boolean): How {
  if (installable) return "prompt";
  const ua = navigator.userAgent;
  // iPadOS says "Macintosh"; only the touch screen gives it away.
  const ios = isIOS() || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Chrome, Firefox, Edge, Opera and in-app browsers (Google, Facebook, Instagram, LINE) on iOS.
  if (ios) return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua) ? "ios" : "ios-other";
  if (/Macintosh/.test(ua) && /Version\/\d+.*Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return "mac-safari";
  return "menu";
}

function useInstall() {
  const t = useT();
  const installable = useSyncExternalStore(onInstallChange, canInstall, () => false);
  const standalone = useMedia("(display-mode: standalone)") || isStandalone();
  const how = howToInstall(installable);
  const installNow = async () => {
    const ok = await install().catch(() => false); // the prompt can only be shown once
    if (ok) toast.success(t("Installed. Open it from your home screen or apps."));
    return ok;
  };
  const copyLink = () =>
    void navigator.clipboard?.writeText(window.location.origin).then(
      () => toast.success(t("Link copied. Paste it into Safari.")),
      () => toast.error(t("Copy blocked by the browser.")),
    );
  return { how, standalone, installNow, copyLink };
}

// ---------------------------------------------------------------- when the card shows

const KEY = "agentic.install";
const WAIT_MS = 30_000; // first visit: after half a minute of use
const ASK_AGAIN_MS = 30 * 24 * 60 * 60 * 1000;

interface Saved {
  visits?: number;
  dismissed?: number;
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: the card may ask again next visit */
  }
}

/** One visit per browser session (a reload is not a new visit); StrictMode runs this twice. */
let counted = false;
function countVisit(): Saved {
  const s = load();
  if (counted) return s;
  counted = true;
  try {
    if (sessionStorage.getItem(KEY)) return s;
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* blocked: count this load */
  }
  const next = { ...s, visits: (s.visits ?? 0) + 1 };
  save(next);
  return next;
}

type Due = "now" | "later" | "never";

function firstDue(): Due {
  const s = countVisit();
  if (s.dismissed && Date.now() - s.dismissed < ASK_AGAIN_MS) return "never";
  return (s.visits ?? 0) >= 2 ? "now" : "later";
}

function snooze() {
  save({ ...load(), dismissed: Date.now() });
}

// ---------------------------------------------------------------- what it says

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent tabular">{n}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Safari on iPhone and iPad: Share, then Add to Home Screen. */
function IosSteps() {
  const t = useT();
  return (
    <div className="grid gap-1.5">
      <ol className="grid gap-1.5 text-[13px]">
        <Step n={1}>
          <Trans text={t("Tap Share {icon} in Safari.")} values={{ icon: <ExportIcon size={17} weight="bold" className="-mt-0.5 inline text-info" aria-hidden /> }} />
        </Step>
        <Step n={2}>
          <Trans
            text={t("Choose {option}.")}
            values={{ option: <span className="font-medium whitespace-nowrap">{t("Add to Home Screen")} <PlusSquareIcon size={16} className="-mt-0.5 inline" aria-hidden /></span> }}
          />
        </Step>
      </ol>
      <p className="text-[12px] text-muted">{t("No Share button? Tap ••• next to the address bar first.")}</p>
    </div>
  );
}

function Body({ how, onInstall, onCopy }: { how: How; onInstall: () => void; onCopy: () => void }) {
  const t = useT();
  if (how === "prompt") {
    return (
      <div className="grid gap-2.5">
        <p className="text-[12.5px] text-muted">{t("It opens full screen from your home screen or desktop, and approvals reach you as notifications.")}</p>
        <div>
          <Button size="sm" onClick={onInstall}><DownloadSimpleIcon size={15} /> {t("Install app")}</Button>
        </div>
      </div>
    );
  }
  if (how === "ios") {
    return (
      <div className="grid gap-2">
        <p className="text-[12.5px] text-muted">{t("Add it to your Home Screen: it opens full screen like an app, and approvals can reach you as notifications.")}</p>
        <IosSteps />
      </div>
    );
  }
  if (how === "ios-other") {
    return (
      <div className="grid gap-2.5">
        <p className="text-[12.5px] text-muted">{t("On iPhone and iPad, apps are added from Safari. Open this page in Safari, then tap Share and Add to Home Screen.")}</p>
        <div>
          <Button size="sm" variant="outline" onClick={onCopy}><CopyIcon size={15} /> {t("Copy link")}</Button>
        </div>
      </div>
    );
  }
  if (how === "mac-safari") return <p className="text-[12.5px] text-muted">{t("In Safari on a Mac: File, then Add to Dock.")}</p>;
  return <p className="text-[12.5px] text-muted">{t("To install: the browser menu, then Install app (or Add to Home screen).")}</p>;
}

// ---------------------------------------------------------------- the two places

/** Signed-in shell: a small card, above the tab bar on phones, bottom right on desktop. It
 * waits for a second visit (or half a minute of use) and, once closed, stays away 30 days. */
function InstallBanner() {
  const t = useT();
  const { how, standalone, installNow, copyLink } = useInstall();
  const [due, setDue] = useState<Due>(firstDue);
  useEffect(() => {
    if (due !== "later") return;
    const id = window.setTimeout(() => setDue("now"), WAIT_MS);
    return () => window.clearTimeout(id);
  }, [due]);
  const close = () => {
    snooze();
    setDue("never");
  };
  // Browsers with no install route of their own get the help in Settings only.
  if (standalone || due !== "now" || !(how === "prompt" || how === "ios" || how === "ios-other")) return null;
  return (
    <aside
      aria-label={t("Install the app")}
      data-keyboard-hide
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-30 animate-[dialog-in_220ms_cubic-bezier(0.16,1,0.3,1)] md:inset-x-auto md:right-4 md:bottom-4 md:w-[22rem]"
    >
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[var(--shadow-pop)]">
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-[10px]" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="text-[13.5px] font-semibold">{t("Install Agentic Office")}</p>
          <Body how={how} onInstall={() => void installNow().finally(close)} onCopy={copyLink} />
        </div>
        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1" aria-label={t("Not now")} title={t("Not now")} onClick={close}>
          <XIcon size={16} />
        </Button>
      </div>
    </aside>
  );
}

/** Settings: the same help, any time, and a check mark once the app is installed. */
function InstallInline() {
  const t = useT();
  const { how, standalone, installNow, copyLink } = useInstall();
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5">
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-[10px]" />
      <div className={cn("grid min-w-0 flex-1 gap-1", standalone && "self-center")}>
        {standalone ? (
          <p className="flex items-center gap-1.5 text-[13.5px] font-medium">
            <CheckCircleIcon size={17} weight="fill" className="shrink-0 text-ok" /> {t("You are using the installed app.")}
          </p>
        ) : (
          <>
            <p className="text-[13.5px] font-medium">{t("Install Agentic Office")}</p>
            <Body how={how} onInstall={() => void installNow()} onCopy={copyLink} />
          </>
        )}
      </div>
    </div>
  );
}

export function InstallApp({ mode = "banner" }: { mode?: "banner" | "inline" }) {
  return mode === "inline" ? <InstallInline /> : <InstallBanner />;
}
