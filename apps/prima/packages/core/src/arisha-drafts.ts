import { sha256Hex } from './audit';
import { AccessDenied, visibleCompanyIds } from './access';
import { arishaLeader, arishaMayDraftCompany, ARISHA_COMPANY_DRAFT_FIELDS, arishaMayDraftRecord, arishaMayPrepareFinance, arishaRecordFieldsFor, type ArishaReviewDraft, type ArishaReviewPayload } from './arisha-policy';
import { RECORD_KINDS, checkRecordValues, type RecordKind, type RecordValues } from './records';
import type { Store } from './store';
import type { User } from './types';
import { BadRequest, type PrimaService } from './service';

// Serializes browser/demo operations too; PostgreSQL additionally locks the durable row.
const queues = new WeakMap<Store, Map<string, Promise<unknown>>>();
export class ArishaDraftService {
  constructor(private store: Store, private svc: PrimaService) {}
  private deny(): never { throw new AccessDenied('view', '(draft action not permitted)'); }
  private async company(user: User, id: string | null) {
    if (user.integration) this.deny();
    if (id && !visibleCompanyIds(user, await this.store.list('grants'), this.svc.today()).includes(id)) this.deny();
    if (id && !(await this.store.get('companies', id))) this.deny();
  }
  async form(user: User, kind: string, companyId: string | null) {
    if (kind === 'company') {
      if (!arishaMayDraftCompany(user)) this.deny();
      if (companyId) await this.company(user, companyId);
      const form = await this.svc.recordForm(user, 'company', null, companyId);
      if (form.chooseCompany) {
        const allowed = new Set((await this.svc.visibleCompanies(user)).map(c => c.id));
        form.chooseCompany = form.chooseCompany.filter(([id]) => allowed.has(id));
      }
      return {...form, spec: {...form.spec, fields: form.spec.fields.filter(f => ARISHA_COMPANY_DRAFT_FIELDS.includes(f.key))}, values: {} as RecordValues};
    }
    if (!arishaMayDraftRecord(user, kind)) this.deny();
    const original = RECORD_KINDS[kind];
    const spec = { ...original, fields: original.fields.filter(f => arishaRecordFieldsFor(kind).includes(f.key) && !f.restricted) };
    if (!original.companyScoped && companyId !== null) throw new BadRequest('This draft is group-wide; do not supply a company.');
    if (original.companyScoped && !companyId) {
      const companies = await this.svc.visibleCompanies(user);
      return { spec, id: null, companyId: null, values: {} as RecordValues, options: {} as Record<string, [string,string][]>, chooseCompany: companies.map(c => [c.id, `${c.code} ${c.name}`] as [string,string]) };
    }
    await this.company(user, companyId);
    const options: Record<string, [string,string][]> = {};
    for (const field of spec.fields.filter(f => f.type === 'ref')) {
      const rows = await this.store.list(field.ref! as never, { companyId } as never) as unknown as {id:string; name?:string; code?:string; companyId:string}[];
      options[field.key] = rows.filter(r => r.companyId === companyId).map(r => [r.id, r.name ?? r.code ?? r.id]);
    }
    return {spec, id:null, companyId, values:{} as RecordValues, options, chooseCompany:null as [string,string][]|null};
  }
  async prepareRecord(user: User, input: Record<string, unknown>) {
    if (input.id != null) throw new BadRequest('Only new records are supported in this draft release.');
    if (typeof input.kind !== 'string') this.deny();
    const cid = input.companyId == null ? null : input.companyId;
    if (cid !== null && (typeof cid !== 'string' || cid.length > 60)) this.deny();
    const form = await this.form(user, input.kind, cid as string|null);
    if (form.chooseCompany) throw new BadRequest('Choose a permitted company first.');
    const raw = input.values;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequest('Supply record fields.');
    const allowed = input.kind === 'company' ? ARISHA_COMPANY_DRAFT_FIELDS : arishaRecordFieldsFor(input.kind);
    if (Object.keys(raw).some(k => !allowed.includes(k))) throw new BadRequest('Unsupported or protected field.');
    if (Object.values(raw).some(v => !['string','number','boolean'].includes(typeof v) && v !== null)) throw new BadRequest('Invalid field value.');
    if (Object.values(raw).some(v => typeof v === 'string' && v.length > 2000)) throw new BadRequest('A field is too long.');
    const {values,problems} = checkRecordValues(form.spec, raw as RecordValues, true);
    for (const f of form.spec.fields.filter(f => f.type === 'ref' && values[f.key])) {
      if (!form.options[f.key]?.some(([id]) => id === values[f.key])) problems.push('Choose a reference from this company.');
    }
    if (problems.length) throw new BadRequest(problems.join(' '));
    if (input.kind === 'company') values.verificationStatus = 'draft'; // Model cannot certify documentary evidence.
    return { kind: form.spec.kind, companyId: form.companyId, values, summary: `${form.spec.label} proposal; human review required.` };
  }
  async financePapers(user: User, companyId: string) {
    if (!arishaMayPrepareFinance(user)) this.deny();
    await this.company(user,companyId);
    const row = await this.store.get('finStatus', `fin-${companyId}`);
    if (!row) throw new BadRequest('No finance papers are available for this company.');
    return (['audit','tax'] as const).flatMap(pack => row[pack].map(p => ({ id:p.id, label:p.label, status:p.status, pack })));
  }
  /** Model-facing choices deliberately omit paper labels, people, balances and source documents. */
  async financeModelOptions(user: User, companyId: string|null) {
    if (!arishaMayPrepareFinance(user)) this.deny();
    if (companyId === null) {
      const companies = (await this.svc.visibleCompanies(user)).filter(c => /^[A-Za-z0-9_-]{1,60}$/.test(c.id)).sort((a,b)=>a.id.localeCompare(b.id));
      return {
        companyId: null, companyChoices: companies.slice(0,50).map(c => ({id:c.id})), truncated:companies.length > 50,
        papers: [] as {itemId:string;pack:'audit'|'tax';status:string}[],
        note: 'Choose a permitted company ID. At most 50 choices are shown; a known permitted ID can be requested directly. Paper labels are available only in the human Finance panel, not in model context.',
      };
    }
    if (typeof companyId !== 'string' || !companyId || companyId.length > 60) this.deny();
    const papers = (await this.financePapers(user,companyId)).filter(p => /^[A-Za-z0-9_-]{1,100}$/.test(p.id));
    return {companyId,companyChoices:[],papers:papers.slice(0,100).map(p => ({itemId:p.id,pack:p.pack,status:['todo','prepared','reviewed','sent'].includes(p.status) ? p.status : 'unknown'})),truncated:papers.length > 100,note:'Recorded paper IDs/statuses only. Ask the human to identify the paper if ambiguous. No source documents or financial amounts are provided.'};
  }
  /** Preparing an AI finance proposal never inserts a draft or changes finance status. */
  async prepareFinance(user: User, input: Record<string,unknown>) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) this.deny();
    if (Object.keys(input).some(k => !['companyId','pack','itemId','status'].includes(k))) throw new BadRequest('Unsupported finance preparation field.');
    if (typeof input.companyId !== 'string' || !input.companyId || input.companyId.length > 60 ||
        (input.pack !== 'audit' && input.pack !== 'tax') || typeof input.itemId !== 'string' || !input.itemId || input.itemId.length > 100 ||
        (input.status !== undefined && input.status !== 'prepared')) this.deny();
    const payload: Extract<ArishaReviewPayload,{type:'finance-paper'}> = {type:'finance-paper',pack:input.pack,itemId:input.itemId,status:'prepared'};
    await this.financeSource(user,payload,input.companyId); // independent identity, company, target and status check
    const row = await this.store.get('finStatus',`fin-${input.companyId}`);
    const label = row?.[payload.pack].find(p => p.id === payload.itemId)?.label ?? payload.itemId;
    // label is for the authorized human card only. Tool runners must replace this
    // entire result with a static confirmation before giving any result to a model.
    return {companyId:input.companyId,pack:payload.pack,itemId:payload.itemId,status:'prepared' as const,label};
  }
  private async financeSource(user: User, payload: Extract<ArishaReviewPayload,{type:'finance-paper'}>, cid: string|null) {
    if (!arishaMayPrepareFinance(user) || !cid || !['audit','tax'].includes(payload.pack) || payload.status !== 'prepared' || typeof payload.itemId !== 'string') this.deny();
    await this.company(user,cid);
    const row = await this.store.get('finStatus',`fin-${cid}`);
    const item = row?.[payload.pack].find(p => p.id === payload.itemId);
    if (!item || item.status !== 'todo') throw new BadRequest('Only an existing paper still marked todo can be proposed as prepared.');
    return sha256Hex(JSON.stringify(item));
  }
  private view(d: ArishaReviewDraft) { const {sourceVersion: _private, ...safe} = d; return structuredClone(safe); }
  async submit(user: User, payload: ArishaReviewPayload, companyId: string|null, provenance: 'arisha'|'human'|'unverified' = 'unverified') {
    const role = arishaLeader(user); if (!role) this.deny();
    if (companyId !== null && (typeof companyId !== 'string' || !companyId || companyId.length > 60)) this.deny();
    if (!payload || typeof payload !== 'object' || !['arisha','human','unverified'].includes(provenance)) this.deny();
    let sourceVersion: string|null = null;
    let safe: ArishaReviewPayload;
    if (payload.type === 'record') {
      if (!arishaMayDraftRecord(user,payload.kind)) this.deny(); // Company compatibility never enters this create-only queue.
      if (payload.id !== null) throw new BadRequest('Draft updates are not supported.');
      const p = await this.prepareRecord(user,{...payload,companyId});
      safe = {type:'record',kind:payload.kind,id:null,values:p.values};
    } else if (payload.type === 'finance-paper') {
      sourceVersion = await this.financeSource(user,payload,companyId);
      safe = {type:'finance-paper',pack:payload.pack,itemId:payload.itemId,status:'prepared'};
    } else this.deny();
    // Stable content identity makes network retries/double-clicks one proposal, not
    // multiple operational records. Returned proposals have a separate versioned human resubmission action.
    // Legacy caller hints remain accepted for demo compatibility, but prove no preparation origin.
    // Existing rows returned by dedup retain their original historical metadata.
    const d: ArishaReviewDraft = {id:`ard-${sha256Hex(JSON.stringify([user.id,companyId,safe,sourceVersion])).slice(0,32)}`,companyId,authorId:user.id,authorRole:role,createdAt:this.svc.now(),provenance:'unverified',version:1,status:'submitted',payload:safe,sourceVersion,reviewedById:null,reviewedAt:null,resultId:null};
    return this.serial(d.id, () => this.store.transaction(async tx => {
      await tx.lock?.('arishaDrafts',d.id);
      const prior = await tx.get('arishaDrafts',d.id);
      if (prior) {
        if (prior.authorId !== user.id || prior.status === 'returned') throw new BadRequest('Use the explicit resubmit action for this returned proposal.');
        return this.view(prior);
      }
      await tx.insert('arishaDrafts',d); await this.audit(tx,user,d,'submitted'); return this.view(d);
    }));
  }
  private async mayReview(user: User, d: ArishaReviewDraft): Promise<boolean> {
    if (user.integration) return false;
    // A separate explicit human step, not an AI save. Existing writer authority
    // may include the author; do not invent a second-person rule or widen rights.
    try {
      await this.company(user,d.companyId);
      if (d.payload.type === 'record') {
        await this.svc.recordForm(user,d.payload.kind,null,d.companyId); // unchanged existing WRITE authority
        return true;
      }
      const f = await this.store.get('finStatus',`fin-${d.companyId}`);
      return !!f && (user.leadership === 'finance_director' || (user.department === 'finance' && user.financeTeam === f.team && !!user.financeRole));
    } catch { return false; }
  }
  async list(user: User) {
    if (user.integration) return [];
    const out = [];
    for (const d of await this.store.list('arishaDrafts')) {
      try { await this.company(user,d.companyId); } catch { continue; }
      const may = await this.mayReview(user,d);
      if ((d.authorId === user.id && arishaLeader(user)) || may) {
        let sourceLabel: string|null = null;
        if (d.payload.type === 'finance-paper') {
          const p = d.payload;
          const source = await this.store.get('finStatus', `fin-${d.companyId}`);
          sourceLabel = source?.[p.pack].find(item => item.id === p.itemId)?.label ?? null;
        }
        out.push({...this.view(d),sourceLabel,canCommit:may && d.status === 'submitted',canReturn:may && d.status === 'submitted',canResubmit:d.authorId === user.id && !!arishaLeader(user) && d.status === 'returned'});
      }
    }
    return out.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async serial<T>(id:string, fn:()=>Promise<T>): Promise<T> {
    let map = queues.get(this.store); if (!map) { map = new Map(); queues.set(this.store,map); }
    const prior = map.get(id) ?? Promise.resolve();
    const next = prior.catch(()=>undefined).then(fn); map.set(id,next);
    try { return await next; } finally { if (map.get(id) === next) map.delete(id); }
  }
  async resubmit(user: User, id:string, version:number) {
    return this.serial(id, () => this.store.transaction(async tx => {
      await tx.lock?.('arishaDrafts',id);
      const d = await tx.get('arishaDrafts',id);
      if (!d || d.authorId !== user.id || arishaLeader(user) !== d.authorRole) this.deny();
      await this.company(user,d.companyId);
      if (!Number.isInteger(version)) throw new BadRequest('Refresh the proposal before resubmitting.');
      if (d.status === 'submitted' && d.version === version + 1) return this.view(d); // same human request retry
      if (d.status !== 'returned' || d.version !== version) throw new BadRequest('Refresh the returned proposal before resubmitting.');
      let sourceVersion: string|null = null;
      if (d.payload.type === 'record') await this.prepareRecord(user,{...d.payload,companyId:d.companyId});
      else {
        await tx.lock?.('finStatus',`fin-${d.companyId}`);
        sourceVersion = await this.financeSource(user,d.payload,d.companyId);
      }
      const revised = await tx.update('arishaDrafts',id,{status:'submitted',version:d.version+1,sourceVersion,reviewedById:null,reviewedAt:null,resultId:null});
      await this.audit(tx,user,revised,'resubmitted');
      return this.view(revised);
    }));
  }
  async commit(user: User, id:string, version:number) { return this.review(user,id,version,false); }
  async returnDraft(user: User, id:string, version:number) { return this.review(user,id,version,true); }
  private async review(user:User,id:string,version:number,returning:boolean) {
    return this.serial(id,() => this.store.transaction(async tx => {
      await tx.lock?.('arishaDrafts',id);
      const d = await tx.get('arishaDrafts',id);
      if (!d || !await this.mayReview(user,d)) this.deny();
      if (!returning && d.status === 'committed' && d.reviewedById === user.id && (version === d.version || version === d.version - 1)) return this.view(d);
      if (!Number.isInteger(version) || version !== d.version || d.status !== 'submitted') throw new BadRequest('Draft changed; refresh before reviewing.');
      let resultId:string|null = null;
      if (!returning) {
        const author = await this.store.get('users',d.authorId);
        if (!author || arishaLeader(author) !== d.authorRole) this.deny();
        await this.company(author,d.companyId); // revoked/expired author scope fails closed
        if (d.payload.type === 'record') {
          const p = await this.prepareRecord(author,{...d.payload,companyId:d.companyId});
          const saved = await this.svc.saveRecord(user,p.kind,null,d.companyId,p.values) as {id?:string};
          resultId = saved.id ?? null;
        } else {
          await tx.lock?.('finStatus',`fin-${d.companyId}`);
          if (await this.financeSource(author,d.payload,d.companyId) !== d.sourceVersion) throw new BadRequest('Finance source changed; submit a fresh proposal.');
          const result = await this.svc.setFinPack(user,d.companyId!,d.payload.pack,d.payload.itemId,'prepared');
          resultId = result.id;
        }
      }
      const updated = await tx.update('arishaDrafts',id,{status:returning?'returned':'committed',version:d.version+1,reviewedById:user.id,reviewedAt:this.svc.now(),resultId});
      await this.audit(tx,user,updated,returning?'returned':'committed');
      return this.view(updated);
    }));
  }
  private audit(tx:Store,user:User,d:ArishaReviewDraft,action:string) {
    return tx.audit({at:this.svc.now(),actor:user.name,companyId:d.companyId,action:`arisha.draft.${action}`,entity:'arisha_draft',entityId:d.id,summary:`Draft ${action}; author ${d.authorId}; reviewer ${d.reviewedById ?? 'none'}; version ${d.version}.`});
  }
}
