/** Picks the guide's long-form words (pages, recipes, flows, slides) for the current language.
 * The English files stay the source; each Malay twin mirrors its structure exactly (see
 * content-parity.test.ts). Components call useGuideText() / useSlides(), so switching the
 * language re-renders the guide and the presentation straight away. */
import { useLang, type Lang } from "@/i18n";

import { FLOW_DOCS, PAGE_DOCS, type FlowDoc, type PageDoc } from "./content";
import { FLOW_CHAPTERS_MS, FLOW_DOCS_MS, PAGE_DOCS_MS } from "./content.ms";
import { SLIDES, type Slide } from "./slides";
import { SLIDES_MS } from "./slides.ms";
import { GUIDE_FLOWS, GUIDE_PAGES, type GuidePage } from "./targets";
import { GROUP_LABELS_MS, GUIDE_FLOWS_MS, GUIDE_PAGES_MS, type GuideFlow } from "./targets.ms";

export interface GuideText {
  lang: Lang;
  /** Pages in sidebar order; `group` is always the English key, show it with groupLabel(). */
  pages: GuidePage[];
  flows: readonly GuideFlow[];
  docs: Record<string, PageDoc>;
  flowDocs: Record<string, FlowDoc>;
  groupLabel: (group: string) => string;
  /** A recorded video's chapter label (captured in English). */
  chapterLabel: (label: string) => string;
  pageById: (id: string) => GuidePage | undefined;
}

function bundle(lang: Lang, pages: GuidePage[], flows: readonly GuideFlow[], docs: Record<string, PageDoc>, flowDocs: Record<string, FlowDoc>, groups: Record<string, string>, chapters: Record<string, string>): GuideText {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return {
    lang,
    pages,
    flows,
    docs,
    flowDocs,
    groupLabel: (g) => groups[g] ?? g,
    chapterLabel: (c) => chapters[c] ?? c,
    pageById: (id) => byId.get(id),
  };
}

const TEXT: Record<Lang, GuideText> = {
  en: bundle("en", GUIDE_PAGES, GUIDE_FLOWS, PAGE_DOCS, FLOW_DOCS, {}, {}),
  ms: bundle("ms", GUIDE_PAGES_MS, GUIDE_FLOWS_MS, PAGE_DOCS_MS, FLOW_DOCS_MS, GROUP_LABELS_MS, FLOW_CHAPTERS_MS),
};

const DECKS: Record<Lang, Slide[]> = { en: SLIDES, ms: SLIDES_MS };

export const guideText = (lang: Lang): GuideText => TEXT[lang];
export const slidesFor = (lang: Lang): Slide[] => DECKS[lang];

/** The guide's words in the current language; re-renders when it changes. */
export function useGuideText(): GuideText {
  return TEXT[useLang((s) => s.lang)];
}

/** The presentation's slides in the current language. */
export function useSlides(): Slide[] {
  return DECKS[useLang((s) => s.lang)];
}
