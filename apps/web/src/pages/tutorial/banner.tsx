/** The first-time nudge on the Command center: "New here? Take the tutorial". Hidden once
 * dismissed (users.prefs.tutorial.dismissed) or once half the person's track is done. */
import { ArrowRightIcon, BookOpenTextIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { tutorialProgressQuery, useSavePrefs } from "@/lib/tutorial";

import { lessonState } from "./content";
import { useTutorialText } from "./lang";

export function TutorialBanner() {
  const t = useT();
  const { trackById } = useTutorialText();
  const { data } = useQuery(tutorialProgressQuery);
  const save = useSavePrefs();
  if (!data || data.dismissed) return null;
  const track = trackById[data.track];
  const total = track.lessons.length;
  const done = track.lessons.filter((l) => lessonState(l, data.signals, data.done)).length;
  if (done * 2 >= total) return null;
  const first = track.lessons.find((l) => !lessonState(l, data.signals, data.done));
  // The lesson title sits inside the sentence as a highlight; Malay word order is kept whole.
  const [before = "", after = ""] = t("Short lessons in plain words, starting with {lesson}.").split("{lesson}");

  return (
    <aside aria-label={t("Tutorial")}
      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/50 p-3.5 sm:p-4">
      <IconTile icon={BookOpenTextIcon} />
      <div className="min-w-0 max-sm:pr-6">
        <p className="text-[14px] font-semibold break-words">{t("New here? Take the {track} tutorial", { track: track.label.toLowerCase() })}</p>
        <p className="text-[13px] text-muted">
          {first ? (
            <>
              {before}
              <span className="font-medium text-fg">{first.title}</span>
              {after}
            </>
          ) : (
            t("Short lessons in plain words.")
          )}{" "}
          {t("{done} of {total} done.", { done, total })}
        </p>
      </div>
      <div className="flex items-center gap-1 max-sm:col-span-3 max-sm:[&>a]:flex-1">
        <Button asChild size="sm">
          <Link to="/tutorial">{t("Start the tutorial")} <ArrowRightIcon size={14} /></Link>
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("Hide the tutorial tip")} className="max-sm:absolute max-sm:top-2 max-sm:right-2"
          loading={save.isPending}
          onClick={() => save.mutate({ tutorial: { dismissed: true } }, { onError: (e) => toast.error(errorMessage(e)) })}>
          {save.isPending ? null : <XIcon size={15} />}
        </Button>
      </div>
    </aside>
  );
}
