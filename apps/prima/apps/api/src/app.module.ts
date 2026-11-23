import {teamsEvidenceModule} from './connections-teams/controller';
import { ItExtractionController } from './arisha-it-extraction.controller';
import { ItImportReviewController } from './arisha-it-import.controller';
import { DraftHelpController } from './draft-help.controller';
import { KeyInController } from './key-in.controller';
import { StaffDirectoryController } from './staff-directory.controller';
import { jobEmailRuntimeModule } from './connections-mail/controllers';
import { Module } from '@nestjs/common';
import { AnalyticsFeedController, AppController, InhouseFeedController, AuthController, DoorFeedController, HealthController, JaFeedController, OfficeController, PlannerFeedController, ShareController } from './controllers';
import { Db } from './db';
import { GuardPhoneController, GuardPhoneOpenController } from './guard-phone.controller';
import { CleaningController } from './cleaning.controller';
import { RosterController } from './roster.controller';
import { ConnectionsController } from './connections.controller';
import { SharePointConnections } from './connections';
import { alertsModule } from './alerts/controller';
import { usageModule } from './m365-usage/controller';
import { m365ConnectionsModule } from './connections-m365/controller';
import { OrgController, OrgHealthController } from './org.controller';
import { SPECIAL_OPS_CONTROLLERS } from './special-ops.controller';
import { WHATSAPP_CONTROLLERS, WhatsAppRunner } from './whatsapp';
import { TenderWatcherRunner } from './tender-watcher-online';
import { OfflineController } from './offline.controller';
// Agentic Office: office sign-in/hosting routes, staff check-in by place and the InfoTech attendance PDF reports.
import { CheckinController } from './checkin.controller';
import { AttendanceReportsController, AttendanceUploads } from './attendance-reports.controller';

const jobEmail = jobEmailRuntimeModule();
const teamsEvidence=teamsEvidenceModule();
const alerts = alertsModule();
const usage = usageModule();
const m365 = m365ConnectionsModule();

@Module({
  controllers: [HealthController, AttendanceReportsController, AuthController, CheckinController, OfficeController, AppController, JaFeedController, DoorFeedController, PlannerFeedController, AnalyticsFeedController, InhouseFeedController, ConnectionsController, ItExtractionController, ItImportReviewController, ...jobEmail.controllers, ...teamsEvidence.controllers, OfflineController, ...SPECIAL_OPS_CONTROLLERS, ...WHATSAPP_CONTROLLERS, OrgHealthController, OrgController, ...m365.controllers, ShareController, StaffDirectoryController, CleaningController, RosterController, ...alerts.controllers, DraftHelpController, KeyInController, GuardPhoneOpenController, GuardPhoneController, ...usage.controllers],
  providers: [Db, { provide: SharePointConnections, useFactory: () => new SharePointConnections() }, { provide: AttendanceUploads, useFactory: () => new AttendanceUploads() }, ...jobEmail.providers, ...teamsEvidence.providers, WhatsAppRunner, TenderWatcherRunner, ...m365.providers, ...alerts.providers, ...usage.providers],
})
export class AppModule {}
