/** A captured screenshot with numbered hotspots over the controls the guide explains.
 * Boxes come from the manifest in fractions of the image, so they are placed by percentage
 * and stay right at any size. Only targets the doc mentions get a box (`numbers`). */
import {
  DesktopIcon,
  DeviceMobileIcon,
  ImageIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Dialog } from "radix-ui";
import { useState, type CSSProperties } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import type { Device } from "./data";
import type { GuideBox, GuideShot } from "./manifest";
import type { GuideTarget } from "./targets";

interface HotspotProps {
  numbers: Map<string, number>;
  active: string | null;
  onActive: (id: string | null) => void;
}

function Hotspots({ shot, numbers, active, onActive, interactive = true }: HotspotProps & { shot: GuideShot; interactive?: boolean }) {
  const boxes = shot.boxes.filter((b) => numbers.has(b.id));
  return (
    <>
      {boxes.map((b) => (
        <Hotspot key={b.id} box={b} n={numbers.get(b.id)!} active={active} onActive={onActive} interactive={interactive} />
      ))}
    </>
  );
}

function Hotspot({ box, n, active, onActive, interactive }: { box: GuideBox; n: number; active: string | null; onActive: (id: string | null) => void; interactive: boolean }) {
  const t = useT();
  const on = active === box.id;
  const dim = active !== null && !on;
  // Badges sit just outside the box's top-left corner, or inside it when the box touches the edge.
  const edge = box.x < 0.025 || box.y < 0.03;
  const style: CSSProperties = {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  };
  return (
    <button
      type="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={t("Marker {n}", { n })}
      onMouseEnter={interactive ? () => onActive(box.id) : undefined}
      onMouseLeave={interactive ? () => onActive(null) : undefined}
      onFocus={interactive ? () => onActive(box.id) : undefined}
      onBlur={interactive ? () => onActive(null) : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (interactive) onActive(on ? null : box.id);
      }}
      className={cn(
        // The ::before widens the tap area around thin boxes without changing the outline.
        "absolute rounded-[6px] transition-[box-shadow,background-color,opacity] duration-200 focus-visible:outline-none before:absolute before:-inset-3 before:content-['']",
        on
          ? "z-10 bg-accent/12 shadow-[0_0_0_2px_var(--accent),0_0_0_6px_color-mix(in_oklab,var(--accent)_25%,transparent)]"
          : "bg-accent/[0.04] shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--accent)_75%,transparent)]",
        dim && "opacity-35",
        !interactive && "pointer-events-none",
      )}
      style={style}
    >
      <span
        aria-hidden
        className={cn(
          "absolute grid size-6 place-items-center rounded-full text-[12px] font-semibold tabular shadow-[var(--shadow-soft)] ring-2 ring-surface transition-transform duration-200",
          edge ? "top-1 left-1" : "-top-3 -left-3",
          on ? "scale-110 bg-accent text-accent-fg" : "bg-accent text-accent-fg",
        )}
      >
        {n}
      </span>
    </button>
  );
}

