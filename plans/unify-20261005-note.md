# Workspace unification note — 2026-10-05

## What this records

One unification pass over the repository's jj workspaces. After it, one branch
(`main`) carries every relevant committed row, the two recovery chains are
preserved behind one backup bookmark, and only a single workspace remains.

## Pre-operation rollback point

`jj op restore d1ee86e610f8cd90852a9a8f643785683faa099fb791fcb22a9e4d6958cf0d6ebbfd068a6145cdcd6b5207fc76ab0cec212cd56e85d76de5c5272c945c4fb002`

This restores the repository to the exact state before the unification pass.
Recorded it here because the pass deleted alternate heads and obsolete
bookmarks; the op log keeps their content reachable even so.

## Delivered branch

Single branch = `main` bookmark, ending (at note time) at:

1. the unified spine (main's previously bookmarked `bbcd571a` integration base,
   then every repair/plan/customization step, ending in `d287...`
   fix(queue-reorder): stop the dock measuring through undefined composer hooks
   plus the short in-flight wip commit), and
2. the software-additions chain rebased on top of the spine's working-copy tip:
   `docs(plan): bring approved software roadmap onto current baseline`,
   `feat(dsh-core): named runtime driver seam in the narrow agent fork`,
   `docs(plan): record phase 0 and 1a acceptance receipts`, and
3. `restore: integrate the 2-file recover-conflict rows` — the only genuinely
   unique rows from the abandoned `recovery-unify-conflict` head:
   - `tooling/dshx/package.json` resolved build row now `create-dshx` first,
     which is the actual repair for the historical
     `Cannot find module 'create-dshx'` build-order break, plus the restored
     `test:boot` wiring (spine keeps the script; the row was dropped there).
   - `tooling/dshx/packages/dshx/tests/authoring-cli.spec.ts`: 27 rows of
     scaffolding CLI tests, none of which the spine carried.

## Preserved recovery line

The `recovery-20261005` bookmark points at the abandoned `integration-unify-pending`
chain head (`uqnsppwr abd07616`, "fix: enforce plugin and desktop toolchain
checks") — one of the duplicate re-creations of the spine's own fixes. It
stays reachable in case anything inside the recovery universe is ever wanted
byte-exactly; the unified branch supersedes every row of it with live,
tested variants. The other alternate chains (`old-attempt` duplicates and the
`framework` workspace snapshot) were abandoned without a bookmark; they remain
hidden but reachable from the same op point, so nothing is destroyed.

## Workspaces

All workspaces except `default` were forgotten (`fast-fixes`, `feature-survey`,
`framework`, `hardening2`, `unify-20261005`, `software-additions`). Their
heads were empty at the time; every non-empty row from them either sat on the
unified branch already or belongs to the preserved recovery line above.

Post-state invariants (verified):

- `jj log -r 'heads(all() & mutable())'` shows one live head plus the bookmarked
  recovery line.
- conflict count across all commits: 0
- divergent change-ids: 0
- bookmarks: `main` + `recovery-20261005`
