import type { ItPurchase } from './types';
/** Stored comparison identity only: never fetches the supplied URL. */
export function onlineComparisonKey(ref:string):string|null {
 try {const u=new URL(ref);if(u.protocol!=='https:'||u.username||u.password)return null;u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['gclid','fbclid'].includes(k.toLowerCase()))u.searchParams.delete(k);u.searchParams.sort();return u.toString();}catch{return null;}
}
export function distinctOnlineComparisons(entries:NonNullable<ItPurchase['online']>):NonNullable<ItPurchase['online']> {
 const sources=new Set<string>(),links=new Set<string>(),proofs=new Set<string>();
 return entries.filter(e=>{const source=e.source.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(),link=onlineComparisonKey(e.ref),hashes=e.proof.map(p=>p.sha256).filter(h=>/^[a-f0-9]{64}$/i.test(h)).map(h=>h.toLowerCase());
 if(!source||!link||!Number.isFinite(e.amount)||e.amount<=0||!Number.isFinite(Date.parse(e.at))||!hashes.length||sources.has(source)||links.has(link)||hashes.some(h=>proofs.has(h)))return false;
 sources.add(source);links.add(link);for(const h of hashes)proofs.add(h);return true;});
}
