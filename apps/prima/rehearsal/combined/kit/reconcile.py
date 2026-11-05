
# Meaning-level reconciliations found by the combined typecheck (rehearsal only; each owner thread decides the real fix).
p='packages/core/src/service.ts'; s=open(p).read()
a="""      (user.role === 'director' || isHrDirector(user) || (user.role === 'pwvsb_officer' && user.department === 'hr') || this.consentsForVc(user));
    let rows = await this.store.list('leaveRequests', { companyId: [...companies.map((c) => c.id), ...(central ? [GROUP_EMPLOYER_ID, IT_COMPANY_ID] : [])] });
      (user.role === 'director' || isHrDirector(user) || (user.role === 'pwvsb_officer' && user.department === 'hr'));
    let rows = await this.store.list('leaveRequests', { companyId: [...companies.map((c) => c.id), ...(central ? CENTRAL_EMPLOYER_IDS : [])] });"""
b="""      (user.role === 'director' || isHrDirector(user) || (user.role === 'pwvsb_officer' && user.department === 'hr') || this.consentsForVc(user));
    let rows = await this.store.list('leaveRequests', { companyId: [...companies.map((c) => c.id), ...(central ? CENTRAL_EMPLOYER_IDS : [])] });"""
if a in s: s=s.replace(a,b); print('R1 leave list: HR condition + Gov Ops central employers')
stub="  private async workStandardHours(): Promise<Record<string, number>> {\n    return {};\n  }\n"
if stub in s and "  async workStandardHours(): Promise<Record<string, number>> {" in s:
    i=s.index(stub); c0=s.rfind("  /**",0,i); s=s[:c0]+s[i+len(stub):]; print('R2 workStandardHours: ACT real rule over delegation stub')
open(p,'w').write(s)
p='packages/core/src/work-rebalance.ts'; s=open(p).read()
o="  source: 'playbook' | 'assigned' | 'meeting' | 'own';"
if o in s: s=s.replace(o,"  source: 'playbook' | 'assigned' | 'meeting' | 'own' | 'ceo';"); print("R3 delegation task source gains 'ceo' (Central Admin CEO instructions)")
open(p,'w').write(s)
p='packages/core/src/service.ts'; s=open(p).read()
import re
a=re.search(r"    if \(!\['payroll', 'worker', 'incident', 'guard'\]\.includes\(dataset\)\)([^\n]*)\n    if \(!\['payroll', 'worker', 'incident', 'paySummary'\]\.includes\(dataset\)\)[^\n]*\n",s)
if a:
    s=s[:a.start()]+"    if (!['payroll', 'worker', 'incident', 'guard', 'paySummary'].includes(dataset))"+a.group(1)+"\n"+s[a.end():]; print('R4 JA datasets: guard (HR) + paySummary (Gov Ops)')
open(p,'w').write(s)
# R5: exact wall lists written per branch; the combined list is the union of each branch's intent.
p='packages/core/test/staff-security.test.ts'; s=open(p).read(); n=0
for a,b in [
 ("    expect(walls('u-act-dep')).toEqual(['asset_read', 'act', 'corporate', 'legal']);\n",""),
 ("    expect(walls('u-act-aud2')).toEqual(['asset_read', 'act']);","    expect(walls('u-act-aud2')).toEqual(['asset_read', 'act', 'corporate', 'legal']);"),
 ("    expect(walls('u-legal')).toEqual(['arms']);","    expect(walls('u-legal')).toEqual(['arms', 'corporate', 'legal', 'mandates']);"),
 ("    expect(walls('u-cm-sasa')).toEqual(['arms']);","    expect(walls('u-cm-sasa')).toEqual(['arms', 'corporate', 'legal', 'mandates', 'staff_company']);"),
 ("x.integration && x.integration !== 'am' && x.integration !== 'whatsapp')) expect(dataWalls(u)).toEqual([]);","x.integration && !['am', 'whatsapp', 'ja'].includes(String(x.integration)))) expect(dataWalls(u)).toEqual([]);"),
 ("    expect(walls('u-legal')).toEqual(['corporate', 'legal', 'mandates']);","    expect(walls('u-legal')).toEqual(['arms', 'corporate', 'legal', 'mandates']);"),
 ("    expect(walls('u-cm-sasa')).toEqual(['corporate', 'legal', 'mandates']);","    expect(walls('u-cm-sasa')).toEqual(['arms', 'corporate', 'legal', 'mandates', 'staff_company']);"),
]:
    if a in s: s=s.replace(a,b); n+=1
open(p,'w').write(s)
p='packages/core/test/hr-wall.test.ts'; s=open(p).read()
a="    expect(dataWalls(u('u-cm-sasa'))).toEqual(['staff_company']);"
if a in s: s=s.replace(a,"    expect(dataWalls(u('u-cm-sasa'))).toEqual(['arms', 'corporate', 'legal', 'mandates', 'staff_company']);"); n+=1
open(p,'w').write(s)
p='packages/core/test/special-ops.test.ts'; s=open(p).read()
import re
s2=re.sub(r"x\.integration && x\.integration !== 'am' && x\.integration !== 'whatsapp'\)\)",r"x.integration && !['am', 'whatsapp', 'ja'].includes(String(x.integration))))",s)
if s2!=s: n+=1
open(p,'w').write(s2)
print('R5 wall assertions combined:', n, "edits (u-act-dep: removed by ACT restructure #55, still named by Central Admin #52 test)")
p='packages/core/test/staff-security.test.ts'; s=open(p).read()
old="    for (const id of ['u-transport', 'u-proc-exec', 'u-fwm-ex1', 'u-ja-sync']) expect(walls(id)).toEqual([]);\n"
if old in s:
    s=s.replace(old,"",)  # all copies
    s=s.replace("    expect(walls('u-fwm-ex1')).toEqual(['fw_ids']);","    for (const id of ['u-transport', 'u-proc-exec']) expect(walls(id)).toEqual([]);\n    expect(walls('u-fwm-ex1')).toEqual(['fw_ids']);",1)
    print("R5b fwm/JA feed walls: HR's version over the older no-wall line")
open(p,'w').write(s)
p='packages/core/test/staff-security.test.ts'; s=open(p).read()
for a,b in [("    for (const u of ds.users.filter((x) => x.integration)) expect(dataWalls(u)).toEqual([]);\n",""),
            ("    for (const id of ['u-transport', 'u-legal', 'u-proc-exec']) expect(walls(id)).toEqual([]);\n","")]:
    if a in s: s=s.replace(a,b); print('R5c removed an older exact-empty wall line superseded by the combined lines above')
open(p,'w').write(s)
p='packages/core/test/staff-security.test.ts'; s=open(p).read()
for a,b in [("    expect(walls('u-cm-sasa')).toEqual(['staff_company']);","    expect(walls('u-cm-sasa')).toContain('staff_company');"),
            ("x.integration && x.integration !== 'ja')) expect(dataWalls(u)).toEqual([]);","x.integration && !['am', 'whatsapp', 'ja'].includes(String(x.integration)))) expect(dataWalls(u)).toEqual([]);")]:
    if a in s: s=s.replace(a,b); print('R5d HR wall lines read as part of the combined list')
