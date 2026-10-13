# `default` workspace — state and the safe sync procedure

Investigated for section 4 of the handoff. **Not relocated**, because the live
Host runs from this directory; the state and the exact safe procedure are
recorded instead so it stops being silently forgotten.

## Measured state

| Fact                                  | Value                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `default` `@`                         | `9c59f35c` — **empty** commit, description `wip`                             |
| its parent                            | `494d7ce1` — the old spine base                                              |
| working copy                          | **clean** (`The working copy has no changes.`)                               |
| unique content vs `integration-spine` | **none** — `jj diff --from integration-spine --to @` only removes spine work |
| ancestor of the spine?                | no                                                                           |
| commits off the spine                 | 1 (the empty `wip`)                                                          |

So `default` is an empty wip commit parked on the old base. It holds **no unique
work**: the diff against the spine is the spine's own 20+ commits, not anything
this checkout authored.

## Why it is not moved now

The live `:3080` Host runs from this directory. Relocating `@` performs a real
checkout of ~20 commits into the files the running Host reads. That is a
disruptive change to a live process, which the handoff excludes, and the handoff
also says this must not delay the release.

## The safe procedure, for when the Host is stopped

`@` is empty and the working copy is clean, so no commit needs rewriting,
rebasing or abandoning — the only operation required is a forward `jj new`:

```sh
cd /Users/astahmer/dev/dshfiles
jj status                     # must report no changes; stop otherwise
jj log -r @ --no-graph -T 'commit_id ++ " " ++ description.first_line()'   # expect the empty wip
jj new integration-spine      # new empty child of the spine tip; rewrites nothing
jj log -r @ --no-graph -T 'commit_id ++ " " ++ description.first_line()'   # expect an empty child of the spine
```

This is deliberately **not** `jj rebase`, not `jj edit`, and not `jj abandon`:
the folded-default hazard in `AGENTS.md` is about rewriting that `@`, and none of
that is needed when the commit is empty and clean.

Afterwards verify `jj workspace list` shows `default` on a child of
`integration-spine`, and that no other workspace's `@` changed.

## Regression coverage to add

A test asserting the invariant directly, so this cannot recur silently:

- for every registered workspace, `@` is a descendant of `integration-spine` or
  is an explicitly parked leaf;
- the `default` workspace in particular is never an ancestor of the spine and
  never more than one empty commit off it;
- no workspace `@` is a duplicate change id of another.
