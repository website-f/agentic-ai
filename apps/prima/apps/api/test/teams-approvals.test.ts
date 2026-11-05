// Teams approvals read job (Fauzan, 1 Nov 2026): the Graph mapping and the switch, with a fake Graph. Nothing reaches
// Microsoft 365 and no database is used.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapGraphResult, readTeamsApprovals, type GraphListItem } from '../src/teams-approvals';

const item: GraphListItem = {
  id: '7',
  eTag: '"abc,1"',
  createdDateTime: '2026-10-31T02:20:00Z',
  lastModifiedDateTime: '2026-10-31T02:20:00Z',
  createdBy: { user: { id: 'oid-flow' } },
  lastModifiedBy: { user: { id: 'oid-flow' } },
  fields: {
    PrimaPaymentId: 'pay-1',
    CompanyId: 'pwvsb',
    ApprovalId: 'appr-7',
    Outcome: 'Approve',
    CompletionDate: '2026-10-31T02:15:00Z',
    RequestItemId: '3',
    RequestVersion: '1.0',
    Fingerprint: 'f00d',
    AssignedTo: '["oid-fd","oid-ceo"]',
    Responses: '[{"objectId":"oid-fd","upn":"fd@example.test","response":"Approve","comment":"ok","responseDate":"2026-10-31T02:15:00Z"}]',
  },
};

describe('Teams approvals read job', () => {
  it('maps a Graph results item, and broken JSON leaves fields empty so the checks fail', () => {
    const r = mapGraphResult(item, 1);
    assert.equal(r.createdById, 'oid-flow');
    assert.deepEqual(r.assignedTo, ['oid-fd', 'oid-ceo']);
    assert.equal(r.responses[0].comment, 'ok');
    const bad = mapGraphResult({ ...item, fields: { ...item.fields, Responses: '{not json', AssignedTo: 5 } }, null);
    assert.deepEqual([bad.responses, bad.assignedTo, bad.versionCount], [[], [], null]);
  });

  it('reads nothing while TEAMS_APPROVALS_READ is off, and hands every result to Prima when on', async () => {
    const calls: string[] = [];
    const recorded: string[] = [];
    const deps = {
      siteId: 'site',
      resultsListId: 'results',
      requestsListId: 'requests',
      graphGet: async (path: string) => {
        calls.push(path);
        if (path.endsWith('/versions')) return { value: [{}] };
        if (path.includes('/requests/')) return { ...item, id: '3', fields: { PrimaPaymentId: 'pay-1', CompanyId: 'pwvsb', Fingerprint: 'f00d', _UIVersionString: '1.0' } };
        return { value: [item] };
      },
      record: async (companyId: string, result: { itemId: string }, request: { version: string } | null) => {
        recorded.push(`${companyId}:${result.itemId}:${request?.version}`);
        return { verdict: 'approved' };
      },
    };
    const prev = process.env.TEAMS_APPROVALS_READ;
    try {
      delete process.env.TEAMS_APPROVALS_READ;
      assert.deepEqual(await readTeamsApprovals(deps), { read: 0, verdicts: {} });
      assert.equal(calls.length, 0);
      process.env.TEAMS_APPROVALS_READ = 'true';
      assert.deepEqual(await readTeamsApprovals(deps), { read: 1, verdicts: { approved: 1 } });
      assert.deepEqual(recorded, ['pwvsb:7:1.0']);
      // Only GET calls on the configured lists.
      assert.ok(calls.every((c) => c.startsWith('/sites/site/lists/results') || c.startsWith('/sites/site/lists/requests')));
    } finally {
      if (prev === undefined) delete process.env.TEAMS_APPROVALS_READ;
      else process.env.TEAMS_APPROVALS_READ = prev;
    }
  });
});