open(p,'w').write(s)
# R6: staff pay files. Finance (#49) adds the employer number row and its own member-number columns; HR (#51) adds
# the IC column (full IC only behind the HR wall). Combined: Finance's layout with HR's IC column after the name.
p='packages/core/src/service.ts'; s=open(p).read()
a=s.find("    else if (kind === 'epf')\n      rows = [\n        ['Staff no', 'Name', 'IC / passport', 'EPF member no'")
b=s.find("    else if (kind === 'pcb')", a)
if a>=0 and b>a:
    new="""    else if (kind === 'epf')
      rows = [
        header('EPF number', nos?.epf),
        ['Staff no', 'Name', 'IC / passport', 'EPF number', 'Wages', 'Employee', 'Employer', 'Table row'],
        ...run.lines.map((l) => [l.staffNo, l.name, member.ic(l.personId), l.epfNo ?? member.epf(l.personId), l.gross, l.epfEe, l.epfEr, l.statBands?.epf ?? '']),
        ['Total', '', '', '', t.gross, run.lines.reduce((n, l) => n + l.epfEe, 0), run.lines.reduce((n, l) => n + l.epfEr, 0), ''],
      ];
    else if (kind === 'socso')
      rows = [
        header('PERKESO code', nos?.socso),
        ['Staff no', 'Name', 'IC / passport', 'SOCSO number', 'Wages', 'SOCSO employer', 'SOCSO employee', 'LINDUNG 24 Jam employee', 'EIS employer', 'EIS employee'],
        ...run.lines.map((l) => [
          l.staffNo,
          l.name,
          member.ic(l.personId),
          l.socsoNo ?? member.socso(l.personId),
          l.gross,
          l.socsoEr,
          l.socsoEe,
          l.lindungStatus === 'opted_out' ? 'Opted out' : l.lindungEe,
          l.nationality === 'MY' ? l.eisEr : 'Not applicable',
          l.nationality === 'MY' ? l.eisEe : 'Not applicable',
        ]),
        ['Total', '', '', '', t.gross, t.socsoEr, t.socsoEe, t.lindung, t.eisEr, t.eisEe],
      ];
"""
    s=s[:a]+new+s[b:]; open(p,'w').write(s); print("R6 staff pay EPF/SOCSO files: Finance's employer row and numbers + HR's IC column")
# R7: union leftovers where two branches changed the same line (keep the newer meaning).
p='packages/core/src/service.ts'; s=open(p).read(); n=0
for a,b in [
 ("import { CLIENT_OFFBOARD_STEPS, CLIENT_ONBOARD_STEPS } from './clients';\n",""),
 ("import { reportPeriods, simulateWorkflow } from './reports';\nimport { CLIENT_OFFBOARD_STEPS, CLIENT_ONBOARD_STEPS, CLIENT_VIA } from './clients';","import { reportPeriods, simulateWorkflow } from './reports';\nimport { CLIENT_OFFBOARD_STEPS, CLIENT_ONBOARD_STEPS, CLIENT_VIA } from './clients';"),
 ("import { reportPeriods } from './reports';\n",""),
 # Staff clock: HR's server-side face check (#51) plus the photo-reuse refusal (#49).
 ("    const { shot, flags } = this.staffShot(user, input, await this.staffFaceEnrolled(user));\n    await this.refuseReusedClockPhoto(shot);\n    const { shot, flags } = this.staffShot(user, { ...input, face: await this.serverFace(user, input) }, await this.staffFaceEnrolled(user));\n",
  "    const { shot, flags } = this.staffShot(user, { ...input, face: await this.serverFace(user, input) }, await this.staffFaceEnrolled(user));\n    await this.refuseReusedClockPhoto(shot);\n"),
 # Procurement names: Gov Ops' store label (#54) over main's.
 ("    const name = (id: Id) => (id === GROUP_EMPLOYER_ID ? 'PWVSB (central)' : (companies.find((c) => c.id === id)?.name ?? id));\n    const supplierRows","    const supplierRows"),
]:
    c=s.count(a)
    if c: s=s.replace(a,b); n+=c
open(p,'w').write(s)
p='packages/core/src/index.ts'; s=open(p).read()
x="// Rehearsal: two guide modules name their own GuideField/GuideCardSpec; the shared guide-cards types win here.\nexport type { GuideField, GuideCardSpec } from './guide-cards';\n"
if x not in s: s+=x; n+=1
open(p,'w').write(s)
print('R7 duplicate imports/declarations from same-line edits:', n)
# R8: Finance drawer: Gov Ops' fees panel (#54) and Finance's drawer with the desk (#49), one drawer only.
p='apps/web/src/views/Finance.tsx'; s=open(p).read()
a="      {row && <CompanyDrawer row={row} may={mayFor(data.financeRole)} onClose={() => setOpen(null)} />}\n"
if a in s and "<CompanyDrawer row={row} desk={desk}" in s: s=s.replace(a,""); open(p,'w').write(s); print('R8 Finance drawer: one drawer with the desk, plus the fees panel')
# R9: Finance tests (#49) drive staff pay through the older CoS + Vice Chairman consent path; HR (#51) changed it to
# CoS approve then COO approve, each with a comment. The tests follow HR's path; the file layout follows R6.
import re
for p in ['packages/core/test/finance-staff-automation.test.ts','packages/core/test/statutory-tables.test.ts','packages/core/test/staff-zakat.test.ts']:
    s=open(p).read(); o=s
    s=re.sub(r"svc\.staffPayStep\(([^,]+), run\.id, 'approve'\)", r"svc.staffPayStep(\1, run.id, 'approve', { note: 'Checked (synthetic)' })", s)
    s=re.sub(r"svc\.staffPayStep\([^,]+, run\.id, 'consent'\)", "svc.staffPayStep(await svc.user('u-coo'), run.id, 'coo_approve', { note: 'Approved (synthetic)' })", s)
    s=s.replace("expect(epf[1]).toBe('Staff no,Name,EPF number,Wages,Employee,Employer,Table row');","expect(epf[1]).toBe('Staff no,Name,IC / passport,EPF number,Wages,Employee,Employer,Table row');")
    if s!=o: open(p,'w').write(s); print('R9', p)
p='packages/core/test/hr-3g-3d.test.ts'; s=open(p).read(); o=s
s=s.replace("expect(epfHr.body.split('\\n')[0]).toBe('Staff no,Name,IC / passport,EPF member no,Wages,Employee,Employer');","expect(epfHr.body.split('\\n')[1]).toBe('Staff no,Name,IC / passport,EPF number,Wages,Employee,Employer,Table row');")
s=s.replace("expect(fin.body.split('\\n')[0]).toContain('IC / passport,SOCSO no');","expect(fin.body.split('\\n')[1]).toContain('IC / passport,SOCSO number');")
if s!=o: open(p,'w').write(s); print('R9', p)
# R10 (real defect between #49 and #51): Finance counts a staff payroll as approved at 'approved'/'consented'/'paid'.
# Under HR's flow the final approval is the COO's ('coo_approved'; 'consented' no longer exists), so Finance must count
# only 'coo_approved' and 'paid'. R6 also keeps Finance's 'NOT RECORDED' wording for a missing member number.
p='packages/core/src/finance-controls.ts'; s=open(p).read(); c=s.count("['approved', 'consented', 'paid']")
if c: s=s.replace("['approved', 'consented', 'paid']","['coo_approved', 'paid']"); open(p,'w').write(s); print('R10 Finance reads HR payroll as approved only after the COO:', c)
p='packages/core/src/service.ts'; s=open(p).read(); o=s
s=s.replace("l.epfNo ?? member.epf(l.personId)","l.epfNo ?? 'NOT RECORDED'").replace("l.socsoNo ?? member.socso(l.personId)","l.socsoNo ?? 'NOT RECORDED'")
if s!=o: open(p,'w').write(s); print("R6b member numbers: Finance's NOT RECORDED wording")
# R11: PgStore.transaction. Several branches took #56's savepoint fix; Finance (#49) adds RefusedAfterSave. The union
# kept every copy (a second ROLLBACK TO after RELEASE fails with "savepoint unit does not exist"). One body: Finance's.
p='apps/api/src/pg-store.ts'; s=open(p).read()
a=s.find("  async transaction<R>(fn: (store: Store) => Promise<R>): Promise<R> {")
b=s.find("\n  }\n", s.find("      throw e;", a))
if a>=0 and b>a and s.count("ROLLBACK TO SAVEPOINT unit", a, b)>1:
    body="""  async transaction<R>(fn: (store: Store) => Promise<R>): Promise<R> {
    // Each request already runs in one transaction; a savepoint keeps a failed unit from leaving half its writes behind.
    // ROLLBACK TO keeps the savepoint, so a failed unit's savepoint is released straight after: otherwise an outer
    // unit's rollback would stop at that leftover and keep everything written before it (PR #56, 05b4a4a). The shared
    // name stays so units that run side by side on one connection still release cleanly.
    await this.client.query('SAVEPOINT unit');
    try {
      const out = await fn(this);
      await this.client.query('RELEASE SAVEPOINT unit');
      return out;
    } catch (e) {
      // A refusal that keeps what it saved (a lapsed approval returned and logged) releases the savepoint instead.
      if (e instanceof RefusedAfterSave) await this.client.query('RELEASE SAVEPOINT unit');
      else {
        await this.client.query('ROLLBACK TO SAVEPOINT unit');
        await this.client.query('RELEASE SAVEPOINT unit');
      }
      throw e;
    }"""
    s=s[:a]+body+s[b:]; open(p,'w').write(s); print('R11 PgStore.transaction: one savepoint body (Finance RefusedAfterSave + #56 release)')

