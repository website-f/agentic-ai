import {liveItRows} from './it-cleanup-guards';
// Manual IT work records only. Nothing here provisions accounts, changes permissions or certifies compliance.
import type { Store } from './store';
import type { ItAccount, ItAsset, ItManualMetadata, ItManualKind, ItOnboarding, User } from './types';
import { AccessDenied, CENTRAL_EMPLOYER_IDS, accessClosed, centralEmployerName, isCentralEmployer, isOwnerAdmin } from './access';
import { BadRequest, NotFound } from './service';
import { sha256Hex } from './audit';
import { dateOf } from './time';

const queues = new WeakMap<Store, Promise<unknown>>();
/** Demo serialization plus transaction-held database advisory lock, including absent records. */
export function withItRecordLock<T>(store: Store, key: string, run: (tx: Store) => Promise<T>): Promise<T> {
  const previous = queues.get(store) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => store.transaction(async tx => {
    await tx.lock?.('itSettings', `it-manual:${key}`);
    return run(tx);
  }));
  queues.set(store, next);
  return next.finally(() => { if (queues.get(store) === next) queues.delete(store); });
}
export function realCalendarDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' && v <= '2199-12-31'
    && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}
const text = (v: unknown, name: string, max = 300, min = 0) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max || /[\u0000-\u001f\u007f]/.test(v)
    || /(?:password|passwd|secret|access[_ -]?token|api[_ -]?key)\s*[:=]|bearer\s+\S+/i.test(v)) throw new BadRequest(`Give ${name} without credentials (${min}–${max} characters).`);
  return v.trim();
};
const uuid = (v: unknown) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw new BadRequest('A request UUID is required.');
  return v;
};
const optionalDate = (v: unknown) => { if (v === null) return null; if (!realCalendarDate(v)) throw new BadRequest('Give a real calendar date or null.'); return v; };
const exact = (i: Record<string, unknown>, keys: string[]) => { if (Object.keys(i).length !== keys.length || keys.some(k => !(k in i))) throw new BadRequest('Send exactly the fields for this manual action.'); };
const isIt = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'it' && ['manager','lead','executive'].includes(u.itRole ?? '');
const isManager=(u:User)=>isIt(u)&&u.itRole==='manager';
const isLead = (u: User) => isIt(u) && ['manager','lead'].includes(u.itRole ?? '');
/** P78: the owner (master administrator) records existing devices, systems and joiners too, and names the IT person. */
const maker = (u: User) => isIt(u) || isOwnerAdmin(u);
const assigns = (u: User) => isLead(u) || isOwnerAdmin(u);
const mayRead = (u: User) => !u.integration && u.role !== 'site_device' && (isIt(u) || ['ceo','coo'].includes(u.opsTier ?? '') || ['audit','hr','chief_of_staff'].includes(u.department ?? ''));
const hrOnly = (u: User) => ['hr','chief_of_staff'].includes(u.department ?? '') && !['ceo','coo'].includes(u.opsTier ?? '');
const systemKinds: ItAccount['kind'][] = ['m365','azure','registrar','dns','hosting','github','sql_account','network','cctv','prima','other'];
const assetKinds: ItAsset['kind'][] = ['LAPTOP','DESKTOP','PHONE','TABLET','PRINTER','NETWORK','CCTV','OTHER'];
const marker = (user: User) => ({ serviceId: 'it-manual' as const, userId: user.id });
type Row = ItOnboarding | ItAccount | ItAsset;

