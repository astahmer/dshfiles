# Logical project vs physical execution workspace — what the data model allows

Status: **open design blocker**, with the exact constraint identified.

## The two concepts

- **Logical project** — `/Users/astahmer/dev/dshfiles`: grouping, discovery,
  navigation, persistence.
- **Physical execution workspace** — `/Users/astahmer/dev/dshfiles-threads/…`:
  the isolated jj workspace the agent runs in.

The release candidate now creates threads successfully and gives each a distinct
isolated jj workspace. What it does **not** yet do is keep the thread discoverable
under the original project.

## Why the obvious fix does not work

`WorkspaceEntity.attachSession` (`@deepseek-ai/dsh-workspace` `lib/index.js:111`)
validates `cwd === record.path` and throws otherwise. Relaxing that check with a
"placed by resolver" flag was the first candidate, and it is **not sufficient**:

```js
// lib/index.js:103
return this.record.sessionIds.filter(id => this.host.sessionPath(id) === this.record.path)
```

A workspace's visible sessions are those whose **remembered path equals the
workspace path**. `attachSession` calls `rememberSessionPath(sessionId, cwd)` with
the session's real cwd. So a session attached to the project workspace while
executing in a provisioned directory would be attached and then **filtered out of
the listing** — it would not appear under the project, which is the whole point.

Relaxing the validation would therefore have produced exactly the misleading
success this work is meant to avoid: `result.ok: true`, no error, and a thread the
user cannot find.

## What the model actually supports

- Sessions belong to a workspace by **exact path equality**; there is no
  parent/child or group concept in the registry (`create(path, title)`,
  `resolveByPath(path)`, `list()`, `insertBefore`).
- Therefore a thread's execution directory must itself be a **registered
  workspace** for the thread to be discoverable at all.

## The two viable implementations

1. **Register the provisioned directory as a workspace** — the ADE provisioner
   calls `workspaceRegistry.create(provisionedPath, threadTitle)` after `jj
workspace add`, so the session attaches to it through the existing, unmodified
   contract. Discoverable and isolated, at the cost of one sidebar entry per
   thread rather than grouping under `dshfiles`. This needs no core change and no
   validation relaxation.
2. **Add a parent/group to the workspace record** — a real core data-model change
   in `dsh-workspace` so a provisioned workspace can render beneath its project.
   Larger, and it is a published package.

Option 1 is the smallest correct implementation and preserves every existing
invariant: ownership, security, cleanup eligibility and workspace lifecycle all
keep operating on the real execution directory. Option 2 is the only way to get
literal "grouped under dshfiles" and should be treated as a separate feature.

## What is verified today

Against the isolated release runtime, `scripts/release/rc-verify.mjs`:

```
workspace/create 200 | workspaceId d57dcf52-3369-4002-8f86-94a3b2864167
session/create session-rc-alpha: 200 | ok: true
session/create session-rc-beta:  200 | ok: true
provisioned jj workspaces: ["project-68c6675b","project-ed75c4d6"] | distinct: 2
resume: 200 | workspaces after: 2 (was 2)
activation failures: none
```

Creation, isolation, distinctness and resume hold. Association does not, for the
reason above, and `ok: true` must not be read as proof that it does.
