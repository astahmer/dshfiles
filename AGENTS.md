# dshfiles

Personal DeepSeek Harness (DSH) setup: marketplace plugins we adopt, and
plugins we own.

## What this repo is for

Two kinds of work live here, and the distinction matters:

- **Adopting** a plugin that already exists on [dshmarket.com](https://dshmarket.com)
  (4412 plugins, 23 categories). Preferred whenever something already covers the
  need — a maintained community plugin beats a thin one we maintain.
- **Owning** a plugin that does not exist anywhere. Justified when a capability
  is genuinely unclaimed, not merely inconvenient to find.

Reference material we have ported from lives in `../bb-plugins`. It is a
**source of ideas and working code, not a spec** — DSH has different APIs,
different boundaries, and a different plugin model. Do not assume that project's
architecture carries over, and do not carry its product names into ours: our
plugins are named for what they do here. Read its `README.md` for the
*behavior* worth keeping, then reimplement against the DSH API.

### When no plugin covers the need

Adopting is the default, not a mandate. When the survey finds nothing that
covers what we actually want, do not stall, and do not settle for a plugin
that covers part of it. Pick one of these three and say which:

1. **Adopt anyway** — good enough, or the gap is cosmetic.
2. **Fork or port** — an existing project already does the hard part. Preserve
   its license and source provenance, then vendor the code inside this repo.
   Keep an upstream remote only when ongoing sync is an explicit goal. A hard
   fork has no remote dependency, remote bookmark, fetch, or rebase workflow.
3. **Build it with dshx** — from scratch, when a fork would carry more debt
   than the feature is worth.

Two rules make the choice cheap to revisit:

- **Verify against the installed runtime, not the README.** A plugin's claims
  are not evidence. Read its peer ranges against our DSH version, resolve the
  imports it actually uses, and read the Service contract it calls. Peer ranges
  are usually honest: a plugin capped below our version is a real signal.
- **Check whether the Host can do it at all before building UI for it.** Read
  the Service and Event contracts first. If the seam has no such method — no
  `reorder`, no `remove` — a plugin cannot add one, and the honest answer is a
  Host change, not a clever client-side fake. Say so instead of shipping
  something that mutates durable state to work around it.

Report which option you chose and why. A fork nobody asked for is a liability;
a workaround nobody flagged is worse.

Do not stop at "dshx cannot express this". When the same wall shows up in one
plugin, it is a missing abstraction rather than a one-off, so fix it in the
toolchain first and let the plugin become ordinary: a change that removes a type
cast, a hand-restated interface, or a workaround from every future plugin belongs
in dshx. Reach for that before writing the second workaround. Keep it narrow — an
abstraction that serves one caller is not one — and say which plugin forced it, so
the next reader knows it was earned.

A workaround is also a bug report about the toolchain. Two we shipped here were
caused by dshx gaps and were invisible until the second one hurt: a declaration a
UI plugin had to restate, and a `@deepseek-ai/*` dependency that resolves a second
copy and fails only at boot. Both are now dshx's to refuse. When you catch
yourself reaching for `as unknown as`, a local `declare module`, or a duplicated
interface, ask which layer should own it before shipping the escape hatch.

## Never delete source while a build is serving

A plugin's `dist/` keeps working after its sources are gone, so deleting a file
under a running build looks like a no-op until the next rebuild — which is how a
whole plugin can be missing for hours while the served bundle still answers.

Before removing a source file: confirm it is tracked, and confirm nothing serves
it. When recovering, `jj file show -r <change> <path>` restores a file from any
revision, which is faster and safer than rewriting it. Verify the build afterwards
by importing the built entry, not by looking at it.

## Git

This is a [Jujutsu](https://jj-vcs.github.io) repo, colocated with git.

- `jj status` before starting; `jj diff` to review; `jj describe` then `jj new`
  for a change. Never `git`-only commands, never `jj git push` without asking.
- The working copy is always a commit — there is no separate staging area.
- Shared checkout: if another agent's files are in `jj status`, they are not
  yours. Commit only your own paths.

## Environment

Node comes from **fnm**, pinned by `.node-version`, not from Nix.

```sh
nix develop      # or: direnv allow
node -v          # must print the .node-version value
dsh web
```

**`dsh` must run on the official Node build.** Nix's `nodejs` package fails at
boot with `node-addon-require-builtin unsupported: Unsupported/no-getter`
because DSH's native loader probe cannot find its internal getter on the Nix
build. `mkShell` puts `~/.nix-profile/bin` ahead of fnm's directory in `PATH`,
so the `shellHook` strips that entry and re-prepends `FNM_DIR/bin`. If `node -v`
prints a Nix version, the shell is misconfigured — stop and fix it before
debugging anything else.

## Installing plugins

```sh
dsh plugin --profile web add <package>
dsh plugin --profile web remove <package>
dsh plugin --profile web exec <package> <command>
```

Profiles live in `~/.dsh/profiles/<name>/`. Edit `cordis.patch.yml` for config,
never `cordis.yml`. Inspect what a profile composes to:

```sh
dsh --profile web --dump-config          # full composed tree
dsh --profile web --dump-config-schema   # JSON Schema for entries and patches
```

### Peer dependencies are a real trap

`~/.dsh/profiles/web/pnpm-workspace.yaml` sets `autoInstallPeers: false`, and
that is correct. Plugins get their `@deepseek-ai/*` packages from the profile's
own bundle tree at runtime, not from `node_modules`.

Two failure modes to recognize:

- **Turning `autoInstallPeers` on is worse than the bug you are fixing.** It
  tries to resolve `@deepseek-ai/dsh-type-meta`, which is not on npm at all
  (404).
- **The public `@deepseek-ai/*` npm line is a different, older generation**
  (`0.0.1-rc.x`) from what DSH 0.2.0-rc.2 ships internally. Installing them to
  satisfy a peer will make the plugin manager reject them as version-incompatible
  — correctly, because they genuinely are not the same code.

A plugin whose `package.json` has `peerDependencies` on `@deepseek-ai/*` but an
empty or missing `dependencies` block **cannot work** in this profile. Verified
example: `dsh-codex-switch@0.1.0-alpha.8` (all 8 published versions are alpha)
installs without error, then logs `llm-openai-codex: failed to import` at every
boot. Check for this shape before investing in a plugin.

### Local paths work; the rules are narrower than the errors suggest

`pnpm add <path>` is fine. Both confusing errors come from the same place — pnpm
resolving the *directory name* as a package name:

- `Package name <path> is invalid, it should have a @scope` — the directory is
  not named `@scope/name`. This is about the folder, not the `name` field alone.
- `dependency with an invalid name: "<parent dir>/"` — an ancestor directory
  contains an `@`, so pnpm splits the path at the wrong segment.

Install a local bundle from a directory whose own path is already the scoped
package name: `plugins/@dshfiles/ai-accounts`. Do not fight this by renaming
`package.json` alone.

### pnpm majors must not be mixed

The profile's `node_modules` records the store it was built with
(`~/.dsh/profiles/web/node_modules/.modules.yaml`). If the pnpm the Host resolves
disagrees, every install fails with `ERR_PNPM_UNEXPECTED_STORE` — which reads
like a permissions problem and is not one.

Corepack picks the pnpm version from the nearest `packageManager` field, then
`~/.cache/node/corepack/lastKnownGood.json`. Our profile was built by **pnpm 12**
(store `v11`); the fnm corepack shim resolves **10.34.5** (store `v10`) by
default. `lastKnownGood` is the supported fix and needs no PATH surgery:

```sh
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path.home() / ".cache/node/corepack/lastKnownGood.json"
d = json.loads(p.read_text()); d["pnpm"] = "12.0.0"
p.write_text(json.dumps(d, indent=2) + "\n")
EOF
```

Check what the Host will resolve before changing anything:

```sh
head -3 ~/.dsh/profiles/web/node_modules/.modules.yaml   # storeDir + packageManager
which -a pnpm                                            # what the Host finds first
```

### `pnpm add <path>` is blocked; `pnpm install` is not

This pnpm resolves a local path spec through *registry name resolution*, so
`pnpm add /abs/path` fails with `should have a @scope` or
`ERR_PNPM_INVALID_DEPENDENCY_NAME` for essentially every layout, including a
directory named exactly `@scope/name`. `trustPolicy` (values `off`,
`no-downgrade`) does not change it.

Declaring the dependency and running `pnpm install` works, which is what a
profile already wants:

```jsonc
// ~/.dsh/profiles/<name>/package.json
"dependencies": { "@dshfiles/ai-accounts": "link:/abs/path/@dshfiles/ai-accounts" },
"dsh": { "profile": { "bundles": [ /* … */, "@dshfiles/ai-accounts" ] } }
```

```sh
cd ~/.dsh/profiles/<name> && pnpm install
```

`plugin_manager install_bundle` shells out to `pnpm add`, so it cannot express
this. Use `install_bundle` for registry packages, and the manifest plus
`pnpm install` for a local bundle. Two things make that safe: keep the
directory's own path equal to its scoped package name, and confirm with
`plugin_manager list_bundles` that the bundle reports `installed: true` and its
row is present.

## Writing our own plugins

New plugins use **[dshx](https://dshx.io/en)**
([liyown/dshx](https://github.com/liyown/dshx)) — TypeScript, React, Vite.

```sh
pnpm create dshx my-plugin
cd my-plugin
pnpm dev          # client HMR + host auto-restart
dshx inspect slots --root sidebar    # read the live composition
```

dshx is **v0.1.4-preview**, and its typed surface is a strong default, not a
guarantee. Its most reliable value is `dshx inspect` — read the real runtime
instead of guessing whether a slot or service exists.

### We maintain a local dshx hard fork

The complete source lives at `tooling/dshx`, inside this repository's single
Jujutsu/Git boundary. It is a maintained hard fork for DSH 0.2 compatibility;
the original package peer range did not claim DSH 0.2, and reimplementing its
build and inspection tools would duplicate useful work.

The fork is owned here as `@dshfiles/dshx`. It must not fetch or install
`@becomeopc/dshx` from a registry, and it has **no upstream remote at all**.
Upstream went quiet for about a month and did not support the DSH generation
this profile runs, so waiting on it cost more than owning the divergence. Do not
add an upstream remote or bookmark, fetch, or merge. `tooling/dshx/FORK.md`
records the source baseline, license, and attribution. Do not add a nested
`.jj`/`.git`; review DSH changes manually when the native contracts move.

Plugins link the local path, so the CLI a plugin builds with is always this tree.

```sh
cd tooling/dshx
pnpm install --frozen-lockfile
pnpm --filter @dshfiles/dshx build
```

The fork's own documentation is the source of truth for what it does:
`tooling/dshx/docs/sdk/getting-started.md` for the authoring API,
`tooling/dshx/docs/compatibility.md` for what a DSH generation changed, and
`tooling/dshx/FORK.md` for provenance. There is no separate plan for it here —
a plan that outgrows the code it describes is a second source of truth, and it
goes stale silently.

What `PROTOCOL_2_COMPATIBILITY` changed, in case upstream moves again:

- `dsh-client-runtime` no longer exists; its types moved to
  `dsh-client-ui-conversation/client`, and `ChatConversationViewNode`,
  `ChatNodeOwnerProps`, and `UseChatNodeTurnData` moved to
  `dsh-client-ui-chat/client`.
- Settings inverted. 0.1 had a plugin register a namespace object
  (`SettingsScope` / `SettingsProvider` / `.register()`); 0.2 identifies a
  namespace by its Loader entry id and reads it through `ctx.settings.describe()`
  and `update()`. The Host binds a scope façade and the Client binds through
  `ConfigForms`.
- `SettingsScopeBinder` is gone with no replacement; `ConfigForms.get(entryId)`
  plus `ConfigForms.describe()` is the protocol-2 equivalent.
- 0.2 removed the config field earlier generations put on the context, so a
  plugin reads its own row settings from `apply(ctx, config)`. dshx generated that
  call and dropped the argument; our fork forwards it to `setup(ctx, config)` and
  unwraps schemastery's resolvers first.
- The public `dshx/host` entry never re-exported cordis's `Events`
  augmentation, so importing `defineHost` from it made `ctx.on` degrade to
  `keyof Events` and reject every DSH event name. Our fork re-exports it.

Two cordis copies are the failure mode that makes this look like a dshx bug. A
`declare module` augmentation lands on the `Events` of the copy that is
resolved, so a plugin and the toolchain typing it must share **one** cordis
identity — including its `cordis-plugin-include` and `cordis-plugin-loader`
versions, which are part of the identity. Verify with:

```sh
node -e "const{createRequire}=require('module');\
const r=createRequire('$PWD/src/x.ts');\
console.log(r.resolve('@deepseek-ai/cordis').split('.pnpm/')[1])"
```

If those disagree, pin the versions and add `dedupePeerDependents: true`.

Owned plugins are plain cordis bundles: a `cordis.patch.yml` that inserts the
package row, `lib/` for the host half, `lib/client.js` for the browser half.
That part is stable regardless of which build tool produced it.

### Creator mode is NOT currently available

`@deepseek-ai/dsh-agent-preset` ships a `skills/` directory that a "creator"
mode mounts through `skill-filesystem`: `agent-experience`,
`cordis-plugin-development` (with `references/` and copyable `templates/`),
`editing-cordis-compositions`, and `cordis-composition-reference`.

**As of DSH 0.2.0-rc.2 on this profile, no preset with `id: creator` is
declared.** The four declared ids are `standard`, `minimal`, `ptc`, and
`cordis`, and `agent-preset-registry`'s `default` is `standard`.

This matters because we intend to create DSH plugins *from inside DSH itself*.
That path depends on `cordis-plugin-development`, which is the single best
piece of DSH documentation for plugin work — it mandates `plugin_manager` with
`action: install_bundle`, forbids hand-editing `package.json` /
`cordis.patch.yml`, and lists concrete verification steps.

Do not assume the skills are reachable. Check first:

```sh
dsh --profile web --dump-config | grep -A4 "name: '@deepseek-ai/dsh-agent-preset'$"
```

If `creator` is missing, read the skill directly from the installed package
instead — the skills are plain files on disk:

```sh
find ~/.local/share/pnpm/global/v11 -path '*dsh-agent-preset/skills' -type d
```

Presets are declared as entries in `@deepseek-ai/dsh-agent-preset`; the active
default comes from `agent-preset-registry`'s `default` config key. Sessions
store the preset identity they were created with, so changing the default does
not move existing sessions — start a new one to pick it up.

## Verifying anything

A plugin that installs is not a plugin that works.

- **Read the boot output.** `dsh web` prints one line per entry that failed to
  activate, plus the tokenized URL. That line is the whole signal — check it
  every time.
- `dsh web` binds `127.0.0.1:3080` and answers **401** to a bare `curl`. The
  usable URL is the tokenized one it prints at startup. Never conclude a plugin
  is broken from a 401 alone.
- Startup failures that are fatal write a diagnostic under
  `~/.dsh/logs/startup-*.log`. Non-fatal "did not activate" warnings do **not**
  — they only appear on stdout. Capture stdout.
- Only `http://127.0.0.1:3080` may be started once per profile. A stale process
  holding the port produces `EADDRINUSE` and masks the real error; check
  `lsof -nP -iTCP:3080 -sTCP:LISTEN` before debugging a boot failure.
- Prefer `dsh --profile web --dump-config` over reading installed plugin source
  to learn what a profile actually loads.

### Rebuilt plugins reach the browser over HMR

`dsh web` does **not** need a restart to pick up a rebuilt plugin.
`@deepseek-ai/dsh-client-hmr` is in the default web profile; it polls each
bundle's `mtime`/`ctime`/`size` every 500ms and pushes an SSE `graph` frame on
`/plugins/events`, which the client applies without a reload. Verified on a live
instance: rebuilding `dist/client.js` produced a fresh graph frame within one
poll interval.

What a page refresh alone does **not** do is re-read the boot manifest. The
bundle `rev` is a content hash computed when the server started, so a running
server keeps serving the manifest it booted with. Confirmed by editing a served
bundle twice on one server and reading the same `rev` back both times.

So the workflow is: rebuild, let the client receive the graph frame, and only
restart when the change is to `cordis.patch.yml`, `package.json`, or the profile
composition — anything the server resolves at boot rather than per request.

### Client boot failures are cross-plugin

A `Failed to load plugins` card lists symptoms, not causes. The entry named first
is frequently not the broken one: a plugin that throws during `apply` is the
cause, and the entries listed as `pending (waiting for service: X)` are innocent
dependents of the service it failed to publish. Fixing the failed entry is the
only thing that clears the pending ones.

`dshx check` and `tsc` both pass on a plugin with a colliding locale namespace
or a missing runtime service, because both are defects only visible across the
installed set. See `plans/plugin-boot-integrity.md`.
