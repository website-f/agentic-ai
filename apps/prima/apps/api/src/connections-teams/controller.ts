import {Controller,Get,Query,UseGuards} from '@nestjs/common';
import {AuthGuard,UserId} from '../auth';
import {Db} from '../db';
import {noQuery} from '../connections-mail/delegated';
import {TeamsApprovalEvidenceReader} from './evidence-reader';
/** Status only. No endpoint accepts a browser-provided decision or mutates Finance. */
@Controller('api/connections/teams')
@UseGuards(AuthGuard)
export class TeamsConnectionController{
 constructor(private readonly db:Db,private readonly reader:TeamsApprovalEvidenceReader){}
 @Get('status') status(@UserId() uid:string,@Query() query:Record<string,unknown>){noQuery(query);return this.db.asUser(uid,async(_svc,user)=>({serviceId:'teams' as const,userId:user.id,...this.reader.status()}));}
}
/** A flag or manual link cannot install a trusted source. Production remains unavailable until separately reviewed adapter composition. */
export const teamsEvidenceModule=()=>({controllers:[TeamsConnectionController],providers:[{provide:TeamsApprovalEvidenceReader,useFactory:()=>new TeamsApprovalEvidenceReader(null)}]});
