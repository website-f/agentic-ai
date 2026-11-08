import { addMinutes } from "./time";
import { toMs } from "./time";
import { RULES } from "./rules";
import type { IsoDateTime } from "./types";
import type { PoliceHelp } from "./types";
import type { PoliceHelpKind } from "./types";
import type { PoliceHelpReason } from "./types";
import type { PoliceHelpStep } from "./types";
import type { Severity } from "./types";


export const POLICE_HELP_KIND_LABEL: Record<
  PoliceHelpKind,
  { bm: string; en: string }
> = {
  PHONE_CALL: { bm: "Polis menelefon", en: "Police phoned us" },
  VISIT_NOW: {
    bm: "Polis sedang datang / sudah tiba",
    en: "Police are coming now or already here",
  },
  VISIT_BOOKED: {
    bm: "Polis akan datang pada tarikh ditetapkan",
    en: "Police will visit on a set date",
  },
};

export const POLICE_HELP_REASON_LABEL: Record<
  PoliceHelpReason,
  { bm: string; en: string }
> = {
  ARMOURY_CHECK: {
    bm: "Pemeriksaan bilik kebal / senjata api",
    en: "Armoury or firearm check",
  },
  DOCUMENT_CHECK: {
    bm: "Semakan dokumen atau lesen",
    en: "Document or licence check",
  },
  FIREARM_QUERY: {
    bm: "Pertanyaan tentang senjata api atau pengawal bersenjata",
    en: "Question about a firearm or armed guard",
  },
  OTHER: { bm: "Lain-lain", en: "Other" },
};

export const POLICE_HELP_STEP_LABEL: Record<PoliceHelpStep, string> = {
  asked: "Waiting for Arms Control",
  assigned: "Helper assigned",
  helped: "Helped, company to confirm",
  confirmed: "Confirmed by the company",
  withdrawn: "Withdrawn",
};

/** Response clock on the case: a visit happening now is P1, a phone call P2, a booked visit P3. */
export function policeHelpSeverity(kind: PoliceHelpKind): Severity {
  return kind === "VISIT_NOW" ? "P1" : kind === "PHONE_CALL" ? "P2" : "P3";
}

/** When Arms Control should have assigned a helper (rule ARMS-POLICE-HELP, approved 3 Nov 2026). */
export function policeHelpAssignBy(
  h: Pick<PoliceHelp, "kind" | "expectedAt">,
  askedAt: IsoDateTime,
): IsoDateTime {
  const r = RULES.policeHelp.value;
  if (h.kind === "VISIT_NOW") return addMinutes(askedAt, r.visitNowMin);
  if (h.kind === "PHONE_CALL") return addMinutes(askedAt, r.phoneCallMin);
  const before = h.expectedAt
    ? addMinutes(h.expectedAt, -r.bookedHoursBefore * 60)
    : askedAt;
  // A visit booked for tomorrow morning still gets a helper within the phone-call time, never "already late".
  return toMs(before) > toMs(askedAt)
    ? before
    : addMinutes(askedAt, r.phoneCallMin);
}

export function policeHelpLate(
  h: PoliceHelp,
  askedAt: IsoDateTime,
  now: IsoDateTime,
): boolean {
  return h.step === "asked" && toMs(now) > toMs(policeHelpAssignBy(h, askedAt));
}

export interface GuideLine {
  bm: string;
  en: string;
}

export interface PoliceHelpGuide {
  title: GuideLine;
  note: GuideLine;
  sections: { id: string; title: GuideLine; lines: GuideLine[] }[];
}

/**
 * What staff say and show when the police call or come to check the armoury. Malay first, English below (the same
 * pattern as the rent reminders). Each line is a plain instruction; nothing here runs a step or grants a permission.
 */
