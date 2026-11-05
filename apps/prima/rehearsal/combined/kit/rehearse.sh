#!/bin/bash
# Combined candidate rehearsal, from exact commits only. Portable: no fixed paths; the kit is the directory holding
# this script. Local only: it never pushes, merges a PR, installs, migrates or deploys.
#   usage: rehearse.sh <empty git worktree of this repository>
# Reads components.json next to this script: base commit, then each component in order, by exact SHA:
#   mode "merge": git merge of that commit;  mode "delta": the commits deltaBase..sha replayed (a PR built on top of an
#   earlier candidate). Fails closed (exit 1) on a missing commit, a component not contained in the result, an
#   unresolved conflict marker, or a reconcile step that errors.
set -euo pipefail
K=$(cd "$(dirname "$0")" && pwd)
W=${1:?usage: rehearse.sh <worktree>}
cd "$W"
G=(git -c user.name=rehearsal -c user.email=rehearsal@localhost -c merge.conflictStyle=diff3)
J="$K/components.json"
val() { node -e "const c=require(process.argv[1]);console.log(eval(process.argv[2]))" "$J" "$1"; }
need() { git cat-file -e "$1^{commit}" 2>/dev/null || git fetch -q origin "$1" 2>/dev/null || true; git cat-file -e "$1^{commit}" 2>/dev/null || { echo "MISSING commit $1" >&2; exit 1; }; }
BASE=$(val c.base.sha); need "$BASE"
git checkout -q --detach "$BASE"
N=$(val c.order.length)
resolve() { # one conflicted file at a time, same rules for every component
  local f=$1 owner56=$2
  case "$f" in
    CLAUDE.md|docs/*) git checkout --ours -- "$f" ;;
    packages/core/src/rollouts.ts|packages/core/test/rollouts.test.ts) git show "$owner56:$f" > "$f" ;;
    apps/web/src/views/Reports.tsx) python3 - "$f" <<'PY'
import re,sys;p=sys.argv[1];s=open(p).read();s=re.sub(r"<<<<<<< [^\n]*\n(.*?)(?:\|\|\|\|\|\|\| [^\n]*\n.*?)?=======\n.*?>>>>>>> [^\n]*\n",r"\1",s,flags=re.S);open(p,'w').write(s)
PY
    ;;
    *) python3 "$K/union.py" "$f" ;;
  esac
}
meaning() { # known meaning-level merges (both sides add to one value)
  sed -i "s/^export type JaDataset = 'payroll' | 'worker' | 'incident' | 'guard';$/export type JaDataset = 'payroll' | 'worker' | 'incident' | 'guard' | 'paySummary';/; /^export type JaDataset = 'payroll' | 'worker' | 'incident' | 'paySummary';$/d" packages/core/src/types.ts
  if grep -q "guard: 'Guards' };" apps/web/src/views/Ja.tsx && grep -q "paySummary: 'Guard pay' };" apps/web/src/views/Ja.tsx; then
    sed -i "/paySummary: 'Guard pay' };$/d; s/guard: 'Guards' };/guard: 'Guards', paySummary: 'Guard pay' };/" apps/web/src/views/Ja.tsx; fi
  if [ "$(grep -c '^const JA_DATASETS = ' apps/api/src/controllers.ts)" = 2 ]; then
    sed -i "/^const JA_DATASETS = .*'pay-summary': 'paySummary' } as const;$/d; s/^const JA_DATASETS = \(.*\)guards: 'guard' } as const;$/const JA_DATASETS = \1guards: 'guard', 'pay-summary': 'paySummary' } as const;/" apps/api/src/controllers.ts; fi
}
S56=$(val 'c.order.find(o=>o.pr.startsWith("#56")).sha')
for i in $(seq 0 $((N-1))); do
  PR=$(val "c.order[$i].pr"); SHA=$(val "c.order[$i].sha"); MODE=$(val "c.order[$i].mode||'merge'"); need "$SHA"
  if [ "$MODE" = merge ]; then
    if "${G[@]}" merge -q --no-edit "$SHA" >/dev/null 2>&1; then echo "CLEAN  $PR ${SHA:0:7}"; continue; fi
    files=$(git diff --name-only --diff-filter=U); echo "MERGED $PR ${SHA:0:7} (resolved: $(echo $files | tr '\n' ' '))"
    for f in $files; do resolve "$f" "$S56"; done
    meaning; git add -A; "${G[@]}" commit -qm "rehearsal: merge $PR ${SHA:0:12}"
  else
    DB=$(val "c.order[$i].deltaBase"); need "$DB"
    # The net change deltaBase..sha is applied once, so a change made and later undone inside the PR (for example
    # #63 adding then handing back Finance team routing) never reaches the candidate twice.
    if ! git diff --binary "$DB" "$SHA" | git apply --3way --index >/dev/null 2>&1; then
      files=$(git diff --name-only --diff-filter=U)
      [ -n "$files" ] || { echo "DELTA FAILED $PR: patch did not apply and left no conflicts" >&2; exit 1; }
      for f in $files; do resolve "$f" "$S56"; done
      meaning; git add -A
    fi
    "${G[@]}" commit -q --allow-empty -m "delta $PR ${DB:0:7}..${SHA:0:7} (net change, $(git rev-list --count "$DB..$SHA") commits)"
    echo "DELTA  $PR ${DB:0:7}..${SHA:0:7} ($(git rev-list --count "$DB..$SHA") commits)"
  fi
done
# The registered-wall member must close the DataWall union.
python3 - <<'PY'
import re
p='packages/core/src/access.ts'; s=open(p).read()
line="  | (string & { readonly registeredWall?: true })"
m=re.search(r"export type DataWall =(.*?);\n",s,re.S)
body=m.group(1)
if line.strip() in body:
    keep=[]
    for l in body.split('\n'):
        if l.strip().rstrip(';')==line.strip():
            if keep and 'registerWall()' in keep[-1]: keep.pop()
            continue
        keep.append(l)
    nb='\n'.join(keep).rstrip()+"\n  /** A wall a department registered with registerWall() (walls.ts). */\n"+line
    s=s[:m.start(1)]+nb+s[m.end(1):]
    open(p,'w').write(s)
PY
git add -A; "${G[@]}" commit -qm "rehearsal: close DataWall union" >/dev/null 2>&1 || true
python3 "$K/reconcile.py"
git add -A; "${G[@]}" commit -qm "rehearsal: reconcile R1-R14" >/dev/null 2>&1 || true
node "$K/pins.js" "$BASE" $(node -e 'const c=require(process.argv[1]);console.log(c.order.map(o=>o.sha).join(" "))' "$J") > "$W/.pins.out"
git add -A; "${G[@]}" commit -qm "rehearsal: one-pass pins" >/dev/null 2>&1 || true
rm -f "$W/.pins.out"
if git grep -n "^<<<<<<< \|^>>>>>>> \|^||||||| " -- apps packages db scripts >/dev/null; then echo "CONFLICT MARKERS LEFT" >&2; git grep -n "^<<<<<<< " -- apps packages db scripts | head >&2; exit 1; fi
# Every merged component must be contained in the result.
for i in $(seq 0 $((N-1))); do SHA=$(val "c.order[$i].sha"); MODE=$(val "c.order[$i].mode||'merge'"); [ "$MODE" = merge ] || continue; git merge-base --is-ancestor "$SHA" HEAD || { echo "NOT CONTAINED $SHA" >&2; exit 1; }; done
echo "tested tree commit $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree})"
