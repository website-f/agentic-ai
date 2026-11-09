import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BankIcon,
  BriefcaseIcon,
  CaretRightIcon,
  DesktopTowerIcon,
  GlobeHemisphereEastIcon,
  HandshakeIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  PackageIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  WalletIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { HomeItem, HomeLink } from '@prima/core';
import type { ViewName } from './App';
import { ViewIcon } from './icons';
import { tr, useLang } from './i18n';
import { Marked, type MenuItem } from './NavMenu';
import { NAV_INFO, appsOf, recentViews, searchNav, spaceLayout, spaceOf, whereIs, type NavLayout, type SpaceId } from './nav-catalog';
import './styles/spaces.css';

/**
 * P91 (Fitri, 9 Nov 2026): Prima as a set of apps, like a super-app. The home screen shows one card per app; opening an
 * app turns the side menu into that app's screens with a way back (desktop), and a bar with the app's screens across the
 * top (phone). The apps are only a way to find screens: who may open each screen is still the menu filter in App.tsx and
 * the server.
 */

const ICONS: Record<SpaceId, (size: number) => ReactNode> = {
  home: (s) => <HouseIcon size={s} weight="duotone" aria-hidden="true" />,
  ops: (s) => <MapTrifoldIcon size={s} weight="duotone" aria-hidden="true" />,
  security: (s) => <ShieldCheckIcon size={s} weight="duotone" aria-hidden="true" />,
  equip: (s) => <PackageIcon size={s} weight="duotone" aria-hidden="true" />,
  hr: (s) => <UsersThreeIcon size={s} weight="duotone" aria-hidden="true" />,
  pay: (s) => <WalletIcon size={s} weight="duotone" aria-hidden="true" />,
  fw: (s) => <GlobeHemisphereEastIcon size={s} weight="duotone" aria-hidden="true" />,
  sales: (s) => <HandshakeIcon size={s} weight="duotone" aria-hidden="true" />,
  finance: (s) => <BankIcon size={s} weight="duotone" aria-hidden="true" />,
  gov: (s) => <SealCheckIcon size={s} weight="duotone" aria-hidden="true" />,
  board: (s) => <BriefcaseIcon size={s} weight="duotone" aria-hidden="true" />,
  it: (s) => <DesktopTowerIcon size={s} weight="duotone" aria-hidden="true" />,
  more: (s) => <SquaresFourIcon size={s} weight="duotone" aria-hidden="true" />,
};

