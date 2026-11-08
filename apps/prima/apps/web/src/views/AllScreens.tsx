import { useMemo, useState, type ReactNode } from 'react';
import {
  CaretDownIcon,
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  DesktopTowerIcon,
  MagnifyingGlassIcon,
  ScalesIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  SunIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import { ViewIcon } from '../icons';
import { Marked, type MenuItem } from '../NavMenu';
import { NAV_INFO, layoutNav, recentViews, searchNav, whereIs } from '../nav-catalog';
import { tr, useLang } from '../i18n';
import '../styles/nav.css';

const CAT_ICON: Record<string, ReactNode> = {
  today: <SunIcon size={20} aria-hidden="true" />,
  ops: <ShieldCheckIcon size={20} aria-hidden="true" />,
  people: <UsersThreeIcon size={20} aria-hidden="true" />,
  biz: <ChartLineUpIcon size={20} aria-hidden="true" />,
  gov: <ScalesIcon size={20} aria-hidden="true" />,
  it: <DesktopTowerIcon size={20} aria-hidden="true" />,
  more: <SquaresFourIcon size={20} aria-hidden="true" />,
};

/** A category card shows this many screens until opened. */
const FOLD = 6;

function Tile({ item, query, onOpen }: { item: MenuItem; query?: string; onOpen: () => void }) {
  const { lang } = useLang();
  const where = query ? whereIs(item.view) : undefined;
  return (
    <li>
      <button type="button" className="home-tile" onClick={onOpen}>
        <span className="home-tile-icon" aria-hidden="true">
          <ViewIcon view={item.view} fallback={item.icon} size={18} />
        </span>
        <span className="home-tile-text">
          {query ? <Marked text={item.label} query={query} /> : <span className="home-tile-label">{item.label}</span>}
          {NAV_INFO[item.view] && <span className="home-tile-blurb">{NAV_INFO[item.view].blurb}</span>}
          {where && (
            <span className="home-tile-where" data-no-translate>
              {tr(where.section.title, lang)} · {tr(where.group.title, lang)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * P90 (Fitri, 9 Nov 2026): the home screen's "All your screens": one card per menu section with its screens in small
 * groups, each with a plain line on what it is for, a search box, and the screens opened lately. Only the screens this
 * person's menu holds, so each role sees its own.
 */
export function AllScreens() {
  const { me, menu, go } = useApp();
  const [query, setQuery] = useState('');
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const items = useMemo(() => (menu ?? []).filter((n) => n.view !== 'home'), [menu]);
  const sections = useMemo(() => layoutNav(items), [items]);
  const recent = useMemo(() => {
    const by = new Map(items.map((i) => [i.view, i]));
    return recentViews(me.user.id)
      .map((v) => by.get(v))
      .filter((x): x is MenuItem => !!x)
      .slice(0, 6);
    // Read once per visit to the home screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, me.user.id]);
  const hits = useMemo(() => (query.trim() ? searchNav(items, query).map((h) => h.item) : []), [items, query]);
  if (items.length < 2) return null;
  const open = (view: MenuItem['view']) => go({ view });

  return (
    <section className="home-section home-screens" aria-labelledby="home-screens">
      <div className="home-screens-head">
        <div className="home-section-head">
          <h2 id="home-screens">All your screens</h2>
          <span className="home-cat-count">{items.length}</span>
        </div>
        <div className="navm-search home-screens-search">
          <MagnifyingGlassIcon size={16} aria-hidden="true" className="navm-search-icon" />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
            className="input"
            placeholder="Find a screen"
            aria-label="Find a screen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'Enter' && hits[0]) open(hits[0].view);
            }}
          />
          {query && (
            <button type="button" className="navm-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
              <XIcon size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {!query.trim() && recent.length > 0 && (
        <div className="home-recent" role="group" aria-label="Recently opened">
          <span className="home-recent-label">
            <ClockCounterClockwiseIcon size={15} aria-hidden="true" />
            Recently opened
          </span>
          {recent.map((r) => (
            <button key={r.view} type="button" className="home-recent-chip" onClick={() => open(r.view)}>
              <ViewIcon view={r.view} fallback={r.icon} size={15} />
              {r.label}
            </button>
          ))}
        </div>
      )}

      {query.trim() ? (
        hits.length ? (
          <ul className="home-tiles home-tiles-results" aria-label="Search results">
            {hits.map((h) => (
              <Tile key={h.view} item={h} query={query} onOpen={() => open(h.view)} />
            ))}
          </ul>
        ) : (
          <div className="navm-empty home-screens-empty">
            <p>No screen in your menu matches this.</p>
            <p className="muted small">Try another word, such as pay, leave or site.</p>
          </div>
        )
      ) : (
        <div className="home-cats">
          {sections.map((sec) => {
            const all = unfolded[sec.id] || sec.count <= FOLD + 1;
            let left = all ? Infinity : FOLD;
            const showGroups = sec.groups.length > 1 && sec.count > 3;
            return (
              <section key={sec.id} className="home-cat" data-cat={sec.id} aria-labelledby={`home-cat-${sec.id}`}>
                <header className="home-cat-head">
                  <span className="home-cat-icon" aria-hidden="true">
                    {CAT_ICON[sec.id] ?? CAT_ICON.more}
                  </span>
                  <h3 id={`home-cat-${sec.id}`}>{sec.title}</h3>
                  <span className="home-cat-count">{sec.count}</span>
                </header>
                {sec.groups.map((g) => {
                  if (left <= 0) return null;
                  const shown = g.items.slice(0, left);
                  left -= shown.length;
                  return (
                    <div className="home-cat-group" key={g.title || 'all'}>
                      {showGroups && g.title && <h4>{g.title}</h4>}
                      <ul className="home-tiles">
                        {shown.map((i) => (
                          <Tile key={i.view} item={i} onOpen={() => open(i.view)} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {sec.count > FOLD + 1 && (
                  <button
                    type="button"
                    className="home-group-more"
                    aria-expanded={!!unfolded[sec.id]}
                    onClick={() => setUnfolded((u) => ({ ...u, [sec.id]: !u[sec.id] }))}
                  >
                    {unfolded[sec.id] ? (
                      'Show fewer'
                    ) : (
                      <>
                        <span>Show all</span> <span className="num">{sec.count}</span>
                      </>
                    )}
                    <CaretDownIcon size={14} aria-hidden="true" data-open={!!unfolded[sec.id]} />
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
