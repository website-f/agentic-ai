/** P96: on a slow phone connection, opening a page (its code, its data) can take seconds. A thin
 * bar under the status bar says "loading" so a tap never looks ignored. Quick loads show
 * nothing: it appears only after a quarter of a second. */
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useT } from "@/i18n";

export const PROGRESS_DELAY_MS = 250;

export function NavProgress() {
  const t = useT();
  const loading = useRouterState({ select: (s) => s.status === "pending" || s.isLoading });
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLate(true), PROGRESS_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [loading]);
  if (!loading || !late) return null;
  return (
    <div
      role="progressbar"
      aria-label={t("Loading…")}
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[60] h-0.5 overflow-hidden"
    >
      <div className="h-full w-1/3 animate-[nav-progress_1.1s_ease-in-out_infinite] rounded-full bg-accent" />
    </div>
  );
}
