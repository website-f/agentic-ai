/** P92 "Lessons": what people taught the agents when they corrected them, and a daily digest
 * of how the office got smarter (lessons learned that day, skills improved, mistakes people
 * had to correct more than once). Owners and admins edit (the edit is itself recorded) and
 * forget; whoever taught a lesson can undo it. Built from what the office keeps
 * (GET /api/lessons, /api/learning/digest); no model is asked. */
import {
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  GraduationCapIcon,
  LightbulbIcon,
  PencilSimpleIcon,
  RepeatIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  digestQuery,
  editLesson,
  forgetLesson,
  lessonKeys,
  lessonsQuery,
  undoLesson,
  VIA_LABEL,
  type Lesson,
  type LessonDigest,
  type LessonEdit,
} from "@/lib/lessons";
import { timeAgo } from "@/lib/utils";

const ALL = "all";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** One lesson: the rule, its parts, who taught it and when it was last used. */
export function LessonRow({ l, onEdit, onForget, compact }: { l: Lesson; onEdit?: (l: Lesson) => void; onForget?: (l: Lesson) => void; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const undo = useMutation({
    mutationFn: () => undoLesson(l.id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: lessonKeys.all });
      toast.success(r.restored ? tr("Taken back. The earlier lesson is used again.") : tr("Taken back. It will not be used."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const parts: [string, string | null][] = [
    [t("When"), l.when],
    [t("Do"), l.do],
    [t("Don't"), l.dont],
    [t("Field"), l.field],
    [t("Example"), l.example],
  ];
  const shown = compact ? [] : parts.filter(([, v]) => v && !l.text.toLowerCase().includes(v.toLowerCase()));
  return (
    <li className="grid min-w-0 gap-1.5 px-4 py-3">
      <p className="text-[14px] break-words">{l.text}</p>
      {shown.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[12.5px]">
          {shown.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <Pill tone={l.topic === "eperolehan" ? "accent" : "neutral"}>{l.topic_label}</Pill>
        {l.agent_name ? <span>{l.agent_name}</span> : null}
        <span>· {t("taught by {name}, {when}", { name: l.taught_by_name, when: timeAgo(l.taught_at) })}</span>
        {l.via ? <span>({t(VIA_LABEL[l.via])})</span> : null}
        {l.taught > 1 ? <Pill tone="warn">{t("taught {n} times", { n: l.taught })}</Pill> : null}
        <span>· {l.uses ? t("used {n}×, last {when}", { n: l.uses, when: timeAgo(l.last_used_at) }) : t("not used yet")}</span>
        {l.folded_into ? <span>· {t("in skill {name}", { name: l.folded_into })}</span> : null}
        {l.private ? <Pill tone="info">{t("only this AI")}</Pill> : null}
        {l.state === "ended" ? <Pill tone="neutral">{l.end_reason === "replaced" ? t("Replaced by a newer lesson") : t("Not in use")}</Pill> : null}
      </div>
      {!compact && l.state === "active" && (l.can_edit || l.can_undo) ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {l.can_edit && onEdit ? (
            <Button size="sm" variant="outline" className="max-sm:h-9" onClick={() => onEdit(l)}><PencilSimpleIcon size={14} /> {t("Edit")}</Button>
          ) : null}
          {l.can_undo ? (
            <Button size="sm" variant="ghost" className="max-sm:h-9" loading={undo.isPending} onClick={() => undo.mutate()}><ArrowCounterClockwiseIcon size={14} /> {t("Undo")}</Button>
          ) : null}
          {l.can_edit && onForget ? (
            <Button size="sm" variant="ghost" className="text-danger max-sm:h-9" onClick={() => onForget(l)}><TrashIcon size={14} /> {t("Forget")}</Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function EditLesson({ l, onClose }: { l: Lesson; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<keyof LessonEdit, string>>({
    text: l.text, when: l.when ?? "", do: l.do ?? "", dont: l.dont ?? "", field: l.field ?? "", example: l.example ?? "",
  });
  const save = useMutation({
    mutationFn: () => editLesson(l.id, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lessonKeys.all });
      toast.success(tr("Saved. The old wording is kept in the history."));
      onClose();
    },
  });
  const set = (k: keyof LessonEdit) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Edit lesson")}
      description={t("Your change is kept as a correction: the agents use the new wording from now on.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button loading={save.isPending} disabled={form.text.trim().length < 8} onClick={() => save.mutate()}>{t("Save")}</Button>
        </>
      }>
      <div className="grid gap-3">
        <TextareaField label={t("The lesson, in one sentence")} value={form.text} onChange={set("text")} maxLength={300} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("When")} value={form.when} onChange={set("when")} maxLength={200} />
          <Field label={t("Field or step")} value={form.field} onChange={set("field")} maxLength={200} />
          <Field label={t("Do")} value={form.do} onChange={set("do")} maxLength={200} />
          <Field label={t("Don't")} value={form.dont} onChange={set("dont")} maxLength={200} />
        </div>
        <Field label={t("Example")} value={form.example} onChange={set("example")} maxLength={200} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function Digest({ day, onDay }: { day?: string; onDay: (d: string | undefined) => void }) {
  const t = useT();
  const q = useQuery(digestQuery(day));
  const d: LessonDigest | undefined = q.data;
  return (
    <Card aria-label={t("Getting smarter every day")}>
      <CardHeader icon={<IconTile icon={GraduationCapIcon} tone="accent" size="sm" />} title={t("Getting smarter every day")}
        description={t("What one day taught the agents: lessons from people, skills that improved, and mistakes corrected more than once.")} />
      <CardBody className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="icon-sm" variant="outline" disabled={!d} onClick={() => d && onDay(d.previous)} aria-label={t("The day before")}><CaretLeftIcon size={15} /></Button>
          <span className="min-w-32 text-center text-[14px] font-semibold">{d ? (d.next ? dayLabel(d.day) : t("Today")) : t("Loading…")}</span>
          <Button size="icon-sm" variant="outline" disabled={!d?.next} onClick={() => d?.next && onDay(d.next)} aria-label={t("The day after")}><CaretRightIcon size={15} /></Button>
        </div>
        {q.isLoading ? <Skeleton className="h-24 rounded-[var(--radius-md)]" /> : q.error || !d ? (
          <p role="alert" className="text-[13px] text-danger">{errorMessage(q.error)}</p>
        ) : (
          <>
            <StatGrid className="grid-cols-1 sm:grid-cols-3">
              <Stat label={t("Lessons learned")} value={d.totals.lessons} icon={LightbulbIcon} tone="accent"
                hint={d.totals.replaced ? t("{n} replaced an older one", { n: d.totals.replaced }) : t("From people's corrections")} />
              <Stat label={t("Skills improved")} value={d.totals.skills} icon={SparkleIcon} tone="ok" hint={t("New versions that day")} />
              <Stat label={t("Repeated mistakes")} value={d.totals.repeated} icon={RepeatIcon} tone={d.totals.repeated ? "warn" : "neutral"}
                hint={t("Corrected more than once")} />
            </StatGrid>
            {d.lessons.length ? (
              <section className="grid gap-1.5">
                <h3 className="text-[13px] font-semibold">{t("Lessons learned")}</h3>
                <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                  {d.lessons.slice(0, 10).map((l) => <LessonRow key={l.id} l={l} compact />)}
                </ul>
              </section>
            ) : (
              <p className="text-[13px] text-muted">{t("No new lessons this day. When someone corrects an agent, the lesson shows here.")}</p>
            )}
            {d.repeated.length ? (
              <section className="grid gap-1.5">
                <h3 className="text-[13px] font-semibold text-warn">{t("Repeated mistakes")}</h3>
                <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-warn/30 bg-surface">
                  {d.repeated.slice(0, 10).map((l) => <LessonRow key={l.id} l={l} compact />)}
                </ul>
              </section>
            ) : null}
            {d.skills.length ? (
              <section className="grid gap-1.5">
                <h3 className="text-[13px] font-semibold">{t("Skills improved")}</h3>
                <ul className="grid gap-1 text-[13px]">
                  {d.skills.map((s) => (
                    <li key={`${s.skill_id}-${s.version}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium">{s.name}</span>
                      <Pill tone="ok">{t("version {n}", { n: s.version })}</Pill>
                      <span className="text-muted">{s.auto ? t("went live by itself after its tests") : t("approved by a person")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function LessonsView() {
  const t = useT();
  const qc = useQueryClient();
  const [day, setDay] = useState<string | undefined>();
  const [topic, setTopic] = useState(ALL);
  const [agent, setAgent] = useState(ALL);
  const [state, setState] = useState<"active" | "all">("active");
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [forgetting, setForgetting] = useState<Lesson | null>(null);
  const q = useQuery(lessonsQuery({ topic: topic === ALL ? undefined : topic, agent: agent === ALL ? undefined : agent, state }));
  const list = q.data;
  const forget = async () => {
    if (!forgetting) return;
    try {
      await forgetLesson(forgetting.id);
      void qc.invalidateQueries({ queryKey: lessonKeys.all });
      toast.success(tr("Forgotten. The agents no longer use it."));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Digest day={day} onDay={setDay} />
      <Card aria-label={t("Lessons")}>
        <CardHeader icon={<IconTile icon={LightbulbIcon} tone="warn" size="sm" />} title={t("Lessons")}
          description={t("Each time someone corrects an agent, it keeps one short lesson and uses it on that kind of work every time.")} />
        <CardBody className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Select label={t("Topic")} value={topic} onValueChange={setTopic}
              options={[{ value: ALL, label: t("All topics") }, ...(list?.topics ?? []).map((x) => ({ value: x.key, label: `${x.label} (${x.count})` }))]} />
            <Select label={t("Agent")} value={agent} onValueChange={setAgent}
              options={[{ value: ALL, label: t("All agents") }, ...(list?.agents ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.count})` }))]} />
            <Select label={t("Show")} value={state} onValueChange={(v) => setState(v === "all" ? "all" : "active")}
              options={[{ value: "active", label: t("In use") }, { value: "all", label: t("Also replaced and forgotten") }]} />
          </div>
          {q.isLoading ? <Skeleton className="h-40 rounded-[var(--radius-md)]" /> : q.error || !list ? (
            <p role="alert" className="text-[13px] text-danger">{errorMessage(q.error)}</p>
          ) : list.items.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
              {list.items.map((l) => <LessonRow key={l.id} l={l} onEdit={setEditing} onForget={setForgetting} />)}
            </ul>
          ) : (
            <EmptyState icon={LightbulbIcon} title={t("No lessons yet")}
              body={t("Send work back with what was wrong, answer an agent's question with the rule, or tell it in chat: it keeps the lesson for next time.")} />
          )}
        </CardBody>
      </Card>
      {editing ? <EditLesson key={editing.id} l={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={!!forgetting} onOpenChange={(o) => !o && setForgetting(null)} title={t("Forget this lesson?")}
        body={forgetting?.text ?? ""} confirmLabel={t("Forget")} danger onConfirm={forget} />
    </div>
  );
}

/** What people taught one agent (its page's "What it knows", and the twin's): staff see
 * their own AI's lessons here and can undo what they taught. */
export function AgentLessons({ agentId, name }: { agentId: string; name: string }) {
  const t = useT();
  const q = useQuery(lessonsQuery({ agent: agentId }));
  const items = q.data?.items ?? [];
  return (
    <section className="grid min-w-0 content-start gap-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold">{t("What people taught {name}", { name })} <span className="font-normal text-muted">{items.length}</span></h2>
        <p className="text-[13px] text-muted">{t("Lessons from corrections. It uses them on that kind of work every time.")}</p>
      </div>
      {q.isLoading ? <Skeleton className="h-20 rounded-[var(--radius-md)]" /> : items.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
          {items.slice(0, 30).map((l) => <LessonRow key={l.id} l={l} />)}
        </ul>
      ) : (
        <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-[13px] text-muted">
          {t("Nothing yet. When you correct {name} (send work back, answer its question, or say \"no, ...\" in chat), the lesson shows here.", { name })}
        </p>
      )}
    </section>
  );
}
