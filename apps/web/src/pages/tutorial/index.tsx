/** Tutorial (P19): the whole system taught by role, from the first agent to seeing results.
 * Lessons tick themselves from real data (GET /api/tutorial/progress) or by hand
 * ("Mark as done", kept in users.prefs.tutorial.done). */
import {
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  BookOpenTextIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  QuestionIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { tutorialProgressQuery, useSavePrefs, type Track, type TutorialProgress } from "@/lib/tutorial";
import { cn } from "@/lib/utils";

import { LessonArt } from "./art";
import { FAQ, GLOSSARY, TRACK_BY_ID, TRACKS, lessonState, lessonText, parseStep, trackOfRole, type Lesson } from "./content";

/** A progress ring: how much of a track is done. */
export function ProgressRing({ done, total, size = 76 }: { done: number; total: number; size?: number }) {
  const stroke = size > 60 ? 7 : 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}
      role="img" aria-label={`${done} of ${total} lessons done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} className="transition-[stroke-dashoffset] duration-500" />
      </svg>
      <span className="absolute text-center leading-none">
        <span className="block text-[17px] font-semibold tabular">{done}</span>
        <span className="block text-[10.5px] text-muted">of {total}</span>
      </span>
    </span>
  );
}

/** "Open **Tasks**" with the UI words as small chips. */
function StepText({ text }: { text: string }) {
  return (
    <>
      {parseStep(text).map((p, i) =>
        p.ui ? (
          <span key={i} className="rounded-[5px] border border-border bg-surface-2 px-1.5 py-px text-[12.5px] font-medium text-fg [box-decoration-break:clone]">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function ShowMe({ lesson, size = "sm", variant = "primary" }: { lesson: Lesson; size?: "sm" | "md"; variant?: "primary" | "outline" }) {
  return (
    <Button asChild size={size} variant={variant}>
      <Link to={lesson.show.to as "/"} search={(lesson.show.search ?? {}) as never}>
        {lesson.show.label ?? "Show me"} <ArrowRightIcon size={14} />
      </Link>
    </Button>
  );
}

function LessonCard({
  lesson,
  index,
  state,
  open,
  onToggle,
  canOpen,
  onMark,
  saving,
}: {
  lesson: Lesson;
  index: number;
  state: "auto" | "manual" | false;
  open: boolean;
  onToggle: () => void;
  canOpen: boolean;
  onMark: () => void;
  saving: boolean;
}) {
  const panel = `lesson-${lesson.id}`;
  return (
    <li id={`l-${lesson.id}`} className="scroll-mt-20">
      <Card className={cn("overflow-hidden", open && "shadow-[var(--shadow-soft)]")}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel}
          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/50 sm:px-5">
          <span className={cn("mt-0.5 grid size-8 place-items-center rounded-full text-[13px] font-semibold tabular ring-1 ring-inset",
            state ? "bg-ok/12 text-ok ring-ok/20" : "bg-surface-2 text-muted ring-border")}>
            {state ? <CheckIcon size={15} weight="bold" /> : index + 1}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14.5px] font-semibold break-words">{lesson.title}</span>
              {state === "auto" ? <Pill tone="ok" title="Spotted in your real data">Done</Pill>
                : state === "manual" ? <Pill tone="ok">Marked done</Pill> : null}
            </span>
            <span className="text-[13px] text-muted">{lesson.why}</span>
          </span>
          <CaretDownIcon size={16} className={cn("mt-2 text-muted transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <div id={panel} className="grid gap-4 border-t border-border px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_15rem]">
            <ol className="grid content-start gap-2.5">
              {lesson.steps.map((s, i) => (
                <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 text-[13.5px] leading-6">
                  <span className="mt-0.5 grid size-5 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent tabular">{i + 1}</span>
                  <span className="min-w-0 break-words">
                    <StepText text={s} />
                  </span>
                </li>
              ))}
            </ol>
            <LessonArt kind={lesson.art} icon={lesson.icon} tone={lesson.tone} className="w-full max-md:mx-auto max-md:max-w-[17rem]" />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3.5 md:col-span-2 max-sm:[&>*]:flex-1">
              {canOpen ? <ShowMe lesson={lesson} /> : (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
                  <LockSimpleIcon size={14} /> Your role cannot open this page. Ask an owner or your manager.
                </span>
              )}
              {state === "auto" ? (
                <span className="inline-flex items-center justify-center gap-1.5 text-[12.5px] text-ok">
                  <CheckCircleIcon size={15} weight="fill" /> Done: we spotted it in your work
                </span>
              ) : (
                <Button size="sm" variant={state ? "ghost" : "outline"} onClick={onMark} disabled={saving}>
                  {state ? <><ArrowUUpLeftIcon size={14} /> Not done yet</> : <><CheckIcon size={14} weight="bold" /> Mark as done</>}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function NextUp({
  track,
  progress,
  roleTrack,
  next,
  canOpen,
  onOpenLesson,
}: {
  track: Track;
  progress: TutorialProgress | undefined;
  roleTrack: Track;
  next: Lesson | undefined;
  canOpen: boolean;
  onOpenLesson: (l: Lesson) => void;
}) {
  const info = TRACK_BY_ID[track];
  const done = info.lessons.filter((l) => lessonState(l, progress?.signals, progress?.done)).length;
  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_70%)]" />
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 p-4 sm:p-5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        {progress ? <ProgressRing done={done} total={info.lessons.length} /> : <Skeleton className="size-[76px] rounded-full" />}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">
            {info.title}
            {track === roleTrack ? <Pill tone="accent" className="tracking-normal normal-case">Your track</Pill> : null}
          </p>
          <h2 className="mt-1 text-[17px] leading-snug font-semibold break-words">
            {next ? <>Next up: {next.title}</> : "You finished this track"}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {next ? next.why : "Every lesson here is done. Peek at another track, or keep the glossary below handy."}
          </p>
          <p className="mt-1.5 text-[12px] text-muted max-sm:hidden">{info.who}: {info.blurb}</p>
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 md:col-span-1 md:flex-col md:items-stretch max-sm:[&>*]:flex-1">
          {next ? (
            <>
              {canOpen ? <ShowMe lesson={next} size="md" /> : null}
              <Button variant="outline" onClick={() => onOpenLesson(next)}>Read the steps</Button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok"><TrophyIcon size={18} weight="duotone" /> All done</span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Glossary({ q }: { q: string }) {
  const terms = GLOSSARY.filter((t) => !q || `${t.term} ${t.meaning}`.toLowerCase().includes(q));
  return (
    <Card id="glossary" className="scroll-mt-20">
      <CardHeader icon={<IconTile icon={BookOpenTextIcon} size="sm" />} title="Glossary" description="The words you will see around the app, in plain language." />
      <CardBody>
        {terms.length ? (
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-4 sm:grid-cols-2">
            {terms.map((t) => (
              <div key={t.term} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                <IconTile icon={t.icon} tone={t.tone} size="sm" />
                <div className="min-w-0">
                  <dt className="text-[13.5px] font-semibold">{t.term}</dt>
                  <dd className="text-[13px] text-muted">{t.meaning}</dd>
                </div>
              </div>
            ))}
          </dl>
        ) : <p className="text-[13px] text-muted">No word matches your search.</p>}
      </CardBody>
    </Card>
  );
}

function Faqs({ q }: { q: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const items = FAQ.filter((f) => !q || `${f.q} ${f.a}`.toLowerCase().includes(q));
  return (
    <Card id="faq" className="scroll-mt-20">
      <CardHeader icon={<IconTile icon={QuestionIcon} tone="info" size="sm" />} title="Questions people ask" description="Costs, safety, mistakes and privacy." />
      {items.length ? (
        <ul className="divide-y divide-border">
          {items.map((f) => {
            const on = open === f.q || !!q;
            return (
              <li key={f.q}>
                <button type="button" aria-expanded={on} onClick={() => setOpen(open === f.q ? null : f.q)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] font-medium transition-colors hover:bg-surface-2/50 sm:px-5">
                  <span className="min-w-0 flex-1 break-words">{f.q}</span>
                  <CaretDownIcon size={15} className={cn("shrink-0 text-muted transition-transform", on && "rotate-180")} />
                </button>
                {on ? <p className="px-4 pb-4 text-[13px] leading-6 text-muted sm:px-5">{f.a}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : <CardBody><p className="text-[13px] text-muted">No question matches your search.</p></CardBody>}
    </Card>
  );
}

export function TutorialPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const search = useSearch({ strict: false }) as { track?: Track };
  const navigate = useNavigate();
  const { data: progress } = useQuery(tutorialProgressQuery);
  const save = useSavePrefs();
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const roleTrack = progress?.track ?? trackOfRole(me.role);
  const track = search.track ?? roleTrack;
  const info = TRACK_BY_ID[track];
  const q = query.trim().toLowerCase();
  const state = (l: Lesson) => lessonState(l, progress?.signals, progress?.done);
  const canOpen = (l: Lesson) => !l.perm || l.perm.some((p) => me.permissions.includes(p));
  const next = info.lessons.find((l) => !state(l));

  const lessons = info.lessons.filter((l) => !q || lessonText(l).includes(q));
  const elsewhere = q
    ? TRACKS.filter((t) => t.id !== track)
        .map((t) => ({ t, n: t.lessons.filter((l) => lessonText(l).includes(q)).length }))
        .filter((x) => x.n)
    : [];

  const isOpen = (l: Lesson) => toggled[l.id] ?? (q ? true : l.id === next?.id);
  const setTrack = (t: Track) => {
    setToggled({});
    navigate({ to: "/tutorial", search: t === roleTrack ? {} : { track: t }, replace: true });
  };
  const openLesson = (l: Lesson) => {
    setToggled((x) => ({ ...x, [l.id]: true }));
    requestAnimationFrame(() => document.getElementById(`l-${l.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const mark = (l: Lesson) => {
    const done = progress?.done ?? [];
    const list = done.includes(l.id) ? done.filter((d) => d !== l.id) : [...done, l.id];
    save.mutate({ tutorial: { done: list } }, { onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <Page>
      <PageHeader
        title="Tutorial"
        description="Learn the whole system step by step, from your first agent to seeing finished work. Pick your role; lessons tick themselves as you use the app."
      />

      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segmented<Track> label="Role track" value={track} onChange={setTrack}
          options={TRACKS.map((t) => ({
            value: t.id,
            label: progress ? `${t.label} ${t.lessons.filter((l) => state(l)).length}/${t.lessons.length}` : t.label,
          }))} />
        <SearchInput value={query} onChange={setQuery} placeholder="Search lessons, words and questions" className="max-md:flex-none md:max-w-sm" />
      </div>

      {!q ? <NextUp track={track} progress={progress} roleTrack={roleTrack} next={next} canOpen={!!next && canOpen(next)} onOpenLesson={openLesson} /> : null}

      <section aria-label={`${info.title} lessons`} className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{q ? `Lessons matching "${query.trim()}"` : `${info.label} lessons`}</h2>
            <p className="text-[13px] text-muted">{q ? `${lessons.length} in the ${info.title.toLowerCase()}` : `${info.lessons.length} short lessons, in order. Open one to see the steps.`}</p>
          </div>
          {elsewhere.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-muted">Also in</span>
              {elsewhere.map(({ t, n }) => (
                <Button key={t.id} size="sm" variant="outline" onClick={() => setTrack(t.id)}>{t.label} ({n})</Button>
              ))}
            </div>
          ) : null}
        </div>
        {lessons.length ? (
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
            {lessons.map((l) => (
              <LessonCard key={l.id} lesson={l} index={info.lessons.indexOf(l)} state={state(l)} open={isOpen(l)}
                onToggle={() => setToggled((x) => ({ ...x, [l.id]: !isOpen(l) }))}
                canOpen={canOpen(l)} onMark={() => mark(l)} saving={save.isPending} />
            ))}
          </ol>
        ) : (
          <EmptyState icon={MagnifyingGlassIcon} title="No lesson matches"
            body={elsewhere.length ? "Try one of the other tracks above, or a different word." : "Try a different word, like task, approval or schedule."} />
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Glossary q={q} />
        <Faqs q={q} />
      </div>
    </Page>
  );
}
