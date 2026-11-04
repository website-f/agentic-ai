import json,re,sys
import os
O=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','docs','system','reference')+os.sep
d=json.load(sys.stdin); d2=d
def esc(x): return str(x).replace('|','\\|').replace('\n',' ')
def val(v):
    s=json.dumps(v,ensure_ascii=False)
    return s if len(s)<=160 else s[:157]+'…'
# Rules
pref={}
for r in d['rules']: pref.setdefault(r['id'].split('-')[0],[]).append(r)
NAMES={'HR':'Human resources','OPS':'Operations','FWM':'Foreign workers','ARMS':'Arms control','SEC':'Security and secrecy','TENDER':'Tenders','WORK':'Work, tasks and remote work','COO':'COO oversight','BRANCH':'Branches','COM':'Commercial','CMS':'CMS command centre','ATT':'Attendance','CASE':'Cases','EA':'Employment Act','FLEET':'Vehicles','AM':'Asset Management','ACT':'ACT (audit)','RPT':'Reports','MTG':'Meetings','AST':'Fixed assets','PAY':'Payroll','IT':'IT','PILOT':'Pilot','CRD':'PWVSB credit','PUR':'Procurement','GOV':'Governance','AUD':'Assurance (GRC)','COR':'Company secretary','BRN':'Branches','CNT':'Contracts','FIN':'Finance','SYS':'Systems of record','PDPA':'PDPA','CRM':'Sales leads','BCM':'Continuity','LEAVE':'Leave','EVID':'Evidence','INS':'Insurance','REG':'Renewals','CTL':'Insider controls'}
L=['# Rule register (generated)','',
'Every business number and policy the code uses lives in one register, `packages/core/src/rules.ts`, with an ID, a label and its source. The app shows the rule ID when it blocks or warns, so staff can see why.','',
'This page is generated from the combined candidate (round 5). Values are shown as stored; long values are cut with "…" (read the source file for the full value).','',
'**Labels**','',
'- **Law**: taken from an Act or regulation. Counsel still confirms where noted.',
'- **Secondary**: taken from a published summary of the law (tax booklets, guides). Needs checking against the primary source.',
'- **Policy**: decided by the owner (Fauzan) or proposed for approval. "Proposed" in the source means not yet approved.',
'- **Unverified**: a working assumption. It must not be presented as fact or law until someone confirms it.','',
f'Total: {len(d["rules"])} rules.','']
for p in sorted(pref, key=lambda k:NAMES.get(k,k)):
    L+=[f'## {NAMES.get(p,p)} ({p})','','| Rule | Label | Value | Source and meaning |','|---|---|---|---|']
    for r in pref[p]: L.append(f"| `{r['id']}` | {r['label']} | `{esc(val(r['value']))}` | {esc(r['source'])} |")
    L.append('')
open(O+'rule-register.md','w').write('\n'.join(L))
# Records
L=['# Record kinds and their forms (generated)','',
'One Add/Edit form engine (`packages/core/src/records.ts`, `RECORD_KINDS`) serves the plain records below. The Add and Edit buttons show only to the people who keep that kind of record, and the server checks again on save. Every save writes the record and a hash-chained audit line with the old and new value of each field.','',
'Some records are deliberately never typed in: stock on hand (it moves only by goods received, issue and return), guards and officers (they are keyed in the JA Group app), and feeds from SQL Account, JA, door, alarm and CCTV systems.','']
for r in d['records']:
    L+=[f"## {r['label']} (`{r['kind']}`)",'',f"- **Kept by:** {esc(r.get('keptBy',''))}",f"- **Screen:** {r.get('screen','')}",f"- **Company scoped:** {'yes' if r.get('companyScoped') else 'no (group-wide)'}"]
    if r.get('note'): L.append(f"- **Note:** {esc(r['note'])}")
    L+=['','| Field | Type | Required | Notes |','|---|---|---|---|']
    for f in r['fields']:
        notes=[]
        if f.get('options'): notes.append('Choices: '+', '.join(o[1] if isinstance(o,list) else str(o) for o in f['options'])[:300])
        if f.get('restricted'): notes.append('Restricted: shown only behind the data wall')
        if f.get('createOnly'): notes.append('Set when created, not edited later')
        if f.get('ref'): notes.append('Picks a '+str(f['ref'])+' record')
        if f.get('help'): notes.append(f['help'])
        if f.get('setOnce') or f.get('once'): notes.append('Set once')
        L.append(f"| {esc(f.get('label',f.get('key')))} | {f.get('type','')} | {'yes' if f.get('required') else ''} | {esc('; '.join(notes))} |")
    L.append('')
