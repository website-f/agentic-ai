import { SOPS_EQUIP } from './areas/equip';
import { SOPS_GOV } from './areas/gov';
import { SOPS_IT } from './areas/it';
import { SOPS_MONEY } from './areas/money';
import { SOPS_OPS } from './areas/ops';
import { SOPS_PEOPLE } from './areas/people';
import type { Sop } from './types';

/** P121: every SOP and workflow, in the order of the home screen's apps (see nav-catalog.ts). */
export const SOPS: Sop[] = [...SOPS_OPS, ...SOPS_EQUIP, ...SOPS_PEOPLE, ...SOPS_MONEY, ...SOPS_GOV, ...SOPS_IT];

export const sopById = (id: string): Sop | undefined => SOPS.find((s) => s.id === id);
