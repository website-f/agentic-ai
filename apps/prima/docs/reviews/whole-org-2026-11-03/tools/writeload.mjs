const BASE='http://localhost:3077';
const login=async id=>(await (await fetch(BASE+'/api/auth/dev-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:id})})).json()).token;
const ex=[await login('u-it-ex1'),await login('u-it-ex2'),await login('u-it-ex3'),await login('u-it-ex4')];
for (const n of [20,50,100]) {
  const t=performance.now();
  const rs=await Promise.all(Array.from({length:n},(_,i)=>fetch(BASE+'/api/it/tickets',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+ex[i%4]},body:JSON.stringify({raisedFor:'Synthetic staff '+i,channel:'teams',category:'M365',priority:'P3',title:'Load request '+i,detail:'synthetic'})}).then(async r=>({s:r.status,ms:Math.round(performance.now()-t),b:r.status>=300?(await r.text()).slice(0,120):''}))));
  const lat=rs.map(r=>r.ms).sort((a,b)=>a-b);
  const bad=rs.filter(r=>r.s>=300);
  console.log('tickets x',n,'wall',Math.round(performance.now()-t),'p50',lat[n>>1],'max',lat.at(-1),'failed',bad.length, bad[0]?.s, bad[0]?.b);
}
