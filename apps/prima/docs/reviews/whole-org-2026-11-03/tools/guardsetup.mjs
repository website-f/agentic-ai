// Adds a synthetic guard sign-in for every guard and a shared device for every site in the LOCAL stress database, so
// the guard path can be load-tested as if all guards used Prima (Fauzan, 3 Nov 2026). Synthetic data only.
// Refuses anything but a local disposable database (target.mjs), before connecting.
import { connectLocalDb, orRefuse } from './target.mjs';
const url = process.env.DATABASE_URL ?? '';
const c = await orRefuse(() => connectLocalDb(url));
const g = await c.query(`
  INSERT INTO prima.users (id, data)
  SELECT 'u-g-' || p.id, jsonb_build_object('id','u-g-' || p.id,'name',p.data->>'name','title','Guard (synthetic load test)','role','guard',
         'companyIds', jsonb_build_array(p.data->>'companyId'),'siteIds','[]'::jsonb,'personId',p.id)
  FROM prima.people p WHERE p.data->>'role' = 'guard' AND p.data->>'status' IS DISTINCT FROM 'left'
  ON CONFLICT (id) DO NOTHING`);
const d = await c.query(`
  INSERT INTO prima.users (id, data)
  SELECT 'u-d-' || s.id, jsonb_build_object('id','u-d-' || s.id,'name','Site device ' || (s.data->>'code'),'title','Shared device (synthetic load test)',
         'role','site_device','companyIds', jsonb_build_array(s.data->>'companyId'),'siteIds', jsonb_build_array(s.id))
  FROM prima.sites s
  ON CONFLICT (id) DO NOTHING`);
console.log({ guardUsersAdded: g.rowCount, deviceUsersAdded: d.rowCount });
await c.end();
