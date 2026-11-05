import sys,re
IMP=re.compile(r"^import (type )?\{ ?(.*?) ?\} from ('[^']+');$")
ARR=re.compile(r"^(\s*)(controllers|providers): \[(.*)\],$")
def items(x): return [i.strip() for i in x.split(',') if i.strip()]
def merge_lists(a,b):
    out=list(a)
    for i in b:
        if i not in out: out.append(i)
    return out
def resolve(ours,theirs):
    if ours==theirs: return ours
    # import lines: merge specifiers per (type?, module)
    if all(IMP.match(l) for l in ours+theirs if l.strip()):
        mods={}
        order=[]
        for l in ours+theirs:
            if not l.strip(): continue
            m=IMP.match(l); k=(m.group(1) or '',m.group(3))
            if k not in mods: mods[k]=[]; order.append(k)
            mods[k]=merge_lists(mods[k],items(m.group(2)))
        return [f"import {k[0]}{{ {', '.join(mods[k])} }} from {k[1]};" for k in order]
    # module arrays (controllers/providers)
    if all(ARR.match(l) for l in ours+theirs if l.strip()):
        keys={}; order=[]; ind=''
        for l in ours+theirs:
            if not l.strip(): continue
            m=ARR.match(l); ind=m.group(1)
            if m.group(2) not in keys: keys[m.group(2)]=[]; order.append(m.group(2))
            keys[m.group(2)]=merge_lists(keys[m.group(2)],items(m.group(3)))
        return [f"{ind}{k}: [{', '.join(keys[k])}]," for k in order]
    # type-union tails: both end with "...;" in a "| x" list
    lo=[l for l in ours if l.strip()]; lt=[l for l in theirs if l.strip()]
    if lo and lt and lo[-1].strip().startswith('|') and lo[-1].rstrip().endswith(';') and lt[-1].rstrip().endswith(';'):
        o=list(ours); idx=max(i for i,l in enumerate(o) if l.strip()); o[idx]=o[idx].rstrip()[:-1]
        return o+theirs
    return ours+theirs
for p in sys.argv[1:]:
    s=open(p).read().split('\n'); out=[]; mode=None; ours=[]; theirs=[]
    for line in s:
        if line.startswith('<<<<<<< ') and mode is None: mode='o'; ours=[]; theirs=[]; continue
        if mode and line.startswith('||||||| '): mode='b'; continue
        if mode and line.strip()=='=======' : mode='t'; continue
        if mode and line.startswith('>>>>>>> '): out+=resolve(ours,theirs); mode=None; continue
        if mode=='o': ours.append(line)
        elif mode=='t': theirs.append(line)
        elif mode=='b': pass
        else: out.append(line)
    open(p,'w').write('\n'.join(out))
