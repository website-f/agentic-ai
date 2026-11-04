// TEST ONLY: actual local COMMIT completes, then emit synthetic pg client loss.
require('./test-local-transport.cjs');const pg=require('pg');const query=pg.Client.prototype.query;pg.Client.prototype.query=async function(...args){const r=await query.apply(this,args);if(args[0]==='COMMIT')this.emit('error',Error('synthetic-private-loss'));return r;};
