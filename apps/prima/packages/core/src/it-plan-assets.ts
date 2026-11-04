import type {Store} from './store';
import type {ItJob} from './types';
import {dateOf} from './time';
import {liveItRows} from './it-cleanup-guards';
import {cleanupHash} from './it-cleanup-hash';
/** Protective inventory scope, not a claim every asset is due or completed. Never accepts a caller's asset list. */
export async function derivePlanAssetRefs(store:Store,key:string|null|undefined,at:string):Promise<ItJob['planAssetRefs']>{
 if(!key||!key.startsWith('inspection:')&&!key.startsWith('service:'))return undefined;
 const match=/^(?:inspection|service):([^:]+):([0-9]{4}-[0-9]{2})$/.exec(key);if(!match||!/^20\d\d-(0[1-9]|1[0-2])$/.test(match[2]))throw Error('Group plan key is invalid.');
 const assets=(await liveItRows(store,'itAssets')).filter(a=>a.ownerId===match[1]&&!['disposed','disposal_pending'].includes(a.status)).map(a=>({id:a.id,hash:cleanupHash(a)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(!assets.length)throw Error('No current nonarchived assets remain for this group plan.');return {asOf:dateOf(at),assets};
}
