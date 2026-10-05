/** The user guide: every page explained with an annotated screenshot, recipes whose steps
 * light up the control they mention, short flow videos and links into the real page.
 * /guide is the index (grouped like the sidebar, searchable); /guide/<page id> is one page.
 * Screenshots and videos come from the capture manifest; missing ones show placeholders. */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BookBookmarkIcon,
  BookOpenTextIcon,
  CaretRightIcon,
  CheckCircleIcon,
  DesktopIcon,
  DeviceMobileIcon,
  FilmStripIcon,
  LightbulbIcon,
  ListBulletsIcon,
  PresentationIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Drawer } from "vaul";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { locale, useT } from "@/i18n";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- index (sidebar / sheet)

function PageIndex({ current, query, onPick }: { current?: string; query: string; onPick?: () => void }) {
  const t = useT();
  const gt = useGuideText();
  const q = query.trim().toLowerCase();
  const pages = q ? gt.pages.filter((p) => p.title.toLowerCase().includes(q) || gt.groupLabel(p.group).toLowerCase().includes(q)) : gt.pages;
  const groups = groupedPages(pages);
  return (
    <nav aria-label={t("Guide pages")} className="grid gap-4">
      <Link
        to="/guide"
        onClick={onPick}
        className={cn(
          "flex h-9 items-center gap-2 rounded-sm px-2.5 text-[13.5px] font-medium",
          !current ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-2",
        )}
      >
        <BookOpenTextIcon size={17} weight={!current ? "fill" : "regular"} /> {t("Guide home")}
      </Link>
      {groups.map((g) => (
        <div key={g.group}>
          <p className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase">{gt.groupLabel(g.group)}</p>
          <ul className="grid gap-0.5">
            {g.pages.map((p) => {
              const IconCmp = (PAGE_ICONS[p.id] ?? BookBookmarkIcon);
              const on = p.id === current;
              return (
                <li key={p.id}>
                  <Link
                    to="/guide/$page"
                    params={{ page: p.id }}
                    onClick={onPick}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13.5px] transition-colors",
                      on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <IconCmp size={17} weight={on ? "fill" : "regular"} className="shrink-0" />
                    <span className="min-w-0 truncate">{p.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!groups.length ? <p className="px-2.5 text-[13px] text-muted">{t("No page is called that. Search below looks inside the text too.")}</p> : null}
    </nav>
  );
}

/** Phones and tablets: the index lives in a bottom sheet behind one button. */
function IndexSheet({ current, query, onQuery }: { current?: GuidePageInfo; query: string; onQuery: (q: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const IconCmp = current ? (PAGE_ICONS[current.id] ?? BookBookmarkIcon) : BookOpenTextIcon;
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <button
          type="button"
          className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-left shadow-[var(--shadow-soft)] lg:hidden"
        >
          <IconCmp size={18} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{current ? current.title : t("Guide home")}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-muted">
            <ListBulletsIcon size={16} /> {t("All pages")}
          </span>
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
        >
          <div aria-hidden className="mx-auto mt-2.5 mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          <Drawer.Title className="px-4 pb-2 text-[15px] font-semibold">{t("User guide")}</Drawer.Title>
          <div className="px-4 pb-3">
            <SearchInput value={query} onChange={onQuery} placeholder={t("Search the guide")} />
          </div>
          <div
            data-vaul-no-drag
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 [-webkit-overflow-scrolling:touch]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          >
            {query.trim().length > 1 ? (
              <SearchResults query={query} onPick={() => setOpen(false)} compact />
            ) : (
              <PageIndex current={current?.id} query="" onPick={() => setOpen(false)} />
            )}
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
      <p className={cn("text-[13.5px] text-muted", compact ? "px-2.5 py-2" : "py-6 text-center")}>
        {t('Nothing in the guide matches "{q}". Try one word, such as "approve" or "budget".', { q: query.trim() })}
      </p>
    );
  }
  return (
    <ul className={cn("grid", compact ? "gap-0.5" : "gap-2")} aria-label={t("Search results")}>
      {hits.map((h) => {
        const IconCmp = (PAGE_ICONS[h.page.id] ?? BookBookmarkIcon);
        return (
          <li key={h.page.id}>
            <Link
              to="/guide/$page"
              params={{ page: h.page.id }}
              onClick={onPick}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-surface-2",
                !compact && "border border-border bg-surface hover:border-accent/40",
              )}
            >
              <IconTile icon={IconCmp} size="sm" />
              <span className="grid min-w-0 gap-0.5">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="text-[14px] font-medium">{h.page.title}</span>
                  <span className="text-[12px] text-muted">{gt.groupLabel(h.page.group)} · {h.where}</span>
                </span>
                <span className="line-clamp-2 text-[13px] text-muted">{h.snippet}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- guide home

function GuideHome({ manifest, query, onQuery }: { manifest: GuideManifest | null; query: string; onQuery: (q: string) => void }) {
  const t = useT();
  const gt = useGuideText();
  const searching = query.trim().length > 1;
  return (
    <div className="grid min-w-0 gap-8">
      <PageHeader
        title={t("User guide")}
        description={t("Every page of the office explained: what it is for, what you can do there and how, step by step, on real screenshots.")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/tutorial">
                <BookOpenTextIcon size={16} /> {t("Tutorial")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/present">
                <PresentationIcon size={16} /> {t("Present")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-3">
        <SearchInput value={query} onChange={onQuery} placeholder={t("Search the guide, e.g. approve or budget")} className="basis-auto" />
        {searching ? <SearchResults query={query} /> : null}
      </div>

      {!searching ? (
        <>
          <section className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">{t("Watch how it's done")}</h2>
                <p className="text-[13px] text-muted">{t("Short recordings of the things people do most.")}</p>
              </div>
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
                      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
                    >
                      {v ? (
                        <div className="relative aspect-video overflow-hidden bg-surface-2">
                          <img src={v.poster} alt="" loading="lazy" decoding="async" width={v.w} height={v.h} className="size-full object-cover object-top" />
                          <span className="absolute right-2 bottom-2 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[11.5px] text-white tabular">
                            {Math.floor(v.duration / 60)}:{String(Math.round(v.duration % 60)).padStart(2, "0")}
                          </span>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3">
                        <IconTile icon={FilmStripIcon} size="sm" />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="text-[14px] font-medium break-words">{f.title}</span>
                          <span className="text-[12.5px] text-muted">{v ? page?.title : t("{page} · steps until the video is ready", { page: page?.title ?? "" })}</span>
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {groupedPages(gt.pages).map((g) => (
            <section key={g.group} className="grid gap-3">
              <h2 className="text-[15px] font-semibold">{gt.groupLabel(g.group)}</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.pages.map((p) => {
                  const doc = gt.docs[p.id];
                  const IconCmp = (PAGE_ICONS[p.id] ?? BookBookmarkIcon);
                  return (
                    <li key={p.id} className="min-w-0">
                      <Link
                        to="/guide/$page"
                        params={{ page: p.id }}
                        className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
                      >
                        <div className="overflow-hidden border-b border-border">
                          <ShotThumb shot={shotOf(manifest, p.id, "desktop")} alt="" className="transition-transform duration-300 group-hover:scale-[1.02]" />
                        </div>
                        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3">
                          <IconTile icon={IconCmp} size="sm" />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[14px] font-medium">{p.title}</span>
                              {p.who ? <Pill className="text-[11px]">{p.who}</Pill> : null}
                            </span>
                            <span className="line-clamp-2 text-[12.5px] text-muted">{doc ? plain(doc.purpose) : ""}</span>
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
        </>
      ) : null}
    </div>
  );
}

function SourceNote({ manifest }: { manifest: GuideManifest | null }) {
  const t = useT();
  return (
    <p className="text-[12.5px] text-muted">
      {manifest
        ? t("Screenshots: {source}, captured {date}. Your own screens show your own data.", {
            source: t(manifest.source),
            date: new Date(manifest.generated_at).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }),
          })
        : t("Screenshots are being captured. Placeholders show until they are ready; the steps already match the real screens.")}
    </p>
  );
}

// ---------------------------------------------------------------- one page

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
        "grid size-5.5 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold tabular transition-colors",
        on ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent ring-1 ring-accent/30",
      )}
    >
      {n}
    </span>
  );
}

function DocSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2.5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        {icon}
        {title}
      </h2>
      {children}
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
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2.5 text-[14.5px] font-semibold">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-muted tabular">{index + 1}</span>
          <span className="min-w-0 break-words">{recipe.title}</span>
        </h3>
        {recipe.state ? (
          <button
            type="button"
            onClick={() => onShowState(recipe.state!)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium pointer-coarse:h-9",
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
            <li key={i} className="border-b border-border/60 last:border-0">
              <div
                role={n ? "button" : undefined}
                tabIndex={n ? 0 : undefined}
                onMouseEnter={n ? () => onHover(st.target!) : undefined}
                onMouseLeave={n ? () => onHover(null) : undefined}
                onClick={n ? () => onPick(st.target!, recipe.state) : undefined}
                onKeyDown={
                  n
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPick(st.target!, recipe.state);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex min-w-0 items-start gap-3 px-4 py-2.5 text-[13.5px] leading-relaxed transition-colors",
                  n && "cursor-pointer hover:bg-surface-2/70",
                  on && "bg-accent-soft/60",
                )}
              >
                <span className="mt-0.5 w-4 shrink-0 text-right text-[12.5px] font-medium text-muted tabular">{i + 1}.</span>
                <span className="min-w-0 flex-1 break-words">
                  <Rich text={st.text} />
                </span>
                <span className="mt-0.5">
                  <Marker n={n} on={on} />
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
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

  /** A step was tapped: show the capture that holds its box, light it up and bring it into view. */
  const pick = (target: string, recipeState?: string) => {
    const order = [key, recipeState ? `${page.id}:${recipeState}` : "", ...keys].filter(Boolean);
    const found = order.find((k) => shotOf(manifest, k, device)?.boxes.some((b) => b.id === target));
    if (found && found !== key) setView({ state: found.includes(":") ? found.split(":")[1] : "" });
    setActive(target);
    const el = shotRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 80 || r.top > window.innerHeight - 80) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const idx = gt.pages.findIndex((p) => p.id === page.id);
  const prev = gt.pages[idx - 1];
  const next = gt.pages[idx + 1];
  const IconCmp = (PAGE_ICONS[page.id] ?? BookBookmarkIcon);
  const flows = gt.flows.filter((f) => f.page === page.id);
  const stateInfo = page.states.find((s) => s.key === stateKey);
  const viewName = stateInfo ? t(stateLabel(stateInfo.key)) : "";
  const deviceName = device === "mobile" ? t("phone") : t("desktop");

  if (!doc) {
    return <EmptyState icon={IconCmp} title={page.title} body={t("This page is not written up yet.")} />;
  }

  const devices = (["desktop", "mobile"] as Device[]).filter((d) => has(key, d));
  return (
    <article className="grid min-w-0 gap-6">
      <PageHeader
        icon={IconCmp}
        eyebrow={t("Guide · {group}", { group: gt.groupLabel(page.group) })}
        title={page.title}
        description={<Rich text={doc.purpose} />}
        actions={
          <Button asChild>
            <Link to={page.route}>
              {t("Open this page")} <ArrowSquareOutIcon size={16} />
            </Link>
          </Button>
        }
      />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-start">
        {/* The screenshot: sticky beside the text on wide screens. */}
        <div ref={shotRef} className="grid min-w-0 gap-3 xl:sticky xl:top-[4.75rem]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            {page.states.length ? (
              <Segmented
                label={t("Which view")}
                size="sm"
                value={stateKey || "_"}
                onChange={(v) => setView({ state: v === "_" ? "" : v })}
                options={[{ value: "_", label: t("As it opens") }, ...page.states.map((s) => ({ value: s.key, label: t(stateLabel(s.key)) }))]}
                className="min-w-0"
              />
            ) : (
              <span className="text-[12.5px] font-medium text-muted">{t("As it opens")}</span>
            )}
            <Segmented
              label={t("Screen size")}
              size="sm"
              value={device}
              onChange={(d) => setView({ device: d })}
              options={[
                { value: "desktop", label: devices.length && !devices.includes("desktop") ? t("Desktop (none)") : t("Desktop") },
                { value: "mobile", label: devices.length && !devices.includes("mobile") ? t("Phone (none)") : t("Phone") },
              ]}
            />
          </div>
          {stateInfo ? <p className="text-[12.5px] text-muted">{t("How to get here: {how}.", { how: stateInfo.how.replace(/\s*\(\/[^)]*\)/, "") })}</p> : null}
          {shot ? (
            <AnnotatedShot
              shot={shot}
              alt={
                stateInfo
                  ? t("{page}, {view} ({device})", { page: page.title, view: viewName.toLowerCase(), device: deviceName })
                  : t("{page} ({device})", { page: page.title, device: deviceName })
              }
              device={device}
              maxHeight={device === "mobile" ? "calc(100dvh - 11rem)" : undefined}
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
          <div className="hidden items-center gap-1.5 text-[12px] text-muted md:flex">
            {device === "mobile" ? <DeviceMobileIcon size={14} /> : <DesktopIcon size={14} />}
            {t("Point at a numbered step to see where it is on the screen.")}
          </div>
        </div>

        <div className="grid min-w-0 gap-7">
          {numbers.size ? (
            <DocSection title={t("On this screen")}>
              <ul className="grid gap-1">
                {page.targets
                  .filter((t) => numbers.has(t.id))
                  .map((t) => {
                    const on = active === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(t.id)}
                          onMouseLeave={() => setActive(null)}
                          onClick={() => pick(t.id)}
                          className={cn(
                            "flex w-full min-w-0 items-start gap-3 rounded-sm px-2 py-2 text-left transition-colors",
                            on ? "bg-accent-soft/70" : "hover:bg-surface-2",
                          )}
                        >
                          <Marker n={numbers.get(t.id)} on={on} />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="text-[13.5px] font-medium break-words">{t.label}</span>
                            {doc.spots[t.id] ? (
                              <span className="text-[12.5px] text-muted break-words">
                                <Rich text={doc.spots[t.id]!} />
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </DocSection>
          ) : null}

          <DocSection title={t("What you can do here")} icon={<CheckCircleIcon size={18} weight="duotone" className="text-accent" />}>
            <ul className="grid gap-2">
              {doc.can.map((c, i) => (
                <li key={i} className="flex min-w-0 gap-2.5 text-[13.5px] leading-relaxed">
                  <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0 break-words">
                    <Rich text={c} />
                  </span>
                </li>
              ))}
            </ul>
          </DocSection>

          <DocSection title={t("How to")}>
            <div className="grid gap-3">
              {doc.howto.map((r, i) => (
                <RecipeCard
                  key={r.title}
                  recipe={r}
                  index={i}
                  numbers={numbers}
                  active={active}
                  onHover={(id) => setActive(id && shot?.boxes.some((b) => b.id === id) ? id : null)}
                  onPick={pick}
                  onShowState={(st) => setView({ state: st })}
                  stateKey={stateKey}
                />
              ))}
            </div>
          </DocSection>

          {flows.length ? (
            <DocSection title={flows.length > 1 ? t("Videos") : t("Video")}>
              <div className="grid gap-3">
                {flows.map((f) => (
                  <FlowVideo key={f.id} id={f.id} title={f.title} video={videoOf(manifest, f.id)} />
                ))}
              </div>
            </DocSection>
          ) : null}

          {doc.tips.length ? (
            <DocSection title={t("Tips")} icon={<LightbulbIcon size={18} weight="duotone" className="text-warn" />}>
              <ul className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3.5">
                {doc.tips.map((t, i) => (
                  <li key={i} className="flex min-w-0 gap-2.5 text-[13.5px] leading-relaxed">
                    <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-warn" />
                    <span className="min-w-0 break-words">
                      <Rich text={t} />
                    </span>
                  </li>
                ))}
              </ul>
            </DocSection>
          ) : null}

          <DocSection title={t("Who can use it")} icon={<UsersIcon size={18} weight="duotone" className="text-info" />}>
            <p className="text-[13.5px] leading-relaxed">{doc.who}</p>
          </DocSection>

          {doc.related.length ? (
            <DocSection title={t("Related pages")}>
              <ul className="flex flex-wrap gap-2">
                {doc.related.map((id) => {
                  const p = gt.pageById(id);
                  if (!p) return null;
                  const RIcon = (PAGE_ICONS[p.id] ?? BookBookmarkIcon);
                  return (
                    <li key={id}>
                      <Link
                        to="/guide/$page"
                        params={{ page: id }}
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
                      >
                        <RIcon size={15} /> {p.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </DocSection>
          ) : null}
        </div>
      </div>

      <nav aria-label={t("Previous and next page")} className="grid grid-cols-2 gap-3 border-t border-border pt-5">
        {prev ? (
          <Link
            to="/guide/$page"
            params={{ page: prev.id }}
            className="grid min-w-0 gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 transition-colors hover:border-accent/40"
          >
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <ArrowLeftIcon size={13} /> {t("Previous")}
            </span>
            <span className="truncate text-[14px] font-medium">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            to="/guide/$page"
            params={{ page: next.id }}
            className="grid min-w-0 justify-items-end gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-right transition-colors hover:border-accent/40"
          >
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              {t("Next")} <ArrowRightIcon size={13} />
            </span>
            <span className="max-w-full truncate text-[14px] font-medium">{next.title}</span>
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

  return (
    <Page wide>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-[4.75rem] grid max-h-[calc(100dvh-6rem)] grid-rows-[auto_minmax(0,1fr)] gap-3">
            <SearchInput value={query} onChange={setQuery} placeholder={t("Search the guide")} className="basis-auto" />
            <div className="-mx-1 overflow-y-auto px-1 pb-4">
              <PageIndex current={page?.id} query={searching ? "" : query} />
            </div>
          </div>
        </aside>
        <div className="grid min-w-0 content-start gap-5">
          <IndexSheet current={page} query={query} onQuery={setQuery} />
          {params.page && !page ? (
            <EmptyState
              icon={BookOpenTextIcon}
              title={t("No guide page by that name")}
              body={t("It may have been renamed. Pick a page from the list.")}
              action={
                <Button asChild variant="outline">
                  <Link to="/guide">
                    {t("Guide home")} <CaretRightIcon size={14} />
                  </Link>
                </Button>
              }
            />
          ) : page && searching ? (
            <div className="hidden gap-3 lg:grid">
              <h2 className="text-[15px] font-semibold">{t('Results for "{q}"', { q: query.trim() })}</h2>
              <SearchResults query={query} onPick={() => setQuery("")} />
            </div>
          ) : null}
          {page ? (
            <div className={cn(searching && "lg:hidden")}>
              <PageDocView key={page.id} page={page} manifest={manifest} />
            </div>
          ) : !params.page ? (
            <GuideHome manifest={manifest} query={query} onQuery={setQuery} />
          ) : null}
        </div>
      </div>
    </Page>
  );
}
