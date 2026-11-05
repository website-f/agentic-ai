/** Existing purchase authority stays with the server; both decisions require a recorded reason. */
export function ItPurchaseDecision({note,onNote,busy,onDecide}:{note:string;onNote:(s:string)=>void;busy:boolean;onDecide:(action:'approve'|'reject',reason:string)=>unknown}){
 const reason=note.trim(),blocked=busy||reason.length<3||note.length>300;
 const decide=(action:'approve'|'reject')=>{if(!blocked)onDecide(action,reason);};
 return <><input className="input" aria-label="Approval or rejection reason" placeholder="Reason required to approve or reject (at least 3 characters)" maxLength={300} value={note} onChange={e=>onNote(e.target.value)} />
 <div className="row it-actions"><button className="btn btn-primary btn-sm" disabled={blocked} onClick={()=>decide('approve')}>Approve</button><button className="btn btn-sm" disabled={blocked} onClick={()=>decide('reject')}>Reject</button></div></>;
}
