import {teamsEvidenceModule} from './connections-teams/controller';
import { ItExtractionController } from './arisha-it-extraction.controller';
import { ItImportReviewController } from './arisha-it-import.controller';
import { jobEmailRuntimeModule } from './connections-mail/controllers';
import { Module } from '@nestjs/common';
import { AppController, AuthController, DoorFeedController, HealthController, JaFeedController, OfficeController, PlannerFeedController, ShareController } from './controllers';
import { Db } from './db';
import { ConnectionsController } from './connections.controller';
import { SharePointConnections } from './connections';
import { OrgController, OrgHealthController } from './org.controller';
import { SPECIAL_OPS_CONTROLLERS } from './special-ops.controller';
import { WHATSAPP_CONTROLLERS, WhatsAppRunner } from './whatsapp';
import { m365ConnectionsModule } from './connections-m365/controller';
import { CheckinController } from './checkin.controller';
import { AttendanceReportsController, AttendanceUploads } from './attendance-reports.controller';

const jobEmail = jobEmailRuntimeModule();
const teamsEvidence=teamsEvidenceModule();
const m365 = m365ConnectionsModule();

@Module({
  controllers: [HealthController, OrgHealthController, OrgController, AttendanceReportsController, AuthController, OfficeController, CheckinController, AppController, JaFeedController, DoorFeedController, PlannerFeedController, ConnectionsController, ItExtractionController, ItImportReviewController, ...jobEmail.controllers, ...teamsEvidence.controllers, ...SPECIAL_OPS_CONTROLLERS, ...WHATSAPP_CONTROLLERS, ...m365.controllers, ShareController],
  providers: [Db, { provide: SharePointConnections, useFactory: () => new SharePointConnections() }, { provide: AttendanceUploads, useFactory: () => new AttendanceUploads() }, ...jobEmail.providers, ...teamsEvidence.providers, WhatsAppRunner, ...m365.providers],
})
export class AppModule {}
