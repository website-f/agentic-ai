/** P109 Teams-style messages: bubbles (yours on the right in Teams purple, others on the left
 * with their initials), names and times once per run, day dividers, system lines, mentions,
 * reactions, files, quoted replies, "Edited", "Important!", deleted messages, and the
 * composer (Enter sends, Shift+Enter is a new line). The message HTML comes from the server
 * already reduced to an allow-list of tags (microsoft/hub.safe_html). */
import { ArrowBendUpLeftIcon, FileIcon, PaperPlaneRightIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { locale, useT } from "@/i18n";
import { byDay, type TeamsMsg } from "@/lib/m365";
import { cn } from "@/lib/utils";

/** Inner HTML of a message, styled like Teams (mentions purple, links underlined, lists...). */
export const RICH =
  "min-w-0 text-[14px] leading-[1.45] break-words [overflow-wrap:anywhere] [&_p]:my-0 [&_p+p]:mt-1.5 [&_a]:text-[#4f52b2] [&_a]:underline dark:[&_a]:text-[#a6a8f0] " +
  "[&_[data-mention]]:font-semibold [&_[data-mention]]:text-[#4f52b2] dark:[&_[data-mention]]:text-[#a6a8f0] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:text-[13px] dark:[&_code]:bg-white/10 " +
  "[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/5 [&_pre]:p-2 dark:[&_pre]:bg-white/10 [&_img]:my-1 [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-md " +
  "[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold";

export function clock(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "";
}

export function dayLabel(day: string, t: (s: string) => string): string {
  if (!day) return "";
  const d = new Date(day);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("Today");
  if (d.toDateString() === y.toDateString()) return t("Yesterday");
  return d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function DayDivider({ label }: { label: string }) {
  return (
    <li role="separator" className="my-2 flex items-center gap-3 text-[12px] text-muted">
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

export function Extras({ m }: { m: TeamsMsg }) {
  const t = useT();
  return (
    <>
      {m.quotes.map((q) => (
        <blockquote key={q.id} className="mb-1 rounded-md border-l-[3px] border-[#7f85f5] bg-black/[0.03] px-2 py-1 text-[12.5px] dark:bg-white/5">
          <b className="block text-[12px]">{q.from}</b>
          <span className="line-clamp-2 text-muted">{q.text}</span>
        </blockquote>
      ))}
      {m.files.length ? (
        <ul className="mt-1.5 grid gap-1" aria-label={t("Files")}>
          {m.files.map((f) => (
            <li key={f.id}>
              {f.url ? (
                <a href={f.url} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] hover:border-[#7f85f5]">
                  <FileIcon size={16} className="shrink-0 text-[#5b5fc7]" /><span className="min-w-0 truncate">{f.name}</span>
                </a>
              ) : (
                <span className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-muted">
                  <FileIcon size={16} className="shrink-0" /><span className="min-w-0 truncate">{f.name}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function Reactions({ m, className }: { m: TeamsMsg; className?: string }) {
  const t = useT();
  if (!m.reactions.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label={t("Reactions")}>
      {m.reactions.map((r) => (
        <li key={r.emoji} className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[12px] tabular",
          r.mine ? "border-[#7f85f5] bg-[#e8ebfa] dark:bg-[#2f2f4a]" : "border-border bg-surface")}>
          <span aria-hidden>{r.emoji}</span>{r.count}
        </li>
      ))}
    </ul>
  );
}

/** The body of one message (deleted, or its HTML / text), with its quotes and files. */
export function Body({ m }: { m: TeamsMsg }) {
  const t = useT();
  if (m.deleted) return <p className="text-[13px] text-muted italic">{t("This message was deleted.")}</p>;
  return (
    <>
      <Extras m={{ ...m, files: [] }} />
      {m.subject ? <p className="mb-0.5 text-[14.5px] font-semibold break-words">{m.subject}</p> : null}
      {m.html ? <div className={RICH} dangerouslySetInnerHTML={{ __html: m.html }} /> : <p className={cn(RICH, "whitespace-pre-wrap")}>{m.text}</p>}
      <Extras m={{ ...m, quotes: [] }} />
    </>
  );
}

function Bubble({ m, first }: { m: TeamsMsg; first: boolean }) {
  const t = useT();
  if (m.kind === "system") {
    return <li className="my-1 text-center text-[12px] text-muted">{m.text}{m.at ? <span className="ml-1.5 tabular">{clock(m.at)}</span> : null}</li>;
  }
  const meta = (
    <span className={cn("flex items-baseline gap-2 text-[11.5px] text-muted", m.mine && "justify-end")}>
      {!m.mine ? <b className="text-[12.5px] font-semibold text-fg">{m.from || t("Unknown")}</b> : null}
      <time dateTime={m.at ?? undefined} className="tabular">{clock(m.at)}</time>
      {m.edited ? <span>{t("Edited")}</span> : null}
    </span>
  );
  return (
    <li className={cn("flex items-end gap-2", m.mine ? "justify-end pl-10 sm:pl-16" : "pr-10 sm:pr-16", first ? "mt-2.5" : "mt-0.5")}>
      {!m.mine ? (first ? <PersonAvatar name={m.from || "?"} id={m.from_id} size="sm" className="self-start" /> : <span className="w-8 shrink-0" aria-hidden />) : null}
      <div className={cn("grid min-w-0 gap-0.5", m.mine && "justify-items-end")}>
        {first ? meta : null}
        <div className={cn("min-w-0 max-w-full rounded-[10px] px-3 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
          m.mine ? "bg-[#e8ebfa] dark:bg-[#2f2f4a]" : "bg-surface border border-border",
          m.mentions_me && !m.mine && "border-l-[3px] border-l-[#5b5fc7]",
          m.importance && "border-t-[3px] border-t-danger")}>
          {m.importance ? <p className="mb-0.5 flex items-center gap-1 text-[11.5px] font-semibold text-danger"><WarningIcon size={12} weight="fill" /> {m.importance === "urgent" ? t("URGENT!") : t("IMPORTANT!")}</p> : null}
          <Body m={m} />
        </div>
        <Reactions m={m} className={cn("-mt-1", m.mine ? "mr-2" : "ml-2")} />
        {!first ? <span className="sr-only">{m.from} {clock(m.at)}</span> : null}
      </div>
    </li>
  );
}

/** A whole conversation, grouped by day, oldest first. */
export function Conversation({ messages, top }: { messages: TeamsMsg[]; top?: ReactNode }) {
  const t = useT();
  return (
    <ol className="grid content-start px-1 pb-2" aria-label={t("Messages")}>
      {top ? <li className="mb-2 flex justify-center">{top}</li> : null}
      {byDay(messages).map((g) => (
        <li key={g.day} className="contents">
          <ol className="contents">
            <DayDivider label={dayLabel(g.day, t)} />
            {g.items.map(({ msg: m, first }) => <Bubble key={m.id} m={m} first={first} />)}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/** Keeps a scrolling box at the bottom when new messages arrive (unless the person scrolled up). */
export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  return { ref, onScroll };
}

/** The message box under a chat or a thread. */
export function MessageComposer({ value, onChange, onSend, sending, placeholder, onAi, aiBusy, disabled, hint }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
  onAi?: () => void;
  aiBusy?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const t = useT();
  const box = useRef<HTMLTextAreaElement>(null);
  const [focus, setFocus] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !sending && !disabled) onSend();
    }
  };
  return (
    <div className={cn("grid gap-1.5 rounded-[var(--radius-md)] border bg-surface p-2 transition-colors", focus ? "border-[#7f85f5] ring-3 ring-[#7f85f5]/15" : "border-border")}>
      <label className="min-w-0">
        <span className="sr-only">{placeholder}</span>
        <textarea ref={box} rows={1} value={value} disabled={disabled} maxLength={20_000} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} onKeyDown={key} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          className="block max-h-44 min-h-10 w-full resize-none bg-transparent px-1.5 py-2 text-[14px] text-fg outline-none placeholder:text-muted/80 disabled:opacity-60" />
      </label>
      <div className="flex items-center gap-2">
        {onAi ? (
          <Button type="button" size="sm" variant="ghost" loading={aiBusy} onClick={onAi} disabled={disabled}>
            <SparkleIcon size={15} /> {t("Draft with AI")}
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{hint ?? t("Enter to send, Shift+Enter for a new line")}</span>
        <Button type="button" size="icon" aria-label={t("Send")} disabled={!value.trim() || disabled} loading={sending} onClick={onSend}
          className="bg-[#5b5fc7] text-white hover:brightness-110">
          <PaperPlaneRightIcon size={17} weight="fill" />
        </Button>
      </div>
    </div>
  );
}

export function ReplyLink({ count, onClick }: { count: number; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="hit inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#4f52b2] hover:underline dark:text-[#a6a8f0]">
      <ArrowBendUpLeftIcon size={14} /> {count ? t("{n} replies", { n: count }) : t("Reply")}
    </button>
  );
}
