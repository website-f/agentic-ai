import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  CaretRightIcon, EnvelopeSimpleIcon, FileCsvIcon, FileDocIcon, FileIcon, FilePdfIcon, FileTextIcon, FileXlsIcon, IdentificationBadgeIcon,
  ImageIcon, InvoiceIcon, NotebookIcon, PresentationChartIcon, ReceiptIcon, TruckIcon, type Icon,
} from "@phosphor-icons/react";

import { IconTile, type Tone } from "@/components/page";
import { msg, useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** One look per document kind, shared by lists, cards and pickers. */
const KIND: Record<string, { icon: Icon; tone: Tone }> = {
  quotation: { icon: ReceiptIcon, tone: "accent" },
  invoice: { icon: InvoiceIcon, tone: "info" },
  letter: { icon: EnvelopeSimpleIcon, tone: "violet" },
  proposal: { icon: PresentationChartIcon, tone: "orange" },
  minutes: { icon: NotebookIcon, tone: "pink" },
  profile: { icon: IdentificationBadgeIcon, tone: "ok" },
  delivery: { icon: TruckIcon, tone: "warn" },
};

export function kindVisual(kind: string | null | undefined): { icon: Icon; tone: Tone } {
  return KIND[(kind ?? "").toLowerCase()] ?? { icon: FileTextIcon, tone: "neutral" };
}

export function KindTile({ kind, size = "md" }: { kind: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const v = kindVisual(kind);
  return <IconTile icon={v.icon} tone={v.tone} size={size} />;
}

export function fileVisual(mime: string, name = ""): { icon: Icon; tone: Tone } {
  if (mime === "application/pdf") return { icon: FilePdfIcon, tone: "danger" };
  if (mime.includes("wordprocessingml")) return { icon: FileDocIcon, tone: "info" };
  if (mime === "text/csv" || name.toLowerCase().endsWith(".csv")) return { icon: FileCsvIcon, tone: "ok" };
  if (mime.includes("spreadsheetml")) return { icon: FileXlsIcon, tone: "ok" };
  if (mime.startsWith("image/")) return { icon: ImageIcon, tone: "warn" };
  return { icon: FileIcon, tone: "neutral" };
}

export function FileTile({ mime, name, size = "md" }: { mime: string; name?: string; size?: "sm" | "md" | "lg" }) {
  const v = fileVisual(mime, name);
  return <IconTile icon={v.icon} tone={v.tone} size={size} />;
}

const STEPS = [
  { to: "/company-kit", label: msg("Company kit") },
  { to: "/files", label: msg("Files") },
  { to: "/templates", label: msg("Templates") },
  { to: "/documents", label: msg("Documents") },
  { to: "/packs", label: msg("Packs") },
] as const;

/** The Documents section is one flow; this strip shows where you are and links each step. */
export function DocSteps({ current }: { current: (typeof STEPS)[number]["to"] }) {
  const t = useT();
  const at = STEPS.findIndex((s) => s.to === current);
  const active = useRef<HTMLAnchorElement>(null);
  // On phones the strip scrolls: bring the current step into view.
  useEffect(() => {
    active.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <nav aria-label={t("Document steps")} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <ol className="flex w-max min-w-full items-center gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
        {STEPS.map((s, i) => {
          const on = i === at;
          return (
            <li key={s.to} className="flex flex-1 items-center gap-1">
              <Link
                to={s.to}
                ref={on ? active : undefined}
                aria-current={on ? "step" : undefined}
                className={cn(
                  "flex h-9 flex-1 items-center justify-center gap-2 rounded-sm px-3 text-[13px] whitespace-nowrap transition-colors",
                  on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] font-semibold tabular",
                    on ? "bg-accent text-accent-fg" : i < at ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted",
                  )}
                >
                  {i + 1}
                </span>
                {t(s.label)}
              </Link>
              {i < STEPS.length - 1 ? <CaretRightIcon size={12} className="shrink-0 text-border" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
