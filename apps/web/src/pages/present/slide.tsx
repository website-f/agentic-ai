/** One slide, in two layouts: "stage" is a fixed 1600x900 canvas that the deck scales to fit
 * any landscape screen (and prints one per page); "read" flows as a card for portrait phones. */
import {
  BookOpenTextIcon,
  BrainIcon,
  BuildingsIcon,
  CalculatorIcon,
  CalendarCheckIcon,
  ChartBarIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  FilesIcon,
  FlowArrowIcon,
  HandIcon,
  LightningIcon,
  ListChecksIcon,
  LockKeyIcon,
  MicrophoneIcon,
  PackageIcon,
  PlugsConnectedIcon,
  RobotIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SparkleIcon,
  HardDrivesIcon,
  TrendUpIcon,
  UsersThreeIcon,
  WalletIcon,
  WhatsappLogoIcon,
  WrenchIcon,
  type Icon,
} from "@phosphor-icons/react";

import type { ReactNode } from "react";

import { LogoMark } from "@/components/logo";
import type { GuideManifest } from "@/guide/manifest";
import type { Slide, SlideIcon } from "@/guide/slides";
import { cn } from "@/lib/utils";

import { Laptop, Phone } from "./devices";

const ICONS: Record<SlideIcon, Icon> = {
  files: FilesIcon,
  package: PackageIcon,
  chart: ChartBarIcon,
  chat: ChatsCircleIcon,
  brain: BrainIcon,
  users: UsersThreeIcon,
  robot: RobotIcon,
  hand: HandIcon,
  list: ListChecksIcon,
  tools: WrenchIcon,
  check: CheckCircleIcon,
  seal: SealCheckIcon,
  shield: ShieldCheckIcon,
  lock: LockKeyIcon,
  wallet: WalletIcon,
  server: HardDrivesIcon,
  clock: ClockIcon,
  eye: EyeIcon,
  book: BookOpenTextIcon,
  lightning: LightningIcon,
  flow: FlowArrowIcon,
  calendar: CalendarCheckIcon,
  buildings: BuildingsIcon,
  calculator: CalculatorIcon,
  trend: TrendUpIcon,
  envelope: EnvelopeSimpleIcon,
  whatsapp: WhatsappLogoIcon,
  mic: MicrophoneIcon,
  plug: PlugsConnectedIcon,
  sparkle: SparkleIcon,
};

export interface Presenter {
  name: string;
  email: string;
  workspace: string;
}

interface SlideProps {
  slide: Slide;
  index: number;
  total: number;
  manifest: GuideManifest | null;
  presenter: Presenter;
  read?: boolean;
  /** The slide on screen: videos play only there. */
  live?: boolean;
  /** Print and thumbnails: load images straight away. */
  eager?: boolean;
}

function Eyebrow({ children, read }: { children: string; read?: boolean }) {
  return (
    <p className={cn("font-semibold tracking-[0.12em] text-accent uppercase", read ? "text-[11.5px]" : "text-[17px]")}>{children}</p>
  );
}

function Title({ children, read, big }: { children: string; read?: boolean; big?: boolean }) {
  return (
    <h2
      className={cn(
        "font-semibold tracking-tight text-balance text-fg",
        read ? (big ? "text-[28px] leading-[1.12]" : "text-[23px] leading-[1.15]") : big ? "text-[68px] leading-[1.04]" : "text-[52px] leading-[1.08]",
      )}
    >
      {children}
    </h2>
  );
}

function Lead({ children, read }: { children?: string; read?: boolean }) {
  if (!children) return null;
  return <p className={cn("text-pretty text-muted", read ? "text-[15px] leading-relaxed" : "text-[24px] leading-[1.45]")}>{children}</p>;
}

function Note({ children, read }: { children?: string; read?: boolean }) {
  if (!children) return null;
  return (
    <p className={cn("inline-flex items-center gap-2 text-muted", read ? "text-[12.5px]" : "text-[17px]")}>
      <span aria-hidden className={cn("rounded-full bg-warn", read ? "size-1.5" : "size-2")} />
      {children}
    </p>
  );
}

function Bullets({ items, read }: { items?: string[]; read?: boolean }) {
  if (!items?.length) return null;
  return (
    <ul className={cn("grid", read ? "gap-2" : "gap-4")}>
      {items.map((b) => (
        <li key={b} className={cn("flex items-start text-fg", read ? "gap-2.5 text-[14.5px] leading-snug" : "gap-4 text-[23px] leading-snug")}>
          <CheckCircleIcon weight="fill" className={cn("shrink-0 text-accent", read ? "mt-px size-[18px]" : "mt-[3px] size-[28px]")} />
          <span className="min-w-0">{b}</span>
        </li>
      ))}
    </ul>
  );
}

