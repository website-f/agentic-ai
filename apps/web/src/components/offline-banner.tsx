/** No network: a quiet notice under the header, so a page that will not load (or a save that
 * waits) is explained. Back online: a short "Back online" and the page loads again. The API is
 * never cached by the service worker, so what the app shows is either fresh or not there. */
import { CloudCheckIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function OfflineBanner() {
  const t = useT();
  const router = useRouter();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [back, setBack] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const onOnline = () => {
      setBack(true);
      // Queries refetch on their own; this re-runs a page that failed to open while offline.
      void router.invalidate();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBack(false), 3000);
    };
    const onOffline = () => {
      window.clearTimeout(timer);
      setBack(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [router]);

  const shown = !online || back;
  return (
    // Centred on the content column (the sidebar takes the left on md+), just under the header.
    // The live region stays mounted so screen readers announce the change.
    <div role="status" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-30 flex justify-center px-3 md:pl-[calc(68px+0.75rem)] xl:pl-[calc(244px+0.75rem)]">
      {shown ? (
        <p
          className={cn(
            "pointer-events-auto flex max-w-md items-start gap-2 rounded-[var(--radius-md)] border bg-surface px-3.5 py-2 text-[12.5px] shadow-[var(--shadow-pop)] animate-[menu-in_160ms_cubic-bezier(0.16,1,0.3,1)]",
            online ? "border-ok/30" : "border-warn/40",
          )}
        >
          {online ? (
            <>
              <CloudCheckIcon size={16} weight="fill" className="mt-px shrink-0 text-ok" />
              <span className="font-medium">{t("Back online.")}</span>
            </>
          ) : (
            <>
              <WifiSlashIcon size={16} weight="bold" className="mt-px shrink-0 text-warn" />
              <span className="min-w-0">
                <span className="font-medium">{t("You are offline.")}</span>{" "}
                <span className="text-muted">{t("Pages will not load and changes will not save until the connection is back.")}</span>
              </span>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
