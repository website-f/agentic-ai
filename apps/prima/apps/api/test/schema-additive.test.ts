import assert from 'node:assert/strict';import {it} from 'node:test';
import {assertAdditiveSchema} from './schema-additive';import {migrationSql} from '../src/schema';
it('actual schema permits only narrow policy/guard replacement and revocation forms',()=>assertAdditiveSchema(migrationSql()));
it('known non-destructive guard syntax does not count as row deletion',()=>{
 for(const sql of ["DROP POLICY IF EXISTS company_wall ON prima.%1$I;","DROP TRIGGER IF EXISTS hr_it_guard ON prima.hr_it_requests;","EXECUTE format('DROP POLICY IF EXISTS hr_it_read ON prima.%I',t);","EXECUTE format('REVOKE DELETE, TRUNCATE ON prima.%I FROM prima_app',t);","CREATE TRIGGER hr_it_mapping_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.hr_it_authority_mappings FOR EACH ROW EXECUTE FUNCTION prima.hr_it_mapping_guard();","IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable'; END IF;"])assertAdditiveSchema(sql);
});
it('destructive DDL/DML still fails, including beside allowed guard syntax',()=>{
 for(const sql of ["DROP POLICY IF EXISTS company_wall ON prima.%1$I; DELETE FROM prima.users;","DROP TABLE prima.users;","DROP SCHEMA prima CASCADE;","TRUNCATE prima.users;","DELETE FROM prima.users;","EXECUTE format('DELETE FROM prima.%I',t);","DROP TRIGGER IF EXISTS x ON prima.users; DELETE FROM prima.users;","CREATE TRIGGER x BEFORE UPDATE OR DELETE ON prima.users FOR EACH ROW EXECUTE FUNCTION x(); DELETE FROM prima.users;","IF TG_OP='DELETE' THEN DELETE FROM prima.users; END IF;","REVOKE DELETE, TRUNCATE ON prima.users FROM prima_app; TRUNCATE prima.users;","DROP POLICY x ON prima.users;","EXECUTE 'DROP TABLE prima.users';"])assert.throws(()=>assertAdditiveSchema(sql),sql);
});
it('JSON extraction is parenthesized before subtraction in mutable history guards',()=>{
 const sql=migrationSql();
 assert.doesNotMatch(sql,/(?:->|#>)'[^']+'\s*-(?!>)/);
 for(const expr of ["((m->'receipts') - (jsonb_array_length(m->'receipts')-1))","((d->'history')-(n-1))","((d->'paid')-ARRAY['by','at','ref'])","((last->'payload')-'status')"])assert.ok(sql.includes(expr),expr);
});
