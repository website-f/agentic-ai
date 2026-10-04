/** Simple CSS device frames for the presentation: a laptop and a phone around captured shots.
 * The bezel colours are fixed on purpose: they are the hardware, not the theme. */
import { BookBookmarkIcon, ImageIcon } from "@phosphor-icons/react";

import type { GuideManifest } from "@/guide/manifest";
import { PAGE_ICONS } from "@/guide/rich";
import { pageById } from "@/guide/targets";
import { shotOf, videoOf } from "@/guide/data";
import { cn } from "@/lib/utils";

function Missing({ shotKey, phone }: { shotKey: string; phone?: boolean }) {
  const page = pageById(shotKey.split(":")[0] ?? "");
  const IconCmp = page ? (PAGE_ICONS[page.id] ?? BookBookmarkIcon) : ImageIcon;
  return (
    <div className="grid size-full place-items-center bg-[radial-gradient(ellipse_at_top,var(--accent-soft),var(--surface-2)_75%)] text-center">
      <div className={cn("grid justify-items-center", phone ? "gap-[0.4em] px-[0.6em]" : "gap-[0.5em]")}>
        <IconCmp weight="duotone" className="size-[2.2em] text-accent" />
        <span className="text-[0.85em] font-medium text-fg">{page?.title ?? "Screenshot"}</span>
      </div>
    </div>
  );
}

function Screen({
  manifest,
  shotKey,
  device,
  video,
  eager,
}: {
  manifest: GuideManifest | null;
  shotKey?: string;
  device: "desktop" | "mobile";
  video?: string;
  eager?: boolean;
}) {
  const v = video ? videoOf(manifest, video) : undefined;
  if (v && v.device === device) {
    return (
      <video
        key={v.src}
        autoPlay
        muted
        loop
        playsInline
        poster={v.poster}
        width={v.w}
        height={v.h}
        className="size-full object-cover object-top"
      >
        <source src={v.src} type="video/mp4" />
      </video>
    );
  }
  const shot = shotKey ? shotOf(manifest, shotKey, device) : undefined;
  if (!shot) return shotKey ? <Missing shotKey={shotKey} phone={device === "mobile"} /> : <Missing shotKey="" />;
  return (
    <img
      src={shot.src}
      width={shot.w}
      height={shot.h}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className="size-full object-cover object-top"
    />
  );
}

export function Laptop({
  manifest,
  shotKey,
  video,
  className,
  eager,
}: {
  manifest: GuideManifest | null;
  shotKey?: string;
  /** Plays the recorded flow inside the screen (only when it is a desktop recording). */
  video?: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <div className={cn("relative w-full", className)}>
      <div className="rounded-t-[1.1em] bg-[#1a201d] p-[1.4%] pb-[2.2%] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.55)] ring-1 ring-black/40">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[0.3em] bg-surface-2">
          <Screen manifest={manifest} shotKey={shotKey} device="desktop" video={video} eager={eager} />
        </div>
      </div>
      <div className="relative -mx-[6%] h-[0.9em] rounded-b-[0.9em] bg-[linear-gradient(#cfd6d2,#8f9893)] shadow-[0_18px_30px_-16px_rgb(0_0_0/0.5)]">
        <div className="absolute top-0 left-1/2 h-[0.35em] w-[16%] -translate-x-1/2 rounded-b-[0.4em] bg-[#7d8681]" />
      </div>
    </div>
  );
}

export function Phone({
  manifest,
  shotKey,
  video,
  className,
  eager,
}: {
  manifest: GuideManifest | null;
  shotKey?: string;
  video?: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[2.4em] bg-[#0f1412] p-[0.42em] shadow-[0_30px_60px_-24px_rgb(0_0_0/0.6)] ring-1 ring-white/10",
        className,
      )}
    >
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[2em] bg-surface-2">
        <Screen manifest={manifest} shotKey={shotKey} device="mobile" video={video} eager={eager} />
        <div className="absolute top-[1.4%] left-1/2 h-[3.2%] w-[30%] -translate-x-1/2 rounded-full bg-[#0f1412]" />
      </div>
    </div>
  );
}
