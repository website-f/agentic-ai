const BASE='http://localhost:3077';
const r=await fetch(BASE+'/api/auth/dev-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:'u-coo'})});const {token}=await r.json();
const t=performance.now();
const rs=await Promise.all(Array.from({length:20},()=>fetch(BASE+'/api/home?companyId=co-sasa',{headers:{authorization:'Bearer '+token}}).then(async x=>({s:x.status,ms:Math.round(performance.now()-t),b:(await x.text()).slice(0,160)}))));
for(const x of rs) console.log(x.s,x.ms,x.s!==200?x.b:'');
