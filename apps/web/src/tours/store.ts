/**
 * P109: the running tour (which one, which step), kept on this device so a refresh or a move
 * between the app and the Library carries on where it was. The host (./host.tsx) also saves
 * it on the server, so the welcome tour resumes on another device too.
 */
import { create } from "zustand";

const KEY = "agentic.tour";

export interface Running {
  id: string;
  step: number;
  /** Whose tour it is (a shared computer: the next person does not get it). */
  user: string;
}

function read(): Running | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Running | null;
    return v && typeof v.id === "string" && typeof v.step === "number" && typeof v.user === "string" ? v : null;
  } catch {
    return null;
  }
}

function write(v: Running | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the tour still runs for this visit */
  }
}

interface TourState {
  running: Running | null;
  start: (id: string, user: string, step?: number) => void;
  go: (step: number) => void;
  stop: () => void;
}

export const useTour = create<TourState>((set, get) => ({
  running: read(),
  start: (id, user, step = 0) => {
    const running = { id, user, step: Math.max(0, step) };
    write(running);
    set({ running });
  },
  go: (step) => {
    const cur = get().running;
    if (!cur) return;
    const running = { ...cur, step: Math.max(0, step) };
    write(running);
    set({ running });
  },
  stop: () => {
    write(null);
    set({ running: null });
  },
}));

/** Start a tour from anywhere (a button, the command palette, the Guide). */
export const startTour = (id: string, user: string, step = 0) => useTour.getState().start(id, user, step);