# R12 (merge-level defect found by the whole-organisation review, 3 Nov 2026): Finance #49 predates the shared rollout
# switch (#56) and kept its own gate in userForEntra ("!inPilot(user) && !financeIn"), which refused every other
# department's rollout. Finance registers its rule with the shared switch instead, and auth.ts keeps one gate.
p='packages/core/src/finance.ts'; s=open(p).read()
if "registerRollout('finance'" not in s and 'export function inFinanceRollout' in s:
    a=s.find('export function inFinanceRollout'); b=s.find('\n}\n', a)+3
    s=s[:b]+"// The shared department switch (packages/core/src/rollouts.ts): FINANCE_ROLLOUT=true or PRIMA_ROLLOUTS=finance.\nregisterRollout('finance', 'Finance', inFinanceRollout);\n"+s[b:]
    s="import { registerRollout } from './rollouts';\n"+s
    open(p,'w').write(s); print("R12 Finance registers its rollout with the shared switch")
p='apps/api/src/auth.ts'; s=open(p).read(); o=s
for line in ["  // Finance rollout (Phase 2): off unless FINANCE_ROLLOUT=true; then the Finance Director and Finance teams sign in too.\n",
             "  const financeIn = process.env.FINANCE_ROLLOUT === 'true' && inFinanceRollout(user);\n",
             "  if (RULES.pilot.value.on && !inPilot(user) && !financeIn) throw new ForbiddenException('You are not part of the pilot yet.');\n"]:
    s=s.replace(line,'')
s=s.replace(", type User, inFinanceRollout }",", type User }")
if s!=o: open(p,'w').write(s); print("R12 auth.ts: one pilot gate (pilotAdmits), Finance's second gate removed")
p='packages/core/src/index.ts'; s=open(p).read(); L=s.split('\n'); seen=False; out=[]
for l in L:
    if l.strip()=="export * from './rollouts';":
        if seen: continue
        seen=True
    out.append(l)
if len(out)!=len(L): open(p,'w').write('\n'.join(out)); print('R12 index.ts: one rollouts export')
p='apps/api/test/rollouts-entra.test.ts'
try:
    s=open(p).read(); o=s
    import glob
    keys=sorted({m for f in glob.glob('packages/core/src/*.ts') for m in re.findall(r"registerRollout\('([a-z_]+)'", open(f).read())})
    print('R12 registered department rollouts:', ', '.join(keys))
    lst=', '.join(f"'{k}'" for k in ['t_entra']+keys)
    s=s.replace("assert.ok(checked.includes('t_entra'), 'the seeded data has someone outside the pilot to sign in');",
      "for (const k of ["+lst+"]) assert.ok(checked.includes(k), `${k} signs in once started (combined)`);")
    if s!=o: open(p,'w').write(s); print('R12 sign-in test: every combined department rollout must be walked')
except FileNotFoundError: pass

# R13: hand-over map labels. A flow marked 'in_pr' in #56 whose action the combined code emits is live once merged.
# Routing never read the label; the Hand-overs map showed staff "waiting on a PR". Only the label changes.
import re, os
p='packages/core/src/org-links.ts'; s=open(p).read()
srcs=''.join(open(os.path.join('packages/core/src',f)).read() for f in os.listdir('packages/core/src')
             if f.endswith('.ts') and f not in ('org-links.ts','guide-cards.ts') and 'guide' not in f)
def emitted(a):
    if f"'{a}'" in srcs or f"`{a}`" in srcs or (a.endswith('.') and (f"'{a}" in srcs or f"`{a}" in srcs)): return True
    return any(a.startswith(m) for m in re.findall(r"`([a-z_.]+\.)\$\{", srcs))
flipped=[]
def fix(m):
    acts=re.findall(r"'([^']+)'", m.group(2))
    if m.group(3)=='in_pr' and acts and all(emitted(x) for x in acts):
        flipped.append(m.group(1)); return m.group(0)[:m.start(3)-m.start(0)]+'live'+m.group(0)[m.end(3)-m.start(0):]
    return m.group(0)
s2=re.sub(r"id: '([a-z_]+)',[\s\S]*?actions: \[([^\]]*)\][\s\S]*?status: '([a-z_]+)'", fix, s)
if flipped: open(p,'w').write(s2); print('R13 hand-over map: now live in the combined code:', ', '.join(flipped))

# R14 (Arisha main, review of d7d472d): one release manifest. The three add-on modules (company_office, org_links,
# special_ops) were installed by hand outside it. They join the same reviewed path as Central Admin's: manifest entry,
# artifact spec, catalogue check, install presence markers, staging gate. special_ops is wrapped in one transaction
# (BEGIN/COMMIT) so the module installer's single-transaction rule applies; its statements are unchanged.
ADD = [('company_office','db/modules/company-office-v1.sql',[], 'companyOfficeProblems','./company-office-readiness',"{tables:['company_desks'],functions:null}"),
       ('org_links','db/modules/org-links-v1.sql',[], 'orgLinksProblems','./org-links-readiness',"{tables:['org_events','org_tasks','org_notices','org_imports'],functions:'org_'}"),
       ('special_ops','db/modules/special-ops-v1.sql',[], 'specialOpsModuleProblems','./special-ops-readiness',"{tables:[],functions:null,policies:['arms_wall']}")]  # dept_wall is already in the base (HR walls), so only arms_wall marks this module
def edit(p, fn, tag, done=None):
    # Fails closed: when the anchor is not found the step stops the rehearsal instead of silently doing nothing.
    s=open(p).read(); n=fn(s)
    if done is not None and not done(n): raise SystemExit(f'R14 {p}: {tag} could not be applied (anchor not found)')
    if n!=s: open(p,'w').write(n); print('R14', tag)
ADD_IDS=[i for i,*_ in ADD]
p='db/modules/special-ops-v1.sql'; s=open(p).read()
if not re.search(r'^\s*BEGIN;', re.sub(r'(?m)^--.*\n','',s)):
    lines=s.split('\n'); i=0
    while i<len(lines) and lines[i].startswith('--'): i+=1
    s='\n'.join(lines[:i]+['BEGIN;']+lines[i:]).rstrip('\n')+'\nCOMMIT;\n'; open(p,'w').write(s); print('R14 special_ops module wrapped in one transaction')
def specs_ts(s):
    block=''.join(f" {{id:'{i}',path:'{pth}',requires:[]}},\n" for i,pth,*_ in ADD if f"id:'{i}'" not in s)
    return s.replace("] as const;\nexport type ReleaseModuleId", block+"] as const;\nexport type ReleaseModuleId",1) if block else s
