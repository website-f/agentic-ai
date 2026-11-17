/**
 * P109: runs the guided tours. Mounted once in the app shell and once in the Library's frame.
 *
 * - The first time someone signs in, the welcome tour for their role starts by itself (once:
 *   the server keeps that it started, was skipped or done). It waits while they hire their AI
 *   worker (/welcome) or read the Guide.
 * - A tour carries on after a refresh (this device keeps it) and the welcome tour on another
 *   device too (the server keeps where it was).
 * - A step on another page goes there first; a step whose button this person does not have is
 *   left out.
 * - Finishing a tour marks it seen, which ticks the Getting started steps it covers.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef } from "react";

import { useT } from "@/i18n";
import { gettingStartedQuery, useSaveGettingStarted, type GettingStartedSave } from "@/lib/getting-started";
import { meQuery } from "@/lib/queries";

import { useTour } from "./store";
import { stepRoute, tourAllowed, tourById, welcomeTour } from "./tours";

const Spotlight = lazy(() => import("./spotlight").then((m) => ({ default: m.Spotlight })));

/** Pages where the welcome tour does not start by itself (it starts on the next page). */
const QUIET = ["/welcome", "/guide", "/present", "/tutorial", "/change-password", "/two-step-setup"];

// Once per page load: the welcome tour starts (or resumes) at most once.
let autoTried = false;

/** Tests: allow the welcome tour to start again. */
export function resetTourHost() {
  autoTried = false;
}

const onPage = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

export function TourHost() {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, unknown>;
  const navigate = useNavigate();
  const running = useTour((s) => s.running);
  const enabled = !!me && me.access !== "prima_only";
  const gs = useQuery({ ...gettingStartedQuery, enabled });
  const save = useSaveGettingStarted();
  const mutate = save.mutate; // stable across renders
  const dir = useRef(1);

  const tour = running ? tourById(running.id) : undefined;
  const step = tour && running ? tour.steps[running.step] : undefined;
  const allowed = !!tour && !!me && tourAllowed(tour, me.permissions);

  // Start the welcome tour the first time; resume it where it was on another device.
  useEffect(() => {
    if (!me || !gs.data || autoTried) return;
    if (useTour.getState().running) {
      autoTried = true;
      return;
    }
    if (QUIET.some((p) => onPage(pathname, p))) return;
    autoTried = true;
    const d = gs.data;
    if (d.welcome === null) {
      const w = welcomeTour(d.group);
      useTour.getState().start(w.id, me.user.id);
      mutate({ welcome: "started", resume: { tour: w.id, step: 0 } });
    } else if (d.welcome === "started" && d.resume?.tour.startsWith("welcome-") && tourById(d.resume.tour)) {
      useTour.getState().start(d.resume.tour, me.user.id, d.resume.step);
    }
  }, [me, gs.data, pathname, mutate]);

  // Someone else's tour on a shared computer, a tour that no longer exists, or past its end.
  useEffect(() => {
    if (!running || !me) return;
    if (running.user !== me.user.id || !tour || !allowed || !step) useTour.getState().stop();
  }, [running, me, tour, allowed, step]);

  // The welcome tour's place, on the server (another device resumes it there).
  const welcomeId = tour?.welcome ? tour.id : null;
  const at = running?.step ?? 0;
  useEffect(() => {
    if (!welcomeId) return;
    const id = window.setTimeout(() => mutate({ resume: { tour: welcomeId, step: at } }), 600);
    return () => window.clearTimeout(id);
  }, [welcomeId, at, mutate]);

  // A step on another page: go there first.
  const where = tour && step ? stepRoute(tour, step) : undefined;
  const prev = tour && running && running.step > 0 ? tour.steps[running.step - 1] : undefined;
  const prevWhere = tour && prev ? stepRoute(tour, prev) : undefined;
  const here = !where || (onPage(pathname, where.to) && Object.entries(where.search ?? {}).every(([k, v]) => String(search[k] ?? "") === String(v)));
  const keyOf = (w?: { to: string; search?: Record<string, unknown> }) => (w ? `${w.to}?${JSON.stringify(w.search ?? {})}` : "");
  const whereKey = keyOf(where);
  // A step on the same page as the one before: its page is already there.
  const newPage = !prev || keyOf(prevWhere) !== whereKey;
  useEffect(() => {
    if (!where || here) return;
    void navigate({ to: where.to as never, search: (where.search ?? {}) as never });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step's page
  }, [whereKey, here]);

  if (!running || !tour || !step || !allowed || running.user !== me?.user.id) return null;

  const end = (seen: boolean) => {
    useTour.getState().stop();
    const body: GettingStartedSave = {};
    if (seen) body.tour_seen = tour.id;
    if (tour.welcome) {
      body.welcome = seen || gs.data?.welcome === "done" ? "done" : "skipped";
      body.resume = null;
    }
    if (Object.keys(body).length) save.mutate(body);
  };
  const go = (to: number) => {
    dir.current = to >= running.step ? 1 : -1;
    if (to >= tour.steps.length) end(true);
    else useTour.getState().go(Math.max(0, to));
  };
  const missing = () => {
    const to = running.step + dir.current;
    if (to < 0) go(running.step + 1);
    else go(to);
  };

  return (
    <Suspense fallback={null}>
      <Spotlight
        key={`${tour.id}:${running.step}`}
        step={step}
        index={running.step}
        count={tour.steps.length}
        title={t(tour.title)}
        ready={here}
        newPage={newPage}
        onNext={() => go(running.step + 1)}
        onBack={() => go(running.step - 1)}
        onSkip={() => end(false)}
        onMissing={missing}
      />
    </Suspense>
  );
}
