/** The user guide: every page explained with an annotated screenshot, steps whose numbers
 * light up the control they mention, short flow videos and links into the real page.
 * /guide is the index (grouped like the sidebar, searchable); /guide/<page id> is one chapter.
 * Screenshots and videos come from the capture manifest; missing ones show placeholders.
 *
 * P102: the guide is its own full-screen page (router.tsx: outside the office layout), so
 * there is one sidebar, the chapter list: one header (Back to the office, the guide's search,
 * Tutorial / Guide / Present, language, theme), the chapter list beside the reading column on
 * wide screens and in a drawer on phones. Each chapter reads top to bottom: what this page is
 * for, where to find it (the real sidebar path, from nav.ts), the steps, then where to click
 * on the screen. */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BookBookmarkIcon,
  BookOpenTextIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CursorClickIcon,
  DesktopIcon,
  DeviceMobileIcon,
  FilmStripIcon,
  LightbulbIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  MapTrifoldIcon,
  MoonIcon,
  PresentationIcon,
  SidebarSimpleIcon,
  SunIcon,
  TargetIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Drawer } from "vaul";

import { LanguageSwitch } from "@/components/language-switch";
import { LogoMark } from "@/components/logo";
import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { AnnotatedShot, ShotPlaceholder, ShotThumb } from "@/guide/annotated-shot";
import { plain, type PageDoc, type Recipe } from "@/guide/content";
import { groupedPages, searchGuide, shotKeys, shotOf, useManifest, videoOf, type Device } from "@/guide/data";
import { FlowVideo } from "@/guide/flow-video";
import { useGuideText } from "@/guide/lang";
import type { GuideManifest } from "@/guide/manifest";
import { PAGE_ICONS, Rich, stateLabel } from "@/guide/rich";
import type { GuidePage as GuidePageInfo } from "@/guide/targets";
import { whereOf } from "@/guide/where";
import { locale, useT } from "@/i18n";
import { useBackClose } from "@/lib/back-close";
import { useTheme } from "@/lib/stores";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- leaving

/** Where "Back to the office" goes: the page the guide was opened from (however many chapters
 * were read since), else the office's start page. Kept for the tab, so a reload still knows. */
const ENTRY = "agentic.guide.entry";
type HistoryState = { __TSR_index?: number };

function useLeave() {
  const router = useRouter();
  const navigate = useNavigate();
  const index = () => (router.history.location.state as HistoryState).__TSR_index ?? 0;
  const [start] = useState(() => {
    const now = index();
    try {
      const saved = Number(sessionStorage.getItem(ENTRY));
      if (Number.isInteger(saved) && saved > 0 && saved <= now) return saved;
    } catch {
      // private mode: this visit only
    }
    return now;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(ENTRY, String(start));
    } catch {
      // private mode
    }
    // Leaving the guide any way at all ends this visit.
    return () => {
      try {
        sessionStorage.removeItem(ENTRY);
      } catch {
        // private mode
      }
    };
  }, [start]);
  return () => {
    const now = index();
    if (start > 0 && start <= now) router.history.go(start - now - 1);
    else void navigate({ to: "/" });
  };
}

// ---------------------------------------------------------------- header pieces

const MODES = [
  { to: "/tutorial", label: "Tutorial", icon: BookOpenTextIcon },
  { to: "/guide", label: "Guide", icon: BookBookmarkIcon },
  { to: "/present", label: "Present", icon: PresentationIcon },
] as const;

/** Tutorial / Guide / Present: the three ways to learn the office. */
function ModeSwitch({ className, onPick }: { className?: string; onPick?: () => void }) {
  const t = useT();
  return (
    <nav aria-label={t("Learn")} className={cn("flex shrink-0 gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface-2/60 p-0.5", className)}>
      {MODES.map((m) => {
        const on = m.to === "/guide";
        return (
          <Link
            key={m.to}
            to={m.to}
            onClick={onPick}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-11",
              on ? "bg-surface text-fg shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] ring-1 ring-border" : "text-muted hover:text-fg",
            )}
          >
            <m.icon size={16} weight={on ? "fill" : "regular"} /> {t(m.label)}
          </Link>
        );
      })}
    </nav>
  );
}