/** An app's icon on its own colour (each app keeps one colour everywhere, so it is known at a glance). */
export function SpaceIcon({ id, size = 'md' }: { id: string; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'lg' ? 34 : size === 'sm' ? 18 : 28;
  return (
    <span className="sp-icon" data-space={id} data-size={size} aria-hidden="true">
      {(ICONS[id as SpaceId] ?? ICONS.more)(px)}
    </span>
  );
}

/** How many open items on the home screen belong to each app (the red number on its card). */
export function waitingBySpace(items: HomeItem[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items ?? []) {
    if (t.tone !== 'crit' && t.tone !== 'warn') continue;
    const s = spaceOf(t.go.view as ViewName);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/** The app cards: icons in a grid of four on a phone, cards with a line each on a wider screen. */
export function AppGrid({
  apps,
  waiting = {},
  onOpen,
  compact,
  current,
}: {
  apps: NavLayout<MenuItem>[];
  waiting?: Record<string, number>;
  onOpen: (id: SpaceId) => void;
  /** The small grid in a pop-over or a phone sheet. */
  compact?: boolean;
  current?: string | null;
}) {
  return (
    <ul className="sp-grid" data-compact={compact || undefined} aria-label="Apps">
      {apps.map((a) => (
        <li key={a.id}>
          <button type="button" className="sp-card" data-space={a.id} aria-current={current === a.id ? 'true' : undefined} onClick={() => onOpen(a.id as SpaceId)}>
            <span className="sp-card-icon">
              <SpaceIcon id={a.id} />
              {!!waiting[a.id] && (
                <span className="sp-badge num" title="Waiting for you">
                  {waiting[a.id] > 99 ? '99+' : waiting[a.id]}
                </span>
              )}
            </span>
            <span className="sp-card-text">
              <span className="sp-card-name">{a.title}</span>
              {!compact && <span className="sp-card-blurb">{a.blurb}</span>}
              {!compact && (
                <span className="sp-card-meta">
                  <span className="num">{a.count}</span> <span>{a.count === 1 ? 'screen' : 'screens'}</span>
                </span>
              )}
            </span>
            {!compact && <CaretRightIcon className="sp-card-go" size={16} weight="bold" aria-hidden="true" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 19) return 'Good afternoon';
  return 'Good evening';
}

/** One search for the whole of Prima: apps by name, then screens by name, Malay or English, or everyday words. */
export function SpotSearch({
  menu,
  onView,
  onSpace,
  autoFocus,
  big,
}: {
  menu: MenuItem[];
  onView: (v: ViewName) => void;
  onSpace?: (id: SpaceId) => void;
  autoFocus?: boolean;
  big?: boolean;
}) {
  const { lang } = useLang();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const apps = useMemo(() => (onSpace ? appsOf(menu) : []), [menu, onSpace]);
  type Hit = { kind: 'app'; app: NavLayout<MenuItem> } | { kind: 'view'; item: MenuItem };
  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const appHits = apps.filter((a) => [a.title, tr(a.title, 'ms'), tr(a.title, 'mix')].some((t) => t.toLowerCase().startsWith(q))).map((a) => ({ kind: 'app' as const, app: a }));
    return [...appHits, ...searchNav(menu, query).map((h) => ({ kind: 'view' as const, item: h.item }))].slice(0, 12);
  }, [apps, menu, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const pick = (h: Hit) => {
    setQuery('');
    if (h.kind === 'app') onSpace?.(h.app.id as SpaceId);
    else onView(h.item.view);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') setQuery('');
  };
  return (
    <div className="sp-search" data-big={big || undefined}>
      <div className="sp-search-box">
        <MagnifyingGlassIcon size={big ? 20 : 16} aria-hidden="true" className="sp-search-icon" />
        <input
          ref={input}
          type="text"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          className="input"
          placeholder="Search apps and screens"
          aria-label="Search apps and screens"
          role="combobox"
          aria-expanded={!!query.trim()}
          aria-controls={listId}
          aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        {query && (
          <button type="button" className="navm-clear" aria-label="Clear the search" onClick={() => (setQuery(''), input.current?.focus())}>
            <XIcon size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {query.trim() && (
        <div className="sp-results" id={listId} role="listbox" aria-label="Search results">
          {hits.length === 0 ? (
            <div className="navm-empty">
              <p>No screen in your menu matches this.</p>
              <p className="muted small">Try another word, such as pay, leave or site.</p>
            </div>
          ) : (
            hits.map((h, i) => {
              if (h.kind === 'app')
                return (
                  <button key={`app-${h.app.id}`} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === active} data-active={i === active} className="sp-hit" onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                    <SpaceIcon id={h.app.id} size="sm" />
                    <span className="sp-hit-text">
                      <Marked text={h.app.title} query={query} />
                      <span className="sp-hit-where">App</span>
                    </span>
                    <ArrowRightIcon size={14} aria-hidden="true" className="sp-hit-go" />
                  </button>
                );
              const where = whereIs(h.item.view);
              return (
                <button key={h.item.view} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === active} data-active={i === active} className="sp-hit" onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                  <span className="sp-hit-icon" aria-hidden="true">
                    <ViewIcon view={h.item.view} fallback={h.item.icon} size={18} />
                  </span>
                  <span className="sp-hit-text">
                    <Marked text={h.item.label} query={query} />
                    {where && (
                      <span className="sp-hit-where" data-no-translate>
                        {tr(where.section.title, lang)} · {tr(where.group.title, lang)}
                      </span>
                    )}
                  </span>
                  <ArrowRightIcon size={14} aria-hidden="true" className="sp-hit-go" />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The top of the home screen for a person with apps: a greeting, one search for everything, the app cards, their own
 * everyday screens as shortcuts, and what they opened lately.
 */
export function HomeLaunchpad({
  name,
  intro,
  menu,
  userId,
  waiting,
  onView,
  onSpace,
  main = [],
}: {
  name: string;
  intro?: string;
  menu: MenuItem[];
  /** The person's main work screens, shown first among the shortcuts. */
  main?: MenuItem[];
  userId: string;
  waiting: Record<string, number>;
  onView: (v: ViewName) => void;
  onSpace: (id: SpaceId) => void;
}) {
  const { lang } = useLang();
  const apps = useMemo(() => appsOf(menu), [menu]);
  // The person's own screens first (clock, work…), then the dashboards.
  const mine = useMemo(() => {
    const own = (spaceLayout(menu, 'home')?.groups.slice().reverse().flatMap((g) => g.items) ?? []).filter((i) => i.view !== 'home');
    const seen = new Set<string>();
    return [...main, ...own].filter((i) => !seen.has(i.view) && !!seen.add(i.view)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, main.map((m) => m.view).join(',')]);
  const recent = useMemo(() => {
    const by = new Map(menu.map((i) => [i.view, i]));
    return recentViews(userId)
      .map((v) => by.get(v))
      .filter((x): x is MenuItem => !!x)
      .slice(0, 6);
    // Read once per visit to the home screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, userId]);
  const today = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ms-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  return (
    <>
      <section className="sp-hero" aria-labelledby="sp-hero-title">
        <p className="sp-hero-date" data-no-translate>
          {today}
        </p>
        <h1 id="sp-hero-title">
          <span>{greeting()}</span>
          <span className="sp-hero-comma" aria-hidden="true">
            ,{' '}
          </span>
          <span className="sp-hero-name" data-no-translate>
            {name}
          </span>
        </h1>
        {intro && <p className="sp-hero-sub">{intro}</p>}
        <SpotSearch menu={menu} onView={onView} onSpace={onSpace} big />
        {mine.length > 0 && (
          <div className="sp-quick" role="group" aria-label="My day">
            {mine.map((m) => (
              <button key={m.view} type="button" className="sp-quick-btn" onClick={() => onView(m.view)}>
                <ViewIcon view={m.view} fallback={m.icon} size={18} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="home-section sp-apps" id="apps" aria-labelledby="sp-apps-title">
        <div className="home-section-head">
          <h2 id="sp-apps-title">Apps</h2>
          <span className="home-cat-count num">{apps.length}</span>
        </div>
        <AppGrid apps={apps} waiting={waiting} onOpen={onSpace} />
        {recent.length > 0 && (
          <div className="home-recent sp-recent" role="group" aria-label="Recently opened">
            <span className="home-recent-label">Recently opened</span>
            {recent.map((r) => (
              <button key={r.view} type="button" className="home-recent-chip" onClick={() => onView(r.view)}>
                <ViewIcon view={r.view} fallback={r.icon} size={15} />
                {r.label}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** A screen's tile on an app's own home page. */
function ScreenTile({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="home-tile sp-tile" onClick={onOpen}>
        <span className="home-tile-icon" aria-hidden="true">
          <ViewIcon view={item.view} fallback={item.icon} size={20} />
        </span>
        <span className="home-tile-text">
          <span className="home-tile-label">{item.label}</span>
          {NAV_INFO[item.view] && <span className="home-tile-blurb">{NAV_INFO[item.view].blurb}</span>}
        </span>
        <CaretRightIcon className="sp-tile-go" size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/** An app's own home page: its screens in groups, and what is waiting for this person in it. */
export function SpaceHome({
  id,
  menu,
  waitingItems,
  onView,
  onLink,
  onBack,
}: {
  id: SpaceId;
  menu: MenuItem[];
  /** This person's open items from the home screen (filtered to this app here); undefined while loading. */
  waitingItems?: HomeItem[];
  onView: (v: ViewName) => void;
  onLink: (l: HomeLink) => void;
  onBack: () => void;
}) {
  const space = spaceLayout(menu, id);
  if (!space)
    return (
      <div className="page sp-page">
        <button type="button" className="sp-back-link" onClick={onBack}>
          <ArrowLeftIcon size={16} aria-hidden="true" /> All apps
        </button>
        <p className="muted">This app has no screens for you.</p>
      </div>
    );
  const waiting = (waitingItems ?? []).filter((t) => spaceOf(t.go.view as ViewName) === id && (t.tone === 'crit' || t.tone === 'warn'));
  return (
    <div className="page sp-page" data-space={id}>
      <button type="button" className="sp-back-link" onClick={onBack}>
        <ArrowLeftIcon size={16} aria-hidden="true" /> All apps
      </button>
      <header className="sp-page-head">
        <SpaceIcon id={id} size="lg" />
        <div>
          <h1>{space.title}</h1>
          <p className="k-head-sub">{space.blurb}</p>
        </div>
      </header>
      {waiting.length > 0 && (
        <section className="home-section" aria-labelledby="sp-waiting">
          <div className="home-section-head">
            <h2 id="sp-waiting">Waiting for you</h2>
            <span className="home-cat-count num" data-tone="warn">
              {waiting.length}
            </span>
          </div>
          <ul className="sp-wait">
            {waiting.slice(0, 8).map((t, i) => (
              <li key={i}>
                <button type="button" className="home-item" onClick={() => onLink(t.go)}>
                  <span className="home-dot" data-tone={t.tone} aria-hidden="true" />
                  <span className="home-item-text">
                    <span className="home-item-title">{t.title}</span>
                    <span className="home-item-detail">{t.detail}</span>
                  </span>
                  <ArrowRightIcon className="home-item-go" size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {waiting.length > 8 && (
            <p className="muted small">
              <span className="num">{waiting.length - 8}</span> <span>more on the home screen</span>
            </p>
          )}
        </section>
      )}
      {space.groups.map((g) => (
        <section className="home-section" key={g.title || 'all'} aria-label={g.title || space.title}>
          {space.groups.length > 1 && g.title && (
            <div className="home-section-head">
              <h2>{g.title}</h2>
            </div>
          )}
          <ul className="home-tiles sp-tiles">
            {g.items.map((i) => (
              <ScreenTile key={i.view} item={i} onOpen={() => onView(i.view)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The side menu's head inside an app: back to all apps, the app's name, and a switch to another app. */
export function SpaceRailHead({ id, menu, onHome, onSpace }: { id: SpaceId; menu: MenuItem[]; onHome: () => void; onSpace: (id: SpaceId) => void }) {
  const space = spaceLayout(menu, id);
  return (
    <div className="sp-rail-head" data-space={id}>
      <button type="button" className="sp-rail-back" onClick={onHome}>
        <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
        <span>All apps</span>
      </button>
      <div className="sp-rail-title">
        <button type="button" className="sp-rail-name" onClick={() => onSpace(id)} title="This app's home">
          <SpaceIcon id={id} size="sm" />
          <span>{space?.title ?? ''}</span>
        </button>
        <AppSwitcher menu={menu} current={id} onSpace={onSpace} />
      </div>
    </div>
  );
}

/** A button that opens a small grid of every app (switch app without going home first). */
export function AppSwitcher({ menu, current, onSpace, label }: { menu: MenuItem[]; current?: string | null; onSpace: (id: SpaceId) => void; label?: boolean }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const apps = useMemo(() => appsOf(menu), [menu]);
  // The side menu scrolls (and so would clip it): the pop-over is placed against the window, under the button, or above
  // it when there is no room below.
  const toggle = () => {
    const r = root.current?.getBoundingClientRect();
    if (r) {
      const width = Math.min(340, window.innerWidth - 24);
      const left = Math.max(12, Math.min(r.left - 8, window.innerWidth - width - 12));
      const below = window.innerHeight - r.bottom > 380;
      setAt(below ? { position: 'fixed', left, width, top: r.bottom + 6 } : { position: 'fixed', left, width, bottom: window.innerHeight - r.top + 6 });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="sp-switch" ref={root}>
      <button type="button" className={label ? 'sp-switch-btn sp-switch-wide' : 'sp-switch-btn'} aria-haspopup="true" aria-expanded={open} aria-label="Switch app" title="Switch app" onClick={toggle}>
        <SquaresFourIcon size={18} weight="bold" aria-hidden="true" />
        {label && <span>Apps</span>}
      </button>
      {open && (
        <div className="sp-pop" role="dialog" aria-label="Apps" style={at}>
          <AppGrid
            apps={apps}
            compact
            current={current}
            onOpen={(a) => {
              setOpen(false);
              onSpace(a);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** On a phone, inside an app: back to all apps, the app's name, and its screens in a strip that scrolls sideways. */
export function SpacePhoneBar({ id, menu, current, onHome, onSpace, onView }: { id: SpaceId; menu: MenuItem[]; current: ViewName | null; onHome: () => void; onSpace: (id: SpaceId) => void; onView: (v: ViewName) => void }) {
  const space = spaceLayout(menu, id);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current]);
  if (!space) return null;
  const items = space.groups.flatMap((g) => g.items);
  return (
    <div className="sp-phonebar" data-space={id}>
      <div className="sp-phonebar-top">
        <button type="button" className="sp-phonebar-back" onClick={onHome} aria-label="All apps">
          <ArrowLeftIcon size={20} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="sp-phonebar-name" onClick={() => onSpace(id)}>
          <SpaceIcon id={id} size="sm" />
          <span>{space.title}</span>
        </button>
      </div>
      {items.length > 1 && (
        <div className="sp-chips" ref={strip} data-scroll-strip>
          {items.map((i) => (
            <button key={i.view} type="button" className="sp-chip" aria-current={current === i.view ? 'page' : undefined} onClick={() => onView(i.view)}>
              <ViewIcon view={i.view} fallback={i.icon} size={15} />
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
