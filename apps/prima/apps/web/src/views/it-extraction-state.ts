import type { ExtractionClient, ExtractionKind, ExtractionPreview, ExtractionRequest, ExtractionStatus } from '../api/it-extraction';
export class ExtractionSession {
  private generation=0;private disposed=false;private ctrl:AbortController|null=null;private listeners=new Set<()=>void>();
  private state:{status:ExtractionStatus|null;kind:ExtractionKind;label:string;text:string;dataClass:'synthetic'|'approved-it-work';consent:boolean;busy:boolean;preview:ExtractionPreview|null;edits:Record<string,string>;error:string|null}={status:null,kind:'tickets',label:'Selected text',text:'',dataClass:'synthetic',consent:false,busy:false,preview:null,edits:{},error:null};
  constructor(private readonly client:ExtractionClient,readonly userId:string){}
  activate(){this.disposed=false;}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private update(patch:Partial<typeof this.state>){if(this.disposed)return;this.state={...this.state,...patch};for(const fn of this.listeners)fn();}
  private invalidate(){this.generation++;this.ctrl?.abort();this.ctrl=null;}
  change(patch:Partial<Pick<typeof this.state,'kind'|'label'|'text'|'dataClass'>>){this.invalidate();this.update({...patch,consent:false,busy:false,preview:null,edits:{},error:null});}
  consent(value:boolean){this.update({consent:value});}
  edit(row:number,field:string,value:string){if(!this.state.preview?.rows.some(r=>r.row===row&&Object.hasOwn(r.fields,field)))return;this.update({edits:{...this.state.edits,[`${row}:${field}`]:value}});}
  cancel(){this.invalidate();this.update({busy:false,consent:false,preview:null,edits:{},error:null});}
  dispose(){this.cancel();this.update({text:'',label:'Selected text',status:null,dataClass:'synthetic'});this.disposed=true;this.listeners.clear();}
  async load(){if(this.disposed)return;this.invalidate();const id=this.generation;this.ctrl=new AbortController();this.update({busy:true,status:null,error:null,consent:false,preview:null,edits:{}});
    try{const status=await this.client.itExtractionStatus(this.ctrl.signal);if(id===this.generation)this.update({status,busy:false});}
    catch{if(id===this.generation)this.update({busy:false,error:'Setup status unavailable. No text was sent to AI.'});}}
  async extract(){const s=this.state;if(this.disposed||s.busy||!s.consent||!s.status?.enabled||!s.status.configured||!s.status.permitted||!s.status.sourceTypes.includes('paste')||!s.status.dataClasses.includes(s.dataClass)||!s.text.trim()||[...s.text].length>8000)return;
    this.invalidate();const id=this.generation;this.ctrl=new AbortController();this.update({busy:true,error:null,preview:null,edits:{},consent:false});
    const input:ExtractionRequest={kind:s.kind,source:{type:'paste',label:s.label,text:s.text,dataClass:s.dataClass},acknowledgement:{version:'it-extraction-v1',sendToAzure:true}};
    try{const preview=await this.client.itExtractionPreview(input,this.ctrl.signal);if(id!==this.generation||this.disposed)return;
      if(preview.kind!==input.kind||preview.source.canonicalText!==input.source.text.replace(/\r\n?/g,'\n')||preview.operationalWrites!==0||preview.readyForT9Preview!==false)throw Error('unexpected');
      this.update({preview,busy:false});
    }catch{if(id===this.generation)this.update({busy:false,error:'Preview unavailable. No operational records were saved. Check setup or input before trying again; another request may incur AI charges.'});}
  }
}
