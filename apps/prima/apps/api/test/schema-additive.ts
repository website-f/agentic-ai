import assert from 'node:assert/strict';
/** Narrow source contract, not a general SQL parser. RLS/catalog tests separately verify each replacement. */
export function assertAdditiveSchema(source:string):void {
 const sql=source
  .replace(/--.*$/gm,'')
  // Direct statements and format() templates may replace guards/policies, never tables or rows.
  .replace(/\bDROP (?:POLICY|TRIGGER) IF EXISTS [a-z_][a-z0-9_]* ON prima\.(?:[a-z_][a-z0-9_]*|%I|%1\$I)(?=;|')/gi,'')
  // This removes authority; it is not a DELETE/TRUNCATE operation.
  .replace(/\bREVOKE DELETE,\s*TRUNCATE ON prima\.(?:[a-z_][a-z0-9_]*|%I|%1\$I) FROM prima_app(?=;|')/gi,'')
  // A DELETE trigger and TG_OP comparison intercept deletion; their function body is still scanned.
  .replace(/\bBEFORE (?:INSERT OR )?UPDATE OR DELETE(?=\s+ON\s+prima\.)/gi,'')
  .replace(/\bTG_OP\s*=\s*'DELETE'/g,'');
 assert.doesNotMatch(sql,/\b(DROP|TRUNCATE|DELETE)\b/i);
}
