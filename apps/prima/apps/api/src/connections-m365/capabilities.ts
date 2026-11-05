/**
 * Microsoft 365 Connections: the capability and permission matrix (Arisha main review 2 Nov 2026, section B).
 *
 * One source for the screen, Arisha's guidance, the docs and the tests. Every scope here is DELEGATED (the person's
 * own Microsoft identity, via on-behalf-of) and READ-ONLY. A test fails if a write, send or application scope appears.
 * Nothing in this file grants consent, changes the tenant or activates a provider.
 */
export type M365Service = 'outlook' | 'teams' | 'sharepoint';
export const M365_SERVICES: readonly M365Service[] = ['outlook', 'teams', 'sharepoint'];

/** Office staff who sign in with Microsoft. Guards and site devices use the JA app and shared site devices. */
export const M365_ROLES = ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'] as const;

export interface Bilingual { bm: string; en: string }
const t = (bm: string, en: string): Bilingual => ({ bm, en });

export interface M365Capability {
  service: M365Service;
  /** Delegated Microsoft Graph permission(s) requested by on-behalf-of, one per call. Never Mail.Send/ReadWrite. */
  delegatedScopes: { scope: string; usedFor: string; graph: string }[];
  /** Server switches (all off by default). Values are set in approved configuration, never in this repository. */
  switches: string[];
  /** Admin consent / tenant steps Fauzan must approve directly. Listed, never performed by code. */
  tenantSteps: string[];
  /** What Prima itself controls on top of Microsoft. */
  primaControls: string[];
  /** What Microsoft already enforces, so Prima does not duplicate it. */
  microsoftControls: string[];
  /** Things this capability deliberately does not do. */
  boundaries: string[];
  /** Arisha's plain-language guidance (Bahasa Melayu first). */
  why: Bilingual;
  data: Bilingual;
  whereToGetLink: Bilingual;
  whoHelps: Bilingual;
}

export const M365_CAPABILITIES: Readonly<Record<M365Service, M365Capability>> = {
  outlook: {
    service: 'outlook',
    delegatedScopes: [{ scope: 'Mail.ReadBasic', usedFor: 'Connection check: confirms your mailbox answers, without reading any message body.', graph: 'GET /me/mailFolders/inbox?$select=id' }],
    switches: ['M365_CONNECTIONS_ENABLED', 'M365_OUTLOOK_ENABLED', 'M365_OBO_CLIENT_SECRET'],
    tenantSteps: [
      'Add delegated Microsoft Graph Mail.ReadBasic to the Prima API app registration (<application-id>).',
      'Grant admin consent for Mail.ReadBasic in tenant <tenant-id>, or allow user consent for it.',
      'Add the M365_OBO_CLIENT_SECRET credential to the API app (stored as a secret, never in the repository).',
    ],
    primaControls: ['Office role check', 'Microsoft account bound to the Prima staff record by object ID and tenant', 'Status kept per person, never shared', 'Truthful status with expiry', 'Duplicate-click protection', 'Retry-After respected'],
    microsoftControls: ['Sign-in, password and MFA', 'Conditional Access when the tenant has it', 'Mailbox ownership: a person only reaches their own mailbox'],
    boundaries: ['No Mail.Send and no Mail.ReadWrite: staff keep sending and replying in Outlook', 'No message bodies on this page (Mail.ReadBasic excludes them)', 'No switch to application-level Mail.Read; if app-only access is ever needed, Exchange Application RBAC is reviewed first', 'Copying one selected email to an IT job is a separate, already-built feature with its own Mail.Read consent'],
    why: t('Supaya Prima boleh memaut dan memantau emel kerja anda tanpa anda menghantar emel dari Prima. Anda terus menghantar dan membalas dalam Outlook.',
      'So Prima can link to and monitor your work email without sending email from Prima. You keep sending and replying in Outlook.'),
    data: t('Semakan hanya mengesahkan peti mel anda boleh dicapai. Tiada isi emel dibaca atau disimpan.',
      'The check only confirms your mailbox can be reached. No email body is read or stored.'),
    whereToGetLink: t('Tiada pautan diperlukan. Log masuk dengan akaun Microsoft kerja anda.', 'No link needed. Sign in with your work Microsoft account.'),
    whoHelps: t('Meja IT (IT Lead untuk persediaan teknikal). Kebenaran Microsoft untuk organisasi diluluskan oleh CEO.', 'The IT desk (IT Lead for technical setup). Organization-wide Microsoft permission is approved by the CEO.'),
  },
  teams: {
    service: 'teams',
    delegatedScopes: [
      { scope: 'Team.ReadBasic.All', usedFor: 'Connection check: confirms you are a member of the approved team for your company.', graph: 'GET /me/joinedTeams (no query options; only IDs are kept)' },
      { scope: 'Channel.ReadBasic.All', usedFor: 'Channel link check: Microsoft answers only if you can see that channel (private and shared channels need membership).', graph: 'GET /teams/{team-id}/channels/{channel-id}?$select=id,membershipType' },
    ],
    switches: ['M365_CONNECTIONS_ENABLED', 'M365_TEAMS_ENABLED', 'M365_TEAMS_APPROVED_JSON', 'M365_OBO_CLIENT_SECRET'],
    tenantSteps: [
      'Add delegated Team.ReadBasic.All and Channel.ReadBasic.All to the Prima API app registration (<application-id>).',
      'Grant admin consent for both in tenant <tenant-id> (both normally need an administrator).',
      'IT lists each approved team ID with its company in M365_TEAMS_APPROVED_JSON.',
    ],
    primaControls: ['Office role check', 'Team approved for the person\'s own company only', 'Tenant ID in the link must be the organization\'s', 'Status kept per person', 'Duplicate-click protection'],
    microsoftControls: ['Team and channel membership, including private and shared channels', 'Sign-in, password and MFA'],
    boundaries: ['Opening a Teams link, showing status in Prima, and approval evidence are three different things', 'A chat message saying "approved" is not evidence', 'No messages are read or sent', 'Teams Approvals evidence is NOT built: native Approvals runs on Power Automate/Dataverse; the Graph beta approvals API is not production-supported; the Power Automate Approvals connector is being evaluated'],
    why: t('Supaya Prima boleh memaut ke saluran Teams pasukan anda dan menunjukkan status sambungan dengan jujur.', 'So Prima can link to your team\'s Teams channels and show connection status truthfully.'),
    data: t('Hanya ID pasukan dan jenis saluran (standard, peribadi atau dikongsi). Tiada mesej dibaca.', 'Only team IDs and the channel type (standard, private or shared). No messages are read.'),
    whereToGetLink: t('Dalam Teams, klik ... pada saluran, kemudian "Dapatkan pautan ke saluran".', 'In Teams, click ... on the channel, then "Get link to channel".'),
    whoHelps: t('Pemilik pasukan Teams untuk keahlian; meja IT untuk kelulusan pasukan dalam Prima.', 'The Teams team owner for membership; the IT desk for approving the team in Prima.'),
  },
  sharepoint: {
    service: 'sharepoint',
    delegatedScopes: [{ scope: 'Sites.Selected', usedFor: 'Site check and link check: Microsoft answers only for sites IT has granted to Prima AND that you can open.', graph: 'GET /sites/{site-id}?$select=id; for links GET /sites/{host}:/sites/{name}?$select=id and, for a library link, GET /sites/{site-id}/drives?$select=id,webUrl&$top=50' }],
    switches: ['SHAREPOINT_CONNECTION_ENABLED', 'SHAREPOINT_APPROVED_SITES_JSON', 'SHAREPOINT_OBO_CLIENT_SECRET', 'M365_CONNECTIONS_ENABLED'],
    tenantSteps: [
      'Add delegated Sites.Selected to the Prima API app registration (<application-id>) and grant admin consent.',
      'Grant the app access to each approved site (<approved-site-id>) only; no tenant-wide Sites.Read.All.',
      'IT lists each approved site, its companies, its people and its libraries (<approved-library-id>) in SHAREPOINT_APPROVED_SITES_JSON.',
    ],
    primaControls: ['Site approved for the person and ALL of its companies', 'Pasted link host must be an approved organization host', 'No arbitrary URL fetching: only fixed Microsoft Graph addresses are called', 'Status kept per person'],
    microsoftControls: ['Site and library permissions (Prima does not mirror every ACL)', 'Sign-in, password and MFA'],
    boundaries: ['No tenant-wide scanning or cross-company access', 'No write scope, and the /shares resolver (which needs write scope) is not used', 'No preauthenticated downloadUrl is cached or shown', 'Library and file listing stays in the existing SharePoint card'],
    why: t('Setiap jabatan dan syarikat mempunyai SharePoint sendiri. Prima memaut dan memantau proses mereka di sana.', 'Every department and company has its own SharePoint. Prima links to and monitors their process there.'),
    data: t('Hanya ID tapak untuk semakan. Nama fail ditunjuk dalam kad SharePoint apabila anda memintanya.', 'Only the site ID for the check. File names appear in the SharePoint card when you ask for them.'),
    whereToGetLink: t('Buka tapak atau perpustakaan dalam SharePoint dan salin alamat dari pelayar (bukan pautan "Kongsi").', 'Open the site or library in SharePoint and copy the address from the browser (not a "Share" link).'),
    whoHelps: t('Pemilik tapak SharePoint untuk akses; meja IT untuk kelulusan tapak dalam Prima.', 'The SharePoint site owner for access; the IT desk for approving the site in Prima.'),
  },
};

