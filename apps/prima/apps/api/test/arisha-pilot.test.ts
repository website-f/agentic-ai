import { arishaMayConsult, arishaToolsFor } from '@prima/core';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arishaPilotAllowed, arishaCanPrepareRecords, leadershipOnboardingPermits } from '../src/arisha-pilot';

const ceo = { id: 'u-fauzan', opsTier: 'ceo' };
const finance = { id: 'u-fd', leadership: 'finance_director' };
const coo = { id: 'u-coo', opsTier: 'coo' };
const act = { id: 'u-audit', actRole: 'lead' };
const staff = { id: 'u-it-mgr', opsTier: 'manager' };

describe('Arisha: everyone consults, the four leaders prepare', () => {
  it('keeps the leadership pilot to the designated CEO, Finance Director, COO and ACT Lead accounts', () => {
    for (const user of [ceo, finance, coo, act]) assert.equal(arishaPilotAllowed(user), true);
    for (const user of [staff, { id: 'u-act-dep', actRole: 'deputy' }, { id: 'u-chair' },
      { id: 'other', opsTier: 'ceo' }, { id: 'other', leadership: 'finance_director' },
      { id: 'other', opsTier: 'coo' }, { id: 'other', actRole: 'lead' },
      { id: 'u-fd', leadership: 'chairman' }, { id: 'u-audit', actRole: 'deputy' },
      { id: 'u-fauzan', opsTier: 'coo' },
      { id: 'u-coo', opsTier: 'coo', integration: 'feed' },
    ]) assert.equal(arishaPilotAllowed(user), false);
  });

  it('P80: lets everyone who opens Prima consult her, never an integration login', () => {
    for (const user of [ceo, finance, coo, act, staff, { id: 'u-off-1' }, { id: 'other', opsTier: 'ceo' }]) assert.equal(arishaMayConsult(user), true);
    assert.equal(arishaMayConsult({ id: 'u-coo', opsTier: 'coo', integration: 'feed' }), false);
  });

  it('allows narrowly scoped preparation for CEO, COO and ACT, not general record writes', () => {
    assert.equal(arishaCanPrepareRecords(ceo), true);
    assert.equal(arishaCanPrepareRecords(coo), true);
    assert.equal(arishaCanPrepareRecords(act), true);
    for (const user of [finance, staff, { id: 'other', opsTier: 'ceo' }]) {
      assert.equal(arishaCanPrepareRecords(user), false);
    }
    assert.equal(arishaCanPrepareRecords({ ...ceo, integration: 'feed' }), false);
  });

  it('advertises only role-scoped summary and finance tools', () => {
    const names = (u: typeof ceo | typeof finance | typeof coo | typeof act) => arishaToolsFor(u).map((t) => t.name);
    assert.deepEqual(names(finance), ['task_guide', 'executive_summary', 'finance_papers', 'prepare_finance_paper']);
    assert.equal(names(coo).includes('finance_papers'), false);
    assert.equal(names(coo).includes('prepare_record'), true);
    assert.equal(names(act).includes('finance_papers'), true);
    // P80: anyone else gets only the read-only guide, never summaries, records or finance; integrations get nothing.
    assert.deepEqual(arishaToolsFor({ id: 'spoof', opsTier: 'ceo' }).map((t) => t.name), ['task_guide']);
    assert.deepEqual(arishaToolsFor(staff).map((t) => t.name), ['task_guide']);
    assert.deepEqual(arishaToolsFor({ ...ceo, integration: 'feed' }), []);
    const context = arishaToolsFor(coo).find((t) => t.name === 'executive_summary')!.inputSchema.properties.context as { enum: string[] };
    assert.deepEqual(context.enum, ['operations']);
  });

  it('optionally locks normal office API access to the four onboarding leaders', () => {
    assert.equal(leadershipOnboardingPermits(staff, {}), true);
    assert.equal(leadershipOnboardingPermits(staff, { LEADERSHIP_ONBOARDING_ONLY: 'false' }), true);
    assert.equal(leadershipOnboardingPermits(staff, { LEADERSHIP_ONBOARDING_ONLY: 'true' }), false);
    for (const user of [ceo, finance, coo, act]) {
      assert.equal(leadershipOnboardingPermits(user, { LEADERSHIP_ONBOARDING_ONLY: 'true' }), true);
    }
  });
});

