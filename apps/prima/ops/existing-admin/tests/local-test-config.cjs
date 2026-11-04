// Test harness only. No product module imports this environment-driven localhost config.
'use strict';
const fs=require('node:fs'),path=require('node:path');
if(!process.env.TEST_POSTGRES_URL||!process.env.TEST_PG_CA)throw Error('Explicit disposable PostgreSQL URL and test CA required');
const base=new URL(process.env.TEST_POSTGRES_URL);
if(!['postgres:','postgresql:'].includes(base.protocol)||!['localhost','127.0.0.1'].includes(base.hostname)||base.pathname!=='/postgres'||base.search||base.hash)throw Error('Fresh localhost postgres administrative database only');
const localHost=base.hostname,localPort=Number(base.port||5432);
if(!Number.isInteger(localPort)||localPort<1024||localPort>65535)throw Error('Explicit unprivileged local port required');
const ca=path.resolve(process.env.TEST_PG_CA);
const tls={rejectUnauthorized:true,servername:'localhost',ca:fs.readFileSync(ca)};
module.exports={base,localHost,localPort,tls};
