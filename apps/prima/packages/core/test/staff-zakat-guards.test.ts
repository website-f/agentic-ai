import { describe, it, expect } from 'vitest';
import { staffZakatPreview, staffZakatInputKey, staffZakatReleaseProblem, staffSqlOtherSharesProblem } from '../src/staff-zakat-guards';
import type { Person, StaffPayRun } from '../src/types';
const p = () => ({ zakat: {body:'Zakat Kuala Lumpur',percent:2.5,set:{by:'A',byId:'u1',at:'2026-11-07T12:00:00Z'}} } as Person);
const run = (line: object) => ({lines:[line]} as StaffPayRun);
describe('draft zakat boundaries',()=>{
 it('defaults to zero without choice',()=>expect(staffZakatPreview({} as Person,'2026-11')).toEqual({percent:0,body:null}));
 it('valid recorded current choice supports draft preview',()=>expect(staffZakatPreview(p(),'2026-11').percent).toBe(2.5));
 it('never backdates a new election',()=>expect(()=>staffZakatPreview(p(),'2026-10')).toThrow(/retrospective/));
 it('a later stop also gates past-month reconstruction',()=>expect(()=>staffZakatPreview({zakat:null,zakatHistory:[{at:'2026-11-07T12:00:00Z',body:null,percent:null,by:'A',byId:'u1'}]} as Person,'2026-10')).toThrow());
 it('rejects missing consent, unknown body and malformed rates',()=>{for(const patch of [{set:null},{body:'unknown'},{percent:NaN},{percent:Infinity},{percent:-1},{percent:26}])expect(()=>staffZakatPreview({...p(),zakat:{...p().zakat,...patch}} as Person,'2026-11')).toThrow();});
 it('election change changes stale-input fingerprint',()=>{const a=p();const b=p();b.zakat!.percent=3;expect(staffZakatInputKey(a)).not.toEqual(staffZakatInputKey(b));});
 it('nonzero or malformed deductions cannot leave draft',()=>{for(const l of [{zakat:2},{zakatPercent:2.5},{zakat:NaN}])expect(staffZakatReleaseProblem(run(l))).toMatch(/draft-only/);expect(staffZakatReleaseProblem(run({zakat:0}))).toBeNull();});
 it('unmapped additional statutory shares block journal',()=>{expect(staffSqlOtherSharesProblem(run({others:[{ee:0,er:2}]}))).toMatch(/mappings/);expect(staffSqlOtherSharesProblem(run({others:[]}))).toBeNull();});
});

import { staffPaySums, staffPayInputsKey } from '../src/payroll';
describe('Finance49 preserves settings-based wage bases',()=>{
 const input = {basic:4000,allowances:[{label:'Travel',amount:200,fixed:false,epf:false,socso:true,pcb:false}],unpaidDays:0,unpaidDivisor:26,claims:0,age:35,nationality:'MY' as const,pcbEntered:40,period:'2026-11',lindungOptedOut:false};
 it('keeps independent statutory bases and PCB pre-offset',()=>{const s=staffPaySums({...input,zakatPercent:2.5});expect(s.epfWage).toBe(4000);expect(s.socsoWage).toBe(4200);expect(s.taxable).toBe(4000);expect(s.pcbBeforeZakat).toBe(40);expect(s.zakat).toBe(105);expect(s.pcb).toBe(0);});
 it('no election leaves ordinary payroll unchanged',()=>{const s=staffPaySums(input);expect(s.zakat).toBe(0);expect(s.pcb).toBe(40);});
 it('actual payroll key binds election changes',()=>{const a={...p(),hiredOn:'2020-01-01',basicPay:4000} as Person;const before=staffPayInputsKey(a,'2026-11',[],0);a.zakat!.body='Zakat Kedah';expect(staffPayInputsKey(a,'2026-11',[],0)).not.toBe(before);});
});