function IconBox({ icon, read, solid }: { icon: SlideIcon; read?: boolean; solid?: boolean }) {
  const IconCmp = ICONS[icon];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center ring-1 ring-inset",
        solid ? "bg-accent text-accent-fg ring-accent" : "bg-accent-soft text-accent ring-accent/15",
        read ? "size-9 rounded-[10px]" : "size-[60px] rounded-[16px]",
      )}
    >
      <IconCmp weight="duotone" className={read ? "size-[19px]" : "size-[30px]"} />
    </span>
  );
}

/** The laptop with a phone leaning on it, or whichever of the two the slide has. */
function Devices({ slide, manifest, read, live, eager }: Pick<SlideProps, "slide" | "manifest" | "read" | "live" | "eager">) {
  const video = live && !read ? slide.video : undefined;
  if (slide.shot && slide.phone) {
    return (
      <div className={cn("relative", read ? "pr-[14%] pb-[4%] text-[9px]" : "pr-[13%] pb-[3%] text-[18px]")}>
        <Laptop manifest={manifest} shotKey={slide.shot} video={video} eager={eager} />
        <Phone
          manifest={manifest}
          shotKey={slide.phone}
          video={video}
          eager={eager}
          className={cn("absolute right-0 bottom-0 w-[27%]", read ? "text-[7px]" : "text-[13px]")}
        />
      </div>
    );
  }
  if (slide.shot) {
    return (
      <div className={read ? "text-[9px]" : "text-[18px]"}>
        <Laptop manifest={manifest} shotKey={slide.shot} video={video} eager={eager} />
      </div>
    );
  }
  if (slide.phone) {
    return (
      <div className={cn("mx-auto", read ? "w-[46%] text-[8px]" : "w-[300px] text-[14px]")}>
        <Phone manifest={manifest} shotKey={slide.phone} video={video} eager={eager} />
      </div>
    );
  }
  return null;
}

/** Brand frame every slide shares: soft accent light, logo and page number. */
function Frame({ index, total, read, children, className }: { index: number; total: number; read?: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-bg text-fg",
        read ? "rounded-[var(--radius-lg)] border border-border px-5 pt-5 pb-6" : "size-full px-[96px] pt-[84px] pb-[72px]",
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_16%,transparent),transparent)]",
          read ? "-top-24 -right-24 size-72" : "-top-[340px] -right-[260px] size-[1000px]",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_8%,transparent),transparent)]",
          read ? "hidden" : "-bottom-[420px] -left-[300px] size-[900px]",
        )}
      />
      {!read ? (
        <div className="absolute inset-x-[96px] bottom-[30px] flex items-center justify-between text-[15px] text-muted">
          <span className="flex items-center gap-2.5">
            <LogoMark className="size-[22px]" />
            <span className="font-medium">Agentic Office</span>
          </span>
          <span className="tabular">
            {index + 1} / {total}
          </span>
        </div>
      ) : null}
      <div className={cn("relative", !read && "size-full")}>{children}</div>
    </div>
  );
}

