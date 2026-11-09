/** P92: emailed sign-in passwords (api/routers/signin_mail.py): the owner's sender setting, the
 * Members page's sending, and the sign-in page's "Email me a sign-in password". */

export interface SystemMail {
  enabled: boolean;
  address: string;
  from_name: string;
  first_login: boolean;
  forgot_password: boolean;
  microsoft_app: boolean;
  problem: string | null;
  setup_doc: string;
}

export type SystemMailIn = Pick<SystemMail, "enabled" | "address" | "from_name" | "first_login" | "forgot_password">;

export interface BulkJob {
  state: "running" | "done" | "stopped";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  skipped_disabled: number;
  skipped_no_email: number;
  skipped_recent: number;
  skipped_signed_in: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface SigninEmails {
  sender_ready: boolean;
  problem: string | null;
  never_signed_in: number;
  job: BulkJob | null;
}

export const systemMailKey = ["settings", "system-mail"] as const;
export const signinEmailsKey = ["members", "signin-emails"] as const;
export const ssoKey = ["auth", "sso"] as const;

export interface SsoOptions {
  microsoft: boolean;
  email_signin?: boolean;
}

/** How far a bulk send got (people handled so far, of all). */
export function bulkDone(job: BulkJob): number {
  return job.sent + job.failed + job.skipped;
}

/** About how long the rest takes: one email about every 2 seconds. */
export function bulkMinutesLeft(job: BulkJob): number {
  return Math.max(1, Math.ceil(((job.total - bulkDone(job)) * 2.5) / 60));
}

export const SENDER_DEFAULTS: SystemMailIn = { enabled: false, address: "", from_name: "No Reply", first_login: true, forgot_password: true };

/** What the owner's form starts from. */
export function formFrom(s: SystemMail | undefined): SystemMailIn {
  if (!s) return SENDER_DEFAULTS;
  return { enabled: s.enabled, address: s.address, from_name: s.from_name || "No Reply", first_login: s.first_login, forgot_password: s.forgot_password };
}

/** The address looks like a full email address (the server checks it again). */
export function plausibleAddress(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/.test(v.trim());
}

/** The PowerShell for step 2 of the setup (Exchange Online RBAC for Applications), filled in
 * with the sender address. Not translated: it is typed into PowerShell as it is. */
export function rbacScript(address: string): string {
  const mailbox = address.trim() || "noreply@yourcompany.com";
  return [
    "Install-Module ExchangeOnlineManagement   # once",
    "Connect-ExchangeOnline",
    `New-ManagementScope -Name "Agentic Office sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '${mailbox}'"`,
    'New-ServicePrincipal -AppId "<Application (client) ID>" -ObjectId "<Object ID from Enterprise applications>" -DisplayName "Agentic Office"',
    'New-ManagementRoleAssignment -App "<Application (client) ID>" -Role "Application Mail.Send" -CustomResourceScope "Agentic Office sender"',
    `Test-ServicePrincipalAuthorization -Identity "<Application (client) ID>" -Resource "${mailbox}"`,
  ].join("\n");
}
