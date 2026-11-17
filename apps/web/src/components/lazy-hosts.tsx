/**
 * P104: the shell's overlays (the command palette, the task composer, "Ask how") load their code
 * the first time they open, not with every first page: together they pulled a Markdown library,
 * the task form and its pickers into the code every page waited for. Once opened they stay
 * mounted, so closing animations and kept state work exactly as before.
 */
import { lazy, Suspense, useState } from "react";

import { usePalette } from "@/lib/stores";

import { useHelpAsk } from "./help-ask-store";
import { useComposerStore } from "./task-composer/store";

const Palette = lazy(() => import("./command-palette").then((m) => ({ default: m.CommandPalette })));
const Composer = lazy(() => import("./task-composer/task-composer").then((m) => ({ default: m.TaskComposerHost })));
const Help = lazy(() => import("./help-ask").then((m) => ({ default: m.HelpAskSheet })));
// P109: the guided tours (the welcome tour starts by itself the first time someone signs in).
const Tours = lazy(() => import("@/tours/host").then((m) => ({ default: m.TourHost })));

/** True from the first time `open` is true on. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

export function LazyCommandPalette() {
  const show = useOpenedOnce(usePalette((s) => s.open));
  return show ? (
    <Suspense fallback={null}>
      <Palette />
    </Suspense>
  ) : null;
}

export function LazyTaskComposerHost() {
  // The host renders nothing while the composer is closed, so it can come and go with it.
  const open = useComposerStore((s) => s.open);
  return open ? (
    <Suspense fallback={null}>
      <Composer />
    </Suspense>
  ) : null;
}

export function LazyHelpAskSheet() {
  const show = useOpenedOnce(useHelpAsk((s) => s.open));
  return show ? (
    <Suspense fallback={null}>
      <Help />
    </Suspense>
  ) : null;
}

/** P109: the guided tours' host; its code loads after the first page, the spotlight only when
 * a tour runs. */
export function LazyTourHost() {
  return (
    <Suspense fallback={null}>
      <Tours />
    </Suspense>
  );
}