edit('apps/api/src/release-artifact.ts', specs_ts, 'release-artifact.ts: three add-on module specs', lambda s: all(f"id:'{i}'" in s for i in ADD_IDS))
def specs_mjs(s):
    add=''.join(f",['{i}','{pth}',[]]" for i,pth,*_ in ADD if f"['{i}'," not in s)
    if not add: return s
    if s.count("',[]]];")!=1: return s
    return s.replace("',[]]];","',[]]"+add+"];",1)
edit('scripts/release-artifact.mjs', specs_mjs, 'scripts/release-artifact.mjs: three add-on module specs', lambda s: all(f"['{i}'," in s for i in ADD_IDS))
ADD_LIST=",".join(f"'{i}'" for i in ADD_IDS)
def ids(s):
    if "'central_admin_delegations'" in s and "'company_office'" not in s:
        s=re.sub(r"((?:'central_admin_[a-z_]+',?)+)\]", lambda m: m.group(1).rstrip(',')+','+ADD_LIST+']', s, count=1)
    return s
for p in ['apps/api/src/release-catalog.ts','scripts/staging-release-gate.mjs','scripts/release-workflow-contract.test.mjs']:
    edit(p, ids, p+': module ids', lambda s: all(f"'{i}'" in s for i in ADD_IDS))
def catalog(s):
    if 'companyOfficeProblems' in s: return s
    s=re.sub(r"(import \{centralAdmin[^}]*\} from './central-admin-readiness';)", r"\1\nimport {companyOfficeProblems} from './company-office-readiness';\nimport {orgLinksProblems} from './org-links-readiness';\nimport {specialOpsModuleProblems} from './special-ops-readiness';", s, count=1)
    s=s.replace("    if(id==='central_admin_panel')return","    // The add-on modules (combined candidate, R14) have their own catalogue checks and no IT table dependency.\n    if(id==='company_office')return (await companyOfficeProblems(client)).length?[moduleCode(id)]:[];\n    if(id==='org_links')return (await orgLinksProblems(client)).length?[moduleCode(id)]:[];\n    if(id==='special_ops')return (await specialOpsModuleProblems(client)).length?[moduleCode(id)]:[];\n    if(id==='central_admin_panel')return",1)
    return s
edit('apps/api/src/release-catalog.ts', catalog, 'release-catalog.ts: add-on catalogue checks', lambda s: "import {companyOfficeProblems" in s and "if(id==='special_ops')return" in s)
def install(s):
    if 'company_office:' in s: return s
    add=''.join(f" {i}:{m},\n" for i,_,_,_,_,m in ADD)
    return s.replace("\n};\ntype Client=","\n"+add.rstrip('\n')+"\n};\ntype Client=",1)
edit('apps/api/src/module-install.ts', install, 'module-install.ts: add-on presence markers', lambda s: all(f" {i}:" in s for i in ADD_IDS))
ART=re.compile(r"complete artifact pins base and all \w+ modules, including selected Outlook SQL and the \w+ Central Admin modules',\(\)=>\{const a=releaseArtifact\(\);assert\.equal\(a\.manifest\.modules\.length,(\d+)\);")
def art_test(s):
    return ART.sub(lambda m: f"complete artifact pins base and every module, including selected Outlook SQL, the Central Admin modules and the three add-ons',()=>{{const a=releaseArtifact();assert.equal(a.manifest.modules.length,{int(m.group(1))+3});", s, count=1)
edit('apps/api/test/release-artifact.test.ts', art_test, 'release-artifact test: three more modules', lambda s: 'the three add-ons' in s or 'the four add-ons' in s)
def cat_test(s):
    if 'company-office-readiness' in s: return s
    s=s.replace("import * as centralAdmin from '../src/central-admin-readiness';","import * as centralAdmin from '../src/central-admin-readiness';\nimport * as companyOffice from '../src/company-office-readiness';\nimport * as orgLinks from '../src/org-links-readiness';\nimport * as specialOps from '../src/special-ops-readiness';")
    s=re.sub(r"(  for\(const name of \[[^\]]*'centralAdminDelegationsProblems'[^\]]*\] as const\)mock\.method\(centralAdmin as any,name,async\(\)=>\[\]\);\n)", lambda m: m.group(1)+"  for(const [mod,name] of [[companyOffice,'companyOfficeProblems'],[orgLinks,'orgLinksProblems'],[specialOps,'specialOpsModuleProblems']] as const)mock.method(mod as any,name,async()=>[]);\n", s, count=1)
    s=s.replace("&&!id.startsWith('central_admin_'))","&&!id.startsWith('central_admin_')&&!['company_office','org_links','special_ops'].includes(id))")
    s+="\nfor(const [mod,name,id] of [[companyOffice,'companyOfficeProblems','company_office'],[orgLinks,'orgLinksProblems','org_links'],[specialOps,'specialOpsModuleProblems','special_ops']] as const)it('add-on module drift fails only that module, codes only: '+id,async()=>{const f=fixture();mock.method(mod as any,name,async()=>['internal details']);const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert.equal(r.modules[id].ready,false);assert.equal(r.modules.procurement.ready,true);assert(!JSON.stringify(r).includes('internal details'));});\n"
    return s
edit('apps/api/test/release-catalog.test.ts', cat_test, 'release-catalog test: add-on checks mocked, drift per add-on', lambda s: "[specialOps,'specialOpsModuleProblems']" in s and "[specialOps,'specialOpsModuleProblems','special_ops']" in s and "'special_ops'].includes(id)" in s or "'special_ops','fw_welfare'" in s and "[specialOps,'specialOpsModuleProblems','special_ops']" in s)

