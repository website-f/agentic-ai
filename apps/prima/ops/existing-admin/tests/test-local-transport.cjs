// TEST ONLY explicit node --require; never ship as a live transport override.
// Real localhost TLS+SCRAM and SQL. Metadata mapping occurs only after verified connect.
'use strict';
const pg=require('pg'),assert=require('node:assert/strict');
const {localHost,localPort,tls}=require('./local-test-config.cjs');const Original=pg.Client;
pg.Client=class extends Original{
 constructor(cfg){assert.equal(cfg.host,'psql-prima-staging-sea.postgres.database.azure.com');assert.equal(cfg.port,5432);assert.equal(cfg.database,'appdb');assert.equal(cfg.user,'primaadmin');assert.equal(cfg.ssl.rejectUnauthorized,true);super({...cfg,host:localHost,port:localPort,ssl:tls});}
 async connect(){await super.connect();assert.equal(this.connection.stream.authorized,true);this.connectionParameters.host='psql-prima-staging-sea.postgres.database.azure.com';this.connectionParameters.port=5432;}
};
