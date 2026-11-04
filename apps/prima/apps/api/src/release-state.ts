import type {Pool} from 'pg';
import {releaseArtifact} from './release-artifact';
import {releaseCatalogState} from './release-catalog';
/** File completeness plus live catalog protections; never implies Microsoft/AI configuration. */
async function inspectRelease(pool:Pick<Pool,'connect'>){
 try{const a=releaseArtifact(),catalog=await releaseCatalogState(pool,{baseSha256:a.manifest.base.sha256});return {version:1,expected:a.sha256,manifest:a.manifest,ready:catalog.ready,catalog,providerVerified:false};}
 catch{return {version:1,expected:null,manifest:null,ready:false,catalog:null,codes:['RELEASE_ARTIFACT_UNAVAILABLE'],providerVerified:false};}
}
export async function assertReleaseCurrent(pool:Pick<Pool,'connect'>){if(!(await releaseState(pool)).ready)throw Error('Complete release SQL/catalog is not ready. Run explicit reviewed module verification; startup never migrates.');}

// Coalesce concurrent diagnostics only; never cache a successful catalog result across requests.
const pending=new WeakMap<object,ReturnType<typeof inspectRelease>>();
export function releaseState(pool:Pick<Pool,'connect'>){
 const current=pending.get(pool);if(current)return current;
 const work=inspectRelease(pool).finally(()=>pending.delete(pool));pending.set(pool,work);return work;
}
