// Foreign workers (Fitri package E8 / A4, approved by Fauzan 11 Nov 2026): hostels kept in Prima by FWM, the hostel
// check-out memo, and the permit task while a worker is on long SOCSO medical leave. Pure helpers; the service checks
// who may act.
import type { Credential, FwPaper, HostelStay, IsoDate, SocsoClaim } from './types';
import { addDays, daysBetween } from './time';

export type HostelCheckOutReason = 'REPATRIATED' | 'MOVED_HOSTEL' | 'TRANSFERRED' | 'RESIGNED' | 'ABSCONDED' | 'OTHER';

export const HOSTEL_CHECKOUT_REASONS: Record<HostelCheckOutReason, { en: string; ms: string }> = {
  REPATRIATED: { en: 'Going home (repatriation)', ms: 'Pulang ke negara asal' },
  MOVED_HOSTEL: { en: 'Moved to another hostel', ms: 'Berpindah ke asrama lain' },
  TRANSFERRED: { en: 'Transferred to another group company', ms: 'Dipindahkan ke syarikat lain dalam kumpulan' },
  RESIGNED: { en: 'Left employment', ms: 'Berhenti kerja' },
  ABSCONDED: { en: 'Did not return (reported to FWM)', ms: 'Tidak pulang (dilaporkan kepada FWM)' },
  OTHER: { en: 'Other', ms: 'Lain-lain' },
};

/** What FWM records when a worker leaves a hostel. */
export interface HostelCheckOutMemo {
  on: IsoDate;
  reason: HostelCheckOutReason;
  keysReturned: boolean;
  /** Room and items as found, in FWM's words. */
  roomCondition: string;
  /** Electricity and water for the part month are worked out (utility excess) before the worker goes. */
  utilitiesSettled: boolean;
  /** Belongings left behind, or "none". */
  belongings: string;
  note: string;
  by: string;
  byId: string;
  at: string;
  /** Open points HR or the company must close (keys, utilities, belongings). */
  openPoints: string[];
  /** The memo text, English and Malay, for the worker's file. */
  text: { en: string; ms: string };
}

/** The open points and the memo text from what FWM recorded. */
export function hostelCheckOutMemo(i: {
  hostelName: string;
  personName: string;
  staffNo: string;
  from: IsoDate;
  on: IsoDate;
  reason: HostelCheckOutReason;
  keysReturned: boolean;
  roomCondition: string;
  utilitiesSettled: boolean;
  belongings: string;
}): { openPoints: string[]; text: { en: string; ms: string } } {
  const openPoints: string[] = [];
  if (!i.keysReturned) openPoints.push('Keys not returned');
  if (!i.utilitiesSettled) openPoints.push('Utility excess for the part month not yet worked out');
  const left = i.belongings.trim();
  if (left && !/^(none|tiada|-)$/i.test(left)) openPoints.push(`Belongings left: ${left}`);
  const r = HOSTEL_CHECKOUT_REASONS[i.reason];
  const nights = Math.max(0, daysBetween(i.from, i.on));
  const en = [
    `Hostel check-out memo: ${i.hostelName}`,
    `Worker: ${i.personName} (${i.staffNo})`,
    `Stayed from ${i.from} to ${i.on} (${nights} nights). Reason: ${r.en}.`,
    `Keys returned: ${i.keysReturned ? 'yes' : 'NO'}. Utilities worked out: ${i.utilitiesSettled ? 'yes' : 'NO'}.`,
    `Room as found: ${i.roomCondition.trim() || 'not stated'}. Belongings left: ${left || 'none'}.`,
    openPoints.length ? `Still open: ${openPoints.join('; ')}.` : 'Nothing left open.',
  ].join('\n');
  const ms = [
    `Memo keluar asrama: ${i.hostelName}`,
    `Pekerja: ${i.personName} (${i.staffNo})`,
    `Menginap dari ${i.from} hingga ${i.on} (${nights} malam). Sebab: ${r.ms}.`,
    `Kunci dipulangkan: ${i.keysReturned ? 'ya' : 'TIDAK'}. Utiliti dikira: ${i.utilitiesSettled ? 'ya' : 'TIDAK'}.`,
    `Keadaan bilik: ${i.roomCondition.trim() || 'tidak dinyatakan'}. Barang ditinggalkan: ${left || 'tiada'}.`,
    openPoints.length ? `Masih terbuka: ${openPoints.length} perkara.` : 'Tiada perkara terbuka.',
  ].join('\n');
  return { openPoints, text: { en, ms } };
}

/** A worker is in one hostel at a time: an open stay elsewhere must be checked out first. */
export function openStayOf(stays: HostelStay[], personId: string, on: IsoDate): HostelStay | null {
  return stays.find((s) => s.personId === personId && s.from <= on && (!s.to || s.to >= on)) ?? null;
}

/** Proposed (owner may change): SOCSO MC of this many days or more counts as long. */
export const LONG_MC_DAYS = 14;
/** Proposed: a paper expiring within this many days after the MC ends needs a plan now. */
export const LONG_MC_PERMIT_WINDOW_DAYS = 60;

const PERMIT_PAPERS: FwPaper[] = ['PLKS_PERMIT', 'PASSPORT', 'FOMEMA', 'FW_INSURANCE'];

/**
 * A worker on a long SOCSO MC today whose permit, passport, FOMEMA or insurance expires before the MC ends or soon
 * after: FWM must plan the renewal with HR (the worker cannot go to an errand while on MC). Medical details never
 * leave the SOCSO claim; only the MC end date is used.
 */
export function longMcPermitTask(claims: Pick<SocsoClaim, 'id' | 'personId' | 'status' | 'mcs'>[], creds: Pick<Credential, 'type' | 'expiresOn'>[], today: IsoDate): { claimId: string; mcUntil: IsoDate; mcDays: number; papers: { paper: FwPaper; expiresOn: IsoDate; beforeMcEnds: boolean }[] } | null {
  for (const c of claims) {
    if (c.status === 'CLOSED' || c.status === 'REJECTED') continue;
    const current = c.mcs.filter((m) => m.from <= today && m.to >= today);
    if (!current.length) continue;
    // The MC run: from the earliest MC touching today's run to the last one joined to it.
    const sorted = [...c.mcs].sort((a, b) => a.from.localeCompare(b.from));
    let from = current[0].from;
    let to = current[0].to;
    for (const m of sorted) if (m.from <= addDays(to, 1) && m.to >= from) {
      if (m.from < from) from = m.from;
      if (m.to > to) to = m.to;
    }
    const mcDays = daysBetween(from, to) + 1;
    if (mcDays < LONG_MC_DAYS) continue;
    const limit = addDays(to, LONG_MC_PERMIT_WINDOW_DAYS);
    const papers = creds
      .filter((x) => PERMIT_PAPERS.includes(x.type as FwPaper) && x.expiresOn && x.expiresOn <= limit)
      .map((x) => ({ paper: x.type as FwPaper, expiresOn: x.expiresOn!, beforeMcEnds: x.expiresOn! <= to }))
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    if (papers.length) return { claimId: c.id, mcUntil: to, mcDays, papers };
  }
  return null;
}
