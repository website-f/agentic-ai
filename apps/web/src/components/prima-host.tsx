/** P119 (Fitri, 19 Nov 2026: "opening Prima is too slow ... make the sidebar already there so when
 * going to Prima it just shows Prima home"), P122 (21 Nov 2026: "when I click any of Prima's menu
 * items it shows Loading Prima Secure App ... make them one system"):
 *
 * - PrimaWarm: a moment after the office is up, Prima itself is opened hidden (/prima/?warm=1): it
 *   signs in, draws its home and sends this person's apps and screens for the sidebar. Until it is
 *   first shown it starts nothing of the person's day (apps/prima office-embed.ts: no clock-in, no
 *   survey sending, no tracking, no screen prefetch). Once it has sent a menu it stays, as if
 *   opened (`mounted`), so the first click on a Prima screen shows it at once. No menu within
 *   WARM_GIVE_UP_MS (no Prima for this person, or Prima down): the hidden frame is let go.
 * - PrimaHost: Prima under the office's header, only shown on /prima, kept loaded while the person
 *   moves around the office. (P117 made Prima open inside the office; see pages/prima.tsx.) */
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useLang, useT } from "@/i18n";
import { cleanMenu, primaGo, usePrima } from "@/lib/prima-embed";
import { handPrimaLanguage, primaScreen } from "@/lib/prima-screen";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const APP = "/prima/";
const WARM_AFTER_MS = 2500;
const WARM_GIVE_UP_MS = 60_000;

let warmedThisLoad = false;

export function PrimaWarm() {
  const { data: me } = useSuspenseQuery(meQuery);
  const load = usePrima((s) => s.load);
  const mounted = usePrima((s) => s.mounted);
  const warm = usePrima((s) => s.warm);
  const setWarm = usePrima((s) => s.setWarm);
  useEffect(() => load(me.user.id), [load, me.user.id]);
  // Once per page load, a moment after the office is up (its own first screen comes first).
  useEffect(() => {
    if (warmedThisLoad || mounted) return;
    const t = window.setTimeout(() => {
      warmedThisLoad = true;
      setWarm(true);
    }, WARM_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [mounted, setWarm]);
  // Prima never answered with a menu: let the hidden frame go.
  useEffect(() => {
    if (!warm || mounted) return;
    const t = window.setTimeout(() => setWarm(false), WARM_GIVE_UP_MS);
    return () => window.clearTimeout(t);
  }, [warm, mounted, setWarm]);
  return null;
}

export function PrimaHost() {
  const mounted = usePrima((s) => s.mounted);
  const warm = usePrima((s) => s.warm);
  return mounted || warm ? <PrimaFrame /> : null;
}

function PrimaFrame() {
  const t = useT();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const hash = useRouterState({ select: (st) => st.location.hash });
  const people = useRouterState({ select: (st) => !!(st.location.search as { people?: unknown }).people });
  const setMenu = usePrima((s) => s.setMenu);
  const setRoute = usePrima((s) => s.setRoute);
  const setFrame = usePrima((s) => s.setFrame);
  const setMounted = usePrima((s) => s.setMounted);
  const frame = useRef<HTMLIFrameElement>(null);
  const reported = useRef("");
  const shown = pathname === "/prima" && !people;
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  // The language and the first screen are handed over before Prima starts. P122: opened ahead
  // (not on /prima), it starts warm: drawn, but nothing of the person's day until it is shown.
  const [src] = useState(() => {
    handPrimaLanguage(useLang.getState().lang);
    return shown ? APP + (primaScreen(window.location.hash) || "#home") : `${APP}?warm=1#home`;
  });
  const tellShown = () => {
    try {
      frame.current?.contentWindow?.postMessage({ source: "office", type: "show" }, window.location.origin);
    } catch {
      /* not loaded yet: told again when it loads */
    }
  };
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      if (e.origin !== window.location.origin || !w || e.source !== w) return;
      const d = e.data as { source?: unknown; type?: unknown; hash?: unknown; view?: unknown; space?: unknown } | null;
      if (!d || d.source !== "prima") return;
      if (d.type === "menu") {
        const menu = cleanMenu(d);
        if (menu) {
          setMenu(menu);
          // P122: Prima works for this person: kept, as if opened, so /prima shows it at once.
          setMounted(true);
        }
      } else if (d.type === "route" && typeof d.hash === "string" && /^#@?[a-z][a-z0-9-]{0,39}$/.test(d.hash)) {
        setRoute({ hash: d.hash, view: typeof d.view === "string" ? d.view : "", space: typeof d.space === "string" ? d.space : null });
        reported.current = d.hash.slice(1);
        // The address follows Prima only while Prima is the page shown.
        if (shownRef.current) void navigate({ to: "/prima", hash: d.hash.slice(1), replace: true });
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [navigate, setMenu, setRoute, setMounted]);
  // P122: shown for the first time (it was opened ahead): Prima starts the person's day now.
  useEffect(() => {
    if (shown) tellShown();
  }, [shown]);
  // The address changed from outside Prima (the sidebar, the Clock in tab, a link): open that screen in it.
  useEffect(() => {
    if (!shown || !hash || hash === reported.current) return;
    primaGo(`#${hash}`);
  }, [hash, shown]);
  useEffect(() => () => setFrame(null), [setFrame]);
  return (
    <iframe
      ref={frame}
      src={src}
      title={t("Prima")}
      allow="camera; geolocation; clipboard-write"
      aria-hidden={!shown}
      tabIndex={shown ? undefined : -1}
      onLoad={() => {
        setFrame(frame.current?.contentWindow ?? null);
        if (shownRef.current) tellShown();
      }}
      className={cn(
        "w-full border-0 bg-bg h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-4.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))]",
        shown ? "block" : "hidden",
      )}
    />
  );
}
