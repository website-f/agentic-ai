import {sha256Hex} from './audit';
/** Lexical object-key serialization, including numeric-looking keys; matches SQL canonical tokens. */
export function cleanupCanonical(x:unknown):string{if(Array.isArray(x))return '['+x.map(cleanupCanonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+cleanupCanonical((x as Record<string,unknown>)[k])).join(',')+'}';const value=JSON.stringify(x);if(value===undefined)throw Error('Cleanup hash requires JSON values.');return value;}
export const cleanupHash=(x:unknown)=>sha256Hex(cleanupCanonical(x));
