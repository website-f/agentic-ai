/** /explorer: the Library's Browse tab, a file explorer filling the Library frame (frame.tsx:
 * the full-screen header with Back, the company and the tabs). Down the side, the
 * company's folders (drop files and folders on them) and the ready-made folders (documents,
 * SOPs, guidelines, templates, what waits for review, task files, recent, made by AI, from
 * websites, uploaded); the rest of the screen is the folder you are in (browser.tsx). Any file
 * opens in the file panel (?f=), with its preview, details and actions. /files redirects here
 * with the same address, so older links keep working. */
import { ArrowRightIcon, BuildingsIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { useCompanies } from "@/lib/company";
import type { Clipboard } from "@/lib/explorer";
import { type StoreView } from "@/lib/file-store";
import { cleanFolder, fileTreeQuery, filesFromDrop, folderName, type PickedFile } from "@/lib/intake";
import { meQuery } from "@/lib/queries";
import { hasAny, type Branch } from "@/lib/types";
import { cn } from "@/lib/utils";

import { FilePanel } from "../documents/file-panel";
import { StoreViewBody } from "../documents/file-store";
import type { IntakeDropHandle } from "../documents/files-upload";
import { DocumentsFolder, SopsFolder, TemplatesFolder } from "../library-hub/collections";
import { BrowseCrumbs, LibraryTree, QuickFolders, useFolderTree, type TreeDrop } from "../library-hub/tree";
import { VIEW_INFO } from "../library-hub/views";
import { CompanyExplorer } from "./browser";
import { useLibraryFrame } from "./frame-context";
import { canDropInto, copyKey, draggedItems, endDrag, isFileDrag, isOwnDrag, startDrag, useExplorerOps } from "./ops";

// ---------------------------------------------------------------- pieces

/** Under "All companies": pick the company whose documents to work on. */
function CompanyPicker({ branches, onPick }: { branches: Branch[]; onPick: (id: string) => void }) {
  const t = useT();
  const trees = useQueries({ queries: branches.map((b) => fileTreeQuery(b.id)) });
  return (
    <section className="grid gap-3" data-guide="files.pick-company">
      <div className="rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 px-4 py-3">
        <p className="text-[14px] font-semibold">{t("Pick a company first")}</p>
        <p className="text-[13px] text-muted">{t("Each company keeps its own documents. Choose the one you are uploading for or want to browse.")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {branches.map((b, i) => {
          const n = trees[i]?.data?.total_files ?? 0;
          return (
            <Card key={b.id} interactive className="p-0">
              <button type="button" onClick={() => onPick(b.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-4 text-left">
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white" style={{ background: b.color || "var(--accent)" }}>
                  <BuildingsIcon size={20} weight="duotone" />
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[14px] font-semibold">{b.name}</span>
                  <span className="text-[12.5px] text-muted">{n ? (n === 1 ? t("1 file") : t("{n} files", { n: n.toLocaleString(locale()) })) : t("Open its documents")}</span>
                </span>
                <CaretRightIcon size={15} className="text-muted" />
              </button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the page

export function ExplorerPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const co = useCompanies();
  const search = useSearch({ from: "/library/explorer" });
  const navigate = useNavigate({ from: "/explorer" });
  // The frame's header hides the folder tree (wider screens).
  const treeHidden = useLibraryFrame()?.treeHidden ?? false;
  const canEdit = hasAny(me, "work.write");
  const branch = co.isAll ? null : co.selected;
  const view: StoreView = search.view ?? (search.task ? "tasks" : "folders");
  const folder = view === "folders" ? cleanFolder(search.folder ?? "") : "";

  const [treeOpen, setTreeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [clip, setClip] = useState<Clipboard | null>(null);
  const intake = useRef<IntakeDropHandle>(null);
  const { tree, root } = useFolderTree(branch?.id ?? null);
  const ops = useExplorerOps(branch, root);
  // A company with no files yet starts with the upload area open.
  const empty = !!tree && !tree.total_files && !tree.folders.length;
  const [seenEmpty, setSeenEmpty] = useState(false);
  if (empty && !seenEmpty && canEdit) {
    setSeenEmpty(true);
    setUploadOpen(true);
  }

  type Search = typeof search;
  const goto = (patch: (s: Search) => Search, replace = false) => void navigate({ search: patch, resetScroll: false, replace });
  const pickView = (v: StoreView) => {
    setTreeOpen(false);
    goto((s) => ({ ...s, view: v === "folders" ? undefined : v, task: undefined, folder: undefined, origin: undefined, f: undefined, page: undefined }));
  };
  const pickFolder = (p: string) => {
    setTreeOpen(false);
    goto((s) => ({ ...s, view: undefined, task: undefined, folder: p || undefined, f: undefined, page: undefined }));
  };
  const pickCompany = (id: string) => {
    co.select(id);
    pickFolder("");
  };
  const openFile = (id?: string) => goto((s) => ({ ...s, f: id, page: undefined }));

  const uploadInto = (files: PickedFile[], path: string) => {
    if (!files.length) return;
    setUploadOpen(true);
    intake.current?.upload(files, path);
  };

  const treeDrop: TreeDrop | undefined = branch && canEdit && view === "folders" ? {
    accepts: (path, e) => (isOwnDrag(e) ? canDropInto(path) : isFileDrag(e)),
    onDrop: (path, e) => {
      if (isOwnDrag(e)) {
        const its = draggedItems();
        endDrag();
        if (its) void ops.transfer(copyKey(e) ? "copy" : "cut", its, path);
      } else if (e.dataTransfer.files.length) {
        void filesFromDrop(e.dataTransfer).then((picked) => uploadInto(picked, path));
      }
    },
    onDragStart: (path, e) => startDrag(e, [{ kind: "folder", path }], folderName(path)),
    onDragEnd: endDrag,
  } : undefined;

  const treeEl = (
    <LibraryTree view={view} folder={folder} branch={branch} branches={co.branches} onView={pickView} onFolder={pickFolder} onCompany={pickCompany} drop={treeDrop} />
  );

  let body: ReactNode;
  if (view === "folders" && branch) {
    body = (
      <CompanyExplorer key={branch.id} branch={branch} folder={folder} openId={search.f} initialOrigin={search.origin} root={root} ops={ops}
        clip={clip} setClip={setClip} uploadOpen={uploadOpen} setUploadOpen={setUploadOpen} intake={intake} uploadInto={uploadInto}
        onFolder={pickFolder} onOpenFile={(id) => openFile(id)} onOpenTree={() => setTreeOpen(true)} />
    );
  } else {
    let inner: ReactNode;
    if (view === "folders") inner = <CompanyPicker branches={co.branches} onPick={pickCompany} />;
    else if (view === "documents") inner = <DocumentsFolder branch={branch} />;
    else if (view === "sops") inner = <SopsFolder branch={branch} />;
    else if (view === "templates") inner = <TemplatesFolder branch={branch} />;
    else inner = <StoreViewBody view={view} branchId={branch?.id ?? null} taskId={search.task} onOpen={openFile} openId={search.f} />;
    body = (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <BrowseCrumbs view={view} folder={folder} branch={branch} onRoot={() => pickFolder("")} onFolder={pickFolder} onOpenTree={() => setTreeOpen(true)}
          className="shrink-0 rounded-none border-0 border-b" />
        <div data-file-browser className="grid min-h-0 min-w-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {view !== "folders" ? <p className="text-[13px] text-muted">{t(VIEW_INFO[view].hint)}</p> : <QuickFolders branch={branch} onView={pickView} className="md:hidden" />}
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {co.isLoading && !co.branches.length ? (
        <div className="p-4"><Skeleton className="h-48" /></div>
      ) : !co.branches.length ? (
        <div className="p-4">
          <EmptyState icon={BuildingsIcon} title={t("No companies yet")} body={t("Add a company in Organization first. Each company keeps its own documents.")}
            action={<Button size="sm" variant="outline" onClick={() => void navigate({ to: "/organization" })}>{t("Open Organization")} <ArrowRightIcon size={13} /></Button>} />
        </div>
      ) : (
        <div className={cn("grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)]", !treeHidden && "md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)]")}>
          {!treeHidden ? <aside aria-label={t("Folders")} className="hidden min-h-0 min-w-0 overflow-y-auto overscroll-contain border-r border-border bg-surface p-2 md:block">{treeEl}</aside> : null}
          <main className="flex min-h-0 min-w-0 flex-col">{body}</main>
        </div>
      )}

      <SideSheet open={treeOpen} onOpenChange={setTreeOpen} title={t("Folders")} size="sm">{treeEl}</SideSheet>
      {/* Any file, from any folder or list: the file panel. Closing it leaves the page where it was. */}
      <FilePanel id={search.f} page={search.page}
        onClose={() => goto((s) => ({ ...s, f: undefined, page: undefined }), true)}
        onStep={(id) => goto((s) => ({ ...s, f: id, page: undefined }), true)} />
    </div>
  );
}
