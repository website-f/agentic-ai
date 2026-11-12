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

export interface NewbClient {
  vehicleTransferBoard(): Promise<VehicleTransferBoard>;
  requestVehicleTransfer(input: { vehicleId: string; toCompanyId: string; wantedOn: string; reason: string }): Promise<unknown>;
  decideVehicleTransfer(id: string, approve: boolean, note: string): Promise<unknown>;
  handOverVehicleTransfer(id: string, input: VehicleHandoverInput): Promise<unknown>;
  cancelVehicleTransfer(id: string, reason: string): Promise<unknown>;
}

/** The in-browser demo's writes for these calls (demo.ts apply() hands them here first). */
export function applyNewb(svc: PrimaService, u: import('@prima/core').User, op: string, a: never[]): Promise<unknown> | null {
  switch (op) {
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
