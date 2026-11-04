import {teamsEvidenceModule} from './connections-teams/controller';
import { ItExtractionController } from './arisha-it-extraction.controller';
import { ItImportReviewController } from './arisha-it-import.controller';
import { jobEmailRuntimeModule } from './connections-mail/controllers';
import { Module } from '@nestjs/common';
import { AppController, AuthController, DoorFeedController, HealthController, JaFeedController, PlannerFeedController } from './controllers';
import { Db } from './db';
import { ConnectionsController } from './connections.controller';
import { SharePointConnections } from './connections';

const jobEmail = jobEmailRuntimeModule();
const teamsEvidence=teamsEvidenceModule();

@Module({
  controllers: [HealthController, AuthController, AppController, JaFeedController, DoorFeedController, PlannerFeedController, ConnectionsController, ItExtractionController, ItImportReviewController, ...jobEmail.controllers,...teamsEvidence.controllers],
  providers: [Db, { provide: SharePointConnections, useFactory: () => new SharePointConnections() }, ...jobEmail.providers,...teamsEvidence.providers],
})
export class AppModule {}