# R14b: Foreign worker welfare (#62) ships db/modules/fw-welfare-v1.sql with no catalogue check and no manifest entry.
# It joins the manifest with a fail-closed check written here (table, forced RLS, exactly its company wall, app grants
# without DELETE). The Foreign worker thread is asked to carry this check in #62.
if os.path.exists('db/modules/fw-welfare-v1.sql'):
    p='apps/api/src/fw-welfare-readiness.ts'
    if not os.path.exists(p):
        open(p,'w').write("""// What is missing or drifted in the database for foreign-worker welfare checks (db/modules/fw-welfare-v1.sql).
// Names only, never data. Added at the combined merge (R14b) so the module can join the one release manifest.
import type { PoolClient } from 'pg';

export async function fwWelfareProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const t = await client.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            has_table_privilege('prima_app', c.oid, 'SELECT') AS can_select, has_table_privilege('prima_app', c.oid, 'INSERT') AS can_insert,
            has_table_privilege('prima_app', c.oid, 'UPDATE') AS can_update, has_table_privilege('prima_app', c.oid, 'DELETE') AS can_delete,
            (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'c') AS checks
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'fw_welfare_checks' AND c.relkind = 'r'`,
  );
  if (t.rows.length !== 1) return ['Table prima.fw_welfare_checks is missing.'];
  const r = t.rows[0];
  if (!r.rls || !r.forced) out.push('prima.fw_welfare_checks does not force row security.');
  if (!r.can_select || !r.can_insert || !r.can_update) out.push('The app role cannot read and record welfare checks.');
  if (r.can_delete) out.push('The app role may delete welfare checks.');
  if (r.checks < 4) out.push('A welfare check constraint is missing.');
  const p = await client.query(
    `SELECT policyname, permissive, roles::text[] AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'fw_welfare_checks'`,
  );
  const wall = p.rows.find((x) => x.policyname === 'company_wall');
  if (p.rows.length !== 1 || !wall) out.push('prima.fw_welfare_checks must have exactly its company wall policy.');
  else {
    const want = '(company_id = ANY (prima.visible_companies()))';
    if (wall.permissive !== 'PERMISSIVE' || wall.cmd !== 'ALL' || JSON.stringify(wall.roles) !== '["public"]' || wall.qual !== want || wall.with_check !== want)
      out.push('The welfare company wall differs from the reviewed module.');
  }
  return out;
}
""")
        print('R14b fw_welfare catalogue check written (apps/api/src/fw-welfare-readiness.ts)')
    p='db/proposed/fw-welfare-module.json'
    if not os.path.exists(p):
        import json
        json.dump({"status":"PROPOSED at the combined merge (R14b): manifest entry for #62's module. No install is authorized by this file.",
                   "base":{"path":"db/migrations/001_init.sql","sha256":""},"after":[],
                   "modules":[{"id":"fw_welfare","version":1,"path":"db/modules/fw-welfare-v1.sql","sha256":"","requires":[],
                               "catalog":"apps/api/src/fw-welfare-readiness.ts fwWelfareProblems"}]}, open(p,'w'), indent=2)
        print('R14b fw_welfare packaging proposal written')
    ADD2=('fw_welfare','db/modules/fw-welfare-v1.sql','fwWelfareProblems','./fw-welfare-readiness',"{tables:['fw_welfare_checks'],functions:null}")
    i,pth,fn,mod,marker=ADD2
    edit('apps/api/src/release-artifact.ts', lambda s: s if f"id:'{i}'" in s else s.replace("] as const;\nexport type ReleaseModuleId", f" {{id:'{i}',path:'{pth}',requires:[]}},\n] as const;\nexport type ReleaseModuleId",1), 'release-artifact.ts: fw_welfare', lambda s: "id:'fw_welfare'" in s)
    edit('scripts/release-artifact.mjs', lambda s: s if f"['{i}'," in s else s.replace("['special_ops','db/modules/special-ops-v1.sql',[]]]",f"['special_ops','db/modules/special-ops-v1.sql',[]],['{i}','{pth}',[]]]",1), 'release-artifact.mjs: fw_welfare', lambda s: "['fw_welfare'," in s)
    for p in ['apps/api/src/release-catalog.ts','scripts/staging-release-gate.mjs','scripts/release-workflow-contract.test.mjs']:
        edit(p, lambda s: s if "'special_ops','fw_welfare'" in s else s.replace("'org_links','special_ops']","'org_links','special_ops','fw_welfare']"), p+': fw_welfare id', lambda s: "'special_ops','fw_welfare'" in s)
    edit('apps/api/src/release-catalog.ts', lambda s: s if 'fwWelfareProblems' in s else s.replace("import {specialOpsModuleProblems} from './special-ops-readiness';","import {specialOpsModuleProblems} from './special-ops-readiness';\nimport {fwWelfareProblems} from './fw-welfare-readiness';").replace("    if(id==='special_ops')return (await specialOpsModuleProblems(client)).length?[moduleCode(id)]:[];\n","    if(id==='special_ops')return (await specialOpsModuleProblems(client)).length?[moduleCode(id)]:[];\n    if(id==='fw_welfare')return (await fwWelfareProblems(client)).length?[moduleCode(id)]:[];\n"), 'release-catalog.ts: fw_welfare check', lambda s: "if(id==='fw_welfare')return" in s)
    edit('apps/api/src/module-install.ts', lambda s: s if 'fw_welfare:' in s else s.replace(" special_ops:"," fw_welfare:"+marker+",\n special_ops:",1), 'module-install.ts: fw_welfare markers', lambda s: ' fw_welfare:' in s)
    edit('apps/api/test/release-artifact.test.ts', lambda s: re.sub(r"the three add-ons',\(\)=>\{const a=releaseArtifact\(\);assert\.equal\(a\.manifest\.modules\.length,(\d+)\);", lambda m: f"the four add-ons',()=>{{const a=releaseArtifact();assert.equal(a.manifest.modules.length,{int(m.group(1))+1});", s, count=1), 'release-artifact test: one more module (fw_welfare)', lambda s: 'the four add-ons' in s)
    edit('apps/api/test/release-catalog.test.ts', lambda s: s if 'fw-welfare-readiness' in s else s.replace("import * as specialOps from '../src/special-ops-readiness';","import * as specialOps from '../src/special-ops-readiness';\nimport * as fwWelfare from '../src/fw-welfare-readiness';").replace("[specialOps,'specialOpsModuleProblems']] as const)mock","[specialOps,'specialOpsModuleProblems'],[fwWelfare,'fwWelfareProblems']] as const)mock").replace("[specialOps,'specialOpsModuleProblems','special_ops']] as const)it","[specialOps,'specialOpsModuleProblems','special_ops'],[fwWelfare,'fwWelfareProblems','fw_welfare']] as const)it").replace("!['company_office','org_links','special_ops'].includes(id)","!['company_office','org_links','special_ops','fw_welfare'].includes(id)"), 'release-catalog test: fw_welfare', lambda s: "[fwWelfare,'fwWelfareProblems','fw_welfare']" in s)

# R15: #62's welfare test names the ACT account u-act-la, which the ACT restructure (#55) replaced; the combined seed's
# ACT accounts are u-act-aud1/enf1/aud2/enf2. Same check (an ACT auditor is refused the worker's papers), existing account.
p='packages/core/test/fw-welfare.test.ts'
if os.path.exists(p):
    s=open(p).read(); seed=open('packages/core/src/seed.ts').read()
    if "'u-act-la'" in s and "id: 'u-act-la'" not in seed:
        if "'u-act-aud1'" not in seed: raise SystemExit('R15: no ACT auditor account in the combined seed')
        open(p,'w').write(s.replace("'u-act-la'","'u-act-aud1'")); print('R15 fw-welfare test: ACT account u-act-la -> u-act-aud1 (ACT restructure)')


# R16: in the combined candidate the add-ons are in the one manifest (R14), so each department's packaging test that
# asserted "stays out of the manifest until approved" (true on its own branch) now asserts the combined fact: the
# manifest carries exactly the proposal's entries, and the proposal installs after the modules before it. Central
# Admin's "after the IT modules" check finds its entries by id, since the add-ons now follow it.
OUT_OLD='for (const m of proposal.modules) assert.ok(!manifest.modules.some((x) => x.id === m.id));'
OUT_NEW="""for (const m of proposal.modules) {
      const pinned = (manifest.modules as Array<{ id: string; path?: string; sha256?: string }>).find((x) => x.id === m.id);
      assert.ok(pinned, `${m.id} is in the combined manifest`);
      assert.deepEqual({ path: pinned.path, sha256: pinned.sha256 }, { path: m.path, sha256: m.sha256 });
    }"""
AFTER_OLD='assert.deepEqual(proposal.after, manifest.modules.map((m) => m.id));'
AFTER_NEW='assert.deepEqual(proposal.after, manifest.modules.slice(0, manifest.modules.findIndex((x) => x.id === proposal.modules[0].id)).map((m) => m.id));'
import re
for f in ['company-office','org-links','special-ops']:
    p=f'apps/api/test/{f}-packaging.test.ts'
    if not os.path.exists(p): continue
    s=open(p).read(); o=s
    s=s.replace(OUT_OLD,OUT_NEW)
    s=s.replace(AFTER_OLD,AFTER_NEW)
    s=re.sub(r"(assert\.deepEqual\(\s*proposal\.after,\s*)manifest\.modules\.map\(\(m\) => m\.id\),(\s*\);)", r"\1manifest.modules.slice(0, manifest.modules.findIndex((x) => x.id === proposal.modules[0].id)).map((m) => m.id),\2", s)
    s=s.replace('stays out of the manifest until approved','is pinned in the combined manifest after the modules before it')
    if s==o and 'is pinned in the combined manifest' not in s: raise SystemExit(f'R16: {p} did not change')
    if s==o: continue
    open(p,'w').write(s); print(f'R16 {p}: add-on is in the combined manifest')
p='apps/api/test/central-admin-packaging.test.ts'
if os.path.exists(p):
    s=open(p).read()
    old='const pinned = manifest.modules.slice(-ids.length);'
    if old in s:
        s=s.replace(old,'const pinned = ids.map((id) => manifest.modules.find((m) => m.id === id)!);')
        open(p,'w').write(s); print('R16 central-admin packaging test: entries found by id (add-ons follow)')


