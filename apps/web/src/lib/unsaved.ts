/** Unsaved work guard. Editors report "I have unsaved changes" with useUnsaved(dirty); while any
 * editor does:
 *  - closing or reloading the tab asks first (the browser's own "Leave site?" prompt),
 *  - a new app version waits: a toast offers "Reload" instead of reloading under the person,
 *    and the reload happens by itself once everything is saved,
 *  - <LeaveGuard when={dirty} /> also asks before an in-app link leaves the page. */
import { useBlocker, type ShouldBlockFn } from "@tanstack/react-router";
import { createElement, useEffect } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm";
import { t, useT } from "@/i18n";

const dirty = new Set<symbol>();
const listeners = new Set<() => void>();

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = ""; // older browsers need it set to show the prompt
}

function changed(): void {
  if (typeof window !== "undefined") {
    if (dirty.size) window.addEventListener("beforeunload", onBeforeUnload);
    else window.removeEventListener("beforeunload", onBeforeUnload);
  }
  for (const fn of [...listeners]) fn();
}

/** True while any editor on the page holds unsaved changes. */
export function hasUnsaved(): boolean {
  return dirty.size > 0;
}

/** Mark one editor (its token) dirty or clean. Returns the cleanup that marks it clean. */
export function markUnsaved(token: symbol, on: boolean): () => void {
  const had = dirty.has(token);
  if (on) dirty.add(token);
  else dirty.delete(token);
  if (had !== on) changed();
  return () => markUnsaved(token, false);
}

/** Called whenever the unsaved state changes. */
export function onUnsavedChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Run `fn` now if nothing is unsaved, otherwise as soon as everything is saved (or discarded).
 * Returns a cancel function. */
export function whenSaved(fn: () => void): () => void {
  if (!hasUnsaved()) {
    fn();
    return () => {};
  }
  const off = onUnsavedChange(() => {
    if (hasUnsaved()) return;
    off();
    fn();
  });
  return off;
}

/** An editor reports its unsaved state; unmounting counts as clean. */
export function useUnsaved(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    return markUnsaved(Symbol("editor"), true);
  }, [isDirty]);
}

// ---------------------------------------------------------------- app updates

let updateWaiting = false;

/** A new app version took over (service worker). Reload now when nothing is unsaved; otherwise
 * offer "Reload" and reload by itself once the person has saved. */
export function applyUpdate(reload: () => void = () => window.location.reload()): void {
  if (!hasUnsaved()) return reload();
  if (updateWaiting) return;
  updateWaiting = true;
  toast(t("A new version is ready"), {
    id: "app-update",
    description: t("It loads as soon as your changes are saved."),
    duration: Infinity,
    action: { label: t("Reload"), onClick: () => reload() },
  });
  whenSaved(() => {
    toast.dismiss("app-update");
    reload();
  });
}

// ---------------------------------------------------------------- in-app navigation

// Only leaving the page counts: the editors' own search-param changes (open, close, save) do not.
const leavesPage: ShouldBlockFn = ({ current, next }) => current.pathname !== next.pathname;

/** Asks "Leave without saving?" before an in-app link takes the person off a dirty editor. */
export function LeaveGuard({ when }: { when: boolean }) {
  const tr = useT();
  useUnsaved(when);
  const blocker = useBlocker({ shouldBlockFn: leavesPage, withResolver: true, enableBeforeUnload: false, disabled: !when });
  return createElement(ConfirmDialog, {
    open: blocker.status === "blocked",
    onOpenChange: (open: boolean) => {
      if (!open && blocker.status === "blocked") blocker.reset();
    },
    title: tr("Leave without saving?"),
    body: tr("Your unsaved changes will be lost."),
    danger: true,
    confirmLabel: tr("Discard changes"),
    onConfirm: () => {
      if (blocker.status === "blocked") blocker.proceed();
    },
  });
}

/** Tests only: forget every registration. */
export function resetUnsavedForTests(): void {
  dirty.clear();
  updateWaiting = false;
  changed();
}
