/** A recorded flow: the native video player (plays inline on iPhone) and a chapter list that
 * seeks. Until the video is captured, the written steps show in its place. */
import { FilmStripIcon, PlayIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { useGuideText } from "./lang";
import type { GuideVideo } from "./manifest";

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function FlowVideo({ id, title, video }: { id: string; title: string; video?: GuideVideo }) {
  const t = useT();
  const gt = useGuideText();
  const ref = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const doc = gt.flowDocs[id];
  const chapters = video?.chapters ?? [];
  const current = chapters.reduce((acc, c, i) => (c.t <= now + 0.25 ? i : acc), -1);
  const seek = (t: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = t;
    void v.play().catch(() => undefined);
  };
  const mobile = video?.device === "mobile";

  return (
    <div className="@container grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:p-4" id={`video-${id}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent">
          <FilmStripIcon size={18} weight="duotone" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold break-words">{title}</h3>
          {doc ? <p className="text-[13px] text-muted">{doc.summary}</p> : null}
        </div>
      </div>
      <div className={cn("grid min-w-0 gap-3", mobile ? "@md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @md:items-start" : "grid-cols-1")}>
        {video ? (
          <video
            ref={ref}
            controls
            playsInline
            preload="metadata"
            poster={video.poster}
            width={video.w}
            height={video.h}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            className={cn("block h-auto w-full rounded-[var(--radius-sm)] border border-border bg-black", mobile && "mx-auto max-w-[15rem]")}
          >
            <source src={video.src} type="video/mp4" />
          </video>
        ) : (
          <div className="grid aspect-video place-items-center rounded-[var(--radius-sm)] border border-dashed border-border bg-surface-2/50 px-4 text-center">
            <div className="grid justify-items-center gap-1.5">
              <PlayIcon size={22} weight="duotone" className="text-accent" />
              <p className="text-[12.5px] text-muted">{t("The video for this flow has not been recorded yet. The steps are below.")}</p>
            </div>
          </div>
        )}
        {chapters.length ? (
          <ol className="grid content-start gap-1" aria-label={t("Chapters")}>
            {chapters.map((c, i) => (
              <li key={`${c.t}-${i}`}>
                <button
                  type="button"
                  onClick={() => seek(c.t)}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2.5 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors pointer-coarse:py-2",
                    i === current ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <span className={cn("shrink-0 font-mono text-[12px] tabular", i === current ? "text-accent" : "text-muted")}>{clock(c.t)}</span>
                  <span className="min-w-0 break-words">{gt.chapterLabel(c.label)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : doc ? (
          <ol className="grid content-start gap-1.5 text-[13px]">
            {doc.steps.map((st, i) => (
              <li key={i} className="flex min-w-0 gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted tabular">{i + 1}</span>
                <span className="min-w-0 break-words">{st}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
