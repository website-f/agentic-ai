/** P92: "Noted for next time: …" under a chat answer or on a task's timeline, the moment a
 * person's correction became a lesson. Undo takes it back (the lesson it replaced, if any,
 * is used again). Only whoever taught it, or an owner or admin, may undo. */
import { ArrowCounterClockwiseIcon, LightbulbIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { lessonKeys, undoLesson, type NotedLesson } from "@/lib/lessons";
import { cn } from "@/lib/utils";

export function LessonNote({ lesson, className }: { lesson: NotedLesson; className?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [undone, setUndone] = useState(false);
  const undo = useMutation({
    mutationFn: () => undoLesson(lesson.lesson_id),
    onSuccess: (r) => {
      setUndone(true);
      void qc.invalidateQueries({ queryKey: lessonKeys.all });
      toast.success(r.restored ? tr("Taken back. The earlier lesson is used again.") : tr("Taken back. It will not be used."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const label = undone ? t("Taken back:") : lesson.action === "confirmed" ? t("Already known, noted again:") : t("Noted for next time:");
  return (
    <div role="status" data-testid="lesson-note"
      className={cn("mt-2 flex min-w-0 items-start gap-2 rounded-[var(--radius-sm)] border border-info/30 bg-info/8 px-3 py-2 text-[13px]", undone && "opacity-70", className)}>
      <LightbulbIcon size={16} weight="duotone" className="mt-0.5 shrink-0 text-info" aria-hidden />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-medium">{label}</span> <span className={cn(undone && "line-through")}>{lesson.text}</span>
      </p>
      {!undone ? (
        <Button size="sm" variant="ghost" className="-my-1 h-8 shrink-0" loading={undo.isPending} onClick={() => undo.mutate()}>
          <ArrowCounterClockwiseIcon size={14} /> {t("Undo")}
        </Button>
      ) : null}
    </div>
  );
}
