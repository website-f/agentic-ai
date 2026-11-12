/**
 * P100 (newb): the calls for Fauzan's 11 Nov 2026 builds handled together: E6 moving vehicles between group companies,
 * E7 CMS sign-in, J1 the client portal, J5 guard sign-ins in bulk and J6 each person's alert choices. Implemented in
 * http.ts and demo.ts (blocks marked "P100 newb").
 */
import type { PrimaService } from '@prima/core';

type R<K extends keyof PrimaService> = PrimaService[K] extends (...a: never[]) => Promise<infer T> ? T : never;

/** E6: vehicle moves between companies (ask, approve, hand over). */
export type VehicleTransferBoard = R<'vehicleTransferBoard'>;
export interface VehicleHandoverInput {
  on: string;
  odometerKm: number;
  handedBy: string;
  receivedBy: string;
  condition: string;
  items: string[];
  note?: string;
}

/** E7: opening the CMS console with the Prima sign-in. */
export interface CmsConsoleStatus {
  on: boolean;
  url: string | null;
  may: boolean;
}

/** J1: the client portal desk (OM manages, company manager monitors, COO oversees). */
export type ClientPortalDesk = R<'clientPortalDesk'> & { on: boolean };
export interface ClientPortalOpened {
  user: Awaited<ReturnType<PrimaService['openClientPortal']>>['user'];
  code: string;
  /** The personal link to give the client; null when the portal is off (or in the test version). */
  url: string | null;
}

export interface NewbClient {
  clientPortalDesk(): Promise<ClientPortalDesk>;
  openClientPortal(clientId: string, input: { name: string; post: string }): Promise<ClientPortalOpened>;
  resetClientPortal(clientId: string, portalUserId: string, reason: string): Promise<ClientPortalOpened>;
  closeClientPortal(clientId: string, portalUserId: string, reason: string): Promise<unknown>;
  cmsConsole(): Promise<CmsConsoleStatus>;
  cmsConsoleSignIn(): Promise<{ url: string; expiresInS: number; name: string }>;
  vehicleTransferBoard(): Promise<VehicleTransferBoard>;
  requestVehicleTransfer(input: { vehicleId: string; toCompanyId: string; wantedOn: string; reason: string }): Promise<unknown>;
  decideVehicleTransfer(id: string, approve: boolean, note: string): Promise<unknown>;
  handOverVehicleTransfer(id: string, input: VehicleHandoverInput): Promise<unknown>;
  cancelVehicleTransfer(id: string, reason: string): Promise<unknown>;
}

/** The in-browser demo's writes for these calls (demo.ts apply() hands them here first). */
export function applyNewb(svc: PrimaService, u: import('@prima/core').User, op: string, a: never[]): Promise<unknown> | null {
  switch (op) {
    case 'openClientPortal':
      return svc.openClientPortal(u, a[0], a[1]).then((r) => ({ user: r.user, code: r.code, url: null }));
    case 'resetClientPortal':
      return svc.resetClientPortal(u, a[0], a[1], a[2]).then((r) => ({ user: r.user, code: r.code, url: null }));
    case 'closeClientPortal':
      return svc.closeClientPortal(u, a[0], a[1], a[2]);
    case 'requestVehicleTransfer':
      return svc.requestVehicleTransfer(u, a[0]);
    case 'decideVehicleTransfer':
      return svc.decideVehicleTransfer(u, a[0], a[1], a[2]);
    case 'handOverVehicleTransfer':
      return svc.handOverVehicleTransfer(u, a[0], a[1]);
    case 'cancelVehicleTransfer':
      return svc.cancelVehicleTransfer(u, a[0], a[1]);
    default:
      return null;
  }
}
