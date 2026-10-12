# What the jj-isolation guard actually covers

The guard is a `PATH` shim: an executable named `jj` placed ahead of the real jj.
It is **not** global enforcement. This document records exactly which jj
invocations it intercepts on this machine, which bypass it, and what that means
for the rollout.

## Interception model

`@deepseek-ai/dsh-subprocess-local` resolves a bare command name by searching
`PATH` and re-derives the candidates on every call
(`lib/index.js:1332-1355`). Its child environment is `scrubbedParentEnv()` plus
explicit overrides, and that scrub drops only secret-looking names and `DSH_*`
names — **`PATH` is copied verbatim** (`@deepseek-ai/dsh-subprocess/lib/index.js:32,50-56`;
`runner-launch-B2zsQ1Dz.js:694-707`). `spawn` hands the program to Node
`child_process.spawn`, whose `PATH` lookup uses that environment
(`runner-launch-B2zsQ1Dz.js:1020-1051`).

The agent bash tool is `bash -c <command>` with no `PATH` override
(`@deepseek-ai/dsh-bash-local/lib/index.js:22-27,105-121,140-145`), and managed
background jobs run through the same executor
(`@deepseek-ai/dsh-tool-bash/lib/index.js:388-406`). It is not a login or
interactive shell, and `BASH_ENV`/`ENV` are unset, so a shim that lives only in
`.zshrc` never reaches an agent.

Consequence: the shim covers a path **only if the shim directory is in the `PATH`
the `dsh` process itself was launched with.** Installing it into a shell rc file
is not enough.

## Covered

| path | how it spawns jj | evidence |
| --- | --- | --- |
| DSH subprocess service (the mechanism every plugin uses) | `PATH` search, environment inherited | `dsh-subprocess-local/lib/index.js:1332-1355`; `dsh-subprocess/lib/index.js:32,50-56` |
| agent bash tool | `bash -c`, DSH `PATH` | `dsh-bash-local/lib/index.js:22-27,105-121` |
| managed background jobs | same executor | `dsh-tool-bash/lib/index.js:388-406` |
| `@dshfiles/jujutsu` host | bare `jj`, memoized per process | `host.ts:52,73-84,109-120` |
| `@dshfiles/jj-integration` executor | bare `jj`, per call | `host.ts:44-45` |
| `@dshfiles/project-checks` revision probe | bare `jj` | `host.ts:218,173-176` |
| core `workspace-restore-controller` | bare `jj`, per call | `tooling/dsh-core/api-session-controller/src/workspace-restore-controller.ts:921-934` |
| `scripts/jj-workspaces.mjs` | `execFileSync("jj")` | `:13-14` |
| `scripts/jj-workspace-sweep.mjs` jj calls | `execFileSync`/`spawnSync("jj")` | `:32-33,115,124` |
| `scripts/check-diff.mjs` | `execFileSync("jj")` | `:20` |
| `scripts/check-plugins-cached.mjs` | `execFileSync("jj")` | `:14-15,20,58` |
| `tooling/dshx` e2e reporter and jujutsu steps | `execFileSync('jj')`; whole env replaced but `PATH` re-passed | `evidence-reporter.ts:57`; `jujutsu.steps.ts:26-34` |
| `@dshfiles/jujutsu` composer context | never spawns jj itself | no `child_process` in the package |
| `@dshfiles/activity-timeline` | never invokes jj | consumes `dshfiles/activity/event` only |

## Bypasses — treat these as unfenced writers

| bypass | mechanism | evidence |
| --- | --- | --- |
| **VisualJJ `jj branching server`** | long-running VS Code extension spawns its **own bundled** jj by absolute path; in-process, so no `PATH` lookup happens | `…/extensions/visualjj.visualjj-0.35.1-darwin-arm64/dist/extension-BGPcNv-Z.js`; **two live pids observed during this investigation** (`ps`/`lsof`) |
| **VisualJJ terminal PATH injection** | `addJJToTerminalPath` (default true) prepends the extension's `dist/bin` to every VS Code terminal via `environmentVariableCollection.prepend("PATH", …)` with `applyAtProcessCreation`, so it **outranks a shim prepended in a shell rc** | `…/visualjj.../package.json:81` |
| **`jjw`** | the Nix wrapper hard-prepends the real jujutsu store bin before exec | `/nix/store/…-jjw-0.1.0/bin/jjw:2-7,20` |
| **`jj-view.binaryPath`** | absolute `/Users/astahmer/.nix-profile/bin/jj` in VS Code settings; never consults `PATH` | `~/Library/Application Support/Code/User/settings.json:378` |
| other VS Code jj extensions | `jj-plus`, `jj-range-diff`, `jjk`, `somanyconflicts-jj` are long-running hosts; not individually audited | `~/.vscode/extensions/` |
| pre-existing DSH instances | `--profile web --port 3311` and `--profile probe --port 3299` run with `PATH=fnm/v22.23.3/bin:pnpm/bin:/usr/bin:/bin` and predate any install | `ps eww` |
| per-process `PATH` snapshot | every already-running process keeps its spawn-time `PATH`; installing the shim does not reach backwards | — |
| `@dshfiles/jujutsu` memoized resolution | `fixedJjExecutable` is resolved once per host process, so an install that happens after `dsh web` boots is invisible to that host until it restarts | `jujutsu/src/host.ts:52,73-84` |
| absolute-path invocation | `/Users/astahmer/.nix-profile/bin/jj …`, `$(command -v jj)`, `nix run nixpkgs#jujutsu`, `comma jj` | — |
| `JJ_TEST_EXECUTABLE` | if ever set to an absolute path it pins the four jujutsu integration tests away from the shim; unset today | `jujutsu.steps.ts:26-34` |
| shell command hash | not realistic here — a fresh `bash -c` per call, non-interactive, no rc sourcing | `dsh-bash-local/lib/index.js:140-145` |

## What this means for the rollout

1. The guard must be installed into the **DSH process environment**, not a shell
   rc, and the `jujutsu` host caches its resolution — so the live `dsh web`
   instance needs a restart before it can be covered. That restart is the user's
   call and is explicitly out of scope here.
2. `pnpm run jj:sweep --prove-clean` snapshots candidates through **jjw**, which
   bypasses the shim. The sweep's own `--prove-clean` gate is therefore the only
   thing standing between it and an unguarded snapshot.
3. VisualJJ is a real concurrent writer to any store a VS Code window points at.
   Close VS Code jj views during a maintenance window, and re-run
   `jj-isolation preflight` immediately before migrating: it lists every running
   jj process and refuses to arm while a *mutating* one is in flight.
4. The migrator does not depend on the shim: it re-derives its own preconditions
   (fence, foreign working copies, graft, dirt) and verifies the directory digest
   afterwards. The shim is defence in depth for everything else.
5. Never describe coverage as global. The honest phrasing is: *the guard fences
   every jj invocation that resolves through the DSH process `PATH`, once the shim
   is installed there and the host has restarted; jjw and VisualJJ are outside
   it.*
