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

/** The header switcher's "All companies" choice (stored in place of a company id). */
export const ALL_COMPANIES = "all";

interface BranchChoice {
  branchId: string | null;
  lastId: string | null;
}

interface BranchState extends BranchChoice {
  /** Who the remembered choice belongs to: each person on a shared device keeps their own. */
  userId: string | null;
  byUser: Record<string, BranchChoice>;
  /** Switch to the signed-in person's remembered choice (the shell calls it once /me loads). */
  bindUser: (userId: string) => void;
  /** A company id, ALL_COMPANIES, or null (not chosen yet: "All" when there are several). */
  setBranchId: (id: string | null) => void;
  /** Pages that need one company (office floor, company kit) remember theirs here under "All". */
  setLastId: (id: string) => void;
}

/** The company the header switcher points at (or all of them). Remembered per person, per device.
 * `branchId` is the current person's choice; `lastId` the last single company they picked. */
export const useBranch = create<BranchState>()(
  persist(
    (set, get) => {
      const save = (patch: Partial<BranchChoice>) => {
        const { userId, byUser, branchId, lastId } = get();
        const next = { branchId, lastId, ...patch };
        set({ ...next, byUser: userId ? { ...byUser, [userId]: next } : byUser });
      };
      return {
        branchId: null,
        lastId: null,
        userId: null,
        byUser: {},
        bindUser: (userId) => {
          if (get().userId === userId) return;
          const mine = get().byUser[userId];
          // First visit after the per-person upgrade: the device's old choice becomes theirs.
          const choice = mine ?? (get().userId ? { branchId: null, lastId: null } : { branchId: get().branchId, lastId: get().lastId ?? get().branchId });
          set({ userId, ...choice, byUser: { ...get().byUser, [userId]: choice } });
        },
        setBranchId: (branchId) => save(branchId && branchId !== ALL_COMPANIES ? { branchId, lastId: branchId } : { branchId }),
        setLastId: (lastId) => save({ lastId }),
      };
    },
    {
      name: "agentic.branch",
      partialize: ({ branchId, lastId, userId, byUser }) => ({ branchId, lastId, userId, byUser }),
    },
  ),
);

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
