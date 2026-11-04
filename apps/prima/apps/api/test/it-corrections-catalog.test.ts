import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {it} from 'node:test';
import {migrationSql} from '../src/schema';
import {IT_MANUAL_FUNCTION_PINS} from '../src/it-manual-readiness';
import {IT_OPERATIONS_FUNCTION_PINS} from '../src/it-operations-readiness';
const sql=migrationSql();
it('correction and billing source bodies match catalog pins, without a new helper grant',()=>{
 for(const [name,pin] of Object.entries({...IT_MANUAL_FUNCTION_PINS,...IT_OPERATIONS_FUNCTION_PINS})){
  const body=sql.match(new RegExp(String.raw`CREATE OR REPLACE FUNCTION prima\.${name}\([^]*?AS \$\$([^]*?)\$\$;`))?.[1];assert.ok(body,name);assert.equal(createHash('md5').update(body).digest('hex'),pin,name);
 }
 assert.match(sql,/WITH RECURSIVE nodes\(v,path,prefix\)/);
 assert.match(sql,/asset \? 'correction' THEN ','\|\|\(asset#>'\{correction,version\}'\)::text/);
 assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION prima\.hr_it_canonical/);
});

it('inline correction canonical walk qualifies SQL values instead of conflicting with PLpgSQL v',()=>{
 const guard=sql.split('CREATE OR REPLACE FUNCTION prima.it_register_guard()')[1].split('WITH RECURSIVE nodes(v,path,prefix) AS (')[1].split("IF c->>'previousHash'")[0];
 assert.match(guard,/jsonb_typeof\(token_node\.v\)/);
 assert.doesNotMatch(guard,/jsonb_typeof\(v\)|ELSE v::text/);
 assert.match(guard,/string_agg\(canonical_tokens\.token,'' ORDER BY canonical_tokens\.path\)/);
});
