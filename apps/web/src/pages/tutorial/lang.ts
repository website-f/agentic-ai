/** Picks the tutorial's words (tracks, lessons, glossary, FAQ) for the current language.
 * content.ms.ts mirrors content.ts exactly; useTutorialText() re-renders on a language switch. */
import type { Track } from "@/lib/tutorial";
import { useLang, type Lang } from "@/i18n";

import { FAQ, GLOSSARY, TRACKS, type Faq, type Term, type TrackInfo } from "./content";
import { FAQ_MS, GLOSSARY_MS, TRACKS_MS } from "./content.ms";

export interface TutorialText {
  tracks: TrackInfo[];
  trackById: Record<Track, TrackInfo>;
  glossary: Term[];
  faq: Faq[];
}

const byId = (tracks: TrackInfo[]) => Object.fromEntries(tracks.map((t) => [t.id, t])) as Record<Track, TrackInfo>;

const TEXT: Record<Lang, TutorialText> = {
  en: { tracks: TRACKS, trackById: byId(TRACKS), glossary: GLOSSARY, faq: FAQ },
  ms: { tracks: TRACKS_MS, trackById: byId(TRACKS_MS), glossary: GLOSSARY_MS, faq: FAQ_MS },
};

export const tutorialText = (lang: Lang): TutorialText => TEXT[lang];

/** The tutorial in the current language. */
export function useTutorialText(): TutorialText {
  return TEXT[useLang((s) => s.lang)];
}