/** What shows when a page or state was not captured (yet): the numbered list still works. */
export function ShotPlaceholder({
  device,
  title,
  targets,
  numbers,
  active,
  onActive,
  className,
}: HotspotProps & { device: Device; title: string; targets: GuideTarget[]; className?: string }) {
  const tr = useT();
  const shown = targets.filter((t) => numbers.has(t.id));
  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-[var(--radius-md)] border border-dashed border-border bg-surface-2/50 p-6 text-center",
        device === "mobile" ? "mx-auto min-h-72 w-full max-w-[300px] sm:aspect-[9/16]" : "min-h-60 w-full sm:aspect-[16/10]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)]"
      />
      <div className="relative grid justify-items-center gap-2">
        <span className="grid size-11 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent">
          {device === "mobile" ? <DeviceMobileIcon size={22} weight="duotone" /> : <DesktopIcon size={22} weight="duotone" />}
        </span>
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="max-w-xs text-[12.5px] text-muted">{tr("The screenshot for this view has not been captured yet. The numbered controls are listed below.")}</p>
        {shown.length ? (
          <ul className="mt-1 flex flex-wrap justify-center gap-1.5">
            {shown.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseEnter={() => onActive(t.id)}
                  onMouseLeave={() => onActive(null)}
                  onClick={() => onActive(active === t.id ? null : t.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] pointer-coarse:min-h-9 pointer-coarse:px-3",
                    active === t.id ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface",
                  )}
                >
                  <span className="grid size-4.5 place-items-center rounded-full bg-accent text-[10.5px] font-semibold text-accent-fg">{numbers.get(t.id)}</span>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const ZOOMS = [1, 1.5, 2, 3] as const;

/** Full-screen view for phones and small screens: zoom buttons plus native pinch-zoom. */
function Lightbox({
  shot,
  alt,
  open,
  onOpenChange,
  ...hot
}: HotspotProps & { shot: GuideShot; alt: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [zoom, setZoom] = useState<number>(1);
  const idx = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  const fitW = shot.w >= shot.h; // landscape shots fill the width; tall ones fill the height
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/88 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col outline-none"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-white">
            <Dialog.Title className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{alt}</Dialog.Title>
            <button
              type="button"
              aria-label={t("Zoom out")}
              disabled={idx <= 0}
              onClick={() => setZoom(ZOOMS[Math.max(0, idx - 1)]!)}
              className="grid size-10 place-items-center rounded-full bg-white/10 disabled:opacity-40"
            >
              <MagnifyingGlassMinusIcon size={18} />
            </button>
            <span className="w-10 text-center text-[12.5px] tabular">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label={t("Zoom in")}
              disabled={idx >= ZOOMS.length - 1}
              onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, idx + 1)]!)}
              className="grid size-10 place-items-center rounded-full bg-white/10 disabled:opacity-40"
            >
              <MagnifyingGlassPlusIcon size={18} />
            </button>
            <Dialog.Close className="grid size-10 place-items-center rounded-full bg-white/10" aria-label={t("Close")}>
              <XIcon size={18} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 touch-pan-x touch-pan-y touch-pinch-zoom overflow-auto overscroll-contain">
            <div
              className="relative mx-auto my-auto"
              style={
                fitW
                  ? { width: `${zoom * 100}%`, maxWidth: zoom === 1 ? shot.w : undefined }
                  : { width: `min(${zoom * 100}%, calc((100dvh - 4.5rem) * ${(shot.w / shot.h) * zoom}))` }
              }
            >
              <img src={shot.src} width={shot.w} height={shot.h} alt={alt} className="block h-auto w-full select-none" draggable={false} />
              <Hotspots shot={shot} {...hot} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The screenshot with its hotspots; tap (phones) or the enlarge button opens the lightbox. */
export function AnnotatedShot({
  shot,
  alt,
  device,
  maxHeight,
  className,
  ...hot
}: HotspotProps & { shot: GuideShot; alt: string; device: Device; maxHeight?: string; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ratio = shot.w / shot.h;
  // Tall (phone) shots are capped by height so the whole screen fits beside the text.
  const style: CSSProperties | undefined = maxHeight ? { maxWidth: `min(100%, calc(${maxHeight} * ${ratio}))` } : undefined;
  return (
    <figure className={cn("relative mx-auto w-full", device === "mobile" && "max-w-[380px]", className)} style={style}>
      <div
        className={cn(
          "group relative overflow-visible",
          device === "mobile" ? "rounded-[28px] border-[6px] border-[#0f1412] shadow-[var(--shadow-pop)] dark:border-[#2a3430]" : "rounded-[var(--radius-md)] border border-border shadow-[var(--shadow-soft)]",
        )}
      >
        <img
          src={shot.src}
          width={shot.w}
          height={shot.h}
          alt={alt}
          loading="lazy"
          decoding="async"
          onClick={() => setOpen(true)}
          className={cn(
            "block h-auto w-full cursor-zoom-in bg-surface-2",
            device === "mobile" ? "rounded-[22px]" : "rounded-[calc(var(--radius-md)-1px)]",
          )}
        />
        <Hotspots shot={shot} {...hot} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute right-2 bottom-2 z-20 inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 text-[12.5px] font-medium text-fg shadow-[var(--shadow-soft)] backdrop-blur transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <MagnifyingGlassPlusIcon size={15} /> {t("Enlarge")}
        </button>
      </div>
      <Lightbox shot={shot} alt={alt} open={open} onOpenChange={setOpen} {...hot} />
    </figure>
  );
}

/** A small, non-interactive picture of a shot (index cards, slide thumbnails). */
export function ShotThumb({ shot, alt, className }: { shot?: GuideShot; alt: string; className?: string }) {
  if (!shot) {
    return (
      <div className={cn("grid aspect-[16/10] w-full place-items-center bg-surface-2/70 text-muted", className)}>
        <ImageIcon size={22} weight="duotone" />
      </div>
    );
  }
  return (
    <img
      src={shot.src}
      width={shot.w}
      height={shot.h}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("block aspect-[16/10] w-full object-cover object-top", className)}
    />
  );
}