export function SlideView(props: SlideProps) {
  const { slide, index, total, presenter, read } = props;
  const pts = slide.points ?? [];

  if (slide.kind === "title") {
    return (
      <Frame index={index} total={total} read={read}>
        <div className={cn("grid", read ? "gap-5" : "size-full grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] items-center gap-[64px]")}>
          <div className={cn("grid content-center", read ? "gap-3" : "gap-7")}>
            <LogoMark className={read ? "size-10" : "size-[72px]"} />
            <Eyebrow read={read}>{slide.eyebrow}</Eyebrow>
            <Title read={read} big>
              {slide.title}
            </Title>
            <Lead read={read}>{slide.lead}</Lead>
            <p className={cn("text-muted", read ? "text-[13px]" : "text-[19px]")}>
              Presented by <span className="font-medium text-fg">{presenter.name}</span> · {presenter.workspace}
            </p>
          </div>
          <Devices {...props} />
        </div>
      </Frame>
    );
  }

  if (slide.kind === "points") {
    return (
      <Frame index={index} total={total} read={read}>
        <div className={cn("grid", read ? "gap-4" : "size-full grid-rows-[auto_minmax(0,1fr)_auto] gap-[44px]")}>
          <div className={cn("grid", read ? "gap-2" : "max-w-[1180px] gap-4")}>
            <Eyebrow read={read}>{slide.eyebrow}</Eyebrow>
            <Title read={read}>{slide.title}</Title>
            <Lead read={read}>{slide.lead}</Lead>
          </div>
          <ul className={cn("grid", read ? "gap-2.5" : "grid-cols-3 content-center gap-[24px]")}>
            {pts.map((p) => (
              <li
                key={p.title}
                className={cn(
                  "flex border border-border bg-surface shadow-[var(--shadow-soft)]",
                  read ? "items-start gap-3 rounded-[12px] p-3.5" : cn("flex-col rounded-[22px]", pts.length > 3 ? "gap-4 p-[28px]" : "gap-5 p-[34px]"),
                )}
              >
                <IconBox icon={p.icon} read={read} />
                <div className={cn("grid min-w-0", read ? "gap-0.5" : "gap-2")}>
                  <h3 className={cn("font-semibold", read ? "text-[15px]" : "text-[25px] leading-tight")}>{p.title}</h3>
                  <p className={cn("text-muted", read ? "text-[13.5px] leading-snug" : pts.length > 3 ? "text-[18.5px] leading-snug" : "text-[20px] leading-snug")}>{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <Note read={read}>{slide.note}</Note>
        </div>
      </Frame>
    );
  }

  if (slide.kind === "flow" || slide.kind === "steps") {
    const solid = slide.kind === "steps";
    return (
      <Frame index={index} total={total} read={read}>
        <div className={cn("grid", read ? "gap-4" : "size-full grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-[64px]")}>
          <div className={cn("grid content-center", read ? "gap-4" : "gap-[34px]")}>
            <div className={cn("grid", read ? "gap-2" : "gap-4")}>
              <Eyebrow read={read}>{slide.eyebrow}</Eyebrow>
              <Title read={read}>{slide.title}</Title>
              <Lead read={read}>{slide.lead}</Lead>
            </div>
            <ol className={cn("relative grid", read ? "gap-2.5" : solid ? "gap-[26px]" : "gap-[18px]")}>
              <span
                aria-hidden
                className={cn("absolute w-px bg-[linear-gradient(var(--accent),transparent)] opacity-40", read ? "top-4 bottom-4 left-[17.5px]" : "top-8 bottom-8 left-[29.5px]")}
              />
              {pts.map((p, i) => (
                <li key={p.title} className={cn("relative flex items-start", read ? "gap-3" : "gap-5")}>
                  <span className="relative">
                    <IconBox icon={p.icon} read={read} solid={solid || i === pts.length - 1} />
                    <span
                      className={cn(
                        "absolute grid place-items-center rounded-full bg-fg font-semibold text-bg tabular",
                        read ? "-top-1.5 -right-1.5 size-[17px] text-[10px]" : "-top-2 -right-2 size-[24px] text-[13px]",
                      )}
                    >
                      {i + 1}
                    </span>
                  </span>
                  <div className={cn("grid min-w-0", read ? "gap-0" : "gap-0.5 pt-1")}>
                    <h3 className={cn("font-semibold", read ? "text-[15px]" : solid ? "text-[28px]" : "text-[24px] leading-tight")}>{p.title}</h3>
                    <p className={cn("text-muted", read ? "text-[13.5px] leading-snug" : solid ? "text-[20px]" : "text-[19px] leading-snug")}>{p.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Devices {...props} />
        </div>
      </Frame>
    );
  }

  if (slide.kind === "feature") {
    return (
      <Frame index={index} total={total} read={read}>
        <div className={cn("grid", read ? "gap-5" : "size-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] items-center gap-[64px]")}>
          <div className={cn("grid content-center", read ? "gap-4" : "gap-[34px]")}>
            <div className={cn("grid", read ? "gap-2" : "gap-4")}>
              <Eyebrow read={read}>{slide.eyebrow}</Eyebrow>
              <Title read={read}>{slide.title}</Title>
              <Lead read={read}>{slide.lead}</Lead>
            </div>
            <Bullets items={slide.bullets} read={read} />
            <Note read={read}>{slide.note}</Note>
          </div>
          <Devices {...props} />
        </div>
      </Frame>
    );
  }

  // closing
  return (
    <Frame index={index} total={total} read={read}>
      <div className={cn("grid justify-items-center text-center", read ? "gap-4 py-4" : "size-full content-center gap-[30px]")}>
        <LogoMark className={read ? "size-12" : "size-[84px]"} />
        <Eyebrow read={read}>{slide.eyebrow}</Eyebrow>
        <div className={read ? undefined : "max-w-[1100px]"}>
          <Title read={read} big>
            {slide.title}
          </Title>
        </div>
        <div className={read ? undefined : "max-w-[900px]"}>
          <Lead read={read}>{slide.lead}</Lead>
        </div>
        <div
          className={cn(
            "grid justify-items-center border border-border bg-surface shadow-[var(--shadow-soft)]",
            read ? "mt-2 gap-0.5 rounded-[12px] px-5 py-3.5" : "mt-[10px] gap-1 rounded-[22px] px-[44px] py-[26px]",
          )}
        >
          <span className={cn("font-semibold", read ? "text-[16px]" : "text-[28px]")}>{presenter.name}</span>
          <span className={cn("text-accent", read ? "text-[14px]" : "text-[22px]")}>{presenter.email}</span>
          <span className={cn("text-muted", read ? "text-[12.5px]" : "text-[18px]")}>{presenter.workspace}</span>
        </div>
        <p className={cn("text-muted", read ? "text-[13px]" : "text-[20px]")}>Questions?</p>
      </div>
    </Frame>
  );
}
