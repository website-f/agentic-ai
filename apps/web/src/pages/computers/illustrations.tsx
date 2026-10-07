/** Little drawings (HTML + CSS, no images) of the one-time warnings an unsigned app meets,
 * with the button to press ringed, so a person knows what to click before they see it. The
 * system's own words stay as the system shows them (English): only the captions translate. */
import { CaretRightIcon, LockSimpleIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** The button or link the person must press: ringed and pulsing gently. */
function Press({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <span aria-hidden className="absolute -inset-1.5 rounded-[6px] ring-2 ring-warn motion-safe:animate-pulse" />
      {children}
    </span>
  );
}

function Frame({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("grid min-w-0 gap-1.5", className)}>
      <div aria-hidden className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border shadow-[var(--shadow-soft)]">{children}</div>
      <figcaption className="text-[12px] text-muted">{label}</figcaption>
    </figure>
  );
}

/** Windows: SmartScreen's blue box, first "More info", then "Run anyway". */
export function WindowsSmartScreen({ step }: { step: 1 | 2 }) {
  const t = useT();
  return (
    <Frame label={step === 1 ? t("1. Click More info") : t("2. Click Run anyway")}>
      <div className="grid min-h-40 content-between gap-3 bg-[#0b5cad] p-3.5 text-white">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
            <ShieldWarningIcon size={16} weight="fill" /> Windows protected your PC
          </div>
          <p className="text-[10.5px] leading-snug text-white/85">
            Microsoft Defender SmartScreen prevented an unrecognised app from starting.
          </p>
          {step === 1 ? (
            <Press className="justify-self-start"><span className="text-[11px] underline">More info</span></Press>
          ) : (
            <div className="grid gap-0.5 text-[10.5px] text-white/85">
              <span>App: AgenticOffice-Setup.exe</span>
              <span>Publisher: Unknown publisher</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {step === 2 ? (
            <Press><span className="rounded-[3px] border border-white/70 px-2.5 py-1 text-[11px]">Run anyway</span></Press>
          ) : null}
          <span className="rounded-[3px] border border-white/40 bg-white/10 px-2.5 py-1 text-[11px]">{"Don't run"}</span>
        </div>
      </div>
    </Frame>
  );
}

/** macOS: the "Not Opened" alert, then System Settings → Privacy & Security → Open Anyway. */
export function MacGatekeeper({ step }: { step: 1 | 2 }) {
  const t = useT();
  if (step === 1) {
    return (
      <Frame label={t("1. Click Done (not Move to Bin)")}>
        <div className="grid min-h-40 place-items-center bg-[linear-gradient(135deg,#c9d6e8,#e8d9e6)] p-3.5">
          <div className="grid w-full max-w-[15rem] justify-items-center gap-1.5 rounded-[10px] bg-white/95 p-3 text-center text-[#1d1d1f] shadow-lg">
            <span className="grid size-8 place-items-center rounded-[8px] bg-[#2a78d6] text-[11px] font-bold text-white">AO</span>
            <p className="text-[11.5px] font-semibold">“Agentic Office” Not Opened</p>
            <p className="text-[9.5px] leading-snug text-[#555]">Apple could not verify it is free of malware.</p>
            <div className="mt-1 grid w-full gap-1">
              <Press className="w-full"><span className="w-full rounded-[5px] bg-[#007aff] py-1 text-[10.5px] font-medium text-white">Done</span></Press>
              <span className="rounded-[5px] bg-[#e5e5ea] py-1 text-[10.5px]">Move to Bin</span>
            </div>
          </div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame label={t("2. Privacy & Security → Open Anyway")}>
      <div className="grid min-h-40 grid-cols-[6.5rem_minmax(0,1fr)] bg-[#f5f5f7] text-[#1d1d1f]">
        <div className="grid content-start gap-0.5 border-r border-[#ddd] bg-[#ececee] p-2 text-[9.5px]">
          <span className="flex gap-1 pb-1"><i className="size-2 rounded-full bg-[#ff5f57]" /><i className="size-2 rounded-full bg-[#febc2e]" /><i className="size-2 rounded-full bg-[#28c840]" /></span>
          <span className="truncate px-1 py-0.5 text-[#666]">General</span>
          <span className="truncate px-1 py-0.5 text-[#666]">Appearance</span>
          <Press className="w-full"><span className="flex w-full items-center gap-1 truncate rounded-[4px] bg-[#007aff] px-1 py-0.5 text-white"><LockSimpleIcon size={9} weight="fill" /> Privacy & Security</span></Press>
          <span className="truncate px-1 py-0.5 text-[#666]">Desktop & Dock</span>
        </div>
        <div className="grid min-w-0 content-start gap-1.5 p-2.5">
          <span className="text-[11px] font-semibold">Privacy & Security</span>
          <span className="flex items-center gap-1 text-[9px] text-[#888]">{t("scroll down")} <CaretRightIcon size={8} className="rotate-90" /></span>
          <div className="grid gap-1.5 rounded-[6px] bg-white p-2">
            <span className="text-[9.5px] font-semibold">Security</span>
            <span className="text-[9px] leading-snug text-[#555]">“Agentic Office” was blocked to protect your Mac.</span>
            <Press className="justify-self-end"><span className="rounded-[4px] border border-[#ccc] bg-[#fafafa] px-2 py-0.5 text-[9.5px]">Open Anyway</span></Press>
          </div>
        </div>
      </div>
    </Frame>
  );
}
