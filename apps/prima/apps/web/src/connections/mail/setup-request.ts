import type { JobEmailClient } from './job-emails-client';
export type SetupMarker={get():string|null;set(id:string):void;remove():void;claim<T>(fn:()=>Promise<T>):Promise<T>};
const valid=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
/** Durable operation identity only; server atomically deduplicates the same user/request ID. */
export function mailboxSetupMarker(userId:string):SetupMarker{const key='prima:mail-setup:'+encodeURIComponent(userId);return{get:()=>localStorage.getItem(key),set:id=>localStorage.setItem(key,id),remove:()=>localStorage.removeItem(key),claim:fn=>{if(!navigator.locks)throw Error('Cross-tab protection unavailable');return navigator.locks.request(key,{ifAvailable:true},lock=>{if(!lock)throw Error('Setup request busy in another tab');return fn();});}};}
export async function requestMailboxSetup(client:JobEmailClient,userId:string,marker:SetupMarker,newId:()=>string=()=>crypto.randomUUID()){
 return marker.claim(async()=>{const id=marker.get()??newId();if(!valid(id))throw Error('Invalid pending setup identity');marker.set(id);if(marker.get()!==id)throw Error('Recovery marker unavailable');const result=await client.setup(userId,id);try{marker.remove();}catch{/* same id reconciles safely on next open */}return result;});
}
