import { describe, expect, it } from 'vitest';
import { generateDataset, MemoryStore, PrimaService, type Store } from '../src';
const now = '2026-11-07T02:00:00.000Z';
describe('assigned task identity under concurrency and restricted visibility',()=>{
  it('same target and timestamp produce distinct identities even when existing tasks are hidden',async()=>{
    const ds=generateDataset({today:'2026-11-07',now,daysBack:1});
    const base=new MemoryStore(ds);
    const visible = new Proxy(base, { get(target, key) {
      if (key==='list') return (table: string, ...args: unknown[]) => table==='workTasks' ? Promise.resolve([]) : (target.list as Function).call(target,table,...args);
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    } }) as Store;
    const svc=new PrimaService(visible,()=>now),lead=await svc.user('u-it-lead');
    const existing=ds.workTasks.length;
    const create=()=>svc.workTaskAdd(lead,{userId:'u-it-ex1',title:'Synthetic fixed-clock assignment',doneMeans:'Evidence reviewed and attached',dueAt:'2026-11-08T02:00:00.000Z',priority:'normal'});
    const rows=await Promise.all(Array.from({length:20},create));
    rows.push(await create());
    expect(new Set(rows.map(t=>t.id)).size).toBe(21);
    expect(ds.workTasks.length).toBe(existing+21);
    expect(ds.audit.filter(a=>a.action==='work.task_assign'&&rows.some(t=>t.id===a.entityId))).toHaveLength(21);
    await expect(svc.workTaskAdd(await svc.user('u-it-ex2'),{userId:'u-it-ex1',title:'Disallowed peer assignment',doneMeans:'Should not be recorded',dueAt:'2026-11-08T02:00:00.000Z',priority:'normal'})).rejects.toThrow(/only their managers/);
    expect(ds.workTasks.length).toBe(existing+21);
  });
});
