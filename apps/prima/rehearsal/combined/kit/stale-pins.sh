#!/bin/bash
# Release-owner packages and workflows whose pins no longer match the candidate's bytes. Fails (exit 1) when any pin is
# stale, so a candidate is never reported release-ready while they are. It never edits them.
cd "${1:?worktree}" || exit 1
BASE=$(sha256sum db/migrations/001_init.sql | cut -d' ' -f1); echo "candidate base $BASE"
stale=0
for h in $(git grep -ohE '\b[0-9a-f]{64}\b' -- ops .github 2>/dev/null | sort -u); do
  git grep -qE "$h" -- db/release-manifest.json db/proposed 2>/dev/null && continue
  if ls db/migrations/001_init.sql db/modules/*.sql apps/api/src/connections-mail/*.sql 2>/dev/null | xargs -r sha256sum | grep -q "^$h"; then continue; fi
  :
done
for p in $(git ls-files 'ops/*' | grep -E '\.sql$'); do
  n=$(basename "$p"); for src in db/migrations/001_init.sql db/modules/*.sql; do
    [ "$(basename $src)" = "$n" ] || continue
    if [ "$(sha256sum $p|cut -d' ' -f1)" = "$(sha256sum $src|cut -d' ' -f1)" ]; then echo "same    $p"; else echo "STALE   $p (differs from $src)"; stale=1; fi
  done
done
for f in $(git ls-files 'ops/*manifest*.json' 'ops/**/release-manifest.json'); do
  if [ "$(basename "$f")" = readiness-manifest.json ]; then
    # Pins the packaged validators, not the base: current when each packaged source is the candidate's own validator.
    d=$(dirname "$f"); bad=$(node -e 'const fs=require("fs"),c=require("crypto"),p=require("path"),[f,d]=process.argv.slice(1);const h=x=>c.createHash("sha256").update(fs.readFileSync(x)).digest("hex");for(const x of JSON.parse(fs.readFileSync(f)).files){const src="apps/api/src/"+p.basename(x.source);if(!fs.existsSync(src)||h(src)!==x.sourceSha256||h(p.join(d,x.source))!==x.sourceSha256)console.log(p.basename(x.source))}' "$f" "$d")
    if [ -n "$bad" ]; then echo "STALE   $f (validators differ from apps/api/src: $(echo $bad))"; stale=1; else echo "same    $f (validators)"; fi
    continue
  fi
  grep -q "$BASE" "$f" || { echo "STALE   $f (does not pin candidate base ${BASE:0:12})"; stale=1; }
done
for f in $(git ls-files '.github/workflows/*.yml'); do
  for s in $(grep -ohE '\b[0-9a-f]{40}\b' "$f" | sort -u); do echo "STALE   $f pins commit ${s:0:12} (not this candidate)"; stale=1; done
done
[ $stale = 0 ] && echo "release packages: current" || echo "release packages: STALE (release owner regenerates; never done by the rehearsal)"
exit $stale
