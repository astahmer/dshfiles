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

Reference material for the BB (Command Code) plugins we ported from lives in
`../bb-plugins`. It is a **source of ideas and working code, not a spec** — DSH
has different APIs, different boundaries, and a different plugin model. Do not
assume a BB plugin's architecture carries over. Read its `README.md` for the
*behavior* worth keeping, then reimplement against the DSH API.

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

## Writing our own plugins

New plugins use **[dshx](https://dshx.io/en)**
([liyown/dshx](https://github.com/liyown/dshx)) — TypeScript, React, Vite.

```sh
pnpm create dshx my-plugin
cd my-plugin
pnpm dev          # client HMR + host auto-restart
dshx inspect slots --root sidebar    # read the live composition
```

dshx is **v0.1.4-preview, 14 stars**, and DSH's own docs warn its APIs will
change before stabilization. Treat its typed surface as a strong default, not a
guarantee. Its most reliable value is `dshx inspect` — read the real runtime
instead of guessing whether a slot or service exists.

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