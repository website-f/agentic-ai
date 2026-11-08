import type { IsoDate } from "./types";
import type { TenderSource } from "./types";
import type { TenderSourceStatus } from "./types";
import { daysBetween } from "./time";


export const TENDER_SOURCE_STATUS_LABEL: Record<TenderSourceStatus, string> = {
  NOT_CHECKED: "Belum disemak (not checked yet)",
  CHECKED: "Disemak (checked)",
  VENDOR_LIMITED:
    "Awam disemak; vendor terhad (public checked, vendor login not reached)",
  PARTIAL: "Separa/dinamik (partly read)",
  ERROR: "Ralat (could not open)",
};

/** Provisional: a site not checked for this many days is due again. */
export const TENDER_SOURCE_DUE_DAYS = 7;

/** Whether a site needs checking today, and why. Errors and partly read pages are retried on the next sweep. */
export function tenderSourceDue(
  s: TenderSource,
  today: IsoDate,
): { due: boolean; why: string } {
  if (!s.active) return { due: false, why: "Not watched" };
  const last = s.checks[0];
  if (!last) return { due: true, why: "Never checked" };
  const age = daysBetween(last.at.slice(0, 10), today);
  if (last.status === "ERROR")
    return { due: true, why: "Last check failed: try again" };
  if (last.status === "PARTIAL")
    return {
      due: true,
      why: "Last check incomplete: finish the pages not read",
    };
  if (age >= TENDER_SOURCE_DUE_DAYS)
    return { due: true, why: `Last checked ${age} days ago` };
  return {
    due: false,
    why: `Checked ${age === 0 ? "today" : `${age} day(s) ago`}`,
  };
}

/** Public procurement pages are https web addresses; anything else is refused. */
export function cleanSourceUrl(v: string): string | null {
  const t = v.trim();
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString().slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * The starter list from the Director Office's sweep of 4 Nov 2026: public buyer and portal pages only, no results.
 * The Director Office loads it once, then keeps it up to date in Prima.
 */
export const TENDER_SOURCE_STARTER: { buyer: string; urls: string[] }[] = [
  {
    buyer: "KWSP",
    urls: [
      "https://www.kwsp.gov.my/en/corporate/procurement/tenders",
      "https://www.kwsp.gov.my/en/corporate/procurement/suppliers",
    ],
  },
  { buyer: "PNB", urls: ["https://www.pnb.com.my/en/e-procurement-en"] },
  {
    buyer: "KWAP",
    urls: [
      "https://www.kwap.gov.my/corporate/procurement/",
      "https://www.kwap.gov.my/corporate/notice-of-tender/",
      "https://vms.kwap.my/VMS/",
    ],
  },
  {
    buyer: "Tabung Haji",
    urls: ["https://www.tabunghaji.gov.my/bm/portal-pembekal-th"],
  },
  { buyer: "LTAT", urls: ["https://www.ltat.gov.my/"] },
  { buyer: "Khazanah", urls: ["https://www.khazanah.com.my/"] },
  {
    buyer: "PETRONAS",
    urls: [
      "https://www.petronas.com/suppliers/licensing-procurement-malaysia",
      "https://www.petronas.com/bm/partner-us/licensing-procurement-malaysia",
    ],
  },
  {
    buyer: "TNB",
    urls: ["https://www.tnb.com.my/doing-business-with-tnb/suppliers/"],
  },
  {
    buyer: "TM",
    urls: [
      "https://www.tm.com.my/business-with-tm/tender-notices",
      "https://www.tm.com.my/business-with-tm/registration",
    ],
  },
  { buyer: "MRT Corp", urls: ["https://www.mymrt.com.my/tenders/"] },
  { buyer: "Prasarana", urls: ["https://www.prasarana.com.my/tenders/"] },
  {
    buyer: "KTMB",
    urls: [
      "https://www.ktmb.com.my/Procurement.html",
      "https://form.ktmb.com.my/eproc/eProc/index.php?module=main",
    ],
  },
  { buyer: "BSN", urls: ["https://www.bsn.com.my/page/tenders-advertisement"] },
  {
    buyer: "Bank Rakyat",
    urls: [
      "https://www.bankrakyat.com.my/procurement",
      "https://www.bankrakyat.com.my/procurement/faq",
      "https://www.bankrakyat.com.my/procurement/become-our-vendor",
    ],
  },
  {
    buyer: "UDA",
    urls: [
      "https://www.uda.com.my/contact-us/request-for-tender",
      "https://www.uda.com.my/contact-us/vendor-registration-guidelines",
    ],
  },
  {
    buyer: "Senai Airport",
    urls: ["https://www.senaiairport.com/Corporate/Procurement/Tender-Notice"],
  },
  {
    buyer: "ePerolehan",
    urls: ["https://www.eperolehan.gov.my/quotation-tender-notice"],
  },
  {
    buyer: "MyProcurement",
    urls: ["https://myprocurement.treasury.gov.my/advertisements/tender"],
  },
  {
    buyer: "Selangor (tender.selangor.my)",
    urls: ["https://tender.selangor.my/"],
  },
  { buyer: "Pulau Pinang (sysP)", urls: ["https://ep.penang.gov.my/"] },
  { buyer: "Melaka STOM", urls: ["https://stom.melaka.gov.my/"] },
  {
    buyer: "Sabah JTU",
    urls: [
      "https://eservice.hq.jtu.my/eSebutHarga/index.cfm?action=Main&id=26P108&section=Home",
    ],
  },
  { buyer: "FAMA", urls: ["https://www.fama.gov.my/utama"] },
  { buyer: "LHDNM", urls: ["https://www.hasil.gov.my/perolehan/e-perolehan/"] },
  {
    buyer: "Sarawak eTender",
    urls: [
      "https://etendernotice.sarawak.gov.my/etender/public/public_tender_list.jsp?current_index=0",
    ],
  },
  { buyer: "Perlis", urls: ["https://perlis.gov.my/"] },
  { buyer: "Kelantan", urls: ["https://kelantan.gov.my/index.php/utama"] },
  { buyer: "Kedah PDT", urls: ["https://webpdt.kedah.gov.my/lelongan-2-2-2/"] },
];