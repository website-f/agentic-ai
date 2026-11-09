/**
 * P90 (Fitri, 9 Nov 2026): one searchable pick-list for the whole app, in place of the browser's own drop-down, so a long
 * list (companies, sites, guards, clients...) can be searched by typing. Drawn like the kit's `.select` field.
 *
 *   <Select className="select" value={v} onChange={(e) => set(e.target.value)}>   drop-in for <select>: same children
 *     <option value="">All sites</option>{sites.map(...)}                            (<option>, <optgroup>), same event
 *   </Select>
 *   <SearchSelect value={v} onChange={set} options={[{ value, label, group?, disabled? }]} />
 *
 * - Type to filter: matches anywhere in the name, ignores case and accents, and matches the English or the Malay
 *   wording on screen. Option groups keep their headings. Disabled options show but cannot be chosen.
 * - Keyboard: arrows, Page Up/Down, Home/End, Enter, Esc, Tab; typing on the closed field jumps (short lists) or starts
 *   a search (long lists); Delete clears an optional field. ARIA combobox + listbox.
 * - On a phone (640px or narrower) the list opens as a bottom sheet with a big search box and big rows. On a computer
 *   it drops down under the field, or above it near the bottom of the screen. It is drawn on top of the page (a portal),
 *   so it works inside drawers and pop-overs. Very long lists draw only the rows in view.
 * - A real <select> stays in the page, hidden, with the same options and value: forms, `required` checks and
 *   `e.target.value` keep working, and the change event's target is that element.
 */
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { tr, useLang, type Lang } from './i18n';
import { useBackClose } from './back-close';
import './styles/kit-controls.css';

export type SelectOption = { value: string; label: string; group?: string; disabled?: boolean; hidden?: boolean };

/** Lists this long or longer get the search box (Select2's "minimum results for search"); shorter ones jump by typing. */
const SEARCH_FROM = 8;
/** Lists with more rows than this draw only the rows in view. */
const VIRTUAL_FROM = 120;
const PHONE = '(max-width: 640px)';

// ---------- Options from <option>/<optgroup> children ----------

function textOf(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return '';
}

export function readOptions(children: ReactNode, group?: string, groupOff = false, out: SelectOption[] = []): SelectOption[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<Record<string, unknown>>;
    const p = el.props;
    if (el.type === Fragment) readOptions(p.children as ReactNode, group, groupOff, out);
    else if (el.type === 'optgroup') readOptions(p.children as ReactNode, String(p.label ?? ''), !!p.disabled, out);
    else if (el.type === 'option') {
      const text = textOf(p.children as ReactNode).replace(/\s+/g, ' ').trim();
      const label = p.label != null ? String(p.label) : text;
      out.push({
        value: p.value != null ? String(p.value) : text,
        label,
        group,
        disabled: !!p.disabled || groupOff,
        hidden: !!p.hidden,
      });
    }
  });
  return out;
}

// ---------- Matching ----------

/** Lower case, no accents, punctuation as spaces: "Sdn. Bhd." finds "sdn bhd". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** What a search looks through: the option's English and on-screen wording, and its group's. */
function haystack(o: SelectOption, lang: Lang): string {
  return ` ${fold(o.label)} ${fold(tr(o.label, lang))} ${o.group ? fold(o.group) + ' ' + fold(tr(o.group, lang)) : ''}`;
}

/** Every word typed must appear somewhere in the option's English or on-screen wording or its group. */
export function matches(o: SelectOption, query: string, lang: Lang, hay = haystack(o, lang)): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  return words.every((w) => hay.includes(w));
}

type Row = { kind: 'group'; label: string } | { kind: 'option'; o: SelectOption; i: number };

function buildRows(list: SelectOption[]): Row[] {
  const rows: Row[] = [];
  let last: string | undefined;
  list.forEach((o, i) => {
    if (o.group !== last) {
      if (o.group) rows.push({ kind: 'group', label: o.group });
      last = o.group;
    }
    rows.push({ kind: 'option', o, i });
  });
  return rows;
}

/** The part of the label that matches the first word typed, in bold. */
function Marked({ text, query }: { text: string; query: string }) {
  const w = fold(query).split(' ').filter(Boolean)[0];
  if (!w) return <>{text}</>;
  // Fold each character on its own so positions in the folded text line up with the shown text.
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]) || ' ';
    for (const ch of f) {
      folded += ch;
      map.push(i);
    }
  }
  const at = folded.indexOf(w);
  if (at < 0) return <>{text}</>;
  const s = map[at];
  const e = map[at + w.length - 1] + 1;
  return (
    <>
      {text.slice(0, s)}
      <mark>{text.slice(s, e)}</mark>
      {text.slice(e)}
    </>
  );
}