export class ItManualService {
  constructor(private store: Store, private clock: () => string) {}
  private async actor(user: User, tx = this.store) {
    const current = await tx.get('users', user.id);
    if (!current || accessClosed(current, dateOf(this.clock())) || !mayRead(current)) throw new AccessDenied('view', '(manual IT records are not available to this account)');
    return current;
  }
  private async people(tx = this.store) { return (await tx.list('users', {})).filter(u => !u.integration && u.role !== 'site_device' && !accessClosed(u, dateOf(this.clock()))); }
  private async person(tx: Store, id: unknown, it = false): Promise<User> {
    if (typeof id !== 'string') throw new BadRequest('Choose a currently available person.');
    const p = (await this.people(tx)).find(p => p.id === id);
    if (!p || (it && !isIt(p))) throw new BadRequest('Choose a currently available person.');
    return p;
  }
  private async company(tx: Store, id: unknown) {
    if (id === null) return null;
    if (typeof id !== 'string' || (!isCentralEmployer(id) && !(await tx.get('companies', id)))) throw new BadRequest('Choose a registered company or mark the unit unlinked.');
    return id;
  }
  private async rows(tx = this.store): Promise<Row[]> { return [...await tx.list('itOnboarding', {}), ...await tx.list('itAccounts', {}), ...await tx.list('itAssets', {})]; }
  private result(user: User, row: Row, requestId: string, version: number, replayed: boolean) { return { ...marker(user), requestId, kind:row.manual!.kind, recordId: row.id, version, replayed }; }
  private prior(rows: Row[], user: User, requestId: string) {
    for (const row of rows) {
      const receipt = row.manual?.receipts.find(r => r.userId === user.id && r.requestId === requestId);
      if (receipt) return { row, receipt };
    }
    return null;
  }
  async board(user: User) {
    user = await this.actor(user);
    const people = await this.people(); const companies = await this.store.list('companies', {});
    const readonlyHr = hrOnly(user);
    const problems=await this.store.itManualProblems?.() ?? []; const ready=problems.length===0;
    return { ...marker(user), connection: 'not_connected' as const, configuration:ready?'ready':'setup_required', problems, canCreate: ready&&maker(user), canCheck: ready&&isManager(user), canCreateAsset: ready&&maker(user),
      staff: maker(user) ? people.map(u => ({ id:u.id, name:u.name, title:u.title })) : [],
      itStaff: maker(user) ? people.filter(isIt).map(u => ({ id:u.id, name:u.name })) : [],
      // The central employers (PWVSB, Merdeka Network, Goodwill Empire, Sasa Team) have staff and devices too; they are not
      // rows of the companies table, so they are listed first by name (Arisha main review round 2, 2 Nov 2026).
      companies: maker(user) ? [...CENTRAL_EMPLOYER_IDS.map(id => ({ id, name:centralEmployerName(id)! })), ...companies.map(c => ({ id:c.id, name:c.name }))] : [],
      jobs: maker(user) ? (await this.store.list('itJobs', {})).filter(j => j.status !== 'cancelled' && (assigns(user) || j.assigneeId === user.id || j.givenById === user.id)).map(j => ({ id:j.id, title:j.title })) : [],
      onboarding: readonlyHr ? [] : await liveItRows(this.store,'itOnboarding'),
      accounts: readonlyHr ? [] : await liveItRows(this.store,'itAccounts'),
      assets: readonlyHr ? [] : await liveItRows(this.store,'itAssets'),
    };
  }
  async receipt(user: User, i: Record<string, unknown>) {
    exact(i, ['requestId','kind']); user = await this.actor(user); const requestId = uuid(i.requestId);
    if (!['intake','system','guidance','asset'].includes(String(i.kind))) throw new BadRequest('Unknown manual record kind.');
    if((await this.store.itManualProblems?.() ?? []).length)return {...marker(user),requestId,kind:i.kind,found:false as const,configuration:'setup_required'};
    const receipt=await this.store.get('itManualReceipts',`${user.id}:${requestId}`);
    if(!receipt || receipt.kind!==i.kind)return {...marker(user),requestId,kind:i.kind,found:false as const};
    return {...marker(user),requestId,kind:receipt.kind,found:true as const,terminal:receipt.outcome,recordId:receipt.recordId,version:receipt.version,message:receipt.message,replayed:true};
  }
  async abandon(user:User,i:Record<string,unknown>){
    exact(i,['requestId','kind']);const requestId=uuid(i.requestId);
    if(!['intake','system','guidance','asset'].includes(String(i.kind)))throw new BadRequest('Unknown manual record kind.');
    const kind=i.kind as ItManualKind;
    return withItRecordLock(this.store,'create',async tx=>{
      user=await this.actor(user,tx);if(!maker(user))throw new AccessDenied('view','(only IT reconciles its own manual attempts)');
      if((await tx.itManualProblems?.() ?? []).length)throw new BadRequest('Manual IT storage protections are not configured.');
      const id=`${user.id}:${requestId}`,old=await tx.get('itManualReceipts',id);
      if(old){if(old.kind!==kind)throw new BadRequest('This request belongs to another manual record kind.');return {...marker(user),requestId,kind,found:true as const,terminal:old.outcome,recordId:old.recordId,version:old.version,message:old.message,replayed:true};}
      const message='This unresolved attempt was cancelled before any commit recorded under its request ID. A delayed save with this ID will be refused.';
      await tx.insert('itManualReceipts',{id,userId:user.id,requestId,kind,hash:sha256Hex(`abandoned:${kind}:${requestId}`),outcome:'rejected',recordId:null,version:null,message,at:this.clock()});
      await tx.audit({at:this.clock(),actor:user.name,companyId:null,action:'it.manual.abandon',entity:'itManualReceipts',entityId:id,summary:JSON.stringify({kind,outcome:'rejected'})});
      return {...marker(user),requestId,kind,found:true as const,terminal:'rejected' as const,recordId:null,version:null,message,replayed:false};
    });
  }
  private async execute(user:User,kind:ItManualKind,i:Record<string,unknown>,update=false){
    const requestId=uuid(i.requestId);
    const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):v;
    const hash=sha256Hex(JSON.stringify({kind,update,input:canonical(i)}));
    return withItRecordLock(this.store,'create',async tx=>{
      user=await this.actor(user,tx);
      if(update?!isIt(user):!maker(user))throw new AccessDenied('view','(only authorized IT records manual work)');
      if((await tx.itManualProblems?.() ?? []).length)throw new BadRequest('Manual IT storage protections are not configured. No submission was accepted by this call; keep any uncertain earlier request for reconciliation.');
      const id=`${user.id}:${requestId}`;const old=await tx.get('itManualReceipts',id);
      if(old){
        if(old.hash!==hash||old.kind!==kind)throw new BadRequest('This request ID is permanently bound to different details.');
        return {...marker(user),requestId,kind,terminal:old.outcome,recordId:old.recordId,version:old.version,message:old.message,replayed:true};
      }
      const inner=new ItManualService(tx,this.clock);
      try{

        const result=update?await inner.updateGuidanceImpl(user,i):await inner.createImpl(user,kind,i);
        await tx.insert('itManualReceipts',{id,userId:user.id,requestId,kind,hash,outcome:'committed',recordId:result.recordId,version:result.version,message:null,at:this.clock()});
        return {...result,kind,terminal:'committed' as const};
      }catch(e){
        if(!(e instanceof BadRequest)&&!(e instanceof NotFound)&&!(e instanceof AccessDenied))throw e;
        const message=e.message;
        await tx.insert('itManualReceipts',{id,userId:user.id,requestId,kind,hash,outcome:'rejected',recordId:null,version:null,message,at:this.clock()});
        await tx.audit({at:this.clock(),actor:user.name,companyId:null,action:'it.manual.rejected',entity:'itManualReceipts',entityId:id,summary:JSON.stringify({kind,outcome:'rejected'})});
        return {...marker(user),requestId,kind,terminal:'rejected' as const,recordId:null,version:null,message,replayed:false};
      }
    });
  }
  async create(user:User,kind:ItManualKind,i:Record<string,unknown>){return this.execute(user,kind,i);}
  async updateGuidance(user:User,i:Record<string,unknown>){return this.execute(user,'guidance',i,true);}

  private async createImpl(user: User, kind: ItManualKind, i: Record<string, unknown>) {
    const keys = kind === 'intake' ? ['requestId','kind','personUserId','personName','jobTitle','companyId','unitLabel','on','ownerStaffId']
      : kind === 'system' ? ['requestId','name','kind','companyId','unitLabel','note']
      : kind === 'asset' ? ['requestId','tag','serial','kind','model','companyId','unitLabel','location','boughtOn','warrantyTo']
      : ['requestId','name','companyId','unitLabel','siteOwnerUserId','itResponsibleId','url','nextReviewOn','jobId','note'];
    exact(i, keys); const requestId = uuid(i.requestId);
    // The durable receipt fingerprints the submitted immutable DTO. It stores no raw request body.
    const hash = sha256Hex(JSON.stringify(keys.map(k => [k, i[k]])));
    return (async (tx:Store) => {
      user = await this.actor(user, tx);
      if (!maker(user)) throw new AccessDenied('view', '(only the authorized IT team records manual work)');
      const rows = await this.rows(tx); const prior = this.prior(rows, user, requestId);
      if (prior) { if (prior.receipt.hash !== hash || prior.row.manual?.kind !== kind) throw new BadRequest('This request ID was already used for different details.'); return this.result(user, prior.row, requestId, prior.receipt.version, true); }
      const companyId = await this.company(tx, i.companyId); const unitLabel = text(i.unitLabel, 'the unit label', 120);
      const id = `itm-${kind}-${user.id}-${requestId}`; const at = this.clock();
      const manual: ItManualMetadata = { kind, createdById:user.id, createdAt:at, companyId, unitLabel, version:1, state:'recorded', connection:'not_connected',
        receipts:[{requestId,userId:user.id,hash,version:1}] };
      let row: Row; let table: 'itOnboarding'|'itAccounts'|'itAssets';
      if (kind === 'intake') {
        if (i.kind !== 'join' && i.kind !== 'leave') throw new BadRequest('Choose joining or leaving.');
        if (!realCalendarDate(i.on)) throw new BadRequest('Give the real joining/leaving date.');
        const person = i.personUserId === null ? null : await this.person(tx, i.personUserId);
        const owner = await this.person(tx, i.ownerStaffId, true);
        if (!assigns(user) && owner.id !== user.id) throw new BadRequest('Only the IT Manager or Lead assigns another IT person.');
        manual.personUserId = person?.id ?? null;
        const personName = person?.name ?? text(i.personName, 'the unlinked person name', 120, 2);
        const jobTitle = person?.title ?? text(i.jobTitle, 'the job title', 120, 2);
        // These are work checklist records, not actual account provisioning/revocation receipts.
        const steps = i.kind === 'join' ? [['identity','Confirm identity and approved request'],['accounts','Record account setup evidence'],['device','Record device handover'],['prima','Record Prima access evidence'],['training','Record Microsoft 365 training']]
          : [['identity','Confirm leaving instruction and date'],['accounts','Record external account closure evidence'],['device','Record device return'],['prima','Refer Prima closure to authorized HR/CEO'],['handover','Record handover evidence']];
        row = {id,kind:i.kind,personName,jobTitle,ownerId:companyId ?? 'unlinked',on:i.on,ownerStaffId:owner.id,steps:steps.map(([key,label])=>({key,label,doneAt:null,by:null})),manual}; table='itOnboarding';
      } else if (kind === 'asset') {
        if (!assetKinds.includes(i.kind as ItAsset['kind'])) throw new BadRequest('Choose the device kind.');
        const tag=text(i.tag,'the asset tag',80,1), serial=text(i.serial,'the serial',120,1);
        const norm=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toUpperCase();
        if (!/[A-Z0-9]/i.test(tag) || !/[A-Z0-9]/i.test(serial)) throw new BadRequest('Tag and serial need real letters or digits.');
        if ((await tx.list('itAssets',{})).some(a=>norm(a.tag)===norm(tag)||norm(a.serial)===norm(serial))) throw new BadRequest('This asset tag or serial is already recorded.');
        const boughtOn=optionalDate(i.boughtOn), warrantyTo=optionalDate(i.warrantyTo);
        if (boughtOn && boughtOn>dateOf(at)) throw new BadRequest('An existing asset cannot have a future purchase date.');
        if (boughtOn && warrantyTo && warrantyTo<boughtOn) throw new BadRequest('Warranty cannot end before purchase.');
        manual.provenance='existing_stock'; manual.purchaseDateUnknown=boughtOn===null;
        row={id,tag,serial,kind:i.kind as ItAsset['kind'],model:text(i.model,'the model',120,2),ownerId:companyId??'unlinked',assignedTo:null,location:text(i.location,'the location',160,2),boughtOn:boughtOn??'',warrantyTo,status:'spare',lastCheckedOn:null,purchaseId:null,maintenance:[],nextServiceOn:null,disposal:null,manual}; table='itAssets';
      } else {
        const ceos=(await this.people(tx)).filter(u=>u.opsTier==='ceo'); if(ceos.length!==1) throw new BadRequest('A single current CEO owner must be configured first.');
        if (kind==='system' && !systemKinds.includes(i.kind as ItAccount['kind'])) throw new BadRequest('Choose the system kind.');
        if(kind==='guidance'){
          manual.siteOwnerUserId=i.siteOwnerUserId===null?null:(await this.person(tx,i.siteOwnerUserId)).id;
          manual.itResponsibleId=(await this.person(tx,i.itResponsibleId,true)).id;
          if(!assigns(user)&&manual.itResponsibleId!==user.id)throw new BadRequest('Only the IT Manager or Lead assigns another IT person.');
          manual.guidanceById=null;manual.checkedById=null;manual.updatedAt=at;manual.siteUrl=this.siteUrl(i.url);manual.nextReviewOn=optionalDate(i.nextReviewOn);manual.evidence='';manual.guidanceNote=text(i.note,'a guidance note',500);
          if(i.jobId!==null){const j=typeof i.jobId==='string'?await tx.get('itJobs',i.jobId):null;if(!j||j.status==='cancelled'||(!assigns(user)&&j.assigneeId!==user.id&&j.givenById!==user.id))throw new BadRequest('Choose an accessible current IT job.');manual.jobId=j.id;}else manual.jobId=null;
        }
        row={id,name:text(i.name,'the record name',120,2),kind:kind==='guidance'?'other':i.kind as ItAccount['kind'],ownerId:ceos[0].id,owner:ceos[0].name,masterKeptAt:'',mfa:null,access:[],reviewedOn:null,note:text(i.note,'a note',500),manual};table='itAccounts';
      }
      await tx.insert(table, row as never);
      await tx.audit({at,actor:user.name,companyId:null,action:`it.manual.${kind}.create`,entity:table,entityId:id,summary:JSON.stringify({kind,recordId:id,version:1,connection:'not_connected'})});
      return this.result(user,row,requestId,1,false);
    })(this.store);
  }
  private siteUrl(v: unknown): string|null {
    if(v===null)return null;
    if(typeof v!=='string'||v.length>1000)throw new BadRequest('Give a SharePoint site URL or leave it pending.');
    let u:URL;try{u=new URL(v);}catch{throw new BadRequest('Give a SharePoint site URL or leave it pending.');}
    if(u.protocol!=='https:'||!u.hostname.endsWith('.sharepoint.com')||u.username||u.password||u.port||u.search||u.hash)throw new BadRequest('Use an HTTPS SharePoint site URL without credentials, query or fragment.');
    return u.toString();
  }
  private async updateGuidanceImpl(user:User,i:Record<string,unknown>){
    exact(i,['id','expectedVersion','requestId','state','evidence','note','nextReviewOn']);const requestId=uuid(i.requestId);
    const hash=sha256Hex(JSON.stringify(['id','expectedVersion','state','evidence','note','nextReviewOn'].map(k=>[k,i[k]])));
    return (async (tx:Store)=>{
      user=await this.actor(user,tx);if(!isIt(user))throw new AccessDenied('view','(only IT records guidance)');
      const prior=this.prior(await this.rows(tx),user,requestId);
      if(prior){if(prior.receipt.hash!==hash||prior.row.id!==i.id)throw new BadRequest('This request ID was already used for different details.');return this.result(user,prior.row,requestId,prior.receipt.version,true);}
      const row=typeof i.id==='string'?await tx.get('itAccounts',i.id):null;
      if(!row||row.manual?.kind!=='guidance')throw new NotFound('Guidance record');const m=row.manual;
      if(!isLead(user)&&m.itResponsibleId!==user.id)throw new AccessDenied('view','(this guidance is assigned to another IT person)');
      if(!Number.isInteger(i.expectedVersion)||i.expectedVersion!==m.version)throw new BadRequest('This record changed. Reload before saving.');
      if(!['recorded','guidance_given','manually_checked'].includes(String(i.state)))throw new BadRequest('Choose a manual workflow state.');
      if(i.state==='manually_checked'&&(!isManager(user)||m.state!=='guidance_given'||!m.guidanceById||m.guidanceById===user.id||m.itResponsibleId===user.id))throw new AccessDenied('view','(the IT Manager checks independently recorded guidance evidence)');
      const evidence=text(i.evidence,'evidence reference',500,i.state==='recorded'?0:3), note=text(i.note,'a note',500,3),nextReviewOn=optionalDate(i.nextReviewOn);
      if(m.receipts.length>=100)throw new BadRequest('This record needs an approved archive process before more updates.');
      const version=m.version+1;
      const manual:ItManualMetadata={...m,version,state:i.state as ItManualMetadata['state'],connection:'not_connected',evidence,guidanceNote:note,nextReviewOn,guidanceById:i.state==='guidance_given'?user.id:m.guidanceById??null,checkedById:i.state==='manually_checked'?user.id:null,updatedAt:this.clock(),receipts:[...m.receipts,{requestId,userId:user.id,hash,version}]};
      const saved=await tx.update('itAccounts',row.id,{manual});
      await tx.audit({at:this.clock(),actor:user.name,companyId:null,action:'it.manual.guidance.update',entity:'itAccounts',entityId:row.id,summary:JSON.stringify({state:manual.state,version,connection:'not_connected'})});
      return this.result(user,saved,requestId,version,false);
    })(this.store);
  }
}