open(O+'record-forms.md','w').write('\n'.join(L))
# Hand-over map
ST={'live':'Live (on main)','in_pr':'In a draft PR','direct':'Direct (the receiving desk works it on its own screen)','waits':'Waits (needs a feed or decision first)'}
L=['# Hand-over map between departments (generated)','',
'Fauzan, 2 Nov 2026: "Key in once and all department get the data needed." When one desk saves a record, Prima sends each listed desk either a **to-do** (something to act on, with a due time) or an **info** notice. Each person sees theirs on the **Hand-overs** screen. A hand-over is a link to the record; the screen it opens still checks the person\'s own permissions.','',
'Source: `packages/core/src/org-links.ts` (`ORG_FLOWS`), combined candidate round 5. This map arrives with PR #56 (Connect departments), which is not merged to main.','',
'**Desks**: '+', '.join(f"{k} = {v}" for k,v in d2['desks'].items()),'',
'**Never routed** (these actions never create a hand-over, by design): '+', '.join(f'`{x}`' for x in d2['never']),'']
for f in d2['flows']:
    L+=[f"## {f['name']}",'',f"- **Keyed by:** {d2['desks'].get(f['keyedBy'],f['keyedBy'])}",f"- **Record:** {f['record']}",f"- **Status:** {ST.get(f['status'],f['status'])}"]
    if f.get('note'): L.append(f"- **Note:** {esc(f['note'])}")
    L+=['','| Goes to | Kind | What they do | Due |','|---|---|---|---|']
    for t in f['targets']:
        L.append(f"| {d2['desks'].get(t['desk'],t['desk'])} | {t['kind']} | {esc(t['task'])} | {str(t.get('dueDays',''))+' days' if t.get('dueDays') else ''} |")
    L.append('')
open(O+'handover-map.md','w').write('\n'.join(L))
# Guide cards
STS={'ready':'Ready','partial':'Partly built','not_built':'Not built yet','off':'Built, switched off'}
L=['# Task guide cards (generated)','',
'Guide cards are read-only, step-by-step help for each task, Bahasa Melayu first with English. The screen and Arisha read the same cards, so Arisha\'s answers match the screen. A card never saves, approves or sends anything, and it shows a task only to people the server already lets do it.','',
'This index lists the English title, who does it, where (screen and button) and its build status. The full card (fields, sources, whom to ask, what happens after Save) is shown in the app and in the source files.','',
'Registered in the shared guide (`guide-registry.ts`): ACT, Central Admin, Finance, HR, Company office. Still read from their own module files: Operations (`ops-guide-cards.ts`), Special Ops and Asset Management (`special-ops-guide.ts`), Work rebalancing (`work-rebalance-guide.ts`). Finance also has its own payment guides (`finance-guides.ts`) and IT has its own in-app IT guide.','']
def gtxt(x): return x.get('en') if isinstance(x,dict) else (x or '')
by={}
for c in d2['cards']: by.setdefault({'all':'All departments','finance':'Finance'}.get(c['dept'],c['dept']),[]).append(c)
for k,v in d2['extra'].items():
    for c in v: by.setdefault({'all':'All departments','finance':'Finance'}.get(c.get('dept'),c.get('dept')) or k,[]).append(c)
for dept in sorted(by):
    L+=[f'## {dept}','','| Task | Who | Screen and action | Status |','|---|---|---|---|']
    for c in by[dept]:
        sc=c.get('screen') or {}
        scr=f"{sc.get('name','')} ({sc.get('view')}): {gtxt(sc.get('action'))}" if sc else ''
        L.append(f"| {esc(gtxt(c.get('title')))} | {esc(gtxt(c.get('who')))} | {esc(scr)} | {STS.get(c.get('status'),c.get('status',''))} |")
    L.append('')
open(O+'guide-cards.md','w').write('\n'.join(L))
print('ok')
