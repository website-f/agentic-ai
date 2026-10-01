import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "light" | "dark" | "system";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem("agentic.theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

interface ThemeState {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  pref: readPref(),
  setPref: (pref) => {
    try {
      localStorage.setItem("agentic.theme", pref);
    } catch {
      /* storage blocked: theme still applies for this visit */
    }
    applyTheme(pref);
    set({ pref });
  },
}));

// Follow the OS when the preference is "system".
media().addEventListener("change", () => {
  if (useTheme.getState().pref === "system") applyTheme("system");
});

interface BranchState {
  branchId: string | null;
  setBranchId: (id: string | null) => void;
}

/** The branch the header switcher points at. Remembered per browser. */
export const useBranch = create<BranchState>()(
  persist((set) => ({ branchId: null, setBranchId: (branchId) => set({ branchId }) }), {
    name: "agentic.branch",
  }),
);

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
