/** P97: which language the agent replies in, under the message box, with a quick switch for
 * this conversation only. The default is the person's setting (Settings > Language), the same
 * for every agent; the server applies it (api i18n/notes.voice_for). */
import { CaretDownIcon, GearSixIcon, TranslateIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useLang, useT } from "@/i18n";
import { prefsQuery } from "@/lib/tutorial";
import { STYLE_NAMES, voiceName, type Pick } from "@/lib/voice";

const DIALECTS = Object.keys(STYLE_NAMES) as Exclude<Pick, "" | "en" | "ms">[];

export function ReplyLanguage({ pick, onPick, disabled }: { pick: Pick; onPick: (p: Pick) => void; disabled?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const lang = useLang((s) => s.lang);
  const { data, isPending } = useQuery(prefsQuery);
  const speech = data?.locale?.speech ?? null;
  const name = voiceName(t, lang, speech, pick);
  const mine = voiceName(t, lang, speech);
  if (isPending) return null; // the setting is not known yet: never show a wrong language
  return (
    <Menu>
      <MenuTrigger asChild disabled={disabled}>
        <button type="button" data-testid="reply-language"
          aria-label={t("Replies in {name}. Change the reply language for this chat", { name })}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11.5px] text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-50 pointer-coarse:min-h-11">
          <TranslateIcon size={14} aria-hidden className={pick ? "text-accent" : undefined} />
          <span className="truncate">{t("Replies in {name}", { name })}</span>
          <CaretDownIcon size={11} aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="center" side="top" className="w-64">
        <MenuLabel>{t("Reply language for this chat")}</MenuLabel>
        <MenuRadioGroup value={pick} onValueChange={(v) => onPick(v as Pick)}>
          <MenuRadioItem value="">{t("My setting: {name}", { name: mine })}</MenuRadioItem>
          <MenuRadioItem value="en">{t("English")}</MenuRadioItem>
          <MenuRadioItem value="ms">{t("Standard Malay")}</MenuRadioItem>
          <MenuSeparator />
          <MenuLabel>{t("Casual Malay and dialects")}</MenuLabel>
          {DIALECTS.map((d) => (
            <MenuRadioItem key={d} value={d}>{t(STYLE_NAMES[d])}</MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<GearSixIcon />} onSelect={() => void navigate({ to: "/settings" })}>{t("Change my setting for every agent")}</MenuItem>
      </MenuContent>
    </Menu>
  );
}
