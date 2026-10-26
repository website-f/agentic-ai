/** P37: how my AI speaks to me: as I write, casual Malay (bahasa pasar) or a state's dialect. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Select } from "@/components/ui/select";
import { msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { prefsQuery, savePrefs, tutorialKeys, type SpeechStyle } from "@/lib/tutorial";

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

export function SpeechStylePicker() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery(prefsQuery);
  const value: SpeechStyle = data?.locale?.speech ?? "standard";
  const save = useMutation({
    mutationFn: (speech: SpeechStyle) => savePrefs({ locale: { speech } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tutorialKeys.prefs });
      toast.success(t("Saved. Your AI speaks this way from your next message."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Select
      value={value}
      disabled={save.isPending}
      onValueChange={(v) => save.mutate(v as SpeechStyle)}
      label={t("How your AI speaks to you")}
      className="w-full sm:w-96"
      options={STYLES.map((s) => ({ value: s.value, label: t(s.label), hint: t(s.hint) }))}
    />
  );
}
