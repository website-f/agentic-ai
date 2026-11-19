/** P119 (Fitri, 19 Nov 2026: "opening Prima is too slow ... make the sidebar already there so when
 * going to Prima it just shows Prima home"):
 *
 * - PrimaMenuProbe: shortly after the office opens, Prima's menu-only mode (/prima/?menu=1, framed
 *   and hidden) works out this person's Prima apps and screens and sends them; nothing else runs
 *   in it (no clock-in, no tracking, no screens). The sidebar's Prima group is then complete
 *   before Prima is ever opened. Read again after MENU_FRESH_MS, at most once a page load.
 * - PrimaHost: Prima itself under the office's header, opened the first time /prima is visited
 *   and then kept loaded while the person moves around the office, so coming back is instant. It
 *   is only shown on /prima. (P117 made Prima open inside the office; see pages/prima.tsx.) */
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useLang, useT } from "@/i18n";
import { cleanMenu, menuIsFresh, primaGo, usePrima } from "@/lib/prima-embed";
import { handPrimaLanguage, primaScreen } from "@/lib/prima-screen";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const APP = "/prima/";
const PROBE_AFTER_MS = 2500;
const PROBE_GIVE_UP_MS = 45_000;

let probedThisLoad = false;

export function PrimaMenuProbe() {
  const { data: me } = useSuspenseQuery(meQuery);
  const load = usePrima((s) => s.load);
  const menuAt = usePrima((s) => s.menuAt);
  const mounted = usePrima((s) => s.mounted);
  const setMenu = usePrima((s) => s.setMenu);
  const frame = useRef<HTMLIFrameElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => load(me.user.id), [load, me.user.id]);
  // Read when nothing fresh is known, a moment after the office is up, once per page load.
  useEffect(() => {
    if (probedThisLoad || mounted || menuIsFresh(menuAt)) return;
    const t = window.setTimeout(() => {
      probedThisLoad = true;
      setOn(true);
    }, PROBE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [menuAt, mounted]);
  useEffect(() => {
    if (!on) return;
    const done = () => setOn(false);
    const onMsg = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      if (e.origin !== window.location.origin || !w || e.source !== w) return;
      const d = e.data as { source?: unknown; type?: unknown } | null;
      if (d?.source !== "prima" || d.type !== "menu") return;
      const menu = cleanMenu(d);
      if (menu) setMenu(menu);
      done();
    };
    window.addEventListener("message", onMsg);
    const t = window.setTimeout(done, PROBE_GIVE_UP_MS); // Prima not linked or not running: stop quietly
    return () => {
      window.removeEventListener("message", onMsg);
      window.clearTimeout(t);
    };
  }, [on, setMenu]);
  if (!on || mounted) return null;
  return <iframe ref={frame} src={`${APP}?menu=1#home`} title="" aria-hidden tabIndex={-1} className="hidden" />;
}

export function PrimaHost() {
  const mounted = usePrima((s) => s.mounted);
  return mounted ? <PrimaFrame /> : null;
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
  const frame = useRef<HTMLIFrameElement>(null);
  const reported = useRef("");
  const shown = pathname === "/prima" && !people;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // The language and the first screen are handed over before Prima starts.
  const [src] = useState(() => {
    handPrimaLanguage(useLang.getState().lang);
    return APP + (primaScreen(window.location.hash) || "#home");
  });
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      if (e.origin !== window.location.origin || !w || e.source !== w) return;
      const d = e.data as { source?: unknown; type?: unknown; hash?: unknown; view?: unknown; space?: unknown } | null;
      if (!d || d.source !== "prima") return;
      if (d.type === "menu") {
        const menu = cleanMenu(d);
        if (menu) setMenu(menu);
      } else if (d.type === "route" && typeof d.hash === "string" && /^#@?[a-z][a-z0-9-]{0,39}$/.test(d.hash)) {
        setRoute({ hash: d.hash, view: typeof d.view === "string" ? d.view : "", space: typeof d.space === "string" ? d.space : null });
        reported.current = d.hash.slice(1);
        // The address follows Prima only while Prima is the page shown.
        if (shownRef.current) void navigate({ to: "/prima", hash: d.hash.slice(1), replace: true });
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [navigate, setMenu, setRoute]);
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
      onLoad={() => setFrame(frame.current?.contentWindow ?? null)}
      className={cn(
        "w-full border-0 bg-bg h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-4.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))]",
        shown ? "block" : "hidden",
      )}
    />
  );
}
