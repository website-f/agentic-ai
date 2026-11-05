// Combined merge (R20): every department's guide cards join the shared guide (GET /api/org/guide), as each file says.
import { registerGuideCards, type GuideCardSpec } from './guide-cards';
import { ACT_GUIDE_CARDS } from './act-guide-cards';
import { CENTRAL_ADMIN_GUIDE_SPECS } from './central-admin-guide';
import { FINANCE_GUIDE_CARD_SPECS } from './finance-guide-cards';
import { HR_GUIDE_CARDS } from './hr-guide-cards';
import { OFFICE_GUIDE } from './office-guide';

const DEPARTMENT_GUIDES: Record<string, GuideCardSpec[]> = {
  act: ACT_GUIDE_CARDS,
  central_admin: CENTRAL_ADMIN_GUIDE_SPECS,
  finance: FINANCE_GUIDE_CARD_SPECS,
  hr: HR_GUIDE_CARDS,
  company_office: OFFICE_GUIDE,
};
for (const cards of Object.values(DEPARTMENT_GUIDES)) registerGuideCards(cards);
/** The departments whose cards are in the shared guide. */
export const REGISTERED_DEPARTMENT_GUIDES = Object.keys(DEPARTMENT_GUIDES);
