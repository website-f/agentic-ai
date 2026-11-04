/** P61b: what the full-screen Library frame (frame.tsx) shares with the pages inside it. Null
 * outside the frame, so a Library piece rendered elsewhere keeps its stand-alone look. */
import { createContext, useContext } from "react";

export interface LibraryFrame {
  /** Browse: the folder tree down the side is hidden (the header's toggle). */
  treeHidden: boolean;
  setTreeHidden: (hidden: boolean) => void;
}

export const InLibraryFrame = createContext<LibraryFrame | null>(null);

export function useLibraryFrame(): LibraryFrame | null {
  return useContext(InLibraryFrame);
}
