import {
  BookOpenTextIcon, CertificateIcon, ChartBarIcon, ClipboardTextIcon, CoinsIcon, FlowArrowIcon, HandshakeIcon, ListChecksIcon,
  NotePencilIcon, ScalesIcon, StackIcon, EnvelopeSimpleIcon, FileCsvIcon, FileDocIcon, FileIcon, FilePdfIcon, FileTextIcon, FileXlsIcon, IdentificationBadgeIcon,
  ImageIcon, InvoiceIcon, NotebookIcon, PresentationChartIcon, ReceiptIcon, TruckIcon, type Icon,
} from "@phosphor-icons/react";

import { IconTile, type Tone } from "@/components/page";

/** One look per document kind, shared by lists, cards and pickers. */
const KIND: Record<string, { icon: Icon; tone: Tone }> = {
  quotation: { icon: ReceiptIcon, tone: "accent" },
  invoice: { icon: InvoiceIcon, tone: "info" },
  letter: { icon: EnvelopeSimpleIcon, tone: "violet" },
  proposal: { icon: PresentationChartIcon, tone: "orange" },
  minutes: { icon: NotebookIcon, tone: "pink" },
  profile: { icon: IdentificationBadgeIcon, tone: "ok" },
  delivery: { icon: TruckIcon, tone: "warn" },
  // P24 company documents: the kinds an upload is sorted into.
  sop: { icon: ClipboardTextIcon, tone: "accent" },
  guide: { icon: BookOpenTextIcon, tone: "info" },
  checklist: { icon: ListChecksIcon, tone: "ok" },
  flowchart: { icon: FlowArrowIcon, tone: "violet" },
  form: { icon: NotePencilIcon, tone: "orange" },
  template: { icon: StackIcon, tone: "neutral" },
  policy: { icon: ScalesIcon, tone: "info" },
  contract: { icon: HandshakeIcon, tone: "pink" },
  certificate: { icon: CertificateIcon, tone: "warn" },
  report: { icon: ChartBarIcon, tone: "ok" },
  financial: { icon: CoinsIcon, tone: "orange" },
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