/** Who owns which control (bundle evidence: control-ownership matrix). */
export const M365_CONTROL_OWNERSHIP: readonly { control: string; owner: 'Microsoft' | 'Prima' | 'IT desk' | 'CEO (Fauzan)'; note: string }[] = [
  { control: 'Passwords, MFA, sign-in risk', owner: 'Microsoft', note: 'Not rebuilt in Prima.' },
  { control: 'Conditional Access, Purview', owner: 'Microsoft', note: 'Used when the tenant has them; never a Prima prerequisite.' },
  { control: 'Mailbox, team, channel, site and library permissions', owner: 'Microsoft', note: 'Prima does not mirror ACLs; it asks Microsoft with the person\'s own token.' },
  { control: 'Private and shared channel membership', owner: 'Microsoft', note: 'Channel link check returns not-a-member when Microsoft refuses.' },
  { control: 'Roles and workflow permissions', owner: 'Prima', note: 'Office roles only; approvals stay in Prima workflows.' },
  { control: 'Binding a connection to tenant + object ID + Prima user', owner: 'Prima', note: 'Every check and every stored status is keyed by all three.' },
  { control: 'Status cache isolation and retention', owner: 'Prima', note: 'Per person, memory only, verified status shown for 8 hours, any record dropped after 24 hours or on disconnect.' },
  { control: 'Request version, approver and outcome validation; idempotency', owner: 'Prima', note: 'Teams evidence reader binds payment version, attempt, approver set; not yet connected to a live source.' },
  { control: 'Truthful status', owner: 'Prima', note: 'Connected only after a successful provider check; never from sign-in, a saved link or a setup request.' },
  { control: 'Approved teams and sites lists', owner: 'IT desk', note: 'Configuration, reviewed before activation.' },
  { control: 'Admin consent, app registration changes, secrets, provider activation', owner: 'CEO (Fauzan)', note: 'Direct approval required; not performed by code or by Claude.' },
];
