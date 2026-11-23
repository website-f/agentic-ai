/**
 * Every link between Prima and Microsoft 365 that is built, in one list (Fauzan, 23 Nov 2026: "Make sure we fully use
 * the integration between prima secure and microsoft 365"). The server reports for each one whether its settings are
 * on; the Microsoft use board shows the list to IT and group leaders with what each link gives staff and what is still
 * needed to switch it on. A link is On only when its own settings are complete on the server: an entered address,
 * a saved request or a successful Prima sign-in is never a Connected claim. Turning a link on stays a separate,
 * owner-approved step (tenant consent, secrets, database modules).
 */
export type M365LinkId =
  | 'entra_signin'
  | 'alerts'
  | 'connections'
  | 'sharepoint_proof'
  | 'job_email'
  | 'teams_approvals'
  | 'planner'
  | 'powerbi'
  | 'website_requests'
  | 'usage_board';

export type M365LinkState = 'on' | 'partly' | 'off';

export interface M365Link {
  id: M365LinkId;
  title: string;
  /** What staff get from it, BM then English. */
  bm: string;
  en: string;
  /** What is still needed before it can be switched on (plain words, no secrets or tenant values). */
  needs: string;
  /** The repository guide with the exact steps. */
  doc: string | null;
}

export const M365_LINKS: readonly M365Link[] = [
  {
    id: 'entra_signin',
    title: 'Sign in with Microsoft',
    bm: 'Staf masuk ke Prima dengan akaun Microsoft kerja. Tiada kata laluan Prima lagi.',
    en: 'Staff sign in to Prima with their work Microsoft account. No separate Prima password.',
    needs: 'Two Entra app registrations (web app and API), then IT links each staff member to their Microsoft account.',
    doc: 'docs/MICROSOFT_SIGN_IN.md',
  },
  {
    id: 'alerts',
    title: 'Alerts to Teams, e-mail and the Prima bell',
    bm: 'Amaran kerja sampai di Teams, e-mel dan loceng Prima, supaya tiada yang terlepas.',
    en: 'Work alerts arrive in Teams, e-mail and the Prima bell, so nothing is missed.',
    needs: 'One shared sending mailbox with Mail.Send limited to it, a Teams workflow per department channel, and the alert record table installed.',
    doc: 'docs/ALERTS_TEAMS_EMAIL.md',
  },
  {
    id: 'connections',
    title: 'Outlook, Teams and SharePoint check',
    bm: 'Setiap staf boleh semak sendiri bahawa Outlook, pasukan Teams dan laman SharePoint mereka bersambung.',
    en: 'Each person can check that their Outlook, Teams teams and SharePoint sites are connected.',
    needs: 'Read-only delegated permissions with admin consent, the approved team and site lists, and the connection secret.',
    doc: 'docs/M365_CONNECTIONS.md',
  },
  {
    id: 'sharepoint_proof',
    title: 'SharePoint files as proof',
    bm: 'Bukti kerja diberi sebagai pautan fail SharePoint, tanpa salinan dan tanpa muat naik semula.',
    en: 'Work proof is given as a SharePoint file link, with no copies and no re-uploading.',
    needs: "IT sets the group's SharePoint address so only the group's own files are accepted.",
    doc: 'docs/SHAREPOINT_PROOF_LINKS.md',
  },
  {
    id: 'job_email',
    title: 'Attach an Outlook e-mail to a job',
    bm: 'Staf pilih satu e-mel Outlook dan lampirkan pada kerja, supaya rekod lengkap tanpa forward.',
    en: 'Staff pick one Outlook e-mail and attach it to a job, so the record is complete without forwarding.',
    needs: 'Delegated Mail.Read with admin consent, the preview secret, and the job e-mail table installed.',
    doc: 'docs/JOB_EMAIL_MONDAY_IMPLEMENTATION.md',
  },
  {
    id: 'teams_approvals',
    title: 'Finance approvals in Teams',
    bm: 'Pengarah Kewangan atau CEO boleh lulus bayaran dalam Teams, dan Prima semak keputusannya.',
    en: 'The Finance Director or CEO can approve payments in Teams, and Prima checks the result.',
    needs: 'The Teams approval flow, its protected SharePoint results list and a read-only grant to that list.',
    doc: 'docs/TEAMS_APPROVALS_INTEGRATION.md',
  },
  {
    id: 'planner',
    title: 'Planner tasks',
    bm: 'Tugas kerja jarak jauh dan cawangan selari dengan Microsoft Planner.',
    en: 'Remote and branch work tasks stay in step with Microsoft Planner.',
    needs: 'Planner changes into Prima are built: a signed sender with its own feed key and secret. Sending Prima tasks out to Planner is not built yet.',
    doc: 'docs/M365_PLANNER_LINK.md',
  },
  {
    id: 'powerbi',
    title: 'Power BI reports',
    bm: 'Ketua jabatan yang diluluskan buka laporan Power BI dari Prima.',
    en: 'Approved department heads open Power BI reports from Prima.',
    needs: 'Power BI licences for the people the CEO authorises, the approved report list and delegated consent.',
    doc: 'docs/STAFF_EMAIL_POWER_BI.md',
  },
  {
    id: 'website_requests',
    title: 'Website requests list in SharePoint',
    bm: 'Permintaan kemas kini laman web dibaca dari senarai SharePoint.',
    en: 'Website update requests are read from a SharePoint list.',
    needs: 'A read-only app with access to the one requests list, and the list address.',
    doc: 'docs/M365_WEBSITE_REQUESTS_LIST.md',
  },
  {
    id: 'usage_board',
    title: 'Microsoft use board',
    bm: 'Setiap staf nampak apa yang belum disediakan atau digunakan dalam Microsoft 365, dengan cara buat.',
    en: 'Each person sees what is not yet set up or used in Microsoft 365, with how to do it.',
    needs: 'Read-only report permissions with admin consent, names shown in reports after the PDPA officer agrees, and the usage table installed.',
    doc: 'docs/M365_USAGE_BOARD.md',
  },
];