# R17: #63 proposes db/modules/time-series-indexes-v1.sql (five date-window indexes, no table/policy/grant change) with
# no catalogue check. Arisha main asked that nothing sit outside the one manifest, so it joins it last with a fail-closed
# check written here: each of the five indexes exists on its table with exactly the reviewed definition.
if os.path.exists('db/modules/time-series-indexes-v1.sql'):
    p='apps/api/src/time-series-indexes-readiness.ts'
    if not os.path.exists(p):
        open(p,'w').write("""// What is missing or drifted for the date-window indexes (db/modules/time-series-indexes-v1.sql). Names only.
// Added at the combined merge (R17) so the module can join the one release manifest.
import type { PoolClient } from 'pg';

/** The reviewed index definitions, as PostgreSQL prints them (pg_get_indexdef). */
export const TIME_SERIES_INDEXES: Record<string, string> = {
  shifts_company_date_idx: "CREATE INDEX shifts_company_date_idx ON prima.shifts USING btree (company_id, ((data ->> 'date'::text)))",
  shifts_person_date_idx: "CREATE INDEX shifts_person_date_idx ON prima.shifts USING btree (((data ->> 'personId'::text)), ((data ->> 'date'::text)))",
  attendance_company_clockin_idx: "CREATE INDEX attendance_company_clockin_idx ON prima.attendance USING btree (company_id, ((data ->> 'clockIn'::text)))",
  scans_site_at_idx: "CREATE INDEX scans_site_at_idx ON prima.scans USING btree (((data ->> 'siteId'::text)), ((data ->> 'at'::text)))",
  scans_company_at_idx: "CREATE INDEX scans_company_at_idx ON prima.scans USING btree (company_id, ((data ->> 'at'::text)))",
};

export async function timeSeriesIndexesProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const r = await client.query(
    `SELECT c.relname AS name, pg_get_indexdef(c.oid) AS def, i.indisvalid AS valid
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_index i ON i.indexrelid = c.oid
      WHERE n.nspname = 'prima' AND c.relkind = 'i' AND c.relname = ANY($1::text[])`,
    [Object.keys(TIME_SERIES_INDEXES)],
  );
  const found = new Map(r.rows.map((x) => [x.name as string, x]));
  const out: string[] = [];
  for (const [name, def] of Object.entries(TIME_SERIES_INDEXES)) {
    const row = found.get(name);
    if (!row) out.push(`Index prima.${name} is missing.`);
    else if (row.def !== def) out.push(`Index prima.${name} differs from the reviewed definition.`);
    else if (!row.valid) out.push(`Index prima.${name} is not valid.`);
  }
  return out;
}
""")
        print('R17 time_series_indexes catalogue check written (apps/api/src/time-series-indexes-readiness.ts)')
    i,pth,fn,mod='time_series_indexes','db/modules/time-series-indexes-v1.sql','timeSeriesIndexesProblems','./time-series-indexes-readiness'
    marker="{tables:['shifts_company_date_idx','shifts_person_date_idx','attendance_company_clockin_idx','scans_site_at_idx','scans_company_at_idx'],functions:null}"
    edit('apps/api/src/release-artifact.ts', lambda s: s if f"id:'{i}'" in s else s.replace("] as const;\nexport type ReleaseModuleId", f" {{id:'{i}',path:'{pth}',requires:[]}},\n] as const;\nexport type ReleaseModuleId",1), 'release-artifact.ts: time_series_indexes', lambda s: f"id:'{i}'" in s)
    edit('scripts/release-artifact.mjs', lambda s: s if f"['{i}'," in s else s.replace("['fw_welfare','db/modules/fw-welfare-v1.sql',[]]]",f"['fw_welfare','db/modules/fw-welfare-v1.sql',[]],['{i}','{pth}',[]]]",1), 'release-artifact.mjs: time_series_indexes', lambda s: f"['{i}'," in s)
    for p in ['apps/api/src/release-catalog.ts','scripts/staging-release-gate.mjs','scripts/release-workflow-contract.test.mjs']:
        edit(p, lambda s: s if "'fw_welfare','time_series_indexes'" in s else s.replace("'special_ops','fw_welfare']","'special_ops','fw_welfare','time_series_indexes']"), p+': time_series_indexes id', lambda s: "'fw_welfare','time_series_indexes'" in s)
    edit('apps/api/src/release-catalog.ts', lambda s: s if fn in s else s.replace("import {fwWelfareProblems} from './fw-welfare-readiness';",f"import {{fwWelfareProblems}} from './fw-welfare-readiness';\nimport {{{fn}}} from '{mod}';").replace("    if(id==='fw_welfare')return (await fwWelfareProblems(client)).length?[moduleCode(id)]:[];\n",f"    if(id==='fw_welfare')return (await fwWelfareProblems(client)).length?[moduleCode(id)]:[];\n    if(id==='{i}')return (await {fn}(client)).length?[moduleCode(id)]:[];\n"), 'release-catalog.ts: time_series_indexes check', lambda s: f"if(id==='{i}')return" in s)
    edit('apps/api/src/module-install.ts', lambda s: s if f' {i}:' in s else s.replace(" special_ops:",f" {i}:{marker},\n special_ops:",1), 'module-install.ts: time_series_indexes markers', lambda s: f' {i}:' in s)
    edit('apps/api/test/release-artifact.test.ts', lambda s: re.sub(r"the four add-ons',\(\)=>\{const a=releaseArtifact\(\);assert\.equal\(a\.manifest\.modules\.length,(\d+)\);", lambda m: f"the five add-ons',()=>{{const a=releaseArtifact();assert.equal(a.manifest.modules.length,{int(m.group(1))+1});", s, count=1), 'release-artifact test: one more module (time_series_indexes)', lambda s: 'the five add-ons' in s)
    edit('apps/api/test/release-catalog.test.ts', lambda s: s if 'time-series-indexes-readiness' in s else s.replace("import * as fwWelfare from '../src/fw-welfare-readiness';","import * as fwWelfare from '../src/fw-welfare-readiness';\nimport * as timeSeries from '../src/time-series-indexes-readiness';").replace("[fwWelfare,'fwWelfareProblems']] as const)mock","[fwWelfare,'fwWelfareProblems'],[timeSeries,'timeSeriesIndexesProblems']] as const)mock").replace("[fwWelfare,'fwWelfareProblems','fw_welfare']] as const)it","[fwWelfare,'fwWelfareProblems','fw_welfare'],[timeSeries,'timeSeriesIndexesProblems','time_series_indexes']] as const)it").replace("'special_ops','fw_welfare'].includes(id)","'special_ops','fw_welfare','time_series_indexes'].includes(id)"), 'release-catalog test: time_series_indexes', lambda s: "[timeSeries,'timeSeriesIndexesProblems','time_series_indexes']" in s)
    p='db/proposed/time-series-indexes-module.json'
    if os.path.exists(p):
        import json
        j=json.load(open(p))
        for m in j.get('modules',[]):
            if m.get('id')=='time_series_indexes' and m.get('catalog')=='None.':
                m['catalog']='apps/api/src/time-series-indexes-readiness.ts timeSeriesIndexesProblems (written at the combined merge, R17)'
        json.dump(j,open(p,'w'),indent=2); open(p,'a').write('\n'); print('R17 time_series_indexes proposal: catalogue check named')

