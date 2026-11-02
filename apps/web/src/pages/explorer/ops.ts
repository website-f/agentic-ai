/** What the explorer does to files and folders, shared by the folder tree (drops) and the file
 * area (drops, menus, keys, the clipboard). Every change refreshes the lists and says in a
 * toast what moved where. */
import { useQueryClient } from "@tanstack/react-query";
import type { DragEvent } from "react";
import { toast } from "sonner";

import { t } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { docKeys } from "@/lib/documents";
import {
  copyFiles, createFolder, deleteFolder, joinPath, planPaste, renameFile, renameFolder,
  type ClipItem, type Clipboard, type ExplorerFile, type PastePlan,
} from "@/lib/explorer";
import { cleanFolder, deleteFile, intakeKeys, moveFiles, notThere, patchFile, type FolderNode } from "@/lib/intake";
import { libraryKeys } from "@/lib/library";
import type { Branch } from "@/lib/types";

// ---------------------------------------------------------------- dragging

/** Our own drags (files and folders inside the Library) carry this type; files from the
 * computer carry "Files". */
export const DRAG_TYPE = "application/x-agentic-library";
let dragging: ClipItem[] | null = null;

export function startDrag(e: DragEvent, items: ClipItem[], label: string) {
  dragging = items;
  e.dataTransfer.setData(DRAG_TYPE, "1");
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "copyMove";
}

export const endDrag = () => {
  dragging = null;
};

export const draggedItems = () => dragging;
export const isOwnDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
export const isFileDrag = (e: DragEvent) => !isOwnDrag(e) && e.dataTransfer.types.includes("Files");
/** Ctrl (Option on a Mac) while dropping copies instead of moving, as in a file manager. */
export const copyKey = (e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean }) => e.ctrlKey || e.altKey;

/** May what is being dragged go into `path`? Never a folder into itself. */
export function canDropInto(path: string): boolean {
  const items = dragging;
  if (!items) return true; // files from the computer
  const plan = planPaste({ mode: "copy", branchId: "", items }, path);
  return plan.files.length + plan.folders.length > 0;
}

// ---------------------------------------------------------------- words

const filesWord = (n: number) => (n === 1 ? t("1 file") : t("{n} files", { n }));
const foldersWord = (n: number) => (n === 1 ? t("1 folder") : t("{n} folders", { n }));

export function itemsWord(files: number, folders: number): string {
  if (files && folders) return t("{folders} and {files}", { folders: foldersWord(folders), files: filesWord(files) });
  return folders ? foldersWord(folders) : filesWord(files);
}

function skippedNote(plan: PastePlan) {
  for (const s of plan.skipped) {
    toast(s.reason === "into_itself" ? t("{name} cannot go inside itself.", { name: s.name }) : t("{name} is already there.", { name: s.name }));
  }
}

// ---------------------------------------------------------------- the operations

export type ExplorerOps = ReturnType<typeof useExplorerOps>;

