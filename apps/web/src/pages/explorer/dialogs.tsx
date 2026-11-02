/** The explorer's dialogs: pick a folder to move or copy into, and why a folder that still
 * holds files cannot be deleted. */
import { CopyIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useT } from "@/i18n";
import { cleanFolder, type FolderNode } from "@/lib/intake";
import { cn } from "@/lib/utils";

/** Pick a folder (or type a new path) to move or copy into. */
export function FolderPickerDialog({ open, onOpenChange, mode, what, root, rootName, current, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "move" | "copy";
  /** "3 files", "1 folder and 2 files". */
  what: string;
  root: FolderNode;
  rootName: string;
  current: string;
  onPick: (folder: string) => void;
}) {
  const t = useT();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="w-[min(94vw,32rem)]"
      title={mode === "move" ? t("Move {what} to…", { what }) : t("Copy {what} to…", { what })}
      description={t("Pick a folder, or type a new one. Use / for a folder inside a folder.")}>
      <PickerForm mode={mode} root={root} rootName={rootName} current={current} onCancel={() => onOpenChange(false)}
        onPick={(f) => { onOpenChange(false); onPick(f); }} />
    </ResponsiveDialog>
  );
}

function PickerForm({ mode, root, rootName, current, onPick, onCancel }: {
  mode: "move" | "copy";
  root: FolderNode;
  rootName: string;
  current: string;
  onPick: (folder: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(current);
  const rows = useMemo(() => {
    const out: { path: string; name: string; depth: number }[] = [];
    const walk = (n: FolderNode, depth: number) => {
      for (const c of n.children) {
        out.push({ path: c.path, name: c.name, depth });
        walk(c, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [root]);
  const chosen = cleanFolder(value);
  const needle = value.trim().toLowerCase();
  const typing = !!needle && !rows.some((r) => r.path.toLowerCase() === needle);
  const shown = typing ? rows.filter((r) => r.path.toLowerCase().includes(needle)) : rows;
  const isNew = !!chosen && !rows.some((r) => r.path === chosen);
  const row = "flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2 pointer-coarse:min-h-11";
  return (
    <div className="grid gap-3">
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("e.g. OPERATIONS/SOP")} aria-label={t("Folder")}
        onKeyDown={(e) => { if (e.key === "Enter") onPick(chosen); }} />
      <ul className="grid max-h-[42dvh] gap-0.5 overflow-y-auto overscroll-contain">
        <li>
          <button type="button" onClick={() => setValue("")} className={cn(row, !chosen && "bg-accent-soft text-accent")}>
            <FolderOpenIcon size={15} className="shrink-0" /> <span className="truncate font-medium">{rootName}</span>
            <span className="shrink-0 text-[12px] text-muted">{t("top level")}</span>
          </button>
        </li>
        {shown.map((r) => (
          <li key={r.path}>
            <button type="button" onClick={() => setValue(r.path)} title={r.path}
              className={cn(row, chosen === r.path && "bg-accent-soft text-accent")} style={{ paddingLeft: `${0.625 + (typing ? 0 : r.depth) * 0.9}rem` }}>
              <FolderIcon size={15} weight={chosen === r.path ? "fill" : "duotone"} className="shrink-0 text-warn" />
              <span className="min-w-0 truncate">{typing ? r.path : r.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {isNew ? <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><FolderPlusIcon size={14} /> {t("A new folder {path} will be made.", { path: chosen })}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={onCancel}>{t("Cancel")}</Button>
        <Button onClick={() => onPick(chosen)}>
          {mode === "move" ? <><FolderOpenIcon size={15} /> {t("Move here")}</> : <><CopyIcon size={15} /> {t("Copy here")}</>}
        </Button>
      </div>
    </div>
  );
}

/** A folder with files in it is not deleted: say why and what to do. */
export function NotEmptyDialog({ folder, onClose, onOpen }: { folder: { name: string; path: string; files: number } | null; onClose: () => void; onOpen: (path: string) => void }) {
  const t = useT();
  return (
    <ResponsiveDialog open={!!folder} onOpenChange={(o) => !o && onClose()} title={t("{name} is not empty", { name: folder?.name ?? "" })}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t("OK")}</Button>
        {folder ? <Button onClick={() => { onOpen(folder.path); onClose(); }}><FolderOpenIcon size={15} /> {t("Open the folder")}</Button> : null}
      </>}>
      <p className="text-[13.5px] text-muted">
        {folder?.files === 1 ? t("It still holds 1 file. Only an empty folder can be deleted, so nothing is lost by accident. Move the file elsewhere or delete it, then delete the folder.")
          : t("It still holds {n} files. Only an empty folder can be deleted, so nothing is lost by accident. Move the files elsewhere or delete them, then delete the folder.", { n: folder?.files ?? 0 })}
      </p>
    </ResponsiveDialog>
  );
}
