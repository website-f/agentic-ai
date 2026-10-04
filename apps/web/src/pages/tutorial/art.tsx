/** Small mock screens beside each lesson: plain blocks and Phosphor icons, no images. */
import {
  ArrowRightIcon,
  BellRingingIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  KeyIcon,
  MicrophoneIcon,
  PlusIcon,
  RobotIcon,
  SparkleIcon,
  UploadSimpleIcon,
  UserIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { IconTile, type Tone } from "@/components/page";
import { cn } from "@/lib/utils";

import type { ArtKind } from "./content";

/** A text line placeholder. */
function Bar({ w = "w-full", className }: { w?: string; className?: string }) {
  return <span aria-hidden className={cn("block h-1.5 rounded-full bg-border", w, className)} />;
}

/** A tiny button-looking chip carrying a real label. */
function Chip({ children, primary, className }: { children: ReactNode; primary?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[10px] leading-none font-medium whitespace-nowrap",
        primary ? "bg-accent text-accent-fg" : "border border-border bg-surface text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 items-center gap-2 rounded-[6px] border border-border bg-surface px-2 py-1.5", className)}>{children}</div>;
}

function Screen({ kind, icon, tone }: { kind: ArtKind; icon: Icon; tone: Tone }) {
  switch (kind) {
    case "connect":
      return (
        <div className="grid gap-1.5">
          {["w-16", "w-12"].map((w, i) => (
            <Row key={w}>
              <IconTile icon={i ? KeyIcon : icon} tone={i ? "neutral" : tone} size="sm" className="size-6 [&_svg]:size-3.5" />
              <span className="grid min-w-0 flex-1 gap-1"><Bar w={w} /><Bar w="w-10" className="opacity-60" /></span>
              {i ? <Chip>Test</Chip> : <Chip className="border-ok/30 text-ok"><CheckIcon size={10} weight="bold" /> OK</Chip>}
            </Row>
          ))}
          <div className="flex justify-end"><Chip primary><PlusIcon size={10} weight="bold" /> Connect a provider</Chip></div>
        </div>
      );
    case "company":
      return (
        <div className="grid gap-2">
          <Row>
            <IconTile icon={icon} tone={tone} size="sm" className="size-6 [&_svg]:size-3.5" />
            <span className="grid min-w-0 flex-1 gap-1"><Bar w="w-20" /><Bar w="w-12" className="opacity-60" /></span>
          </Row>
          <div className="flex flex-wrap gap-1">
            {["Finance", "Operations", "Sales"].map((d) => <Chip key={d}>{d}</Chip>)}
          </div>
          <div className="flex justify-end"><Chip primary><PlusIcon size={10} weight="bold" /> New branch</Chip></div>
        </div>
      );
    case "people":
      return (
        <div className="grid gap-2">
          <div className="flex -space-x-1.5">
            {["bg-accent", "bg-info", "bg-warn", "bg-ok"].map((c) => (
              <span key={c} aria-hidden className={cn("grid size-7 place-items-center rounded-full text-white ring-2 ring-surface-2", c)}>
                <UserIcon size={13} weight="bold" />
              </span>
            ))}
          </div>
          {["Branch manager", "Staff"].map((r) => (
            <Row key={r}><Bar w="w-14" /><span className="flex-1" /><Chip>{r}</Chip></Row>
          ))}
          <div className="flex justify-end"><Chip primary><PlusIcon size={10} weight="bold" /> Add member</Chip></div>
        </div>
      );
    case "builder":
      return (
        <div className="grid gap-2">
          <div className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < 3 ? "bg-accent" : "bg-border")} />
            ))}
          </div>
          <Row><IconTile icon={icon} tone={tone} size="sm" className="size-6 [&_svg]:size-3.5" /><span className="grid flex-1 gap-1"><Bar w="w-16" /><Bar w="w-24" className="opacity-60" /></span></Row>
          <Row className="py-2"><span className="grid flex-1 gap-1"><Bar /><Bar w="w-3/4" /></span></Row>
          <div className="flex justify-end gap-1"><Chip>Back</Chip><Chip primary>Next <ArrowRightIcon size={10} /></Chip></div>
        </div>
      );
    case "board":
      return (
        <div className="grid grid-cols-3 gap-1.5">
          {[{ t: "Ready", n: 2 }, { t: "Running", n: 1 }, { t: "Review", n: 1 }].map((col, ci) => (
            <div key={col.t} className="grid content-start gap-1 rounded-[6px] bg-surface-2 p-1">
              <span className="truncate px-0.5 text-[9.5px] font-medium text-muted">{col.t}</span>
              {Array.from({ length: col.n }, (_, i) => (
                <span key={i} className={cn("grid gap-1 rounded-[5px] border bg-surface p-1", ci === 2 ? "border-accent/50" : "border-border")}>
                  <Bar w="w-4/5" /><Bar w="w-1/2" className="opacity-60" />
                </span>
              ))}
            </div>
          ))}
          <div className="col-span-3 flex justify-end gap-1"><Chip>Send back</Chip><Chip primary><CheckIcon size={10} weight="bold" /> Accept</Chip></div>
        </div>
      );
    case "approval":
      return (
        <div className="grid gap-2 rounded-[6px] border border-warn/40 bg-surface p-2">
          <div className="flex items-center gap-2">
            <IconTile icon={RobotIcon} tone="warn" size="sm" className="size-6 [&_svg]:size-3.5" />
            <span className="grid min-w-0 flex-1 gap-1"><Bar w="w-20" /><Bar w="w-14" className="opacity-60" /></span>
          </div>
          <Bar /><Bar w="w-2/3" />
          <div className="flex flex-wrap gap-1"><Chip primary><CheckIcon size={10} weight="bold" /> Approve once</Chip><Chip>Deny</Chip></div>
        </div>
      );
    case "flow":
      return (
        <div className="grid gap-2">
          <div className="flex items-center gap-1">
            {["Start", "Check", "Approve"].map((n, i) => (
              <span key={n} className="flex min-w-0 flex-1 items-center gap-1">
                <span className={cn("min-w-0 flex-1 truncate rounded-[6px] border px-1 py-1.5 text-center text-[9.5px] font-medium", i === 2 ? "border-warn/50 bg-warn/10 text-warn" : "border-border bg-surface text-muted")}>{n}</span>
                {i < 2 ? <ArrowRightIcon size={10} className="shrink-0 text-muted" /> : null}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 pl-6">
            <span className="h-4 w-px bg-border" aria-hidden />
            <span className="min-w-0 flex-1 truncate rounded-[6px] border border-border bg-surface px-1 py-1.5 text-center text-[9.5px] font-medium text-muted">File it</span>
            <span className="min-w-0 flex-1 truncate rounded-[6px] border border-ok/40 bg-ok/10 px-1 py-1.5 text-center text-[9.5px] font-medium text-ok">Done</span>
          </div>
          <div className="flex justify-end"><Chip primary>Run</Chip></div>
        </div>
      );
    case "calendar":
      return (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-7 gap-1" aria-hidden>
            {"MTWTFSS".split("").map((d, i) => <span key={i} className="text-center text-[9px] font-medium text-muted">{d}</span>)}
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className={cn("h-4 rounded-[4px]", i % 7 === 0 ? "bg-accent" : i % 7 > 4 ? "bg-surface-2" : "bg-border/70")} />
            ))}
          </div>
          <Row><ClockIcon size={13} className="shrink-0 text-accent" /><span className="truncate text-[10px] text-muted">Every Monday, 9:00</span></Row>
        </div>
      );
    case "upload":
      return (
        <div className="grid gap-1.5">
          <div className="grid place-items-center gap-1 rounded-[6px] border border-dashed border-accent/50 bg-accent-soft/40 py-3 text-accent">
            <UploadSimpleIcon size={18} weight="bold" />
            <span className="text-[9.5px] font-medium">Drop files here</span>
          </div>
          {["SOP – Claims.pdf", "Staff handbook.docx"].map((f) => (
            <Row key={f} className="py-1"><FileTextIcon size={12} className="shrink-0 text-muted" /><span className="truncate text-[10px] text-muted">{f}</span><CheckIcon size={10} weight="bold" className="ml-auto shrink-0 text-ok" /></Row>
          ))}
        </div>
      );
    case "chart":
      return (
        <div className="grid gap-2">
          <div className="flex h-14 items-end gap-1.5" aria-hidden>
            {[40, 70, 55, 90, 65, 80].map((h, i) => (
              <span key={i} className={cn("flex-1 rounded-t-[3px]", i === 3 ? "bg-accent" : "bg-accent/30")} style={{ height: `${h}%` }} />
            ))}
          </div>
          <Row><SparkleIcon size={12} weight="fill" className="shrink-0 text-accent" /><span className="grid flex-1 gap-1"><Bar /><Bar w="w-2/3" className="opacity-60" /></span></Row>
        </div>
      );
    case "chat":
      return (
        <div className="grid gap-1.5">
          <span className="max-w-[80%] justify-self-end rounded-[8px] rounded-br-[2px] bg-accent px-2 py-1.5 text-[10px] text-accent-fg">What needs me today?</span>
          <span className="grid max-w-[85%] gap-1 rounded-[8px] rounded-bl-[2px] border border-border bg-surface px-2 py-1.5"><Bar w="w-24" /><Bar w="w-16" className="opacity-60" /></span>
          <Row className="py-1"><Bar w="w-16" className="opacity-60" /><span className="flex-1" /><span className="grid size-5 place-items-center rounded-full bg-accent text-accent-fg"><MicrophoneIcon size={11} weight="fill" /></span></Row>
        </div>
      );
    case "phone":
      return (
        <div className="mx-auto grid w-28 gap-1.5 rounded-[14px] border-2 border-border bg-surface p-1.5">
          <span aria-hidden className="mx-auto h-1 w-8 rounded-full bg-border" />
          <div className="grid gap-1 rounded-[8px] bg-surface-2 p-1.5">
            <span className="flex items-center gap-1 text-[9px] font-medium"><BellRingingIcon size={10} weight="fill" className="text-warn" /> Approval</span>
            <Bar /><Bar w="w-2/3" className="opacity-60" />
            <span className="flex gap-1"><Chip primary className="h-4 px-1 text-[8.5px]">Approve</Chip><Chip className="h-4 px-1 text-[8.5px]">Deny</Chip></span>
          </div>
          <span className="h-6" aria-hidden />
        </div>
      );
    case "shield":
      return (
        <div className="grid gap-1.5">
          <Row className="grid gap-1">
            <span className="flex justify-between text-[9.5px] text-muted"><span>This month</span><span>$12 of $40</span></span>
            <span className="h-1.5 rounded-full bg-border"><span className="block h-full w-[30%] rounded-full bg-ok" /></span>
          </Row>
          {[["Send email", "Ask"], ["Run code", "Never"]].map(([t, m]) => (
            <Row key={t}><span className="truncate text-[10px] text-muted">{t}</span><span className="flex-1" /><Chip className={m === "Ask" ? "border-warn/40 text-warn" : ""}>{m}</Chip></Row>
          ))}
        </div>
      );
    case "twin":
      return (
        <div className="grid gap-2">
          <div className="flex items-center justify-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-info/15 text-info"><UserIcon size={18} weight="bold" /></span>
            <SparkleIcon size={14} weight="fill" className="text-accent" />
            <span className="grid size-9 place-items-center rounded-full bg-accent text-accent-fg ring-4 ring-accent-soft"><RobotIcon size={18} weight="fill" /></span>
          </div>
          <Row><span className="grid flex-1 gap-1"><Bar w="w-20" /><Bar w="w-12" className="opacity-60" /></span><Chip className="border-info/30 text-info">Available</Chip></Row>
          <div className="flex justify-end"><Chip primary><SparkleIcon size={10} weight="fill" /> Create my twin</Chip></div>
        </div>
      );
    case "live":
      return (
        <div className="grid gap-1.5">
          <Row className="py-1"><span className="size-1.5 shrink-0 rounded-full bg-ok" /><span className="truncate text-[10px] text-muted">Working: reading invoices</span></Row>
          <div className="grid gap-1 rounded-[6px] border border-border bg-surface p-1.5">
            <Bar w="w-5/6" /><Bar w="w-2/3" className="opacity-60" />
            <span className="flex gap-1"><Chip>web_search</Chip><Chip>read_file</Chip></span>
          </div>
        </div>
      );
    case "memory":
      return (
        <div className="grid gap-1.5">
          {["Prefers short replies", "Month end is on the 25th", "Cite the SOP page"].map((m) => (
            <Row key={m} className="py-1"><CheckIcon size={11} weight="bold" className="shrink-0 text-ok" /><span className="truncate text-[10px] text-muted">{m}</span></Row>
          ))}
          <div className="flex justify-end"><Chip primary><PlusIcon size={10} weight="bold" /> Remember</Chip></div>
        </div>
      );
    case "report":
      return (
        <div className="grid gap-1.5 rounded-[6px] border border-border bg-surface p-2">
          <Bar w="w-24" /><Bar w="w-full" className="opacity-60" />
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[4px] bg-border" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={cn("h-3", i < 3 ? "bg-surface-2" : "bg-surface")} />)}
          </div>
          <div className="flex justify-end"><Chip>CSV</Chip></div>
        </div>
      );
  }
}

export function LessonArt({ kind, icon, tone, className }: { kind: ArtKind; icon: Icon; tone: Tone; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/60 p-3 select-none", className)}
    >
      <div className="mb-2.5 flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-border" />
        <span className="size-1.5 rounded-full bg-border" />
        <span className="size-1.5 rounded-full bg-border" />
      </div>
      <Screen kind={kind} icon={icon} tone={tone} />
    </div>
  );
}