export const POLICE_HELP_GUIDE: PoliceHelpGuide = {
  title: {
    bm: "Panduan bila polis menelefon atau datang",
    en: "Guide for a police call or visit",
  },
  note: {
    bm: "Panduan ini disediakan daripada peraturan senjata dalam Prima (Akta Senjata 1960, Pekeliling Agensi Persendirian KDN Bil. 1/2006). Ia bukan nasihat undang-undang. Ikut arahan Kawalan Senjata.",
    en: "Prepared from the arms rules in Prima (Arms Act 1960, KDN Private Agencies Circular 1/2006). Not legal advice. Follow what Arms Control tells you.",
  },
  sections: [
    {
      id: "first",
      title: { bm: "Langkah pertama", en: "First steps" },
      lines: [
        {
          bm: "Bertenang dan bersopan. Catat nama, pangkat, nombor badan dan balai pegawai, nombor telefon, serta apa yang mereka mahu semak.",
          en: "Stay calm and polite. Write down the officer's name, rank, ID number and station, their phone number and what they want to check.",
        },
        {
          bm: 'Tekan "Minta bantuan" dalam Prima dengan segera. Kawalan Senjata akan menelefon anda dan menghantar seseorang.',
          en: 'Press "Ask for help" in Prima straight away. Arms Control will call you and send someone.',
        },
        {
          bm: "Jangan menolak atau melambatkan pemeriksaan yang sah. Anda boleh bertanya dengan sopan sama ada pegawai boleh menunggu sebentar untuk wakil syarikat.",
          en: "Do not refuse or delay a lawful check. You may politely ask whether the officer can wait a short time for the company representative.",
        },
      ],
    },
    {
      id: "say",
      title: { bm: "Apa yang boleh dikatakan", en: "What you can say" },
      lines: [
        {
          bm: '"Selamat pagi/petang Tuan/Puan. Saya [nama], [jawatan] di [syarikat]. Boleh saya tahu nama, pangkat dan balai Tuan/Puan? Pegawai Kawalan Senjata kami akan bercakap dengan Tuan/Puan sebentar lagi."',
          en: '"Good morning/afternoon, sir/madam. I am [name], [job] at [company]. May I have your name, rank and station? Our Arms Control officer will speak with you shortly."',
        },
        {
          bm: 'Jika tidak pasti jawapan: "Saya tidak pasti. Saya akan semak dengan pegawai Kawalan Senjata kami dan maklumkan segera." Jangan meneka.',
          en: 'If you are not sure of an answer: "I am not sure. I will check with our Arms Control officer and tell you right away." Never guess.',
        },
        {
          bm: '"Boleh Tuan/Puan bercakap dengan pegawai kami di telefon?" Berikan telefon kepada pembantu Kawalan Senjata jika mereka sudah dihubungi.',
          en: '"Would you like to speak with our officer on the phone?" Hand the phone to the Arms Control helper once they are on the line.',
        },
      ],
    },
    {
      id: "show",
      title: {
        bm: "Dokumen untuk pemeriksaan bilik kebal",
        en: "Documents for an armoury check",
      },
      lines: [
        {
          bm: "Lesen agensi persendirian syarikat (KDN).",
          en: "The company's private agency licence (KDN).",
        },
        {
          bm: "Lesen senjata api bagi setiap senjata, atas nama orang yang dinamakan, serta permit membawa yang dikeluarkan.",
          en: "The firearm licence for each firearm, in the nominated person's name, and the permits to carry that were issued.",
        },
        {
          bm: "Kelulusan polis untuk bilik kebal atau peti besi.",
          en: "Police approval for the strongroom or safe.",
        },
        {
          bm: "Buku daftar keluar masuk senjata api yang terkini, sama dengan daftar dalam Prima, dan kiraan terakhir yang ditandatangani.",
          en: "The up-to-date firearm in-and-out register book, matching the Prima register, and the last signed count.",
        },
        {
          bm: "Rekod peluru (diterima, dikeluarkan, dipulangkan, baki).",
          en: "The ammunition record (received, issued, returned, balance).",
        },
        {
          bm: "Senarai pengawal yang dibenarkan membawa senjata dan rekod latihan menembak (sekurang-kurangnya dua kali setahun).",
          en: "The list of guards authorised to carry and their range practice records (at least twice a year).",
        },
        {
          bm: "Penyata tahunan senjata api terakhir kepada KDN.",
          en: "The latest annual firearm return to KDN.",
        },
        {
          bm: "Laporan polis bagi senjata atau peluru yang hilang, jika ada (dalam 14 hari).",
          en: "Police reports for any lost firearm or ammunition, if any (within 14 days).",
        },
      ],
    },
    {
      id: "during",
      title: { bm: "Semasa pemeriksaan", en: "During the check" },
      lines: [
        {
          bm: "Hanya pemegang lesen bilik kebal dan Amra (penjaga stor senjata) yang membuka bilik kebal.",
          en: "Only the vault licence holder and the Amra (armoury keeper) open the vault.",
        },
        {
          bm: "Jika polis mengambil senjata, peluru atau dokumen, minta resit atau akuan bertulis dan ambil gambarnya.",
          en: "If the police take any firearm, ammunition or document, ask for a written receipt or acknowledgement and photograph it.",
        },
        {
          bm: "Baca sebelum menandatangani. Jika tidak pasti, hubungi Kawalan Senjata semasa pegawai masih ada.",
          en: "Read before you sign. If unsure, call Arms Control while the officer is still there.",
        },
      ],
    },
    {
      id: "after",
      title: { bm: "Selepas pemeriksaan", en: "After the check" },
      lines: [
        {
          bm: "Ambil gambar muka surat buku daftar yang ditandatangani polis dan apa-apa notis yang diberikan. Kawalan Senjata merekodkannya dalam Prima.",
          en: "Photograph the register book page the police signed and any notice they gave. Arms Control records it in Prima.",
        },
        {
          bm: "Sahkan dalam Prima bahawa bantuan diterima, atau hantar balik kepada Kawalan Senjata dengan sebab.",
          en: "Confirm in Prima that you got the help, or send it back to Arms Control with the reason.",
        },
      ],
    },
  ],
};