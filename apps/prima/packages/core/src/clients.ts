/** Client onboarding and offboarding steps (Fauzan, 26 Oct 2026; list proposed). */
export const CLIENT_ONBOARD_STEPS: [string, string][] = [
  ['contract', 'Contract signed'],
  ['survey', 'Site survey and risk assessment'],
  ['order', 'Assignment order or letter of award'],
  ['deploy', 'Deployment plan and guards briefed'],
  ['billing', 'Billing set up in the accounts'],
  ['pdpa', 'PDPA notice and client consent for monitoring products'],
];
export const CLIENT_OFFBOARD_STEPS: [string, string][] = [
  ['notice', 'Termination notice on file'],
  ['handover', 'Site handover letter signed'],
  ['equipment', 'Equipment, keys and documents returned'],
  ['redeploy', 'Guards redeployed'],
  ['final_bill', 'Final invoice issued'],
];

/** How a client gave a rating or a complaint (Fauzan, 2 Nov 2026: client satisfaction monitored). */
export const CLIENT_VIA = ['meeting', 'visit', 'call', 'email', 'form'] as const;
