import { useEffect, useRef } from 'react';

/**
 * Screens that load a file their own way (Fitri, 24 Nov 2026: "when click upload, why it shows like this? I just want to
 * upload the guard pay things ... same with staff payroll"). Guard pay lines, a salary sheet for the contribution files
 * and the like have their own import with their own checks; the toolbar's Upload offers them first and hands over the
 * file the person already chose, so nothing is picked twice. Registering adds no authority: the screen's own import and
 * the server check everything as before.
 */
export interface UploadHandler {
  key: string;
  /** What the file becomes, e.g. "Guard pay lines: allowances, deductions and PCB". */
  label: string;
  /** One plain sentence: what happens next. */
  detail: string;
  /** Why it cannot be used now (no draft run, not the preparer); shown instead of the button. */
  unavailable?: string | null;
  /** Opens the screen's own import, with the file when one was chosen in Upload. */
  open: (file?: File) => void;
}

const handlers = new Map<string, Map<string, UploadHandler>>();
const listeners = new Set<() => void>();

export function screenUploaders(screen: string): UploadHandler[] {
  return [...(handlers.get(screen)?.values() ?? [])];
}

export function onUploadersChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A screen offers its own import to the toolbar's Upload while it is shown. */
export function useScreenUploader(screen: string, handler: UploadHandler | null): void {
  const ref = useRef(handler);
  ref.current = handler;
  const key = handler?.key ?? '';
  const sig = handler ? `${handler.label}|${handler.detail}|${handler.unavailable ?? ''}` : '';
  useEffect(() => {
    if (!key) return;
    const m = handlers.get(screen) ?? new Map<string, UploadHandler>();
    handlers.set(screen, m);
    const h = ref.current!;
    m.set(key, { ...h, open: (f) => ref.current?.open(f) });
    listeners.forEach((l) => l());
    return () => {
      m.delete(key);
      listeners.forEach((l) => l());
    };
  }, [screen, key, sig]);
}

/** A file handed from one screen's Upload to another screen (the salary sheet from Staff payroll to Contribution files). */
let pending: { screen: string; file: File } | null = null;
export function handOver(screen: string, file: File): void {
  pending = { screen, file };
}
export function takeHandedFile(screen: string): File | null {
  if (pending?.screen !== screen) return null;
  const f = pending.file;
  pending = null;
  return f;
}
