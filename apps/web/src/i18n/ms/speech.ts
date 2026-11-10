/** P37 How your AI speaks: casual Malay (bahasa pasar) and each state's dialect. Dialect names
 * and their sample words stay as they are (they are the dialect itself); only the English
 * descriptions become Malay. */
export const SPEECH: Record<string, string> = {
  // P97: one setting for every agent (Settings > Language), and a per-chat switch.
  "How agents speak to you": "Cara ejen bercakap dengan anda",
  "App language": "Bahasa aplikasi",
  "Saved to your profile, so it follows you to other devices and applies to every agent: your AI, team agents and assistants such as Chief of Staff.":
    "Disimpan dalam profil anda, jadi ia ikut anda ke peranti lain dan terpakai untuk setiap ejen: AI anda, ejen pasukan dan pembantu seperti Chief of Staff.",
  "Pick casual Malay or your state's dialect. Documents, letters and reports stay in standard Malay. For one chat only, use the language button under the message box.":
    "Pilih bahasa Melayu santai atau loghat negeri anda. Dokumen, surat dan laporan kekal dalam bahasa Melayu baku. Untuk satu sembang sahaja, guna butang bahasa di bawah kotak mesej.",
  "Saved. Agents speak this way from your next message.": "Disimpan. Ejen bercakap begini mulai mesej anda yang seterusnya.",
  "Agents will reply to you in {name}, also when you type standard Malay or mix in English. Write fully in English and they answer in English.":
    "Ejen akan membalas anda dalam {name}, walaupun anda menaip bahasa Melayu baku atau bercampur bahasa Inggeris. Tulis sepenuhnya dalam bahasa Inggeris dan mereka akan menjawab dalam bahasa Inggeris.",
  "Agents will reply to you in English, and in {name} when you write in Malay.":
    "Ejen akan membalas anda dalam bahasa Inggeris, dan dalam {name} apabila anda menulis dalam bahasa Melayu.",
  "Agents will reply to you in Bahasa Melayu, or in English when you write in English.":
    "Ejen akan membalas anda dalam Bahasa Melayu, atau dalam bahasa Inggeris apabila anda menulis dalam bahasa Inggeris.",
  "Agents will reply to you in English, or in Malay when you write in Malay.":
    "Ejen akan membalas anda dalam bahasa Inggeris, atau dalam bahasa Melayu apabila anda menulis dalam bahasa Melayu.",
  "Replies in {name}": "Balas dalam {name}",
  "Replies in {name}. Change the reply language for this chat": "Balas dalam {name}. Tukar bahasa balasan untuk sembang ini",
  "Reply language for this chat": "Bahasa balasan untuk sembang ini",
  "My setting: {name}": "Tetapan saya: {name}",
  "Standard Malay": "Bahasa Melayu baku",
  "standard Malay": "bahasa Melayu baku",
  "English|reply": "bahasa Inggeris",
  "English or {name}": "bahasa Inggeris atau {name}",
  "Casual Malay and dialects": "Melayu santai dan loghat",
  "Change my setting for every agent": "Tukar tetapan saya untuk semua ejen",
  "The languages your twin may use with others. How every agent, your twin too, speaks to you (language and dialect) is set once in":
    "Bahasa yang boleh digunakan oleh kembar anda dengan orang lain. Cara setiap ejen, termasuk kembar anda, bercakap dengan anda (bahasa dan loghat) ditetapkan sekali sahaja di",
  "Settings > Language": "Tetapan > Bahasa",
  // The languages a twin works in (api agents/twin.py LANGUAGES), shown by name.
  "English|name": "Inggeris",
  Malay: "Melayu",
  Chinese: "Cina",
  Tamil: "Tamil",
  Arabic: "Arab",
  Indonesian: "Indonesia",
  // The language a reply is in (STYLE_NAMES in lib/voice.ts).
  "Casual Malay": "Bahasa Melayu santai",
  "Kelantan Malay": "Loghat Kelantan",
  "Terengganu Malay": "Loghat Terengganu",
  "Kedah / northern Malay": "Loghat Kedah / Utara",
  "Perak Malay": "Loghat Perak",
  "Pahang Malay": "Loghat Pahang",
  "Negeri Sembilan Malay": "Loghat Negeri Sembilan",
  "Melaka Malay": "Loghat Melaka",
  "Johor Malay": "Loghat Johor",
  "Sabah Malay": "Loghat Sabah",
  "Sarawak Malay": "Loghat Sarawak",

  "As I write (standard)": "Seperti saya menaip (baku)",
  "English, or standard Malay, following you": "Inggeris, atau Melayu baku, mengikut anda",
  "Casual Malay (bahasa pasar)": "Melayu santai (bahasa pasar)",
  "Relaxed everyday Malay: tak, dah, nak, je, la": "Melayu harian yang santai: tak, dah, nak, je, la",

  // Dialect names are the dialects themselves; keep them. Only the hints are translated.
  Kelantan: "Kelantan",
  "Loghat Kelate: ambo, demo, gapo, bakpo": "Loghat Kelate: ambo, demo, gapo, bakpo",
  Terengganu: "Terengganu",
  "Loghat Ganu: mung, bakpe, guane, dok": "Loghat Ganu: mung, bakpe, guane, dok",
  "Kedah / Utara": "Kedah / Utara",
  "Kedah, Perlis, Penang: hang, depa, awat, habaq": "Kedah, Perlis, Pulau Pinang: hang, depa, awat, habaq",
  Perak: "Perak",
  "Teman, mike, kome, deme": "Teman, mike, kome, deme",
  Pahang: "Pahang",
  "Kome, deme, ngape": "Kome, deme, ngape",
  "Negeri Sembilan": "Negeri Sembilan",
  "Loghat Nogori: den, ekau, apo": "Loghat Nogori: den, ekau, apo",
  Melaka: "Melaka",
  "Close to standard, with apo, kito": "Hampir dengan baku, dengan apo, kito",
  Johor: "Johor",
  "Soft -e endings: ape, saye": "Hujung -e lembut: ape, saye",
  Sabah: "Sabah",
  "Sia, nda, bikin, tingu, bah": "Sia, nda, bikin, tingu, bah",
  Sarawak: "Sarawak",
  "Kamek, kitak, sik, polah, nangga": "Kamek, kitak, sik, polah, nangga",
};
