import type { Db } from './db';
import { ExtractionError, type ExtractionAudit } from './arisha-it-extraction';

/** Separate committed transactions bracket the provider call. Never log user content or raw errors. */
export function extractionAudit(db:Pick<Db,'asUser'>):ExtractionAudit {
  return {append:async event=>{
    await db.asUser(event.actorId,async(_svc,user,store)=>{
      if(user.id!=='u-fauzan'||user.opsTier!=='ceo'||user.integration)throw new ExtractionError('FORBIDDEN');
      await store.audit({at:event.at,actor:user.id,companyId:null,action:`arisha.extraction.${event.phase}`,entity:'arisha_extraction',entityId:event.attemptId,
        summary:JSON.stringify({sourceSha256:event.sourceSha256,sourceLength:event.sourceLength,kind:event.kind,selfDeclaredDataClass:event.selfDeclaredDataClass,consentVersion:event.consentVersion,outcome:event.outcome})});
    });
  }};
}
