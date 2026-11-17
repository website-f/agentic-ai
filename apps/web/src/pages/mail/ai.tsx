/** P109 "Ask AI" pieces shared by the Microsoft 365 tabs: the answer card, the tone picker and
 * the "draft it for me" box. Answers and drafts only: the person edits a draft and presses Send. */
import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { msg, useLang, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { askAi, TONES, type AiIn, type AiOut, type Tone } from "@/lib/m365";
import { cn } from "@/lib/utils";

export const TONE_LABEL: Record<Tone, string> = {
  friendly: msg("Friendly"),
  formal: msg("Formal"),
  short: msg("Short"),
  firm: msg("Firm"),
  apologetic: msg("Apologetic"),
};

/** One Ask AI call; its errors are shown as a toast. */
export function useAskAi(onDone?: (r: AiOut) => void) {
  const lang = useLang((s) => s.lang);
  return useMutation({
    mutationFn: (body: AiIn) => askAi({ lang: lang === "ms" ? "ms" : "", ...body }),
    onSuccess: (r) => onDone?.(r),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** What the AI said (a summary, a briefing): readable, closable, never acted on by itself. */
export function AiAnswer({ title, text, onClose, children, className }: { title: string; text: string; onClose: () => void; children?: ReactNode; className?: string }) {
  const t = useT();
  return (
    <section aria-label={title} className={cn("grid gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 p-3", className)}>
      <div className="flex items-center gap-2">
        <SparkleIcon size={16} weight="fill" className="shrink-0 text-accent" />
        <h4 className="min-w-0 flex-1 text-[13px] font-semibold">{title}</h4>
        <Button size="icon-sm" variant="ghost" aria-label={t("Close")} onClick={onClose}><XIcon size={14} /></Button>
      </div>
      <Markdown className="text-[13.5px]">{text}</Markdown>
      {children}
      <p className="text-[11.5px] text-muted">{t("Written by AI from your own messages. Check it before you act on it.")}</p>
    </section>
  );
}

export function ToneSelect({ value, onChange }: { value: Tone | ""; onChange: (v: Tone | "") => void }) {
  const t = useT();
  return (
    <Select size="sm" label={t("Tone")} value={value || "default"} onValueChange={(v) => onChange(v === "default" ? "" : (v as Tone))}
      options={[{ value: "default", label: t("Usual tone") }, ...TONES.map((x) => ({ value: x, label: t(TONE_LABEL[x]) }))]} />
  );
}

/** "Draft with AI": optional words on what to say and a tone; the draft fills the composer. */
export function DraftWithAi({ busy, onDraft, placeholder, className }: {
  busy: boolean;
  onDraft: (p: { tone: Tone | ""; instructions: string }) => void;
  placeholder?: string;
  className?: string;
}) {
  const t = useT();
  const [tone, setTone] = useState<Tone | "">("");
  const [what, setWhat] = useState("");
  return (
    <div className={cn("grid gap-2 rounded-[var(--radius-md)] border border-dashed border-accent/40 bg-accent-soft/25 p-2.5", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("What should it say?")}</span>
          <Input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={2000}
            placeholder={placeholder ?? t("What should it say? (optional)")}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); onDraft({ tone, instructions: what }); } }} />
        </label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 sm:w-36 sm:flex-none"><ToneSelect value={tone} onChange={setTone} /></div>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => onDraft({ tone, instructions: what })}>
            <SparkleIcon size={14} /> {t("Draft with AI")}
          </Button>
        </div>
      </div>
    </div>
  );
}
