import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CaretDownIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';
import type { ViewName } from './App';
import { ViewIcon } from './icons';
import { tr, useLang } from './i18n';
import { layoutNav, matchSpan, saveSectionState, searchNav, sectionState, whereIs } from './nav-catalog';
import './styles/nav.css';

export interface MenuItem {
  view: ViewName;
  label: string;
  icon: string;
}

/** A menu longer than this gets a search box and sections that open and close. */
const SHORT = 8;
/** Up to this many screens every section starts open; above it only Today and the open screen's section. */
const ALL_OPEN = 24;

/** "Search the menu" pressed from anywhere: `/` or Ctrl+K (Cmd+K on a Mac), unless the person is typing. */
export function isMenuHotkey(e: KeyboardEvent): boolean {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') return true;
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  return !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}

/** A label as shown in the chosen language, with the part that matches the search marked. */
export function Marked({ text, query }: { text: string; query: string }) {
  const { lang } = useLang();
  const shown = tr(text, lang);
  const m = matchSpan(shown, query);
  return (
    <span className="navm-label" data-no-translate>
      {m ? (
        <>
          {m[0]}
          <mark>{m[1]}</mark>
          {m[2]}
        </>
      ) : (
        shown
      )}
    </span>
  );
}

/**
 * P90: the side menu and the phone's More sheet. A search box on top (label in any language, section, or everyday
 * words such as "gaji" or "cuti"), then the sections, each opening and closing, remembered per person in this browser.
 * The section holding the open screen opens when that screen opens, and the open screen is scrolled into view.
 */
export function NavMenu({
  items,
  searchItems = items,
  current,
  onOpen,
  userId,
  variant,
  focusSearch,
  onHotkeyHidden,
}: {
  items: MenuItem[];
  /** What the search looks through (the More sheet shows only the rest of the menu but searches all of it). */
  searchItems?: MenuItem[];
  current: ViewName;
  onOpen: (view: ViewName) => void;
  userId: string;
  variant: 'rail' | 'sheet';
  /** Put the cursor in the search box when shown (the sheet opened by the keyboard shortcut). */
  focusSearch?: boolean;
  /** The shortcut was pressed while this menu is hidden (the side menu on a phone). */
  onHotkeyHidden?: () => void;
}) {
  const { lang } = useLang();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const long = searchItems.length > SHORT;
  const sections = useMemo(() => layoutNav(items), [items]);
  const here = whereIs(current)?.section.id;

  const [open, setOpen] = useState<Record<string, boolean>>(() => sectionState(userId));
  const isOpen = (id: string) => open[id] ?? (items.length <= ALL_OPEN || id === 'today' || id === here || id === 'more');
  const toggle = (id: string) => {
    const was = isOpen(id);
    // From the latest state, so quick clicks on several sections all count.
    setOpen((o) => {
      const next = { ...o, [id]: !(o[id] ?? was) };
      saveSectionState(userId, next);
      return next;
    });
  };
  // The open screen's section is always opened when that screen opens.
  useEffect(() => {
    if (!here) return;
    setOpen((o) => {
      if (o[here] !== false) return o;
      const next = { ...o, [here]: true };
      saveSectionState(userId, next);
      return next;
    });
  }, [here, userId]);

  // Keep the open screen in view (a long menu scrolls).
  useEffect(() => {
    if (query) return;
    const el = root.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'nearest' });
  }, [current, query, open]);

  const hits = useMemo(() => (query.trim() ? searchNav(searchItems, query).map((h) => h.item) : []), [searchItems, query]);
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (focusSearch) input.current?.focus();
  }, [focusSearch]);

  // `/` or Ctrl+K: the side menu's search, or (on a phone, where it is hidden) the More sheet's.
  useEffect(() => {
    if (variant !== 'rail' || !long) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isMenuHotkey(e)) return;
      const box = input.current;
      e.preventDefault();
      if (box && box.offsetParent !== null) {
        box.focus();
        box.select();
      } else onHotkeyHidden?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, long, onHotkeyHidden]);

  const pick = (view: ViewName) => {
    setQuery('');
    onOpen(view);
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
      pick(hits[active].view);
      input.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else input.current?.blur();
    }
  };

  // Keep the chosen search result in view while moving with the arrows.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const button = (n: MenuItem) => (
    <button
      key={n.view}
      type="button"
      className={variant === 'sheet' ? 'sheet-item' : undefined}
      aria-current={current === n.view ? 'page' : undefined}
      onClick={() => pick(n.view)}
    >
      <ViewIcon view={n.view} fallback={n.icon} />
      {n.label}
    </button>
  );

  return (
    <div className={`navm navm-${variant}`} ref={root}>
      {long && (
        <div className="navm-search">
          <MagnifyingGlassIcon size={16} aria-hidden="true" className="navm-search-icon" />
          <input
            ref={input}
            type="text"
            inputMode="search"
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
            className="input"
            placeholder="Search the menu"
            aria-label="Search the menu"
            role="combobox"
            aria-expanded={!!query.trim()}
            aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${hits[active].view}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          {query ? (
            <button type="button" className="navm-clear" aria-label="Clear the search" onClick={() => (setQuery(''), input.current?.focus())}>
              <XIcon size={14} aria-hidden="true" />
            </button>
          ) : (
            variant === 'rail' && (
              <kbd className="navm-kbd" aria-hidden="true" title="Press / or Ctrl+K to search">
                /
              </kbd>
            )
          )}
        </div>
      )}
      {query.trim() ? (
        <div className="navm-results" id={listId} role="listbox" aria-label="Search results">
          {hits.length === 0 ? (
            <div className="navm-empty">
              <p>No screen in your menu matches this.</p>
              <p className="muted small">Try another word, such as pay, leave or site.</p>
            </div>
          ) : (
            hits.map((n, i) => {
              const where = whereIs(n.view);
              return (
                <button
                  key={n.view}
                  id={`${listId}-${n.view}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className={`navm-hit${variant === 'sheet' ? ' sheet-item' : ''}`}
                  aria-current={current === n.view ? 'page' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(n.view)}
                >
                  <ViewIcon view={n.view} fallback={n.icon} />
                  <span className="navm-hit-text">
                    <Marked text={n.label} query={query} />
                    {where && (
                      <span className="navm-hit-where" data-no-translate>
                        {tr(where.section.title, lang)} · {tr(where.group.title, lang)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : items.length <= SHORT ? (
        <div className="nav-section">{items.map(button)}</div>
      ) : (
        sections.map((sec) => {
          const opened = isOpen(sec.id);
          const bodyId = `${listId}-${sec.id}`;
          const showGroups = sec.count > 6 && sec.groups.length > 1;
          return (
            <div className="nav-section navm-section" key={sec.id} data-open={opened}>
              <button type="button" className="navm-head" aria-expanded={opened} aria-controls={bodyId} onClick={() => toggle(sec.id)}>
                <span className="navm-head-title">{sec.title}</span>
                <span className="navm-count" aria-hidden="true">
                  {sec.count}
                </span>
                <CaretDownIcon size={12} weight="bold" aria-hidden="true" className="navm-caret" />
              </button>
              {opened && (
                <div className="navm-body" id={bodyId}>
                  {sec.groups.map((g) => (
                    <div className="navm-group" key={g.title || 'all'}>
                      {showGroups && g.title && <div className="navm-group-title">{g.title}</div>}
                      {g.items.map(button)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
