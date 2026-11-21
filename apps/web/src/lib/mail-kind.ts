/** P122 (Fitri, 21 Nov 2026: "users connect their private email, which is also Outlook, and
 * their work email uses the company domain; they must be separated"): which tab of the
 * Microsoft 365 page a mailbox belongs on, Work or Personal.
 *
 * Microsoft accounts come with `kind` from the server (it also knows the company's Microsoft
 * tenant). Other email accounts (Gmail, IMAP) are Work only when their address is on one of the
 * company's domains (`company_domains`, see apps/api/agentic/microsoft/domains.py); free mail
 * (gmail.com, yahoo.*, outlook.com, hotmail.* ...) is always Personal. */
export type MailKind = "work" | "personal";

const CONSUMER = new Set([
  "outlook.com", "msn.com", "passport.com", "gmail.com", "googlemail.com", "ymail.com", "rocketmail.com",
  "aol.com", "aim.com", "icloud.com", "me.com", "mac.com", "zoho.com", "zohomail.com", "gmx.com", "gmx.net",
  "gmx.de", "mail.com", "yandex.com", "yandex.ru", "ya.ru", "proton.me", "protonmail.com", "fastmail.com", "tm.net.my",
]);
const CONSUMER_BRANDS = new Set(["hotmail", "live", "outlook", "yahoo", "windowslive"]);

export function domainOf(email: string | null | undefined): string {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at < 0 ? "" : e.slice(at + 1).replace(/\.$/, "");
}

export function isConsumerDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return !!d && (CONSUMER.has(d) || CONSUMER_BRANDS.has(d.split(".")[0] ?? ""));
}

/** Work when the address is on a company domain (and not free mail); else Personal. */
export function kindOfEmail(email: string, companyDomains: readonly string[]): MailKind {
  const d = domainOf(email);
  return d && !isConsumerDomain(d) && companyDomains.includes(d) ? "work" : "personal";
}
