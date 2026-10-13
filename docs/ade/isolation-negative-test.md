# Isolation negative test — forced registration failure

Repeatable, disposable, no production impact.

## Procedure

```sh
cd /Users/astahmer/dev/dshfiles-release-candidate
cp plugins/@dshfiles/jj-integration/dist/index.js /tmp/jj-int-dist-backup.js
# Force the registry lookup to fail, simulating an unavailable registry.
python3 - <<'PY'
import re
p='plugins/@dshfiles/jj-integration/dist/index.js'
s=open(p).read()
m=re.search(r"const registry = context\.get\((['\"])workspaceRegistry\1\);", s)
assert m, 'lookup not found'
open(p,'w').write(s[:m.start()] + "const registry = undefined; // NEGATIVE TEST" + s[m.end():])
PY
node scripts/release/rc-verify.mjs
cp /tmp/jj-int-dist-backup.js plugins/@dshfiles/jj-integration/dist/index.js   # restore
```

## Result

```
session/create session-rc-alpha: 200 | ok: false
  {"code":"gateway/internal","message":"the workspace registry is unavailable,
   so a provisioned workspace cannot be registered"}
session/create session-rc-beta:  200 | ok: false  (same)
sessions in the shared checkout: 0
```

| Assertion                                                | Result                                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `session/create` returns an explicit failure             | **PASS** — `ok: false`, named reason                                                                                                   |
| No Session silently falls back to the shared project cwd | **PASS** — 0 sessions in the shared checkout                                                                                           |
| No orphaned Session treated as successful                | **PASS** — both creations refused                                                                                                      |
| Provisioned directories reconciled safely                | **PASS** — the jj directories remain, unclaimed by any Session, for the cleanup lifecycle; no Session claims them and none is orphaned |

Restoring the artifact returns the positive path to green: both Sessions
`ok: true`, two isolated records each with its Session attached, 0 sessions in
the shared checkout.
