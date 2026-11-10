/** P37: how agents speak to me: as I write, casual Malay (bahasa pasar) or a state's dialect.
 * P97: one setting for every agent (my AI, team agents, assistants such as Chief of Staff),
 * shown beside the app language with one plain sentence of what happens. */
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Select } from "@/components/ui/select";
import { msg, useLang, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { prefsQuery, savePrefs, tutorialKeys, type SpeechStyle } from "@/lib/tutorial";
import { STYLE_NAMES, voiceSummary } from "@/lib/voice";

const STYLES: { value: SpeechStyle; label: string; hint: string }[] = [
  { value: "standard", label: msg("As I write (standard)"), hint: msg("English, or standard Malay, following you") },
  { value: "pasar", label: msg("Casual Malay (bahasa pasar)"), hint: msg("Relaxed everyday Malay: tak, dah, nak, je, la") },
  { value: "kelantan", label: msg("Kelantan"), hint: msg("Loghat Kelate: ambo, demo, gapo, bakpo") },
  { value: "terengganu", label: msg("Terengganu"), hint: msg("Loghat Ganu: mung, bakpe, guane, dok") },
  { value: "kedah", label: msg("Kedah / Utara"), hint: msg("Kedah, Perlis, Penang: hang, depa, awat, habaq") },
  { value: "perak", label: msg("Perak"), hint: msg("Teman, mike, kome, deme") },
  { value: "pahang", label: msg("Pahang"), hint: msg("Kome, deme, ngape") },
  { value: "negeri_sembilan", label: msg("Negeri Sembilan"), hint: msg("Loghat Nogori: den, ekau, apo") },
  { value: "melaka", label: msg("Melaka"), hint: msg("Close to standard, with apo, kito") },
  { value: "johor", label: msg("Johor"), hint: msg("Soft -e endings: ape, saye") },
  { value: "sabah", label: msg("Sabah"), hint: msg("Sia, nda, bikin, tingu, bah") },
  { value: "sarawak", label: msg("Sarawak"), hint: msg("Kamek, kitak, sik, polah, nangga") },
];

/** What agents will answer in, in one sentence, from the saved setting. */
export function VoiceSummary() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { data, isPending } = useQuery(prefsQuery);
  const speech = data?.locale?.speech ?? "standard";
  const name = speech !== "standard" ? t(STYLE_NAMES[speech]) : "";
  if (isPending) return null;
  return (
    <p data-testid="voice-summary" aria-live="polite"
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-accent/20 bg-accent-soft/60 px-3 py-2.5 text-[13px] text-fg">
      <ChatCircleTextIcon size={17} className="mt-px shrink-0 text-accent" aria-hidden />
      <span>{t(voiceSummary(lang, speech), { name })}</span>
    </p>
  );
}

export function SpeechStylePicker() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery(prefsQuery);
  const value: SpeechStyle = data?.locale?.speech ?? "standard";
  const save = useMutation({
    mutationFn: (speech: SpeechStyle) => savePrefs({ locale: { speech } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tutorialKeys.prefs });
      toast.success(t("Saved. Agents speak this way from your next message."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Select
      value={value}
      disabled={save.isPending}
      onValueChange={(v) => save.mutate(v as SpeechStyle)}
      label={t("How agents speak to you")}
      className="w-full sm:w-96"
      options={STYLES.map((s) => ({ value: s.value, label: t(s.label), hint: t(s.hint) }))}
    />
  );
}