function ThemeButton({ className }: { className?: string }) {
  const t = useT();
  const { pref, setPref } = useTheme();
  const dark = pref === "dark" || (pref === "system" && typeof document !== "undefined" && document.documentElement.dataset.theme === "dark");
  const label = dark ? t("Switch to light") : t("Switch to dark");
  return (
    <Button variant="ghost" size="icon" className={cn("shrink-0 pointer-coarse:size-11", className)} onClick={() => setPref(dark ? "light" : "dark")} aria-label={label} title={label}>
      {dark ? <SunIcon size={19} /> : <MoonIcon size={19} />}
    </Button>
  );
}

// ---------------------------------------------------------------- chapter list

function PageIndex({ current, onPick }: { current?: string; onPick?: () => void }) {
  const t = useT();
  const gt = useGuideText();
  const groups = groupedPages(gt.pages);
  const link = "flex min-h-10 items-center gap-2.5 rounded-sm px-3 py-1.5 text-[14px] transition-colors pointer-coarse:min-h-11";
  return (
    <nav aria-label={t("Chapters")} className="grid gap-5">
      <Link to="/guide" onClick={onPick} aria-current={!current ? "page" : undefined}
        className={cn(link, "font-medium", !current ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-2")}>
        <BookOpenTextIcon size={18} weight={!current ? "fill" : "regular"} className="shrink-0" /> {t("Guide home")}
      </Link>
      {groups.map((g) => (
        <div key={g.group}>
          <p className="px-3 pb-1.5 text-[11.5px] font-semibold tracking-[0.08em] text-muted uppercase">{gt.groupLabel(g.group)}</p>
          <ul className="grid gap-0.5">
            {g.pages.map((p) => {
              const IconCmp = PAGE_ICONS[p.id] ?? BookBookmarkIcon;
              const on = p.id === current;
              return (
                <li key={p.id}>
                  <Link
                    to="/guide/$page"
                    params={{ page: p.id }}
                    onClick={onPick}
                    aria-current={on ? "page" : undefined}
                    className={cn(link, on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
                  >
                    <IconCmp size={18} weight={on ? "fill" : "regular"} className="shrink-0" />
                    <span className="min-w-0 truncate">{p.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Phones and tablets: the chapter list, the search and the switches live in one drawer. */
function ChapterDrawer({ current, query, onQuery }: { current?: GuidePageInfo; query: string; onQuery: (q: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false)); // the phone's Back closes the drawer
  const close = () => setOpen(false);
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <Button variant="outline" className="h-11 shrink-0 gap-2 px-3 lg:hidden" aria-label={t("Chapters")}>
          <ListBulletsIcon size={18} /> <span className="max-[359px]:sr-only">{t("Chapters")}</span>
        </Button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
        >
          <div aria-hidden className="mx-auto mt-2.5 mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          <div className="grid gap-3 px-4 pb-3">
            <Drawer.Title className="text-[16px] font-semibold">{t("User guide")}</Drawer.Title>
            <SearchInput value={query} onChange={onQuery} placeholder={t("Search the guide")} className="basis-auto" />
            <ModeSwitch className="w-full" onPick={close} />
            <div className="flex items-center justify-between gap-3 sm:hidden">
              <span className="text-[13px] text-muted">{t("Language")}</span>
              <div className="flex items-center gap-1">
                <LanguageSwitch size="md" />
                <ThemeButton />
              </div>
            </div>
          </div>
          <div
            data-vaul-no-drag
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border px-2 pt-3 [-webkit-overflow-scrolling:touch]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          >
            {query.trim().length > 1 ? <SearchResults query={query} onPick={close} compact /> : <PageIndex current={current?.id} onPick={close} />}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------------------------------------------------------------- search

function SearchResults({ query, onPick, compact }: { query: string; onPick?: () => void; compact?: boolean }) {
  const t = useT();
  const gt = useGuideText();
  const hits = useMemo(
    () =>
      searchGuide(query, 30, {
        pages: gt.pages,
        docs: gt.docs,
        labels: { page: t("Page"), about: t("About"), can: t("What you can do"), tip: t("Tip"), onScreen: t("On screen") },
      }),
    [query, gt, t],
  );
  if (!hits.length) {
    return (
      <p className={cn("text-[14px] text-muted", compact ? "px-3 py-2" : "py-6 text-center")}>
        {t('Nothing in the guide matches "{q}". Try one word, such as "approve" or "budget".', { q: query.trim() })}
      </p>
    );
  }
  return (
    <ul className={cn("grid", compact ? "gap-0.5" : "gap-2")} aria-label={t("Search results")}>
      {hits.map((h) => {
        const IconCmp = PAGE_ICONS[h.page.id] ?? BookBookmarkIcon;
        return (
          <li key={h.page.id}>
            <Link
              to="/guide/$page"
              params={{ page: h.page.id }}
              onClick={onPick}
              className={cn(
                "grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[var(--radius-md)] px-3 py-3 transition-colors hover:bg-surface-2",
                !compact && "border border-border bg-surface hover:border-accent/40",
              )}
            >
              <IconTile icon={IconCmp} size="sm" />
              <span className="grid min-w-0 gap-0.5">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-medium">{h.page.title}</span>
                  <span className="text-[12.5px] text-muted">{gt.groupLabel(h.page.group)} · {h.where}</span>
                </span>
                <span className="line-clamp-2 text-[13.5px] text-muted">{h.snippet}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- guide home

function GuideHome({ manifest }: { manifest: GuideManifest | null }) {
  const t = useT();
  const gt = useGuideText();
  return (
    <div className="mx-auto grid w-full max-w-[72rem] gap-10">
      <header className="grid gap-3">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-[34px]">{t("User guide")}</h1>
        <p className="max-w-[62ch] text-[16px] leading-relaxed text-muted sm:text-[17px]">
          {t("Every page of the office, explained: what it is for, where to find it, and what to click, step by step.")}
        </p>
        {/* How a chapter reads, so people know what to expect. */}
        <ol className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            { icon: TargetIcon, title: t("What this page is for"), body: t("One line on what the page does for you.") },
            { icon: MapTrifoldIcon, title: t("Where to find it"), body: t("The way there from the sidebar.") },
            { icon: ListNumbersIcon, title: t("Steps"), body: t("What to click, in order, with the place shown on a picture.") },
          ].map((x, i) => (
            <li key={x.title} className="flex min-w-0 items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-accent-fg tabular">{i + 1}</span>
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-1.5 text-[14.5px] font-semibold"><x.icon size={16} className="text-accent" /> {x.title}</span>
                <span className="text-[13.5px] text-muted">{x.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </header>

      {gt.flows.length ? (
        <section className="grid gap-3" aria-labelledby="guide-videos">
          <div>
            <h2 id="guide-videos" className="text-[19px] font-semibold">{t("Watch how it's done")}</h2>
            <p className="text-[14px] text-muted">{t("Short recordings of the things people do most.")}</p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {gt.flows.map((f) => {
              const v = videoOf(manifest, f.id);
              const page = gt.pageById(f.page);
              return (
                <li key={f.id} className="min-w-0">
                  <Link
                    to="/guide/$page"
                    params={{ page: f.page }}
                    hash={`video-${f.id}`}
                    className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface transition-[border-color,box-shadow] duration-200 hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
                  >
                    {v ? (
                      <div className="relative aspect-video overflow-hidden bg-surface-2 max-sm:hidden">
                        <img src={v.poster} alt="" loading="lazy" decoding="async" width={v.w} height={v.h} className="size-full object-cover object-top" />
                        <span className="absolute right-2 bottom-2 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[11.5px] text-white tabular">
                          {Math.floor(v.duration / 60)}:{String(Math.round(v.duration % 60)).padStart(2, "0")}
                        </span>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3">
                      <IconTile icon={FilmStripIcon} size="sm" />
                      <span className="grid min-w-0 gap-0.5">
                        <span className="text-[15px] font-medium break-words">{f.title}</span>
                        <span className="text-[13px] text-muted">{v ? page?.title : t("{page} · steps until the video is ready", { page: page?.title ?? "" })}</span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {groupedPages(gt.pages).map((g) => (
        <section key={g.group} className="grid gap-3" aria-label={gt.groupLabel(g.group)}>
          <h2 className="text-[19px] font-semibold">{gt.groupLabel(g.group)}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.pages.map((p) => {
              const doc = gt.docs[p.id];
              const IconCmp = PAGE_ICONS[p.id] ?? BookBookmarkIcon;
              const shot = shotOf(manifest, p.id, "desktop");
              return (
                <li key={p.id} className="min-w-0">
                  <Link
                    to="/guide/$page"
                    params={{ page: p.id }}
                    className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface transition-[border-color,box-shadow] duration-200 hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
                  >
                    {shot ? (
                      <div className="overflow-hidden border-b border-border max-sm:hidden">
                        <ShotThumb shot={shot} alt="" className="transition-transform duration-300 group-hover:scale-[1.02]" />
                      </div>
                    ) : null}
                    <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3.5">
                      <IconTile icon={IconCmp} size="sm" />
                      <span className="grid min-w-0 gap-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[15px] font-medium">{p.title}</span>
                          {p.who ? <Pill className="text-[11.5px]">{p.who}</Pill> : null}
                        </span>
                        <span className="line-clamp-2 text-[13.5px] leading-snug text-muted">{doc ? plain(doc.purpose) : ""}</span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <SourceNote manifest={manifest} />
    </div>
  );
}

function SourceNote({ manifest }: { manifest: GuideManifest | null }) {
  const t = useT();
  return (
    <p className="text-[13px] text-muted">
      {manifest
        ? t("Screenshots: {source}, captured {date}. Your own screens show your own data.", {
            source: t(manifest.source),
            date: new Date(manifest.generated_at).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }),
          })
        : t("Screenshots are being captured. Placeholders show until they are ready; the steps already match the real screens.")}
    </p>
  );
}

// ---------------------------------------------------------------- one chapter

/** Targets the doc mentions, numbered in targets.ts order: these get a box on the screenshot. */
function numbering(page: GuidePageInfo, doc: PageDoc): Map<string, number> {
  const mentioned = new Set([...Object.keys(doc.spots), ...doc.howto.flatMap((r) => r.steps.map((st) => st.target).filter(Boolean) as string[])]);
  const out = new Map<string, number>();
  for (const t of page.targets) if (mentioned.has(t.id)) out.set(t.id, out.size + 1);
  return out;
}

function Marker({ n, on }: { n?: number; on?: boolean }) {
  if (!n) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular transition-colors",
        on ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent ring-1 ring-accent/30",
      )}
    >
      {n}
    </span>
  );
}

function DocSection({ title, icon, children, id }: { title: string; icon?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="grid min-w-0 scroll-mt-24 gap-3" id={id}>
      <h2 className="flex items-center gap-2 text-[19px] font-semibold tracking-tight">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One line on what the page is for: the first sentence leads, the rest follows smaller. */
function splitLead(text: string): [string, string] {
  const m = /^(.+?[.!?])\s+(?=[A-Z*])/.exec(text);
  return m ? [m[1]!, text.slice(m[0].length)] : [text, ""];
}

/** "Where to find it": the real sidebar path, the way the sidebar shows it. */
function WhereBox({ page }: { page: GuidePageInfo }) {
  const t = useT();
  const where = whereOf(page.route);
  return (
    <section aria-labelledby="guide-where" className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5">
      <h2 id="guide-where" className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
        <MapTrifoldIcon size={16} weight="duotone" className="text-accent" /> {t("Where to find it")}
      </h2>
      {where ? (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[15px]" aria-label={t("Where to find it")}>
          <li className="inline-flex items-center gap-1.5 text-muted">
            <SidebarSimpleIcon size={17} /> {t("Sidebar")}
          </li>
          {where.trail.map((s, i) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <CaretRightIcon size={13} weight="bold" className="text-muted" aria-hidden />
              <span className={cn("rounded-[6px] border px-2 py-0.5 font-medium", i === where.trail.length - 1 ? "border-accent/40 bg-accent-soft text-accent" : "border-border bg-surface-2")}>
                {s.tab ? t("{name} tab", { name: t(s.label) }) : t(s.label)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <ul className="grid gap-1 text-[13.5px] text-muted">
        {where?.folded ? <li>{t("This group of the sidebar starts folded: click its name to open it.")}</li> : null}
        <li>{t("On a phone, the same list is under More at the bottom of the screen.")}</li>
      </ul>
      <div>
        <Button asChild className="h-11 px-4 text-[14.5px]">
          <Link to={page.route}>
            {t("Open this page")} <ArrowSquareOutIcon size={17} />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function RecipeCard({
  recipe,
  index,
  numbers,
  active,
  onHover,
  onPick,
  onShowState,
  stateKey,
}: {
  recipe: Recipe;
  index: number;
  numbers: Map<string, number>;
  active: string | null;
  onHover: (id: string | null) => void;
  onPick: (target: string, state?: string) => void;
  onShowState: (state: string) => void;
  stateKey: string;
}) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/40 px-4 py-3 sm:px-5">
        <h3 className="flex min-w-0 items-center gap-3 text-[16.5px] font-semibold">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-accent-fg tabular">{index + 1}</span>
          <span className="min-w-0 break-words">{recipe.title}</span>
        </h3>
        {recipe.state ? (
          <button
            type="button"
            onClick={() => onShowState(recipe.state!)}
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-[13px] font-medium pointer-coarse:h-11",
              stateKey === recipe.state ? "border-accent/40 bg-accent-soft text-accent" : "border-border text-muted hover:text-fg",
            )}
          >
            {t("Show: {view}", { view: t(stateLabel(recipe.state)) })}
          </button>
        ) : null}
      </div>
      <ol className="grid">
        {recipe.steps.map((st, i) => {
          const n = st.target ? numbers.get(st.target) : undefined;
          const on = !!st.target && active === st.target;
          return (
            <li
              key={i}
              onMouseEnter={n ? () => onHover(st.target!) : undefined}
              onMouseLeave={n ? () => onHover(null) : undefined}
              className={cn("flex min-w-0 items-start gap-3.5 border-b border-border/60 px-4 py-3.5 last:border-0 sm:px-5", on && "bg-accent-soft/60")}
            >
              <span className="mt-px w-6 shrink-0 text-right text-[15px] font-semibold text-muted tabular">{i + 1}.</span>
              <span className="min-w-0 flex-1 text-[15.5px] leading-7 break-words">
                <Rich text={st.text} />
              </span>
              {n ? (
                <button
                  type="button"
                  onClick={() => onPick(st.target!, recipe.state)}
                  onFocus={() => onHover(st.target!)}
                  onBlur={() => onHover(null)}
                  aria-label={t("Show {n} on the picture", { n })}
                  title={t("Show {n} on the picture", { n })}
                  className="-my-1.5 inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft pointer-coarse:min-h-11"
                >
                  <Marker n={n} on={on} />
                  <span className="max-sm:sr-only">{t("on the picture")}</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BulletList({ items, tone = "accent" }: { items: string[]; tone?: "accent" | "warn" }) {
  return (
    <ul className="grid gap-2.5">
      {items.map((c, i) => (
        <li key={i} className="flex min-w-0 gap-3 text-[15.5px] leading-7">
          <span aria-hidden className={cn("mt-[0.7em] size-1.5 shrink-0 rounded-full", tone === "warn" ? "bg-warn" : "bg-accent")} />
          <span className="min-w-0 break-words">
            <Rich text={c} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function PageDocView({ page, manifest }: { page: GuidePageInfo; manifest: GuideManifest | null }) {
  const t = useT();
  const gt = useGuideText();
  const doc = gt.docs[page.id];
  const search = useSearch({ strict: false }) as { state?: string; device?: Device };
  const navigate = useNavigate();
  const phone = useIsPhone();
  const shotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);

  const keys = shotKeys(page);
  const stateKey = search.state && page.states.some((s) => s.key === search.state) ? search.state : "";
  const key = stateKey ? `${page.id}:${stateKey}` : page.id;
  const has = (k: string, d: Device) => !!shotOf(manifest, k, d);
  const preferred: Device = phone ? "mobile" : "desktop";
  const other: Device = preferred === "mobile" ? "desktop" : "mobile";
  const device: Device = search.device ?? (has(key, preferred) || !has(key, other) ? preferred : other);
  const shot = shotOf(manifest, key, device);
  const numbers = useMemo(() => (doc ? numbering(page, doc) : new Map<string, number>()), [page, doc]);

  const setView = (next: { state?: string; device?: Device }) =>
    void navigate({
      to: "/guide/$page",
      params: { page: page.id },
      search: { state: (next.state ?? stateKey) || undefined, device: next.device ?? search.device },
      replace: true,
      resetScroll: false,
    });

  /** A step's number was tapped: show the capture that holds its box, light it up and bring it into view. */
  const pick = (target: string, recipeState?: string) => {
    const order = [key, recipeState ? `${page.id}:${recipeState}` : "", ...keys].filter(Boolean);
    const found = order.find((k) => shotOf(manifest, k, device)?.boxes.some((b) => b.id === target));
    if (found && found !== key) setView({ state: found.includes(":") ? found.split(":")[1] : "" });
    setActive(target);
    shotRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const idx = gt.pages.findIndex((p) => p.id === page.id);
  const prev = gt.pages[idx - 1];
  const next = gt.pages[idx + 1];
  const IconCmp = PAGE_ICONS[page.id] ?? BookBookmarkIcon;
  const flows = gt.flows.filter((f) => f.page === page.id);
  const stateInfo = page.states.find((s) => s.key === stateKey);
  const viewName = stateInfo ? t(stateLabel(stateInfo.key)) : "";
  const deviceName = device === "mobile" ? t("phone") : t("desktop");

  if (!doc) {
    return <EmptyState icon={IconCmp} title={page.title} body={t("This page is not written up yet.")} />;
  }

  const [lead, rest] = splitLead(doc.purpose);
  const devices = (["desktop", "mobile"] as Device[]).filter((d) => has(key, d));
  const anyShot = keys.some((k) => has(k, "desktop") || has(k, "mobile"));
  return (
    <article className="mx-auto grid w-full max-w-[60rem] min-w-0 gap-10">
      <header className="grid gap-6">
        <div className="grid gap-3">
          <p className="text-[12px] font-semibold tracking-[0.08em] text-accent uppercase">{gt.groupLabel(page.group)}</p>
          <div className="flex min-w-0 items-start gap-4">
            <IconTile icon={IconCmp} size="lg" className="hidden sm:grid" />
            <div className="grid min-w-0 gap-1.5">
              <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance break-words sm:text-[34px]">{page.title}</h1>
              {page.who ? <Pill className="w-fit text-[12px]">{page.who}</Pill> : null}
            </div>
          </div>
        </div>
        <section aria-labelledby="guide-for" className="grid gap-2">
          <h2 id="guide-for" className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
            <TargetIcon size={16} weight="duotone" className="text-accent" /> {t("What this page is for")}
          </h2>
          <p className="max-w-[62ch] text-[18px] leading-relaxed font-medium sm:text-[19px]">
            <Rich text={lead} />
          </p>
          {rest ? (
            <p className="max-w-[68ch] text-[15.5px] leading-7 text-muted">
              <Rich text={rest} />
            </p>
          ) : null}
        </section>
        <WhereBox page={page} />
      </header>

      <DocSection title={t("Steps")} icon={<ListNumbersIcon size={20} weight="duotone" className="text-accent" />}>
        <div className="grid gap-4">
          {doc.howto.map((r, i) => (
            <RecipeCard
              key={r.title}
              recipe={r}
              index={i}
              numbers={numbers}
              active={active}
              onHover={(id) => setActive(id && shot?.boxes.some((b) => b.id === id) ? id : null)}
              onPick={pick}
              onShowState={(st) => {
                setView({ state: st });
                shotRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              stateKey={stateKey}
            />
          ))}
        </div>
      </DocSection>

      {anyShot || numbers.size ? (
        <DocSection title={t("Where to click on the screen")} icon={<CursorClickIcon size={20} weight="duotone" className="text-accent" />}>
          <div ref={shotRef} className="grid min-w-0 scroll-mt-24 gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              {page.states.length ? (
                <Segmented
                  label={t("Which view")}
                  value={stateKey || "_"}
                  onChange={(v) => setView({ state: v === "_" ? "" : v })}
                  options={[{ value: "_", label: t("As it opens") }, ...page.states.map((s) => ({ value: s.key, label: t(stateLabel(s.key)) }))]}
                  className="min-w-0"
                />
              ) : (
                <span className="text-[13.5px] font-medium text-muted">{t("As it opens")}</span>
              )}
              <Segmented
                label={t("Screen size")}
                value={device}
                onChange={(d) => setView({ device: d })}
                options={[
                  { value: "desktop", label: devices.length && !devices.includes("desktop") ? t("Desktop (none)") : t("Desktop") },
                  { value: "mobile", label: devices.length && !devices.includes("mobile") ? t("Phone (none)") : t("Phone") },
                ]}
              />
            </div>
            {stateInfo ? <p className="text-[14px] text-muted">{t("How to get here: {how}.", { how: stateInfo.how.replace(/\s*\(\/[^)]*\)/, "") })}</p> : null}
            {shot ? (
              <AnnotatedShot
                shot={shot}
                alt={
                  stateInfo
                    ? t("{page}, {view} ({device})", { page: page.title, view: viewName.toLowerCase(), device: deviceName })
                    : t("{page} ({device})", { page: page.title, device: deviceName })
                }
                device={device}
                maxHeight={device === "mobile" ? "calc(100dvh - 9rem)" : undefined}
                numbers={numbers}
                active={active}
                onActive={setActive}
              />
            ) : (
              <ShotPlaceholder
                device={device}
                title={stateInfo ? `${page.title} · ${viewName}` : page.title}
                targets={page.targets}
                numbers={numbers}
                active={active}
                onActive={setActive}
              />
            )}
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              {device === "mobile" ? <DeviceMobileIcon size={15} /> : <DesktopIcon size={15} />}
              {t("Tap the picture to see it bigger. The numbers match the steps above.")}
            </p>
            {numbers.size ? (
              <ul className="grid gap-1 sm:grid-cols-2" aria-label={t("On this screen")}>
                {page.targets
                  .filter((x) => numbers.has(x.id))
                  .map((x) => {
                    const on = active === x.id;
                    return (
                      <li key={x.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(x.id)}
                          onMouseLeave={() => setActive(null)}
                          onClick={() => pick(x.id)}
                          className={cn(
                            "flex min-h-11 w-full min-w-0 items-start gap-3 rounded-sm px-2.5 py-2.5 text-left transition-colors",
                            on ? "bg-accent-soft/70" : "hover:bg-surface-2",
                          )}
                        >
                          <Marker n={numbers.get(x.id)} on={on} />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="text-[14.5px] font-medium break-words">{x.label}</span>
                            {doc.spots[x.id] ? (
                              <span className="text-[13.5px] leading-snug text-muted break-words">
                                <Rich text={doc.spots[x.id]!} />
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            ) : null}
          </div>
        </DocSection>
      ) : null}

      <DocSection title={t("What else you can do here")} icon={<CheckCircleIcon size={20} weight="duotone" className="text-accent" />}>
        <BulletList items={doc.can} />
      </DocSection>

      {flows.length ? (
        <DocSection title={flows.length > 1 ? t("Videos") : t("Video")} icon={<FilmStripIcon size={20} weight="duotone" className="text-accent" />}>
          <div className="grid gap-3">
            {flows.map((f) => (
              <FlowVideo key={f.id} id={f.id} title={f.title} video={videoOf(manifest, f.id)} />
            ))}
          </div>
        </DocSection>
      ) : null}

      {doc.tips.length ? (
        <DocSection title={t("Tips")} icon={<LightbulbIcon size={20} weight="duotone" className="text-warn" />}>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-4">
            <BulletList items={doc.tips} tone="warn" />
          </div>
        </DocSection>
      ) : null}

      <DocSection title={t("Who can use it")} icon={<UsersIcon size={20} weight="duotone" className="text-info" />}>
        <p className="max-w-[68ch] text-[15.5px] leading-7">{doc.who}</p>
      </DocSection>

      {doc.related.length ? (
        <DocSection title={t("Related pages")}>
          <ul className="flex flex-wrap gap-2">
            {doc.related.map((id) => {
              const p = gt.pageById(id);
              if (!p) return null;
              const RIcon = PAGE_ICONS[p.id] ?? BookBookmarkIcon;
              return (
                <li key={id}>
                  <Link
                    to="/guide/$page"
                    params={{ page: id }}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
                  >
                    <RIcon size={16} /> {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </DocSection>
      ) : null}

      <nav aria-label={t("Previous and next page")} className="grid grid-cols-2 gap-3 border-t border-border pt-6">
        {prev ? (
          <Link
            to="/guide/$page"
            params={{ page: prev.id }}
            className="grid min-h-11 min-w-0 gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 transition-colors hover:border-accent/40"
          >
            <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
              <ArrowLeftIcon size={13} /> {t("Previous")}
            </span>
            <span className="truncate text-[15px] font-medium">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            to="/guide/$page"
            params={{ page: next.id }}
            className="grid min-h-11 min-w-0 justify-items-end gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 text-right transition-colors hover:border-accent/40"
          >
            <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
              {t("Next")} <ArrowRightIcon size={13} />
            </span>
            <span className="max-w-full truncate text-[15px] font-medium">{next.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

// ---------------------------------------------------------------- route component

export function GuidePage() {
  const t = useT();
  const gt = useGuideText();
  const params = useParams({ strict: false }) as { page?: string };
  const search = useSearch({ strict: false }) as { q?: string };
  const manifest = useManifest();
  const [query, setQuery] = useState(search.q ?? "");
  const page = params.page ? gt.pageById(params.page) : undefined;
  const searching = query.trim().length > 1;
  const leave = useLeave();

  // A new chapter starts with the search cleared, so its text shows.
  const [shown, setShown] = useState(params.page);
  if (shown !== params.page) {
    setShown(params.page);
    if (searching) setQuery("");
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[100rem] items-center gap-2 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:gap-3 lg:px-6">
          <Button variant="outline" className="h-11 shrink-0 gap-2 px-3 max-sm:w-11 max-sm:px-0" onClick={leave} aria-label={t("Back to the office")} title={t("Back to the office")}>
            <ArrowLeftIcon size={18} weight="bold" /> <span className="max-sm:hidden">{t("Back to the office")}</span>
          </Button>
          <Link to="/guide" className="flex min-w-0 items-center gap-2.5 rounded-sm px-1 py-1" aria-label={t("Guide home")}>
            <LogoMark className="size-8 shrink-0" />
            <span className="truncate text-[16.5px] font-semibold tracking-tight">{t("User guide")}</span>
          </Link>
          <span className="min-w-0 flex-1" />
          <SearchInput value={query} onChange={setQuery} placeholder={t("Search the guide")} className="hidden max-w-80 basis-72 lg:block" />
          <ModeSwitch className="hidden md:flex" />
          <div className="hidden items-center gap-1 sm:flex">
            <LanguageSwitch size="md" />
            <ThemeButton />
          </div>
          <ChapterDrawer current={page} query={query} onQuery={setQuery} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[100rem]">
        <aside className="sticky top-[calc(4rem+1px+env(safe-area-inset-top))] hidden h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))] w-72 shrink-0 overflow-y-auto overscroll-contain border-r border-border px-3 pt-6 pb-10 lg:block">
          <PageIndex current={page?.id} />
        </aside>
        <main
          id="guide-main"
          className="min-w-0 flex-1 px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-8 lg:px-12 lg:pt-10 [&_[id^=video-]]:scroll-mt-24"
        >
          {/* Phones: the search sits on the guide home, the chapters and the rest in the drawer. */}
          {!page && !params.page ? (
            <div className="mx-auto mb-6 w-full max-w-[72rem] lg:hidden">
              <SearchInput value={query} onChange={setQuery} placeholder={t("Search the guide, e.g. approve or budget")} className="basis-auto" />
            </div>
          ) : null}
          {searching ? (
            <div className="mx-auto grid w-full max-w-[60rem] gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-[22px] font-semibold">{t('Results for "{q}"', { q: query.trim() })}</h1>
                <Button variant="outline" className="h-11" onClick={() => setQuery("")}>{t("Clear search")}</Button>
              </div>
              <SearchResults query={query} onPick={() => setQuery("")} />
            </div>
          ) : params.page && !page ? (
            <EmptyState
              icon={BookOpenTextIcon}
              title={t("No guide page by that name")}
              body={t("It may have been renamed. Pick a page from the list.")}
              action={
                <Button asChild variant="outline" className="h-11">
                  <Link to="/guide">
                    {t("Guide home")} <CaretRightIcon size={14} />
                  </Link>
                </Button>
              }
            />
          ) : page ? (
            <PageDocView key={page.id} page={page} manifest={manifest} />
          ) : (
            <GuideHome manifest={manifest} />
          )}
        </main>
      </div>
    </div>
  );
}
