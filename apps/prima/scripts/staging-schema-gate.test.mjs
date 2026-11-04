import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireSchemaMatch } from './staging-schema-gate.mjs';
const oldHash = 'a'.repeat(64), newHash = 'b'.repeat(64);
describe('fail-closed image/schema decisions', () => {
  it('allows deployment after migration even while the old API current=false', () => {
    assert.equal(requireSchemaMatch('deploy', newHash, { current:false, expected:oldHash, applied:newHash }).applied, newHash);
  });
  it('allows matching deployment and matching-schema rollback', () => {
    for (const mode of ['deploy','rollback']) assert.equal(requireSchemaMatch(mode, newHash, { current:true, expected:newHash, applied:newHash }).imageExpected,newHash);
  });
  it('forbids rollback to an older schema after a schema-changing migration', () => {
    assert.throws(() => requireSchemaMatch('rollback', oldHash, {current:true,expected:newHash,applied:newHash}), /does not match/);
  });
  it('rejects unknown, missing, malformed and contradictory evidence', () => {
    for (const mode of ['deploy','rollback']) {
      for (const report of [undefined,null,{},[],{current:true,expected:newHash,applied:null},{current:true,expected:newHash,applied:''},{current:true,expected:newHash,applied:'not-a-sha'},{current:true,expected:oldHash,applied:newHash},{current:false,expected:newHash,applied:newHash},{current:'true',expected:newHash,applied:newHash}]) {
        assert.throws(() => requireSchemaMatch(mode,newHash,report));
      }
      for (const expected of ['',undefined,'None','x'.repeat(64),newHash.toUpperCase()]) assert.throws(() => requireSchemaMatch(mode,expected,{current:true,expected:newHash,applied:newHash}));
    }
  });
  it('rejects unsupported operation modes', () => assert.throws(() => requireSchemaMatch('migrate',newHash,{current:true,expected:newHash,applied:newHash})));
});
