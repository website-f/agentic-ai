/** Files people gave a task (P10), and a drop zone to give it more: the agent reads them with
 * read_file (POST /api/tasks/{id}/files tells an agent that already started). */
import { DownloadSimpleIcon, PaperclipIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { FileDrop, FileGlyph, FileStatus } from "@/components/file-drop";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { docKeys, fileSize, filesQuery, fileUrl, type DocFile } from "@/lib/documents";
import { timeAgo } from "@/lib/utils";
import { workKeys } from "@/lib/work";

export function TaskFiles({ taskId, canWrite }: { taskId: string; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: files = [] } = useQuery(filesQuery({ task_id: taskId, origin: "uploaded" }));
  const attach = useMutation({
    mutationFn: (ids: string[]) => api<DocFile[]>(`/api/tasks/${taskId}/files`, "POST", { file_ids: ids }),
    onSuccess: (done) => {
      void qc.invalidateQueries({ queryKey: docKeys.files });
      void qc.invalidateQueries({ queryKey: workKeys.task(taskId) });
      toast.success(done.length === 1 ? t("Attached to the task. The agent can read it.") : t("{n} files attached. The agent can read them.", { n: done.length }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!files.length && !canWrite) return null;
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      <h3 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold">
        <PaperclipIcon size={15} weight="duotone" className="text-muted" />
        {t("Attached files")}
        {files.length ? <span className="font-normal text-muted tabular">{files.length}</span> : null}
      </h3>
      {files.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
          {files.map((f) => (
            <li key={f.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
              <FileGlyph mime={f.mime} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{f.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                  {[fileSize(f.size), timeAgo(f.created_at)].join(" · ")} <FileStatus f={f} />
                </span>
              </span>
              <a href={fileUrl(f.id)} download className="grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("Download {name}", { name: f.name })}>
                <DownloadSimpleIcon size={16} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite ? <FileDrop compact onUploaded={(fs) => attach.mutate(fs.map((f) => f.id))} /> : null}
    </section>
  );
}
