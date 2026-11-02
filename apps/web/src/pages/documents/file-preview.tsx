/** Previews built from GET /api/files/{id}/view, inside the file panel's preview area (its
 * parent is `relative` and sized): a spreadsheet grid for Excel and CSV, a readable page for
 * Word, plain text, and players for audio and video. PDFs and images keep the panel's own
 * viewers (files-viewer.tsx). */
import { FileAudioIcon, InfoIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { locale, useT } from "@/i18n";
import { columnName, sanitizeHtml, type SheetData } from "@/lib/explorer";
import { cn } from "@/lib/utils";

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const isNumber = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^-?[\d,]+(\.\d+)?%?$/.test(v.trim()) && v.trim() !== "");

/** A spreadsheet: column letters and row numbers that stay put while the cells scroll both
 * ways, one tab per sheet, and a note when only the first rows came. */
export function SheetGrid({ sheets }: { sheets: SheetData[] }) {
  const t = useT();
  const [at, setAt] = useState(0);
  const sheet = sheets[Math.min(at, sheets.length - 1)];
  if (!sheet) return <p className="grid h-full place-items-center p-6 text-center text-[13px] text-muted">{t("This spreadsheet is empty.")}</p>;
  const names = Array.isArray(sheet.columns) ? sheet.columns : null;
  const width = Math.max(names?.length ?? 0, typeof sheet.columns === "number" ? sheet.columns : 0, ...sheet.rows.map((r) => r.length), 1);
  const cols = Array.from({ length: width }, (_, i) => i);
  const head = "border-r border-b border-border bg-surface-2 px-2 font-medium text-muted";
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" tabIndex={0} aria-label={t("Sheet {name}", { name: sheet.name })}>
        <table className="border-separate border-spacing-0 text-[12.5px] tabular-nums">
          <thead>
            <tr>
              <th className={cn(head, "sticky top-0 left-0 z-30 h-7 min-w-10")} aria-hidden />
              {cols.map((c) => <th key={c} scope="col" className={cn(head, "sticky top-0 z-20 h-7 min-w-20 text-center")}>{columnName(c)}</th>)}
            </tr>
            {names ? (
              <tr>
                <th className={cn(head, "sticky top-7 left-0 z-30 h-8")} aria-hidden />
                {cols.map((c) => (
                  <th key={c} scope="col" className="sticky top-7 z-20 h-8 max-w-[22rem] truncate border-r border-b border-border bg-surface px-2 text-left font-semibold text-fg">
                    {names[c] ?? ""}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className="hover:[&>td]:bg-accent-soft/40">
                <th scope="row" className={cn(head, "sticky left-0 z-10 h-7 text-right font-normal")}>{r + 1}</th>
                {cols.map((c) => {
                  const v = row[c];
                  const text = cellText(v);
                  return (
                    <td key={c} title={text.length > 30 ? text : undefined}
                      className={cn("h-7 max-w-[22rem] truncate border-r border-b border-border/70 bg-surface px-2 whitespace-nowrap", isNumber(v) && "text-right")}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-t border-border bg-surface-2/60 px-1.5">
        <div role="tablist" aria-label={t("Sheets")} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sheets.map((s, i) => (
            <button key={`${i}:${s.name}`} type="button" role="tab" aria-selected={i === at} onClick={() => setAt(i)}
              className={cn("h-7 shrink-0 rounded-sm px-3 text-[12.5px] whitespace-nowrap transition-colors pointer-coarse:h-10",
                i === at ? "bg-surface font-semibold text-accent shadow-[var(--shadow-soft)]" : "text-muted hover:bg-surface hover:text-fg")}>
              {s.name || t("Sheet {n}", { n: i + 1 })}
            </button>
          ))}
        </div>
        {sheet.truncated ? (
          <span className="flex shrink-0 items-center gap-1 pr-1.5 text-[12px] text-muted">
            <InfoIcon size={13} /> {t("Showing the first {n} rows", { n: sheet.rows.length.toLocaleString(locale()) })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A Word document (or any page the server built as HTML), as a readable page. The server
 * sends escaped text in a few plain tags; this still keeps only those tags and no attributes. */
export function HtmlPage({ html }: { html: string }) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain bg-surface">
      <article
        className={cn(
          "mx-auto max-w-[72ch] px-5 py-6 text-[14px] leading-relaxed text-pretty break-words sm:px-8 sm:py-8",
          "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-[22px] [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-[-0.01em] [&_h1:first-child]:mt-0",
          "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-[15.5px] [&_h3]:font-semibold",
          "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-[14px] [&_h4]:font-semibold [&_p]:my-2.5 [&_strong]:font-semibold",
          "[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
          "[&_hr]:my-6 [&_hr]:border-border [&_section]:my-4",
          "[&_table]:my-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[13px]",
          "[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
        )}
        // Safe: sanitizeHtml keeps only a short allow-list of plain tags, with no attributes.
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </div>
  );
}

export function TextPage({ text }: { text: string }) {
  const t = useT();
  return (
    <pre className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
      {text.trim() || t("No text could be read.")}
    </pre>
  );
}

/** Audio or video, played from the file itself. */
export function MediaPlayer({ src, mime, name }: { src: string; mime: string; name: string }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="grid h-full place-items-center p-6 text-center text-[13px] text-muted">{t("This file cannot play here. Download it to open it.")}</p>;
  if (mime.startsWith("video/")) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-black/90 p-2">
        <video src={src} controls preload="metadata" onError={() => setFailed(true)} className="max-h-full max-w-full" aria-label={name} />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="grid w-full max-w-md justify-items-center gap-4 text-center">
        <FileAudioIcon size={40} weight="duotone" className="text-accent" />
        <p className="max-w-full truncate text-[14px] font-medium">{name}</p>
        <audio src={src} controls preload="metadata" onError={() => setFailed(true)} className="w-full" aria-label={name} />
      </div>
    </div>
  );
}
