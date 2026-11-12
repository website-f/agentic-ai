// E6 (P100, Fauzan 11 Nov 2026): moving a vehicle to another group company's use. Its own file so other work does not
// collide in controllers.ts. Every route runs as the signed-in person (Db.asUser: row-level security plus the service's
// own checks in packages/core/src/vehicle-transfer.ts).
import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';

function str(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
}
function day(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`${name} must be a date (YYYY-MM-DD)`);
  return v;
}
function rid(v: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(v)) throw new BadRequestException('id is not valid');
  return v;
}

@Controller('api')
@UseGuards(AuthGuard)
export class VehicleTransferController {
  constructor(private db: Db) {}

  @Get('fleet/transfers')
  board(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.vehicleTransferBoard(u));
  }

  @Post('fleet/transfers')
  request(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.requestVehicleTransfer(u, {
        vehicleId: rid(str(b.vehicleId, 'vehicleId', 80)),
        toCompanyId: str(b.toCompanyId, 'toCompanyId', 60),
        wantedOn: day(b.wantedOn, 'wantedOn'),
        reason: str(b.reason ?? '', 'reason', 300),
      }),
    );
  }

  @Post('fleet/transfers/:id/decide')
  decide(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.decideVehicleTransfer(u, rid(id), b.approve as boolean, str(b.note ?? '', 'note', 500)));
  }

  @Post('fleet/transfers/:id/handover')
  handover(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.odometerKm !== 'number') throw new BadRequestException('odometerKm must be a number');
    if (!Array.isArray(b.items) || b.items.length > 10 || b.items.some((x) => typeof x !== 'string')) throw new BadRequestException('items must be a list');
    return this.db.asUser(uid, (svc, u) =>
      svc.handOverVehicleTransfer(u, rid(id), {
        on: day(b.on, 'on'),
        odometerKm: b.odometerKm as number,
        handedBy: str(b.handedBy ?? '', 'handedBy', 120),
        receivedBy: str(b.receivedBy ?? '', 'receivedBy', 120),
        condition: str(b.condition ?? '', 'condition', 500),
        items: b.items as string[],
        note: b.note == null ? '' : str(b.note, 'note', 500),
      }),
    );
  }

  @Post('fleet/transfers/:id/cancel')
  cancel(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.cancelVehicleTransfer(u, rid(id), str(b.reason ?? '', 'reason', 300)));
  }
}