// ---------- The field ----------

type Shared = {
  id?: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  /** Shown when nothing is chosen and no option has an empty value. */
  placeholder?: string;
  /** Force the search box on (true) or off (false); by default lists of 8 or more get one. */
  searchable?: boolean;
  /** Show the clear (x) mark; by default when an option with an empty value exists and the field is not required. */
  clearable?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
};

type ComboProps = Shared & {
  value: string;
  options: SelectOption[];
  emit: (value: string, native: HTMLSelectElement | null) => void;
  nativeChildren: ReactNode;
};

function Combo(props: ComboProps) {
  const { value, options, emit, nativeChildren, className, style, disabled, required, name, id, title } = props;
  const { lang } = useLang();
  const uid = useId();
  const listId = `ksel-${uid.replace(/:/g, '')}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [heading, setHeading] = useState('');
  const typed = useRef({ text: '', at: 0 });

  const shown = useMemo(() => options.filter((o) => !o.hidden), [options]);
  const selected = options.find((o) => o.value === value);
  // A value not in the list shows what the browser would: the first option.
  const current = selected ?? (value === '' ? options.find((o) => o.value === '') : undefined) ?? options[0];
  const emptyOption = options.find((o) => o.value === '' && !o.disabled && !o.hidden);
  const canClear = !disabled && value !== '' && (props.clearable ?? (!!emptyOption && !required));
  const searchOn = props.searchable ?? shown.filter((o) => !o.disabled).length >= SEARCH_FROM;
  const longest = useMemo(() => {
    let best = props.placeholder ?? '';
    for (const o of shown) if (o.label.length > best.length) best = o.label;
    return best.slice(0, 100);
  }, [shown, props.placeholder]);

  // Each option's on-screen words and search text, worked out once while the list is open, not on every keystroke
  // (and not at all for the many closed fields on a page).
  const index = useMemo(
    () => (open ? new Map(shown.map((o) => [o, { text: tr(o.label, lang), hay: haystack(o, lang) }])) : null),
    [open, shown, lang],
  );
  const find = useCallback((q: string) => (q ? shown.filter((o) => matches(o, q, lang, index?.get(o)?.hay)) : shown), [shown, lang, index]);
  const words = (o: SelectOption) => index?.get(o)?.text ?? tr(o.label, lang);
  const filtered = useMemo(() => find(query), [find, query]);
  const rows = useMemo(() => buildRows(filtered), [filtered]);
  const virtual = rows.length > VIRTUAL_FROM;
  const rowH = sheet ? 48 : 36;
  const optionRows = useMemo(() => rows.map((r, i) => (r.kind === 'option' && !r.o.disabled ? i : -1)).filter((i) => i >= 0), [rows]);

  // The hidden native select follows the value (React does not reset it when a change is refused).
  useLayoutEffect(() => {
    const n = nativeRef.current;
    if (n && n.value !== value) n.value = value;
  });

  const label = useCallback((): string => {
    if (props['aria-label']) return props['aria-label'];
    const t = triggerRef.current;
    const lab = t?.labels?.[0];
    if (lab) {
      // The label's own words, without the field's value or the hidden list inside it.
      const copy = lab.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('select, button, .ksel-trigger, input, textarea').forEach((n) => n.remove());
      const words = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (words) return words;
    }
    if (title) return title;
    const by = props['aria-labelledby'] && document.getElementById(props['aria-labelledby']);
    return by ? (by.textContent ?? '').trim() : '';
  }, [props, title]);

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    if (window.matchMedia(PHONE).matches) {
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      const bottom = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
      setSheet(true);
      setPos({ bottom, maxHeight: Math.round(h * 0.86) });
      return;
    }
    setSheet(false);
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Scrolled out of sight (the page or a drawer moved): close rather than float over something else.
    if (r.bottom < 0 || r.top > vh) {
      setOpen(false);
      return;
    }
    const want = Math.min(380, (searchOn ? 56 : 8) + Math.max(1, rows.length) * 36 + 8);
    const below = vh - r.bottom - 10;
    const above = r.top - 10;
    const up = below < Math.min(want, 260) && above > below;
    const maxHeight = Math.max(140, Math.min(380, up ? above : below));
    const width = Math.min(Math.max(r.width, 260), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    setPos(up ? { left, width, maxHeight, bottom: vh - r.top + 4 } : { left, width, maxHeight, top: r.bottom + 4 });
  }, [rows.length, searchOn]);

  const show = useCallback(
    (seed = '', at: 'selected' | 'first' | 'last' = 'selected') => {
      if (disabled) return;
      setQuery(seed);
      setSheet(window.matchMedia(PHONE).matches);
      setHeading(label());
      setScrollTop(0);
      const rs = buildRows(find(seed));
      const ok = rs.map((r, i) => (r.kind === 'option' && !r.o.disabled ? i : -1)).filter((i) => i >= 0);
      const sel = rs.findIndex((r) => r.kind === 'option' && r.o.value === value);
      setActive(at === 'last' ? (ok.at(-1) ?? -1) : at === 'first' || seed || sel < 0 ? (ok[0] ?? -1) : sel);
      setOpen(true);
    },
    [disabled, label, find, value],
  );

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  // P96: on a phone the list is a bottom sheet; the phone's Back closes it.
  useBackClose(open && sheet, () => close(false));

  const choose = useCallback(
    (o: SelectOption | undefined, refocus = true) => {
      if (!o || o.disabled) return;
      close(refocus);
      if (o.value === value) return;
      const n = nativeRef.current;
      if (n) n.value = o.value;
      emit(o.value, n);
    },
    [close, emit, value],
  );

  // Position on open and while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    let raf = 0;
    const again = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    window.visualViewport?.addEventListener('resize', again);
    window.visualViewport?.addEventListener('scroll', again);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
      window.visualViewport?.removeEventListener('resize', again);
      window.visualViewport?.removeEventListener('scroll', again);
    };
  }, [open, place]);

  // Focus moves into the list when it opens. On a phone the keyboard is not raised until the search box is tapped.
  useEffect(() => {
    if (!open) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (searchOn && !(sheet && coarse)) searchRef.current?.focus({ preventScroll: true });
    else (sheet ? popRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [open, sheet, searchOn]);

  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open, close]);

  // Keep the highlighted row in view.
  useLayoutEffect(() => {
    const l = listRef.current;
    if (!open || !l || active < 0) return;
    let top: number;
    let h: number;
    if (virtual) {
      top = active * rowH;
      h = rowH;
    } else {
      const el = l.querySelector<HTMLElement>(`[data-row="${active}"]`);
      if (!el) return;
      top = el.offsetTop;
      h = el.offsetHeight;
      // Show the group heading above the first option of a group.
      const prev = el.previousElementSibling as HTMLElement | null;
      if (prev?.classList.contains('ksel-group') && top - prev.offsetHeight <= l.scrollTop) {
        top = prev.offsetTop;
        h += prev.offsetHeight;
      }
    }
    if (top < l.scrollTop) l.scrollTop = top;
    else if (top + h > l.scrollTop + l.clientHeight) l.scrollTop = top + h - l.clientHeight;
  }, [active, open, virtual, rowH, rows]);

  const move = (to: number) => {
    if (!optionRows.length) return;
    setActive(optionRows[Math.max(0, Math.min(optionRows.length - 1, to))]);
  };
  const at = optionRows.indexOf(active);
  const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 300) / rowH) - 1);

  /** Type-ahead: letters typed quickly find the next option starting with them. */
  const typeAhead = (key: string): SelectOption | undefined => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const want = fold(t.text);
    const list = shown.filter((o) => !o.disabled);
    const from = Math.max(0, list.findIndex((o) => o.value === value));
    const ordered = t.text.length === 1 ? [...list.slice(from + 1), ...list.slice(0, from + 1)] : [...list.slice(from), ...list.slice(0, from)];
    return ordered.find((o) => fold(words(o)).startsWith(want) || fold(o.label).startsWith(want));
  };

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || k === 'F4') {
      e.preventDefault();
      show('', k === 'ArrowUp' && !selected ? 'last' : 'selected');
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      show('', k === 'Home' ? 'first' : 'last');
    } else if ((k === 'Delete' || k === 'Backspace') && canClear) {
      e.preventDefault();
      choose(emptyOption ?? { value: '', label: '' });
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && k !== ' ') {
      e.preventDefault();
      if (searchOn) show(k);
      else {
        const o = typeAhead(k);
        if (o && o.value !== value) {
          const n = nativeRef.current;
          if (n) n.value = o.value;
          emit(o.value, n);
        }
      }
    }
  };

  const onPopKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === 'ArrowDown') move(at < 0 ? 0 : at + 1);
    else if (k === 'ArrowUp') move(at < 0 ? 0 : at - 1);
    else if (k === 'PageDown') move(at + page);
    else if (k === 'PageUp') move(at - page);
    else if (k === 'Home' && (!searchOn || !query)) move(0);
    else if (k === 'End' && (!searchOn || !query)) move(optionRows.length - 1);
    else if (k === 'Enter') {
      const r = rows[active];
      if (r?.kind === 'option') choose(r.o);
    } else if (k === 'Escape') {
      // Handled here: a drawer under the list must not close as well.
      e.stopPropagation();
      close(true);
    } else if (k === 'Tab') {
      // Back on the field first, so Tab carries on to the next field of the form.
      close(true);
      return;
    } else if (k === ' ' && !searchOn) {
      const r = rows[active];
      if (r?.kind === 'option') choose(r.o);
    } else if (!searchOn && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const o = typeAhead(k);
      const i = o ? rows.findIndex((r) => r.kind === 'option' && r.o === o) : -1;
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  const onTriggerClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if ((e.target as HTMLElement).closest('.ksel-clear')) {
      e.preventDefault();
      choose(emptyOption ?? { value: '', label: '' }, true);
      return;
    }
    if (open) close(true);
    else show();
  };

  const shownLabel = current ? current.label : (props.placeholder ?? 'Choose');
  const triggerCls = ['select', 'ksel-trigger', className].filter(Boolean).join(' ');

  // Rows to draw: all of them, or those in view for a very long list.
  let first = 0;
  let last = rows.length;
  if (virtual) {
    // Never more than a screenful, even on the first draw before the list has its height.
    const h = Math.min(listRef.current?.clientHeight || 380, window.innerHeight);
    first = Math.max(0, Math.floor(scrollTop / rowH) - 6);
    last = Math.min(rows.length, Math.ceil((scrollTop + h) / rowH) + 6);
  }
  const drawRow = (r: Row, i: number) => {
    const rowStyle: CSSProperties | undefined = virtual ? { position: 'absolute', top: i * rowH, left: 0, right: 0, height: rowH } : undefined;
    if (r.kind === 'group')
      return (
        <div key={`g${i}`} className="ksel-group" role="presentation" data-row={i} style={rowStyle}>
          {tr(r.label, lang)}
        </div>
      );
    const isSel = r.o.value === value && !!selected;
    return (
      <div
        key={`o${i}:${r.o.value}`}
        id={`${listId}-${i}`}
        className="ksel-opt"
        role="option"
        aria-selected={isSel}
        aria-disabled={r.o.disabled || undefined}
        data-active={i === active || undefined}
        data-grouped={r.o.group ? true : undefined}
        data-row={i}
        style={rowStyle}
        title={virtual ? words(r.o) : undefined}
        onMouseMove={() => !r.o.disabled && i !== active && setActive(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(r.o)}
      >
        <span className="ksel-opt-text">
          <Marked text={words(r.o) || ' '} query={query} />
        </span>
        {isSel && (
          <svg className="ksel-tick" viewBox="0 0 256 256" aria-hidden="true">
            <path d="M232.49 80.49l-128 128a12 12 0 01-17 0l-56-56a12 12 0 1117-17L96 183 215.51 63.51a12 12 0 0117 17z" fill="currentColor" />
          </svg>
        )}
      </div>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={triggerCls}
        style={style}
        title={title ?? (current && current.label.length > 28 ? current.label : undefined)}
        disabled={disabled}
        autoFocus={props.autoFocus}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        aria-required={required || undefined}
        data-clearable={canClear || undefined}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKey}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
      >
        <span className="ksel-in">
          <span className="ksel-value">{shownLabel}</span>
          <span className="ksel-sizer" aria-hidden="true">
            {longest}
          </span>
        </span>
        {canClear && (
          <span className="ksel-clear" aria-hidden="true" title="Clear">
            <svg viewBox="0 0 256 256">
              <path d="M205.66 194.34a8 8 0 01-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 01-11.32-11.32L116.69 128 50.34 61.66a8 8 0 0111.32-11.32L128 116.69l66.34-66.35a8 8 0 0111.32 11.32L139.31 128z" fill="currentColor" />
            </svg>
          </span>
        )}
      </button>
      <select
        ref={nativeRef}
        className="ksel-native"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => emit(e.target.value, e.target)}
        onInvalid={() => triggerRef.current?.focus()}
      >
        {nativeChildren}
      </select>
      {open &&
        createPortal(
          <div className="ksel-layer" data-sheet={sheet || undefined}>
            {sheet && <div className="ksel-scrim" onClick={() => close(true)} />}
            <div
              ref={popRef}
              className="ksel-pop"
              style={pos}
              tabIndex={-1}
              role={sheet ? 'dialog' : undefined}
              aria-modal={sheet || undefined}
              aria-label={sheet ? heading || 'Choose' : undefined}
              onKeyDown={onPopKey}
            >
              {sheet && (
                <div className="ksel-sheet-head">
                  <strong>{heading || 'Choose'}</strong>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => close(true)}>
                    Close
                  </button>
                </div>
              )}
              {searchOn && (
                <div className="ksel-search">
                  <svg viewBox="0 0 256 256" aria-hidden="true">
                    <path d="M229.66 218.34l-50.07-50.06a88.11 88.11 0 10-11.31 11.31l50.06 50.07a8 8 0 0011.32-11.32zM40 112a72 72 0 1172 72 72.08 72.08 0 01-72-72z" fill="currentColor" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    aria-label="Search"
                    placeholder={tr('Type to search', lang)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    value={query}
                    onChange={(e) => {
                      const q = e.target.value;
                      setQuery(q);
                      const rs = buildRows(find(q));
                      setActive(rs.findIndex((r) => r.kind === 'option' && !r.o.disabled));
                      if (listRef.current) listRef.current.scrollTop = 0;
                      setScrollTop(0);
                    }}
                  />
                </div>
              )}
              <div
                ref={listRef}
                id={listId}
                className="ksel-list"
                role="listbox"
                tabIndex={searchOn ? undefined : -1}
                aria-label={heading || undefined}
                aria-activedescendant={!searchOn && active >= 0 ? `${listId}-${active}` : undefined}
                data-no-translate
                onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
              >
                {virtual ? (
                  <div style={{ position: 'relative', height: rows.length * rowH }}>{rows.slice(first, last).map((r, k) => drawRow(r, first + k))}</div>
                ) : (
                  rows.map(drawRow)
                )}
              </div>
              {!rows.length && (
                <p className="ksel-empty" role="status">
                  No match
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ---------- Public components ----------

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'placeholder'> &
  Omit<Shared, 'onBlur' | 'onFocus'> & {
    value?: string | number | readonly string[];
    onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
    children?: ReactNode;
  };

/**
 * Drop-in for <select>: same <option>/<optgroup> children, same `value`, and `onChange` receives an event whose target
 * is a real (hidden) <select> holding the new value, so `e.target.value` works unchanged.
 */
export function Select({ value, defaultValue, onChange, children, onBlur, onFocus, placeholder, searchable, clearable, ...rest }: SelectProps) {
  const options = useMemo(() => readOptions(children), [children]);
  const [own, setOwn] = useState(() => String(defaultValue ?? options[0]?.value ?? ''));
  const v = value === undefined || value === null ? own : String(value);
  const emit = useCallback(
    (next: string, native: HTMLSelectElement | null) => {
      if (value === undefined) setOwn(next);
      if (!onChange) return;
      const target = native ?? ({ value: next, name: rest.name ?? '', id: rest.id ?? '' } as unknown as HTMLSelectElement);
      let stopped = false;
      let prevented = false;
      const ev = {
        target,
        currentTarget: target,
        type: 'change',
        bubbles: true,
        cancelable: false,
        defaultPrevented: false,
        eventPhase: 2,
        isTrusted: false,
        timeStamp: Date.now(),
        nativeEvent: new Event('change'),
        preventDefault: () => void (prevented = true),
        isDefaultPrevented: () => prevented,
        stopPropagation: () => void (stopped = true),
        isPropagationStopped: () => stopped,
        persist: () => undefined,
      } as unknown as ChangeEvent<HTMLSelectElement>;
      onChange(ev);
    },
    [onChange, value, rest.name, rest.id],
  );
  return (
    <Combo
      {...pick(rest)}
      placeholder={placeholder}
      searchable={searchable}
      clearable={clearable}
      onBlur={onBlur ? () => onBlur({} as never) : undefined}
      onFocus={onFocus ? () => onFocus({} as never) : undefined}
      value={v}
      options={options}
      emit={emit}
      nativeChildren={children}
    />
  );
}

function pick(p: Record<string, unknown>): Shared {
  const keep = ['id', 'name', 'className', 'style', 'disabled', 'required', 'title', 'autoFocus', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid'];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (p[k] !== undefined) out[k] = p[k];
  return out as Shared;
}

/** The searchable pick-list with options as data. */
export function SearchSelect({ value, onChange, options, ...rest }: Shared & { value: string; onChange: (value: string) => void; options: SelectOption[] }) {
  const emit = useCallback((next: string) => onChange(next), [onChange]);
  const nativeChildren = useMemo(
    () =>
      options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      )),
    [options],
  );
  return <Combo {...rest} value={value} options={options} emit={emit} nativeChildren={nativeChildren} />;
}