# R18: #61 (insurance-claims.ts) and #63 (time.ts) each added an isRealDate helper with the same meaning (a real
# calendar day in YYYY-MM-DD). Both are exported from the package index, which TypeScript refuses. The combined code
# keeps one: time.ts (accepts any value, used by records.ts and the API); insurance-claims.ts imports it.
p='packages/core/src/insurance-claims.ts'
if os.path.exists(p) and 'export function isRealDate' in open('packages/core/src/time.ts').read():
    s=open(p).read()
    m=re.search(r"^export const isRealDate = .*;\n", s, re.M)
    if m:
        s=s[:m.start()]+s[m.end():]
        first=re.search(r"^import .*;\n", s, re.M)
        s=(s[:first.start()]+"import { isRealDate } from './time';\n"+s[first.start():]) if first else "import { isRealDate } from './time';\n"+s
        open(p,'w').write(s)
        q='packages/core/src/service.ts'; t=open(q).read()
        t2=t.replace("import { CLAIM_DOCS, coveredOn, isRealDate, missingClaimDocs } from './insurance-claims';","import { CLAIM_DOCS, coveredOn, missingClaimDocs } from './insurance-claims';")
        if t2==t and "isRealDate, missingClaimDocs } from './insurance-claims'" in t: raise SystemExit('R18: service.ts import not reconciled')
        open(q,'w').write(t2)
        print('R18 isRealDate: one helper (time.ts); insurance-claims imports it')

# R19: #63 widened ClientRelation.ratings (from, via, docId: who at the client rated, and how) while #61 added
# shareLinks beside the old one-line ratings; the union kept both declarations. The combined type keeps the wider one,
# which older ratings still satisfy (the new fields are optional).
p='packages/core/src/types.ts'
s=open(p).read()
old="  /** Satisfaction, 1 (very unhappy) to 5 (very happy). */\n  ratings: { at: IsoDateTime; by: string; score: number; comment: string }[];\n"
if old in s and re.search(r"\n  ratings: \{\n    at: IsoDateTime;\n    by: string;\n    score: number;\n    comment: string;\n    from\?: string;", s):
    open(p,'w').write(s.replace(old,'',1)); print('R19 types.ts: one ClientRelation.ratings (the wider #63 shape)')

# R20: every department's guide cards join the shared guide. ACT, Central Admin, Finance, HR and Company Office each
# say "registered at the combined merge with registerGuideCards()". One file does it, so GET /api/org/guide and Arisha
# read one list; the shared card check (guideCardProblems) then covers every department's cards.
GUIDES=[('act','ACT_GUIDE_CARDS','./act-guide-cards'),('central_admin','CENTRAL_ADMIN_GUIDE_SPECS','./central-admin-guide'),
        ('finance','FINANCE_GUIDE_CARD_SPECS','./finance-guide-cards'),('hr','HR_GUIDE_CARDS','./hr-guide-cards'),
        ('company_office','OFFICE_GUIDE','./office-guide')]
present=[g for g in GUIDES if os.path.exists('packages/core/src/'+g[2][2:]+'.ts') and f'export const {g[1]}' in open('packages/core/src/'+g[2][2:]+'.ts').read()]
missing=[g[0] for g in GUIDES if g not in present]
if missing: raise SystemExit('R20: guide card list missing for '+', '.join(missing))
p='packages/core/src/guide-registry.ts'
if not os.path.exists(p):
    body="// Combined merge (R20): every department's guide cards join the shared guide (GET /api/org/guide), as each file says.\n"
    body+="import { registerGuideCards, type GuideCardSpec } from './guide-cards';\n"
    body+=''.join(f"import {{ {n} }} from '{m}';\n" for _,n,m in present)
    body+="\nconst DEPARTMENT_GUIDES: Record<string, GuideCardSpec[]> = {\n"+''.join(f"  {k}: {n},\n" for k,n,_ in present)+"};\n"
    body+="for (const cards of Object.values(DEPARTMENT_GUIDES)) registerGuideCards(cards);\n"
    body+="/** The departments whose cards are in the shared guide. */\nexport const REGISTERED_DEPARTMENT_GUIDES = Object.keys(DEPARTMENT_GUIDES);\n"
    open(p,'w').write(body)
    q='packages/core/src/index.ts'; s=open(q).read()
    if "'./guide-registry'" not in s: open(q,'a').write("export * from './guide-registry';\n")
    t='packages/core/test/guide-registry.test.ts'
    open(t,'w').write("""import { describe, expect, it } from 'vitest';
import { allGuideCards, guideCardProblems, REGISTERED_DEPARTMENT_GUIDES } from '../src';

describe('combined guide (R20)', () => {
  it('every department that wrote cards is in the shared guide, and every card passes the shared check', () => {
    expect([...REGISTERED_DEPARTMENT_GUIDES].sort()).toEqual(['act', 'central_admin', 'company_office', 'finance', 'hr']);
    const ids = allGuideCards().map((c) => c.id);
    for (const prefix of ['act.', 'central-admin.', 'fin.', 'hr.', 'office.']) expect(ids.some((i) => i.startsWith(prefix)), prefix).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allGuideCards().flatMap(guideCardProblems)).toEqual([]);
  });
});
""")
    print('R20 guide cards registered:', ', '.join(k for k,_,_ in present))

# R21: company_run_links (#57, approved by Fauzan 3 Nov 07:53Z "Yes, via the release path") joins the manifest right
# after company_office, with #57's own catalogue check (companyRunLinkProblems). Installed only through the release path.
if os.path.exists('db/modules/company-run-links-v1.sql'):
    i,pth,fn='company_run_links','db/modules/company-run-links-v1.sql','companyRunLinkProblems'
    if f'export async function {fn}' not in open('apps/api/src/company-office-readiness.ts').read(): raise SystemExit('R21: no run-links catalogue check')
    edit('apps/api/src/release-artifact.ts', lambda s: s if f"id:'{i}'" in s else s.replace(" {id:'company_office',path:'db/modules/company-office-v1.sql',requires:[]},\n", f" {{id:'company_office',path:'db/modules/company-office-v1.sql',requires:[]}},\n {{id:'{i}',path:'{pth}',requires:['company_office']}},\n",1), 'release-artifact.ts: company_run_links', lambda s: f"id:'{i}'" in s)
    edit('scripts/release-artifact.mjs', lambda s: s if f"['{i}'," in s else s.replace("['company_office','db/modules/company-office-v1.sql',[]]",f"['company_office','db/modules/company-office-v1.sql',[]],['{i}','{pth}',['company_office']]",1), 'release-artifact.mjs: company_run_links', lambda s: f"['{i}'," in s)
    for p in ['apps/api/src/release-catalog.ts','scripts/staging-release-gate.mjs','scripts/release-workflow-contract.test.mjs']:
        edit(p, lambda s: s if "'company_office','company_run_links'" in s else s.replace("'company_office','org_links'","'company_office','company_run_links','org_links'"), p+': company_run_links id', lambda s: "'company_office','company_run_links'" in s)
    edit('apps/api/src/release-catalog.ts', lambda s: s if fn in s else s.replace("import {companyOfficeProblems} from './company-office-readiness';",f"import {{companyOfficeProblems,{fn}}} from './company-office-readiness';").replace("    if(id==='company_office')return (await companyOfficeProblems(client)).length?[moduleCode(id)]:[];\n",f"    if(id==='company_office')return (await companyOfficeProblems(client)).length?[moduleCode(id)]:[];\n    if(id==='{i}')return (await {fn}(client)).length?[moduleCode(id)]:[];\n"), 'release-catalog.ts: company_run_links check', lambda s: f"if(id==='{i}')return" in s)
    edit('apps/api/src/module-install.ts', lambda s: s if f' {i}:' in s else s.replace(" org_links:",f" {i}:{{tables:['company_run_links'],functions:null}},\n org_links:",1), 'module-install.ts: company_run_links markers', lambda s: f' {i}:' in s)
    edit('apps/api/test/release-artifact.test.ts', lambda s: s if 'and company run links' in s else re.sub(r"the (\w+) add-ons',\(\)=>\{const a=releaseArtifact\(\);assert\.equal\(a\.manifest\.modules\.length,(\d+)\);", lambda m: f"the {m.group(1)} add-ons and company run links',()=>{{const a=releaseArtifact();assert.equal(a.manifest.modules.length,{int(m.group(2))+1});", s, count=1), 'release-artifact test: one more module (company_run_links)', lambda s: 'and company run links' in s)
    edit('apps/api/test/release-catalog.test.ts', lambda s: s if f"'{fn}','{i}'" in s else s.replace("[companyOffice,'companyOfficeProblems']]","[companyOffice,'companyOfficeProblems'],[companyOffice,'"+fn+"']]").replace("[companyOffice,'companyOfficeProblems'],[orgLinks","[companyOffice,'companyOfficeProblems'],[companyOffice,'"+fn+"'],[orgLinks").replace("[companyOffice,'companyOfficeProblems','company_office'],","[companyOffice,'companyOfficeProblems','company_office'],[companyOffice,'"+fn+"','"+i+"'],").replace("!['company_office','org_links'","!['company_office','"+i+"','org_links'"), 'release-catalog test: company_run_links', lambda s: f"'{fn}','{i}'" in s)

