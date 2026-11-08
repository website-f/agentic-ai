// SharePoint proof links (staff usability rule 6, 4 Nov 2026): the server setting that narrows links to the group's
// SharePoint host. Parse only; no Microsoft call. Synthetic host names only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore, PrimaService, generateDataset, myt } from '@prima/core';
import { apiProofLinkHosts } from '../src/db';

describe('SHAREPOINT_PROOF_HOSTS', () => {
  it('is empty when unset, so any company SharePoint host is accepted until IT sets it', () => {
    assert.deepEqual(apiProofLinkHosts({}), []);
    assert.deepEqual(apiProofLinkHosts({ SHAREPOINT_PROOF_HOSTS: '  ' }), []);
  });
  it('keeps exact SharePoint hosts and drops personal OneDrive and other hosts', () => {
    assert.deepEqual(apiProofLinkHosts({ SHAREPOINT_PROOF_HOSTS: 'Example.sharepoint.com, example-my.sharepoint.com,evil.test' }), ['example.sharepoint.com']);
  });
  it('refuses every link when set but with no usable host, never falling back to any host', async () => {
    const hosts = apiProofLinkHosts({ SHAREPOINT_PROOF_HOSTS: 'evil.test' });
    assert.equal(hosts.length, 1);
    const today = '2026-10-31';
    const now = myt(today, '10:00');
    const svc = new PrimaService(new MemoryStore(generateDataset({ today, now })), () => now);
    svc.proofLinkHosts = hosts;
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex1');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT host check', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: '2026-11-02' });
    await assert.rejects(
      svc.itJobStep(ex, j.id, 'submit', 'Done in SharePoint', [{ kind: 'link', url: 'https://example.sharepoint.com/sites/IT/Shared%20Documents/a.pdf' }]),
      /not in the group SharePoint/,
    );
  });
});
