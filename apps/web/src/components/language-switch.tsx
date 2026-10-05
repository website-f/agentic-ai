/** English / Bahasa Melayu (P22): saved on the device at once and on the person's profile. */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { Segmented } from "@/components/ui/segmented";
import { LANGS, useLang, useT, type Lang } from "@/i18n";
import { prefsQuery, savePrefs } from "@/lib/tutorial";

/** Adopts the language saved on the person's profile once, when they sign in elsewhere. */
export function useProfileLanguage(enabled = true) {
  const { data } = useQuery({ ...prefsQuery, enabled });
  const setLang = useLang((s) => s.setLang);
  const done = useRef(false);
  useEffect(() => {
    const saved = data?.locale?.language;
    if (done.current || !saved) return;
    done.current = true;
    if (saved !== useLang.getState().lang) setLang(saved);
  }, [data, setLang]);
}

export function chooseLanguage(lang: Lang, signedIn = true) {
  useLang.getState().setLang(lang);
  if (signedIn) savePrefs({ locale: { language: lang } }).catch(() => {});
}

export function LanguageSwitch({ signedIn = true, size = "sm" }: { signedIn?: boolean; size?: "sm" | "md" }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  return (
    <Segmented
      label={t("Language")}
      size={size}
      value={lang}
      onChange={(v) => chooseLanguage(v as Lang, signedIn)}
      options={LANGS.map((l) => ({ value: l.key, label: size === "md" ? l.label : l.short }))}
    />
  );
}