# R22: HR #51 (allowances: each allowance may be outside the EPF, PERKESO or PCB wage) and Finance #49 (dated EPF and
# PERKESO tables, zakat by salary deduction) both rewrote the same lines of staffPaySums; the union kept both. The two
# changes are independent, so the combined code keeps both: HR's wage bases feed Finance's dated tables, and zakat is
# still a percentage of gross pay that reduces PCB ringgit for ringgit. Both threads are asked to confirm.
p='packages/core/src/payroll.ts'
s=open(p).read()
a="  const epf = epfShare(epfWage, i.age, i.nationality);\n"
b="  const deductions = r2(epf.ee + socso.ee + lindung.ee + eis.ee + pcb + zakat);\n"
if a in s and "const epf = epfShare(gross, i.age, i.nationality, i.period, i.tables);" in s:
    i0=s.index(a); i1=s.index(b,i0)+len(b)
    merged="""  const epf = epfShare(epfWage, i.age, i.nationality, i.period, i.tables);
  const socso = socsoShare(socsoWage, i.age, i.period, i.tables);
  const eis = eisShare(socsoWage, i.age, i.nationality, i.period, i.tables);
  const lindung = lindungShare(socsoWage, i.period, i.nationality, i.lindungOptedOut);
  const pcbBeforeZakat = i.pcbEntered ?? pcbEstimate(taxable, epf.ee, socso.ee + eis.ee);
  // Zakat by salary deduction (Fauzan, 2 Nov 2026): the staff member's own percentage of gross pay. Zakat paid through
  // the employer reduces the monthly tax deduction ringgit for ringgit (ITA s.6A(3)), never below zero.
  const zakat = r2(Math.max(0, gross) * Math.max(0, i.zakatPercent ?? 0) / 100);
  const pcb = r2(Math.max(0, pcbBeforeZakat - zakat));
  const deductions = r2(epf.ee + socso.ee + lindung.ee + eis.ee + pcb + zakat);
"""
    s=s[:i0]+merged+s[i1:]; open(p,'w').write(s)
    print('R22 payroll.ts: HR allowance wage bases + Finance dated tables and zakat, one calculation')

# R23: #57 (run links) reads the links with a plain store before the company wall is set; #56 builds the request's
# store (with hand-overs when switched on) after it. Both named it `store`. The link read keeps its own name.
p='apps/api/src/db.ts'; s=open(p).read()
o="      const store = new PgStore(client);\n      const user = withRunCompanies(stored, await store.list('companyRunLinks'));\n"
if o in s and "const store = this.orgLinks ? withOrgLinks(new PgStore(client)) : new PgStore(client);" in s:
    open(p,'w').write(s.replace(o,"      const linkStore = new PgStore(client);\n      const user = withRunCompanies(stored, await linkStore.list('companyRunLinks'));\n",1))
    print('R23 db.ts: run-link read uses its own store; the request store keeps hand-overs')

# R24: DataWall union (access.ts). #51 extends HR's list past the old last member ('hr_legal';), so the line union leaves
# HR's tail after the registered-wall terminator. Put every member before the terminator, once. Fails closed when the
# type still does not end with the terminator.
p='packages/core/src/access.ts'; s=open(p).read()
reg="  | (string & { readonly registeredWall?: true });\n"
c="  /** A wall a department registered with registerWall() (walls.ts). */\n"
i=s.find(reg)
if i>=0 and s[i+len(reg):].lstrip(' ').startswith('|'):
    j=s.index(';\n', i+len(reg))+2
    tail=s[i+len(reg):j]
    head=s[:i]
    d=head.rindex('export type DataWall =')
    head=head[:d]+re.sub(r"(?m)^(  \| '[a-z_]+'\n)\1+", r'\1', head[d:])
    have=set(re.findall(r"^  \| '([a-z_]+)'", head[head.rindex('export type DataWall ='):], re.M))
    keep=[]; skip=False
    for line in tail.rstrip('\n').split('\n'):
        m=re.match(r"^  \| '([a-z_]+)';?$", line)
        if m and m.group(1) in have: continue
        keep.append(line.rstrip(';'))
    k=head.rindex(c)
    s=head[:k]+'\n'.join(keep)+'\n'+head[k:]+reg+s[j:]
    t=s[s.index('export type DataWall ='):]; t=t[:t.index(';\n')+2]
    if not t.endswith(reg) or len(re.findall(r"^  \| '([a-z_]+)'",t,re.M))!=len(set(re.findall(r"^  \| '([a-z_]+)'",t,re.M))): raise SystemExit('R24 access.ts: DataWall union not reconciled')
    open(p,'w').write(s); print('R24 access.ts: one DataWall union, registered walls last')

# R25: company managers' walls in the combined build. #51 (714248e) adds staff_movements for company heads; #52/#53 add
# arms, corporate, legal and mandates. Every assertion of u-cm-sasa's full wall list states the combined list.
FULL="['arms', 'corporate', 'legal', 'mandates', 'staff_company', 'staff_movements']"
if 'staff_movements' in open('packages/core/src/access.ts').read():
    for p,pat in [('packages/core/test/staff-security.test.ts',r"(expect\(walls\('u-cm-sasa'\)\)\.toEqual\()\[[^\]]*\](\);)"),
                  ('packages/core/test/hr-wall.test.ts',r"(expect\(dataWalls\(u\('u-cm-sasa'\)\)\)\.toEqual\()\[[^\]]*\](\);)")]:
        s=open(p).read(); n=re.sub(pat, lambda m: m.group(1)+FULL+m.group(2), s)
        if n!=s: open(p,'w').write(n); print('R25', p, ': company manager walls, combined list')

# R26: main.ts rate limits. #63 replaced the plain general limiter with the identity-aware one (one sign-in check per
# request); a branch that added the share-link limiter kept the plain line as its context, so the line union restored
# it and every request was counted twice. Keep the share limiter and the identity-aware limiter only.
p='apps/api/src/main.ts'; s=open(p).read()
if 'rateLimit(undefined, undefined, undefined, undefined, rateIdentity)' in s and '  app.use(rateLimit());\n' in s:
    open(p,'w').write(s.replace('  app.use(rateLimit());\n','',1)); print('R26 main.ts: one general limiter (identity-aware)')

# R27: prepareStaffPay (service.ts). #51 reads people0 then applies the month's movements (peopleForPeriod); #49 adds
# the dated statutory tables (storedStatTables) to the same Promise.all. One destructuring with both.
p='packages/core/src/service.ts'; s=open(p).read()
a="    const [people0, leaves, claims, runs] = await Promise.all([\n    const [people, leaves, claims, runs, tables] = await Promise.all([\n"
if a in s:
    s=s.replace(a,"    const [people0, leaves, claims, runs, tables] = await Promise.all([\n",1)
    if "const people = await this.peopleForPeriod(people0, period);" not in s: raise SystemExit('R27 service.ts: peopleForPeriod line missing')
    open(p,'w').write(s); print('R27 service.ts: prepareStaffPay reads people0 (HR) and tables (Finance) in one call')
