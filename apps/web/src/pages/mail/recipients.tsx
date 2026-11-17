/**
 * P111: who a new Teams conversation is for.
 *
 * Fitri (17 Nov 2026): "in teams, i create new conversation, but make it i can search for the
 * names that are existed or new email as well".
 *
 * One box: the people picked are chips, the cursor sits after them. Typing searches the office
 * members this person may see (the rule for giving a task: never wider; staff see only
 * themselves) with their company and department, and the people in their own Outlook
 * (/api/m365/people). Any full email address can be added as a new one. Arrows move, Enter
 * adds, Backspace in the empty box takes the last chip off, a comma or semicolon after an
 * address adds it, a pasted list adds every address in it, Escape clears what was typed. The
 * list sits in the page flow (not a floating layer), so it works inside dialogs and on a phone.
 */
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import { PersonAvatar } from "@/components/person-avatar";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { allEmails, m365Keys, searchPeople, type Invitee } from "@/lib/m365";
import { cn } from "@/lib/utils";

/** Every address in pasted or typed text ("Ali <ali@x.my>; siti@x.my"), lower case, once. */
export function addressesIn(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const a = part.replace(/^[<("']+|[>)"']+$/g, "").toLowerCase();
    if (a && allEmails([a]) && !out.includes(a)) out.push(a);
  }
  return out;
}

/** "Company · Department" for an office member, else where they were found. */
function placeOf(p: Invitee): string {
  return [p.company, p.department].filter(Boolean).join(" · ");
}

export function RecipientPicker({ value, onChange, label, hint, max = 20, autoFocus }: {
  value: Invitee[];
  onChange: (people: Invitee[]) => void;
  label: string;
  hint?: string;
  /** The most people it takes. */
  max?: number;
  autoFocus?: boolean;
}) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const h = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(h);
  }, [q]);
  const found = useQuery({
    queryKey: [...m365Keys.all, "people", term],
    queryFn: () => searchPeople(term),
    enabled: term.length >= 2 && !/[,;]/.test(term),
    retry: false,
    staleTime: 60_000,
  });
  const taken = useMemo(() => new Set(value.map((p) => p.email.toLowerCase())), [value]);
  const full = value.length >= max;
  const typed = q.trim().replace(/^<|>$/g, "").toLowerCase();
  const results = (found.data ?? []).filter((p) => !taken.has(p.email.toLowerCase())).slice(0, 8);
  // A full address nobody in the results has: offered as a new address, last.
  const typedNew = allEmails([typed]) && !taken.has(typed) && !results.some((p) => p.email.toLowerCase() === typed);
  const rows: Invitee[] = [...results, ...(typedNew ? [{ name: typed, email: typed, source: "new" }] : [])];
  const showList = !full && q.trim().length > 0 && (term.length >= 2 || typedNew);
  const at = Math.min(active, Math.max(rows.length - 1, 0));

  const add = (people: Invitee[]) => {
    const next = [...value];
    for (const p of people) {
      const e = p.email.toLowerCase();
      if (next.length >= max || next.some((x) => x.email.toLowerCase() === e)) continue;
      next.push({ ...p, email: e, name: p.name || e });
    }
    onChange(next);
    setQ("");
    setActive(0);
    input.current?.focus();
  };
  const remove = (email: string) => {
    onChange(value.filter((p) => p.email.toLowerCase() !== email.toLowerCase()));
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setActive((at + 1) % rows.length);
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setActive((at - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showList && rows[at]) add([rows[at]!]);
      else if (allEmails([typed])) add([{ name: typed, email: typed, source: "new" }]);
    } else if ((e.key === "," || e.key === ";") && allEmails([typed])) {
      e.preventDefault();
      add([{ name: typed, email: typed, source: "new" }]);
    } else if (e.key === "Backspace" && !q && value.length) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape" && q) {
      e.stopPropagation(); // clear the box, keep the dialog open
      setQ("");
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const list = addressesIn(e.clipboardData.getData("text"));
    if (list.length > 1 || (list.length === 1 && /[,;\s]/.test(e.clipboardData.getData("text").trim()))) {
      e.preventDefault();
      add(list.map((a) => ({ name: a, email: a, source: "new" })));
    }
  };

  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-q`} className="text-[13px] font-medium">{label}</label>
      <div onClick={() => input.current?.focus()}
        className="flex min-h-11 w-full min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-sm border border-border bg-surface p-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
        {value.length ? (
          <ul className="contents" aria-label={t("People picked")}>
            {value.map((p) => (
              <li key={p.email} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pr-0.5 pl-1 text-[13px]">
                <PersonAvatar name={p.name || p.email} id={p.email} size="xs" />
                <span className="min-w-0 truncate" title={p.email}>{p.name || p.email}</span>
                {p.name && p.name !== p.email ? <span className="hidden min-w-0 truncate text-[12px] text-muted sm:inline">{p.email}</span> : null}
                <button type="button" onClick={(e) => { e.stopPropagation(); remove(p.email); }} aria-label={t("Remove {name}", { name: p.name || p.email })}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none pointer-coarse:size-9">
                  <XIcon size={12} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input ref={input} id={`${id}-q`} value={q} autoFocus={autoFocus} autoComplete="off" spellCheck={false} inputMode="email"
          disabled={full} maxLength={160}
          onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown} onPaste={onPaste}
          placeholder={full ? t("That is the most for one chat.") : value.length ? t("Add another") : t("Type a name or an email")}
          role="combobox" aria-expanded={showList} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={showList && rows.length ? `${id}-o${at}` : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="h-8 min-w-[10rem] flex-1 bg-transparent px-1.5 text-[16px] text-fg outline-none placeholder:text-muted sm:text-[13.5px]" />
      </div>
      {hint ? <p id={`${id}-hint`} className="text-[12px] text-muted">{hint}</p> : null}
      {showList ? (
        <ul id={`${id}-list`} role="listbox" aria-label={t("People found")}
          className="grid max-h-72 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-[var(--shadow-soft)]">
          {rows.map((p, i) => {
            const fresh = p.source === "new";
            const place = placeOf(p);
            return (
              <li key={`${p.email}-${fresh ? "new" : "found"}`} id={`${id}-o${i}`} role="option" aria-selected={i === at}>
                <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => add([p])} onMouseEnter={() => setActive(i)}
                  className={cn("flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[13.5px]", i === at && "bg-surface-2")}>
                  {fresh ? (
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><PlusIcon size={14} weight="bold" /></span>
                  ) : <PersonAvatar name={p.name || p.email} id={p.email} size="sm" />}
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{fresh ? t("Add {email}", { email: p.email }) : p.name || p.email}</span>
                    <span className="truncate text-[12px] text-muted">{fresh ? t("A new address, not in your office or Outlook") : p.email}</span>
                    {!fresh && place ? <span className="truncate text-[12px] text-muted">{place}</span> : null}
                  </span>
                  {fresh ? null : (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                      {p.source === "office" ? t("Office") : p.source === "teams" ? "Teams" : "Outlook"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {!rows.length ? (
            <li className="px-3 py-2.5 text-[13px] text-muted" role="presentation">
              {found.isLoading || term !== q.trim() ? t("Searching…")
                : found.error ? <span role="alert" className="text-danger">{errorMessage(found.error)}</span>
                : t("No one found. Type their full email.")}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
