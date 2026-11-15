import type { User } from "./types";
import { registerWall } from "./walls";

/**
 * Part N4: only the CEO adds a company to the company list. The database wall of the same name (module company-add-v1)
 * lets the insert through for him alone.
 */
export function holdsCompanyAdd(user: User): boolean {
  return !user.integration && user.opsTier === 'ceo' && (user.role === 'director' || user.role === 'pwvsb_officer');
}
registerWall('company_add', holdsCompanyAdd);