export function useExplorerOps(branch: Branch | null, root: FolderNode) {
  const qc = useQueryClient();
  const branchId = branch?.id ?? null;
  const placeName = (path: string) => cleanFolder(path) || branch?.name || t("the top level");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: docKeys.files });
    void qc.invalidateQueries({ queryKey: intakeKeys.all });
    void qc.invalidateQueries({ queryKey: libraryKeys.all });
  };

  /** Every folder path at or under `path`, from the tree. */
  const foldersUnder = (path: string): string[] => {
    const out: string[] = [];
    const walk = (n: FolderNode) => {
      if (n.path === path || n.path.startsWith(`${path}/`)) out.push(n.path);
      n.children.forEach(walk);
    };
    walk(root);
    return out.length ? out : [path];
  };

  const moveFilesTo = async (ids: string[], dest: string) => {
    try {
      await moveFiles(ids, dest);
    } catch (e) {
      if (!notThere(e)) throw e;
      for (const id of ids) await patchFile(id, { folder: dest });
    }
  };

  /** A folder and everything in it, copied to `to` (empty folders too). */
  const copyFolder = async (from: string, to: string) => {
    for (const p of foldersUnder(from)) await createFolder(joinPath(to, p.slice(from.length + 1)), branchId).catch(() => undefined);
    const q = new URLSearchParams({ folder: from, recursive: "true", limit: "500" });
    if (branchId) q.set("branch_id", branchId);
    const files = await api<ExplorerFile[]>(`/api/files?${q}`);
    const byFolder = new Map<string, string[]>();
    for (const f of files) {
      const rest = cleanFolder(f.folder ?? "").slice(from.length + 1);
      const into = joinPath(to, rest);
      byFolder.set(into, [...(byFolder.get(into) ?? []), f.id]);
    }
    let n = 0;
    for (const [into, ids] of byFolder) n += (await copyFiles(ids, into)).copied ?? ids.length;
    return n;
  };

  /** Move (cut) or copy items into `dest`. Returns false when nothing could go. */
  const transfer = async (mode: Clipboard["mode"], items: ClipItem[], dest: string, opts: { quiet?: boolean } = {}): Promise<boolean> => {
    const plan = planPaste({ mode, branchId: branchId ?? "", items }, dest);
    if (!opts.quiet) skippedNote(plan);
    if (!plan.files.length && !plan.folders.length) return false;
    const where = placeName(dest);
    const id = toast.loading(mode === "cut" ? t("Moving…") : t("Copying…"));
    try {
      if (mode === "cut") {
        if (plan.files.length) await moveFilesTo(plan.files, dest);
        for (const f of plan.folders) await renameFolder(f.from, f.to, branchId);
        toast.success(t("Moved {what} to {folder}.", { what: itemsWord(plan.files.length, plan.folders.length), folder: where }), { id });
      } else {
        let skipped = 0;
        if (plan.files.length) {
          const r = await copyFiles(plan.files, dest);
          skipped = Array.isArray(r.skipped) ? r.skipped.length : r.skipped || 0;
        }
        for (const f of plan.folders) await copyFolder(f.from, f.to);
        toast.success(t("Copied {what} to {folder}.", { what: itemsWord(plan.files.length - skipped, plan.folders.length), folder: where }), {
          id, description: skipped ? t("{n} could not be copied.", { n: skipped }) : undefined,
        });
      }
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? t("This server cannot do that yet. Update it, then try again.") : errorMessage(e), { id });
      return false;
    } finally {
      refresh();
    }
  };

  const newFolder = async (parent: string, name: string): Promise<string | null> => {
    const path = joinPath(parent, name.trim());
    try {
      await createFolder(path, branchId);
      toast.success(t("Folder “{name}” made.", { name: name.trim() }));
      return path;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      refresh();
    }
  };

  const renameFolderTo = async (path: string, name: string): Promise<boolean> => {
    const to = joinPath(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", name.trim());
    if (to === path) return true;
    try {
      await renameFolder(path, to, branchId);
      toast.success(t("Renamed to {name}.", { name: name.trim() }));
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      refresh();
    }
  };

  const renameFileTo = async (f: ExplorerFile, name: string): Promise<boolean> => {
    const clean = name.trim();
    if (!clean || clean === f.name) return true;
    try {
      await renameFile(f.id, clean);
      toast.success(t("Renamed to {name}.", { name: clean }));
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      refresh();
    }
  };

  /** Delete files, and folders that hold nothing; a folder with files in it is explained. */
  const remove = async (files: ExplorerFile[], folders: string[]) => {
    let gone = 0;
    for (const f of files) {
      try {
        await deleteFile(f.id);
        gone += 1;
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    let foldersGone = 0;
    for (const p of folders) {
      try {
        await deleteFolder(p, branchId);
        foldersGone += 1;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast.error(t("{name} is not empty. Move or delete what is inside it first.", { name: p.split("/").pop() ?? p }));
        else toast.error(errorMessage(e));
      }
    }
    refresh();
    if (gone || foldersGone) toast.success(t("Deleted {what}.", { what: itemsWord(gone, foldersGone) }));
  };

  return { transfer, newFolder, renameFolderTo, renameFileTo, remove, refresh, placeName };
}
