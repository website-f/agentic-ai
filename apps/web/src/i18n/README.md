# Languages: English and Bahasa Melayu

## How it works

- **The English text is the key.** In a component, `const t = useT()`, then `t("New agent")`.
  Values go in as `{name}`: `t("{n} tasks waiting", { n })`. Never build a sentence out of
  pieces (`t("Saved") + " " + name`), because Malay word order differs. Translate the whole
  sentence with a variable instead.
- **Outside components** (toasts, helpers): `import { t } from "@/i18n"`.
- **Where the Malay lives:** `src/i18n/ms/*.ts`, one file per area. Each file is a map of
  English → Malay, merged in `ms/index.ts`.
- **Missing entries:** a missing entry shows the English, so a new screen is never blank.
  `npx vitest run src/i18n` lists every `t()` text that has no Malay entry yet, and checks
  that every `{var}` survives the translation.
- **Dates and numbers:** use `locale()` with `Intl` (`ms-MY` / `en-MY`). Don't hand-write
  month names.

## How the Malay should read

Write the way a capable Malaysian office manager would write to colleagues. It should be
clear, warm and short, not like a dictionary or a government form.

- **Natural, not literal.** "Give it a task" is "Beri tugasan kepadanya", not "Berikan ia
  satu tugasan". "Nothing waiting for you" is "Tiada apa-apa menunggu anda", not "Tiada item
  yang sedang menunggu untuk anda".
- **Short.** Button labels are 1-3 words: "Simpan", "Hantar semula", "Ejen baharu". Drop
  filler such as "sila", "adalah" and "yang mana" unless the sentence needs it.
- **Use "anda"** for the person. No "awak", no "tuan/puan". Imperatives stay plain:
  "Muat naik fail", "Pilih syarikat".
- **One term per idea.** Use `glossary.ts` (ejen, tugasan, kelulusan, kemahiran,
  perpustakaan, aliran kerja, …). Don't switch between synonyms.
- **Keep the English words people actually use at work**, the ones a Malay translation
  would make stranger: SOP, AI, PDF, Excel, WhatsApp, Gmail, email (in running text "e-mel"
  is fine), dashboard terms where common. Product names and brands are never translated.
- **No machine-translation tells:**
  - No "dengan ini", "adalah dimaklumkan", "sehubungan dengan itu" in UI text.
  - No passive pile-ups ("telah dilakukan oleh").
  - No doubled politeness.
  - Keep numbers, RM and dates in Malaysian style: "RM 1,250.00", "5 Okt 2026".
- **Keep the English tone.** Plain words, honest claims, no hype. If the English says
  "estimate", the Malay says "anggaran", not a promise.
- **Read it aloud.** If a Malaysian colleague would not say it that way, rewrite it.
