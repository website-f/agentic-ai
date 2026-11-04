import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebConnectors, webConnectorConfig } from '../src/web-connectors';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const allOn = { cloudflare: true, github: true, uptime: true, registrar: true, maildns: true, m365: true, sharepoint: true };
const account = '0123456789abcdef0123456789abcdef';

function fixture(env: NodeJS.ProcessEnv, answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const http = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push(String(url));
    return answer(String(url), init);
  }) as typeof fetch;
  return { calls, c: new WebConnectors(() => env, http) };
}

describe('website connectors', () => {
  it('nothing is configured without keys, and nothing is called', async () => {
    assert.deepEqual(Object.values(webConnectorConfig({})), [false, false, false, false, false, false, false]);
    const { calls, c } = fixture({}, () => json({}));
    const feed = await c.feed(allOn, ['sample.com.my'], '2026-10-31T00:00:00.000Z');
    assert.deepEqual(feed, { at: '2026-10-31T00:00:00.000Z' });
    assert.equal(calls.length, 0);
    assert.deepEqual(await c.deliver([{ id: 'n1', title: 't', email: true, teams: true, toEntraOid: null }], ''), []);
  });

  it('a configured connector the CEO has not switched on is not called', async () => {
    const { calls, c } = fixture({ UPTIMEROBOT_API_KEY: 'ur-key' }, () => json({ stat: 'ok', monitors: [] }));
    await c.feed({ ...allOn, uptime: false }, []);
    assert.equal(calls.length, 0);
  });

  it('reads Cloudflare projects and DNS records with the read-only token', async () => {
    const { calls, c } = fixture({ CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: account }, (url, init) => {
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer cf-token');
      assert.equal(init.method, 'GET');
      if (url.includes('/pages/projects'))
        return json({ success: true, result: [{ name: 'sample-site', subdomain: 'sample-site.pages.dev', domains: ['sample.com.my'], latest_deployment: { id: 'd1', created_on: '2026-10-30T01:00:00Z', url: 'https://x.pages.dev', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { branch: 'main', commit_hash: 'abc' } } } }] });
      if (url.includes('/dns_records')) return json({ success: true, result: [{ type: 'A', name: 'sample.com.my', content: '192.0.2.1' }] });
      return json({ success: true, result: [{ id: account, name: 'sample.com.my' }] });
    });
    const feed = await c.feed(allOn, []);
    assert.ok(feed.cloudflare?.ok);
    if (!feed.cloudflare?.ok) return;
    assert.equal(feed.cloudflare.data.projects[0].latest?.status, 'success');
    assert.deepEqual(feed.cloudflare.data.projects[0].domains, ['sample.com.my', 'sample-site.pages.dev']);
    assert.equal(feed.cloudflare.data.zones[0].records[0].content, '192.0.2.1');
    assert.equal(calls.length, 3);
  });

  it('a refused key becomes a recorded error without the key in it', async () => {
    const { c } = fixture({ UPTIMEROBOT_API_KEY: 'secret-key' }, () => json({ stat: 'fail', error: { message: 'api_key not found' } }));
    const feed = await c.feed(allOn, []);
    assert.deepEqual(feed.uptime, { ok: false, error: 'PROVIDER_REJECTED' });
    assert.ok(!JSON.stringify(feed).includes('secret-key'));
  });

  it('maps UptimeRobot status and certificate expiry', async () => {
    const { c } = fixture({ UPTIMEROBOT_API_KEY: 'k' }, () => json({ stat: 'ok', monitors: [{ url: 'https://sample.com.my', status: 9, logs: [{ datetime: 1793000000 }], ssl: { expires: 1795000000 } }] }));
    const feed = await c.feed(allOn, []);
    assert.ok(feed.uptime?.ok);
    if (!feed.uptime?.ok) return;
    assert.equal(feed.uptime.data.monitors[0].status, 'down');
    assert.match(feed.uptime.data.monitors[0].sslExpiresOn ?? '', /^\d{4}-\d{2}-\d{2}$/);
  });

  it('fails an incomplete registry batch without silently skipping domains', async () => {
    const { c } = fixture({ WEB_RDAP_ENABLED: 'true' }, (url) =>
      url.endsWith('/sample.com') ? json({ objectClassName: 'domain', events: [{ eventAction: 'expiration', eventDate: '2027-03-01T00:00:00Z' }], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Sample Registrar']]] }] }) : json({}, 404),
    );
    const feed = await c.feed(allOn, ['sample.com', 'none.my', 'not a domain']);
    assert.deepEqual(feed.registrar, { ok: false, error: 'INCOMPLETE_RESPONSE' });
  });

  it('cannot send mail or webhooks even with all legacy keys', async () => {
    const env = {
      ENTRA_TENANT_ID: '11111111-2222-3333-4444-555555555555',
      WEB_GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      WEB_GRAPH_CLIENT_SECRET: 's',
      WEB_NOTICES_SENDER: 'it-notices@example.com',
      WEB_TEAMS_WEBHOOK_URL: 'https://evil.example.com/hook',
    };
    const { calls, c } = fixture(env, (url) => {
      if (url.includes('/oauth2/')) return json({ access_token: 'graph' });
      if (url.includes('/sendMail')) return new Response(null, { status: 202 });
      return json({ mail: 'person@example.com' });
    });
    const out = await c.deliver([{ id: 'n1', title: 'Domain expires', email: true, teams: true, toEntraOid: '99999999-8888-7777-6666-555555555555' }], 'https://app.example.com');
    assert.deepEqual(out, []);
    assert.equal(webConnectorConfig(env).m365, false);
    assert.equal(calls.length, 0);

    assert.ok(!calls.some((u) => u.includes('evil.example.com')));
  });
});

describe('email DNS check', () => {
  it('reads SPF, DMARC, DKIM and MX from public DNS', async () => {
    const { c } = fixture({ WEB_MAILDNS_ENABLED: 'true' }, (url) => {
      const u = new URL(url);
      const name = u.searchParams.get('name');
      const type = u.searchParams.get('type');
      if (name === 'sample.com.my' && type === 'TXT') return json({ Status: 0, Answer: [{ data: '"v=spf1 include:spf.protection.outlook.com -all"' }] });
      if (name === '_dmarc.sample.com.my') return json({ Status: 0, Answer: [{ data: '"v=DMARC1; p=quarantine; rua=mailto:d@sample.com.my"' }] });
      if (name === 'selector1._domainkey.sample.com.my') return json({ Status: 0, Answer: [{ data: 'selector1-sample._domainkey.sample.onmicrosoft.com.' }] });
      if (type === 'MX') return json({ Status: 0, Answer: [{ data: '0 sample-com-my.mail.protection.outlook.com.' }] });
      return json({ Status: 0 });
    });
    const feed = await c.feed({ cloudflare: false, github: false, uptime: false, registrar: false, maildns: true, m365: false, sharepoint: false }, ['sample.com.my']);
    assert.ok(feed.maildns?.ok);
    if (!feed.maildns?.ok) return;
    assert.deepEqual(feed.maildns.data.domains[0], {
      name: 'sample.com.my',
      spf: 'v=spf1 include:spf.protection.outlook.com -all',
      dmarc: 'v=DMARC1; p=quarantine; rua=mailto:d@sample.com.my',
      dkim: true,
      mx: ['sample-com-my.mail.protection.outlook.com.'],
    });
  });
});

describe('reconstructed connector security regression coverage', () => {
  it('does not reflect provider bodies/status text, thrown credentials or malformed JSON', async () => {
    const secret = 'SYNTHETIC_SECRET_CANARY';
    for (const answer of [() => json({ stat:'fail', error:{message:secret} }), () => new Response(secret,{status:401,statusText:secret}), () => { throw new Error(`https://example.invalid/?key=${secret}`); }, () => { throw secret; }, () => new Response(`{"bad":"${secret}`)]) {
      const { c } = fixture({ UPTIMEROBOT_API_KEY:secret }, answer);
      const feed = await c.feed(allOn, []);
      assert.equal(feed.uptime?.ok,false); assert.ok(!JSON.stringify(feed).includes(secret));
      assert.match(JSON.stringify(feed),/PROVIDER_REJECTED|INVALID_RESPONSE|REQUEST_FAILED/);
    }
  });
  it('stops and cancels a streamed response after the 2MiB byte limit', async () => {
    let pulls=0, cancelled=false;
    const body=new ReadableStream<Uint8Array>({ pull(c) { pulls++;c.enqueue(new Uint8Array(1024*1024)); },cancel() {cancelled=true;} },{highWaterMark:0});
    const { c }=fixture({UPTIMEROBOT_API_KEY:'k'},()=>new Response(body));
    assert.deepEqual((await c.feed(allOn,[])).uptime,{ok:false,error:'RESPONSE_TOO_LARGE'});
    assert.equal(pulls,3);assert.equal(cancelled,true);
  });
  it('rejects excessive declared content length before reading body bytes', async()=>{
    let pulls=0,cancelled=false;
    const body=new ReadableStream<Uint8Array>({pull(){pulls++;},cancel(){cancelled=true;}},{highWaterMark:0});
    const {c}=fixture({UPTIMEROBOT_API_KEY:'k'},()=>new Response(body,{headers:{'content-length':'3000000'}}));
    assert.deepEqual((await c.feed(allOn,[])).uptime,{ok:false,error:'RESPONSE_TOO_LARGE'});
    assert.equal(pulls,0);assert.equal(cancelled,true);
  });
  it('requires a nonempty bounded explicit GitHub allowlist before making any call',async()=>{
    for(const repos of [undefined,'','safe,../escape','safe,SAFE',Array.from({length:21},(_,i)=>`repo${i}`).join(',')]){
      const env={GITHUB_WEBSITES_TOKEN:'t',GITHUB_WEBSITES_OWNER:'group',GITHUB_WEBSITES_REPOS:repos};
      assert.equal(webConnectorConfig(env).github,false);
      const {c,calls}=fixture(env,()=>{throw new Error('No provider expected');});
      assert.equal((await c.feed(allOn,[])).github,undefined);assert.equal(calls.length,0);
    }
  });
  it('reads named private repositories directly and encodes branches, never owner enumeration',async()=>{
    const {c,calls}=fixture({GITHUB_WEBSITES_TOKEN:'t',GITHUB_WEBSITES_OWNER:'group',GITHUB_WEBSITES_REPOS:'private-site'},(url,init)=>{
      assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal((init.headers as Record<string,string>).Authorization,'Bearer t');
      if(url.endsWith('/private-site'))return json({full_name:'group/private-site',private:true,default_branch:'feature/a'});
      assert.ok(url.endsWith('/commits/feature%2Fa'));return json({sha:'a'.repeat(40),commit:{message:'Synthetic',committer:{date:'2026-10-31T00:00:00Z'}}});
    });
    assert.equal((await c.feed(allOn,[])).github?.ok,true);assert.equal(calls.length,2);
    assert.ok(calls.every(u=>u.startsWith('https://api.github.com/repos/group/private-site')));
  });
  it('discards a partial repository batch when one named repository fails',async()=>{
    const {c}=fixture({GITHUB_WEBSITES_TOKEN:'t',GITHUB_WEBSITES_OWNER:'group',GITHUB_WEBSITES_REPOS:'one,two'},url=>{
      if(url.endsWith('/two'))return json({},404);
      return url.includes('/commits/')?json({sha:'a'.repeat(40),commit:{}}):json({full_name:'group/one',default_branch:'main'});
    });
    assert.deepEqual((await c.feed(allOn,[])).github,{ok:false,error:'PROVIDER_REJECTED'});
  });
  it('rejects registry redirects and missing domains instead of reporting empty success',async()=>{
    for(const answer of [()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),()=>json({},404)]){
      const {c,calls}=fixture({WEB_RDAP_ENABLED:'true'},(_url,init)=>{assert.equal(init.redirect,'error');return answer();});
      assert.deepEqual((await c.feed(allOn,['sample.com'])).registrar,{ok:false,error:'PROVIDER_REJECTED'});
      assert.deepEqual(calls,['https://rdap.org/domain/sample.com']);
    }
  });
  it('refuses truncated Cloudflare and Uptime collections rather than overwriting observations',async()=>{
    const cf=fixture({CLOUDFLARE_API_TOKEN:'t',CLOUDFLARE_ACCOUNT_ID:account},()=>json({success:true,result:[],result_info:{total_pages:2}}));
    assert.deepEqual((await cf.c.feed(allOn,[])).cloudflare,{ok:false,error:'INCOMPLETE_RESPONSE'});
    const up=fixture({UPTIMEROBOT_API_KEY:'k'},()=>json({stat:'ok',monitors:[],pagination:{total:51}}));
    assert.deepEqual((await up.c.feed(allOn,[])).uptime,{ok:false,error:'INCOMPLETE_RESPONSE'});
  });
  it('requires numeric integer DNS status and boolean truncation; malformed data is not missing SPF',async()=>{
    const answers=[{Status:2},{Status:0,TC:true},{},...[null,false,'','0','3',0.5].map(Status=>({Status})),...[null,'','false',0].map(TC=>({Status:0,TC}))];
    for(const answer of answers){
      const {c}=fixture({WEB_MAILDNS_ENABLED:'true'},()=>json(answer));
      assert.deepEqual((await c.feed(allOn,['sample.com'])).maildns,{ok:false,error:'INCOMPLETE_RESPONSE'});
    }
  });
  it('refuses invalid or oversized domain batches before any network request',async()=>{
    for(const domains of [['good.com','bad/path.com'],Array.from({length:21},(_,i)=>`d${i}.com`)]){
      const {c,calls}=fixture({WEB_MAILDNS_ENABLED:'true',WEB_RDAP_ENABLED:'true'},()=>json({}));
      const feed=await c.feed(allOn,domains);assert.equal(feed.maildns?.ok,false);assert.equal(feed.registrar?.ok,false);assert.equal(calls.length,0);
    }
  });
  it('bounds Graph token content and refuses SharePoint pages with continuation',async()=>{
    const env={ENTRA_TENANT_ID:'11111111-2222-3333-4444-555555555555',WEB_GRAPH_CLIENT_ID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',WEB_GRAPH_CLIENT_SECRET:'s',WEB_REQUESTS_SITE_ID:'sample.sharepoint.com,11111111-2222-3333-4444-555555555555,aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',WEB_REQUESTS_LIST_ID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};
    const {c,calls}=fixture(env,url=>url.includes('/oauth2/')?json({access_token:'t'}):json({value:[],'@odata.nextLink':'https://evil.invalid/secret'}));
    assert.deepEqual((await c.feed(allOn,[])).sharepoint,{ok:false,error:'INCOMPLETE_RESPONSE'});assert.equal(calls.length,2);assert.ok(!calls.some(u=>u.includes('evil.invalid')));
    const large=fixture(env,()=>json({access_token:'a'.repeat(32769)}));
    assert.deepEqual((await large.c.feed(allOn,[])).sharepoint,{ok:false,error:'INVALID_RESPONSE'});assert.equal(large.calls.length,1);
  });
});

describe('overall feed deadline',()=>{
  it('cancels an approved multi-repository batch and discards earlier successful observations',async()=>{
    const calls:string[]=[];let cancellations=0;
    const env={GITHUB_WEBSITES_TOKEN:'t',GITHUB_WEBSITES_OWNER:'group',GITHUB_WEBSITES_REPOS:Array.from({length:20},(_,i)=>`repo${i}`).join(','),UPTIMEROBOT_API_KEY:'k'};
    const http=(async(url:string|URL|Request,init:RequestInit={})=>{
      calls.push(String(url));if(String(url).includes('uptimerobot'))return json({stat:'ok',monitors:[]});
      if(String(url).endsWith('/repo0'))return json({full_name:'group/repo0',default_branch:'main'});
      return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>{cancellations++;reject(new Error('secret provider text'));},{once:true}));
    }) as typeof fetch;
    const service=new WebConnectors(()=>env,http,25);const alive=setTimeout(()=>undefined,500);
    try{const feed=await service.feed(allOn,[]);assert.deepEqual(feed.github,{ok:false,error:'SYNC_TIMEOUT'});assert.deepEqual(feed.uptime,{ok:false,error:'SYNC_TIMEOUT'});assert.equal(cancellations,1);assert.equal(calls.length,3);assert.ok(!JSON.stringify(feed).includes('secret'));}finally{clearTimeout(alive);}
  });
  it('cancels a stalled response body and never starts the next domain after expiry',async()=>{
    let calls=0,cancelled=false;
    const service=new WebConnectors(()=>({WEB_RDAP_ENABLED:'true'}),(async()=>{calls++;return new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}));}) as typeof fetch,25);
    const alive=setTimeout(()=>undefined,500);
    try{assert.deepEqual((await service.feed(allOn,['one.com','two.com'])).registrar,{ok:false,error:'SYNC_TIMEOUT'});assert.equal(calls,1);assert.equal(cancelled,true);}finally{clearTimeout(alive);}
  });
});
