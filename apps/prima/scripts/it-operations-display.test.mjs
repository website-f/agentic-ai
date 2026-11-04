import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const src=ts.transpileModule(fs.readFileSync(new URL('../apps/web/src/it-operations/display.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const{parseRinggit,ringgit,amountSen}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
test('financial inputs preserve decimal sen without float rounding or implicit blank zero',()=>{assert.equal(parseRinggit('123.45'),12345);assert.equal(parseRinggit('0'),0);assert.equal(parseRinggit('10.1'),1010);for(const value of ['', ' ', '-1','1.001','1e3','Infinity','NaN','1,000','01','100000001'])assert.throws(()=>parseRinggit(value));});
test('missing and malformed rates never render as free or valid amounts',()=>{assert.match(ringgit(null),/unknown/);assert.match(ringgit(undefined),/unknown/);assert.match(ringgit(NaN),/could not/);assert.match(ringgit(0),/0.00/);assert.match(ringgit(12345),/123.45/);});

test('valid maximum historical and accumulated bill amount displays without an input-parser crash',()=>{assert.equal(parseRinggit('100000000'),10000000000);assert.equal(amountSen(100000000),10000000000);assert.match(ringgit(amountSen(100*1000000)),/100,000,000.00/);});
