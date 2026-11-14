/** P49 "Ask how": whether the sheet is open and what was asked. Its own small module (P104) so
 * the sidebar and the setup list can open the sheet without loading the sheet itself (it
 * renders answers with a Markdown library). */
import { create } from "zustand";

interface HelpState {
  open: boolean;
  question: string;
  ask: (question?: string) => void;
  close: () => void;
}

export const useHelpAsk = create<HelpState>((set) => ({
  open: false,
  question: "",
  ask: (question = "") => set({ open: true, question }),
  close: () => set({ open: false, question: "" }),
}));
