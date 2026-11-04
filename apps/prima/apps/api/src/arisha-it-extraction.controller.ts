import { Body, Controller, Get, Header, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, verifiedEntraAssertion } from './auth';
import { Db } from './db';
import { extractionAudit } from './arisha-it-extraction-audit';
import { arishaConfig, IdentityToken } from './arisha';
import { AzureItExtractionModel } from './arisha-it-extraction-azure';
import { ExtractionError, extractionConfig, ItExtractionPreviewService, type ExtractionActor } from './arisha-it-extraction';

/** Register explicitly in AppModule after Connections' verified assertion accessor is merged. */
@Controller('api/arisha/it-extraction')
@UseGuards(AuthGuard)
export class ItExtractionController {
  private readonly configured:boolean;
  private readonly service:ItExtractionPreviewService;
  constructor(private readonly db:Db){
    const cfg=arishaConfig();this.configured=!!cfg;
    const token=new IdentityToken();
    const provider=cfg ? new AzureItExtractionModel(cfg,()=>token.get()) : {extract:async()=>{throw new ExtractionError('DISABLED');}};
    this.service=new ItExtractionPreviewService(provider,{...extractionConfig(),enabled:!!cfg&&extractionConfig().enabled},30000,extractionAudit(db));
  }
  private async actor(req:object):Promise<ExtractionActor>{
    const assertion=verifiedEntraAssertion(req);
    if(!assertion)throw new HttpException('FORBIDDEN',403);
    return this.db.asUser(assertion.userId,async(_svc,user)=>({id:user.id,opsTier:user.opsTier,integration:user.integration,verifiedEntra:typeof user.entraOid==='string'&&user.entraOid.toLowerCase()===assertion.oid.toLowerCase()}));
  }
  @Get()
  @Header('Cache-Control','no-store')
  async status(@Req() req:object){return {...this.service.status(await this.actor(req)),configured:this.configured};}
  @Post('preview')
  @Header('Cache-Control','no-store')
  async preview(@Req() req:object,@Body() body:unknown){
    const actor=await this.actor(req);
    try{return await this.service.preview(actor,body);}catch(e){
      const code=e instanceof ExtractionError?e.code:'MODEL_UNAVAILABLE';
      const status=code==='FORBIDDEN'?403:code==='BUSY'?429:code==='DISABLED'||code==='MODEL_UNAVAILABLE'?503:code==='INVALID_MODEL_OUTPUT'?502:400;
      throw new HttpException(code,status);
    }
  }
}
