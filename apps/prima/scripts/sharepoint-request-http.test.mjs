import test from 'node:test';import assert from 'node:assert/strict';
import { HttpApi, SESSION_ENDED, dutyContext } from './http-test-loader.mjs';
test('setup creation pins bearer and validates expected owner before POST',async()=>{const a=new HttpApi('https://synthetic.invalid');a.ready=async()=>({ms:null});a.bearer=async()=>'synthetic';const old=global.fetch,calls=[];global.fetch=async(url,o)=>{calls.push({url,o});return{ok:true,json:async()=>url.endsWith('/me')?{user:{id:'u1'}}:{reference:'IT-1'}};};try{await a.sharePointRequest('https://example.sharepoint.com/sites/IT','r1','u1');assert.equal(calls.length,2);assert.equal(calls[0].o.method,'GET');assert.equal(calls[1].o.method,'POST');assert(calls.every(c=>c.o.headers.authorization==='Bearer synthetic'));}finally{global.fetch=old;}});
test('stale owner and Microsoft account switch refuse before setup POST',async()=>{for(const mode of ['owner','account']){const a=new HttpApi('https://synthetic.invalid');let active='a';a.ready=async()=>({ms:{account:()=>({homeAccountId:active})}});a.bearer=async()=>{if(mode==='account')active='b';return'synthetic';};const old=global.fetch;let posts=0;global.fetch=async(_url,o)=>{if(o.method==='POST')posts++;return{ok:true,json:async()=>({user:{id:'other'}})};};try{await assert.rejects(a.sharePointRequest('https://example.sharepoint.com/sites/IT','r1','u1'));assert.equal(posts,0);}finally{global.fetch=old;}}});

const enrollment = {
  accountId: 'synthetic-account', companyId: 'synthetic-company', siteId: 'synthetic-site',
  deviceId: 'synthetic-device', enrollmentId: 'synthetic-enrollment',
};
function bindEnrollment() {
  dutyContext.bindDutyContext(enrollment, dutyContext.contextGeneration());
  return dutyContext.dutyLease();
}

test('HTTP loader retains real duty invalidation before sign-in or sign-out can fail', async () => {
  try {
    for (const action of ['signInMicrosoft', 'signOut', 'signIn']) {
      const lease = bindEnrollment();
      const api = new HttpApi('https://synthetic.invalid');
      api.ready = async () => { throw new Error('Synthetic sign-in interruption'); };
      await assert.rejects(api[action]('synthetic-account'), /Synthetic sign-in interruption/);
      assert.equal(dutyContext.contextGeneration(), lease.generation + 1, action);
      assert.throws(() => dutyContext.assertDutyLease(lease), dutyContext.OfflineContextError);
      assert.throws(() => dutyContext.dutyLease(), dutyContext.OfflineContextError);
    }
  } finally {
    dutyContext.invalidateDutyContext(false);
  }
});

test('ordinary and Microsoft-only HTTP 401 responses invalidate duty before notifying the app', async () => {
  const priorFetch = global.fetch;
  const priorWindow = Object.getOwnPropertyDescriptor(global, 'window');
  try {
    for (const microsoftOnly of [false, true]) {
      const lease = bindEnrollment();
      const api = new HttpApi('https://synthetic.invalid');
      api.ready = async () => ({ ms: {
        account: () => ({ homeAccountId: 'synthetic-home', tenantId: 'synthetic-tenant', localAccountId: 'synthetic-user' }),
        token: async () => 'synthetic-token',
      } });
      let notifications = 0;
      global.window = { dispatchEvent: (event) => {
        assert.equal(event.type, SESSION_ENDED);
        assert.throws(() => dutyContext.assertDutyLease(lease), dutyContext.OfflineContextError);
        notifications++;
      } };
      global.fetch = async (url) => microsoftOnly && url.endsWith('/me')
        ? { ok: true, json: async () => ({ user: { id: 'synthetic-account' } }) }
        : { ok: false, status: 401, json: async () => ({ message: 'Synthetic session expired' }) };
      await assert.rejects(
        microsoftOnly ? api.m365Call('synthetic-account', 'GET', '/connections/mail/jobs/status') : api.me(),
        { status: 401 },
      );
      assert.equal(dutyContext.contextGeneration(), lease.generation + 1);
      assert.equal(notifications, 1);
    }
  } finally {
    global.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(global, 'window', priorWindow);
    else delete global.window;
    dutyContext.invalidateDutyContext(false);
  }
});

test('ordinary HTTP success and non-session errors preserve the bound duty lease', async () => {
  const priorFetch = global.fetch;
  try {
    for (const status of [200, 403, 500]) {
      const lease = bindEnrollment();
      const api = new HttpApi('https://synthetic.invalid');
      api.bearer = async () => 'synthetic-token';
      global.fetch = async () => ({ ok: status === 200, status, json: async () => ({ synthetic: true }) });
      if (status === 200) assert.deepEqual(await api.me(), { synthetic: true });
      else await assert.rejects(api.me(), { status });
      assert.equal(dutyContext.contextGeneration(), lease.generation);
      assert.doesNotThrow(() => dutyContext.assertDutyLease(lease));
    }
  } finally {
    global.fetch = priorFetch;
    dutyContext.invalidateDutyContext(false);
  }
});
