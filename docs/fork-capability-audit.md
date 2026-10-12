# Fork-dependent capability audit (2026-10-12)

What this checkout can already do on the deployed Host, what exists only in the
local core forks, and what still needs a core extension.

Method: **deployed** means the packages the running Host actually loads — the
`0.2.0-rc.2` tree in the pnpm global store, read directly, plus
`dsh --profile web --dump-config`. **Fork** means `tooling/dsh-core/*` in this
checkout. Every row carries the evidence that decided it.

## A. Already supported by the deployed core

| Capability | Evidence |
|---|---|
| Composer model-picker slot | `conversation.input.model` is registered in `@deepseek-ai/dsh-client-ui-conversation@0.2.0-rc.2/lib/client.js`. The ai-accounts gap "no composer action slot for model choice" in `plans/dsh-host-gaps.md` is **closed**; only the plugin work remains. |
| Composer control rows | `conversation.input.left`, `.right`, `.activity`, `.permission`, `.plan` are all `list`/`single` seats on `conversation.composer.bar`. |
| Panel and settings seats | `sidebar.panellist`, `main`, `settings.section`, `settings.plugins.page`, `settings.general.item` are all present in the deployed client contracts. |
| Workspace resolution boundary | The deployed `@deepseek-ai/dsh-api-session-controller` carries `lib/types/workspace-resolution.js` and three `requireWorkspaceResolver` references, wired into `session.create` and `session.fork`. Deployed by the ADE work; verified end-to-end. |
| Fork capability advertisement | The fork agent loop exposes `forkFeatures`; OptMem already reads it (`host.ts`), so availability detection is accurate rather than guessed. |

## B. Implemented in the fork, not deployed

| Capability | Evidence |
|---|---|
| `agent/request-messages` waterfall — the OptMem full-mode hook | `tooling/dsh-core/agent/src/runtime-types.ts:356` declares it; `tooling/dsh-core/agent-loop/src/agent.ts:935` dispatches it after `buildRequest`; `tooling/dsh-core/agent-loop/src/index.ts:357` advertises it in `forkFeatures`. |
| Fork runtime bridge | `@dshfiles/dsh-core-runtime` bundles the fork agent, agent-loop, session, session-persistence-jsonl and api-session-controller into one host entry, and its `cordis.patch.yml` disables the five matching native rows. It is **not** in the web profile (absent from both the installed profile and the seed), which is why full mode reports unsupported. |

## C. The blocking conflict (why full mode is not enabled)

The bridge replaces the session controller along with the agent loop, and the
vendored fork has **no** `workspace-resolution.ts` and **no**
`sessionWorkspaceResolver` reference:

```
tooling/dsh-core/api-session-controller/src/workspace-resolution.ts   → absent
grep -rn requireWorkspaceResolver tooling/dsh-core/api-session-controller/src → no matches
```

Deploying the bridge as it stands would therefore replace the one session
controller that performs automatic thread workspace isolation, silently
regressing a capability that is verified working end to end. That is a direct
conflict with preserving workspace resolution, so it was **not** deployed.

Porting the hook is bounded and known: 87 lines of
`workspace-resolution.ts` plus the `index.ts` wiring, where the canonical
checkout (`~/dev/dsh-core-ade-hook`) differs from the vendored copy by 193 diff
lines. Sequence once ported:

```sh
pnpm --dir plugins/@dshfiles/dsh-core-runtime build   # bundles the fork packages
pnpm profile:sync --profile web --bundle @dshfiles/dsh-core-runtime
# then a user-controlled restart, with an LKG snapshot as the rollback
```

## D. Requires a small core extension

Checked against the deployed `0.2.0-rc.2` tree; none of these are present.

| Capability | Owning plugin | Missing piece |
|---|---|---|
| Prefilled prompt on session create | jujutsu | No `initialPrompt` option in the deployed session controller. |
| Archive / turn-lifecycle event hook | thread-sidebar | No archive event on the session controller. |
| Programmatic `settings.open({ section, key })` | settings-search | The settings **slots** exist; an open-by-section API does not. |
| MCP connection status, legacy SSE transport | mcp-servers | Absent from `@deepseek-ai/dsh-mcp-client`. |
| Set or change a session's parent | thread-sidebar | No `setParent` on the session controller. |

## E. Toolchain, not core

`DSHX2002` — a Host entry cannot declare native `Config` and dshx settings
together — was hit while moving the jj-integration switches into settings. The
route is to split the Host into two loader entries, not to change the core.
The same rule is why the mcp-servers preferences gap in `plans/dsh-host-gaps.md`
has a workaround rather than a patch.

## F. Research artifacts, not deployments

`~/dev/dsh-core-*` holds roughly thirty per-capability probe checkouts from
earlier threads (activity metadata, palette search, rich queue, session
deeplinks, thread search, settings-native, and so on). Each is a **separate**
store — none is a workspace of this repository's store — and none is on any live
path. The only one a live artifact derives from is the canonical ADE checkout
(`~/dev/dsh-core-ade-hook`), whose workspace-resolution hook is already deployed
inside the published session controller. Treat the rest as research, not as
pending integration.

## G. Remaining compatibility gaps

- **Full mode**: blocked by C. OptMem stays in compatibility mode and reports it
  accurately; the dropdown is not unlocked.
- **Fork generation drift**: the vendored packages are versioned `0.2.0-rc.2` but
  are ahead of the published rc.2 — they carry `updateAttention` and the
  workspace-restore methods the published controller lacks (recorded in
  `AGENTS.md`). A swap therefore changes more than the agent loop, which is a
  second reason the bridge needs its own validation pass before it reaches the
  web profile.
