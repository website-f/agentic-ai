import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppModule } from '../src/app.module';
import { JobEmailController, MailConnectionsController } from '../src/connections-mail/controllers';
import { PowerBiConnectionsController } from '../src/connections-powerbi/controller';
import { ItImportReviewController } from '../src/arisha-it-import.controller';
import { ItExtractionController } from '../src/arisha-it-extraction.controller';
test('Monday registration includes job email only; Mail Send and Power BI remain unregistered',()=>{
 const controllers=Reflect.getMetadata('controllers',AppModule) as unknown[];
 assert.ok(controllers.includes(JobEmailController));assert.ok(!controllers.includes(MailConnectionsController));assert.ok(!controllers.includes(PowerBiConnectionsController));
 const providers=Reflect.getMetadata('providers',AppModule) as {provide?:{name?:string}}[];
 assert.ok(providers.some(p=>p.provide?.name==='JobEmail'));assert.ok(!providers.some(p=>p.provide?.name==='StaffEmail'||p.provide?.name==='PowerBiReports'));
});
test('combined registration preserves extraction and reviewed import controllers',()=>{
 const controllers=Reflect.getMetadata('controllers',AppModule) as unknown[];
 assert.ok(controllers.includes(ItImportReviewController));assert.ok(controllers.includes(ItExtractionController));
});
test('Teams is status-only with no trusted adapter and no decision ingestion route',async()=>{
 const {TeamsConnectionController,teamsEvidenceModule}=await import('../src/connections-teams/controller');
 const controllers=Reflect.getMetadata('controllers',AppModule) as unknown[];assert.ok(controllers.includes(TeamsConnectionController));
 const module=teamsEvidenceModule();assert.equal(module.providers[0].useFactory().status().status,'NotConfigured');
 const methods=Object.getOwnPropertyNames(TeamsConnectionController.prototype).filter(n=>n!=='constructor');assert.deepEqual(methods,['status']);
 assert.equal(Reflect.getMetadata('method',TeamsConnectionController.prototype.status),0);
 const db={asUser:async(uid:string,fn:Function)=>fn({}, {id:uid})};const c=new TeamsConnectionController(db as never,module.providers[0].useFactory());
 const status=await c.status('u-current',{});assert.equal(status.userId,'u-current');assert.equal(status.providerVerified,false);assert.equal(status.canApplyFinanceApproval,false);
 assert.throws(()=>c.status('u-current',{userId:'u-other'}));
});
