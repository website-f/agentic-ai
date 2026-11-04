import type { ItTicket, User } from './types';
export const webActive = (u: User | null | undefined, today: string): u is User => !!u && !u.integration && !u.accessClosed && (!u.accessClosedFrom || u.accessClosedFrom > today);
export const webIt = (u: User) => u.role === 'pwvsb_officer' && u.department === 'it';
export const webManager = (u: User) => webIt(u) && u.itRole === 'manager';
export const webLead = (u: User) => webIt(u) && u.itRole === 'lead';
export function webTicketPolicy(t: ItTicket, actor: User, requester: User | undefined, today: string, scoped = true) {
 const active = scoped && webActive(actor,today), snap=t.webResolution;
 const internal = !requester || requester.integration || webIt(requester) || !!t.raisedFor;
 const checkerKind:'requester'|'it_manager'|'it_lead'=internal?(snap?.resolverRole==='manager'?'it_lead':'it_manager'):'requester';
 const checker = internal ? (snap?.resolverRole === 'manager' ? webLead(actor) : webManager(actor)) : t.raisedById === actor.id;
 const ready=active && t.status==='resolved' && !t.confirmedAt && !!snap && snap.version===t.webResolutionVersion && !!t.resolvedById && snap.resolverId===t.resolvedById;
 const canConfirm=!!(ready && checker && snap!.resolverId!==actor.id);
 return {canConfirm,canReturn:canConfirm,canAssign:active&&webManager(actor)&&t.status!=='resolved',canReopen:active&&webManager(actor)&&(t.status==='resolved'),expectedResolutionVersion:t.webResolutionVersion??0,checkerKind,legacyResolution:t.status==='resolved'&&!snap};
}
/** Calendar-valid, nonfuture last-post dates only; malformed legacy dates remain unknown. */
export function socialInactivityDays(value: unknown,today:string):number|null {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const n=Date.parse(value+'T00:00:00Z'), now=Date.parse(today+'T00:00:00Z');
 if(!Number.isFinite(n)||!Number.isFinite(now)||new Date(n).toISOString().slice(0,10)!==value||n>now)return null;
 return Math.floor((now-n)/86400000);
}
