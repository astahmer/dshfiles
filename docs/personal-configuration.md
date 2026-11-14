# Personal configuration stays local

The shared web seed selects plugins and generic behavior, not a person's accounts,
model preferences, vault aliases, profile name, installed runtime or machine paths.
The account seed is empty and supplies no default provider/model. Configure accounts
and select a model explicitly in the app. Existing writable account files and local
Cordis settings are not replaced by the seed.

Keep credentials in provider-owned auth storage or a local vault. Configure credential
references in the writable settings, not the repository. Brave Search starts unbound;
its existing `BRAVE_API_KEY` fallback and explicitly stored references still work.

The tracked `.secret.json` is an empty map, not a user's vault configuration.
Store personal alias definitions in the Secret CLI's global configuration or
ignored `.secret.local.json`; resolved values stay in the vault. Before updating
an installation that used earlier tracked aliases, preserve only that owner's
needed reference definitions in their local configuration. Do not install another
person's aliases or restore them to shared source. An empty local file does not
mask project definitions, so it is not a substitute for an empty shared default.

## Launcher configuration

[scripts/dsh-launcher](../scripts/dsh-launcher) uses an official Node available on
`PATH` (or `DSHFILES_NODE_BINARY`) to read a machine-local JSON object:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/dshfiles/launcher.json
```

Set `DSHFILES_LAUNCHER_CONFIG` to an absolute filename to select another file. A missing
default file is allowed; a missing explicitly selected file, unreadable file, malformed
JSON, unknown key or invalid value fails closed. No config is created or rewritten.
Use a private parent directory and mode `0600` for the file. Do not put credentials in it.

Precedence for every key is **explicit environment > local JSON > generic default**.
An empty override is invalid, not a request to fall back. All filesystem keys must be
absolute paths; shell expansion (`~`, `$HOME`) is not performed in JSON.

One exception: inside a DSH shell (`DSH_SESSION_ID` or `DSH_SHELL` set), `DSH_HOME`
names the Host that runs the shell, not a choice for this launch. When it differs from
the JSON `dshHome`, the launcher refuses and names both homes instead of preparing the
inherited one. Run it from a plain terminal, or unset `DSH_HOME`.

| JSON key               | Environment override              | Default / validation                                                                  |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `sourceRoot`           | `DSHFILES_DIR`                    | Checkout containing the helper; absolute directory                                    |
| `dshHome`              | `DSH_HOME`                        | `$HOME/.dsh`; absolute directory                                                      |
| `nodeBinary`           | `DSHFILES_NODE_BINARY`            | Current Node executable; absolute filename                                            |
| `coreEntry`            | `DSH_CORE_ENTRY`                  | The core this checkout's lockfile installed; another core is kept and validated       |
| `profile`              | `DSHFILES_PROFILE`                | `web`; starts with a letter/digit, then letters/digits/underscore/hyphen              |
| `legacyPort`           | `DSHFILES_LEGACY_PORT`            | Absent; integer `0..65535`, only for explicit migration of an old wrapper's port      |
| `homeVerificationFile` | `DSHFILES_HOME_VERIFICATION_FILE` | Absent; optional existing absolute marker filename                                    |
| `browserExecutable`    | `DSHX_CHROMIUM_EXECUTABLE`        | Absent; candidate verifier uses bundled Playwright browser unless explicitly selected |
| `path`                 | `DSHFILES_PATH`                   | Inherited `PATH`; optional nonempty search path                                       |
| `nodePath`             | `DSHFILES_NODE_PATH`              | Inherited `NODE_PATH`; optional nonempty module search path                           |

Every string must be nonempty and contain no NUL/newline. There is no arbitrary
command/shell/environment-map setting. `HOME`, XDG directories and `GH_CONFIG_DIR`
are inherited, never reset to another person or machine. The shell bootstrap must
already find Node; a JSON `nodeBinary` choice takes effect after that bootstrap.

With arguments, the launcher passes them unchanged to the configured core (including
native explicit `--profile` options). Without arguments, it prints the home, profile and
source it will prepare, refuses when a Host already serves that home and profile, obtains
a nonblocking per-DSH-home lock, then runs the configured source supervisor. A Host is any
of the user's processes running a dsh core (the configured entry, a `dsh` bin shim or
`dsh/lib/bin.js`) for the profile (`dsh web`, `--profile web`), whose environment's
`DSH_HOME` (or `HOME/.dsh`) is that home, however it was started. A Host whose home
cannot be read counts as running. The preparation helper repeats this check before any
profile write. It never stops an existing Host. The supervisor retains confirmed-request
restart semantics; preparation failure prevents a new Host from starting.

The source preparation helper retains its historical filename for callers, but uses
`dshHome/profiles/profile` from this config. It relinks only already-selected source
bundles, preserves custom manifest fields and account files, and does not add a
personal plugin selection. It validates built bundles, checks quiescence, backs up
changed files under `dshHome/backups/source-link`, and refuses concurrent edits.
Network startup wiring retains explicit profile choices; only an explicit `legacyPort`
requests the compatibility fallback. Saved Network access preferences and native CLI
flags retain precedence. Private candidate-verification evidence goes under
`dshHome/verification`; candidate execution uses an isolated scratch home.

## Startup preflight

A build that passes is not a start that works. Before every Host start, after building
and relinking, the supervisor runs [scripts/dsh-preflight.mjs](../scripts/dsh-preflight.mjs)
`--apply` against the core that will run ([details](../scripts/dsh-compat/preflight.mjs)):

- **core**: which `@deepseek-ai/dsh` the entry belongs to. Leave `coreEntry` unset to run
  the core this checkout installs, so plugins and core move together on `git pull`. A
  configured other core (including a wrapper's `DSH_CORE_ENTRY`, which overrides the JSON)
  is kept and named in the report with how to switch.
- **node**: the Host's Node satisfies that core's `engines.node`.
- **presets**: saved agent presets name modules that resolve and suit that core. Recorded
  breaking changes (0.2.1 → 0.2.2: `list-agents`, `modelSelectionSettings`, tool-presentation
  mode) are migrated, the file first copied to `<file>.before-presets-…`, only while no Host
  serves the profile. Anything else stops the start with the preset, file, row and fix.
- **composition**: `dsh --profile <p> --dump-config` on that core. A failure, a skipped
  bundle or a disabled row stops the start; DSH itself would only print a line and start
  without that bundle's services.

Run it by hand, writing nothing, with `node scripts/dsh-preflight.mjs`. Before it, the
source preparer applies recorded renames and removals of owned plugins
([list](../scripts/dsh-compat/owned-plugins.mjs)) to the profile selection, with a backup;
a selected plugin whose sources are gone for no recorded reason stops the start. A removed
plugin's leftover `dist/` no longer counts as built.

## Moving an existing installation

Before changing a canonical checkout or wrapper, copy the old wrapper's runtime entry,
Node executable, source root, profile, optional home-verification marker, `PATH` and
`NODE_PATH` into the local JSON file. If it forced a port, record that migration choice
as `legacyPort`. Keep the existing writable DSH home; do not copy another person's
accounts, patches or aliases from a seed. Review inherited `HOME`/XDG values in the
external wrapper as well. No repository script performs this external migration.

A fresh installation should seed its writable web profile with the existing profile
reconciler, then configure accounts and explicitly select a model. The source-launch
preparer expects an existing profile; it does not silently create one or import auth.

## Focused verification

```sh
node --experimental-strip-types --test scripts/running-hosts.test.mjs scripts/launcher-config.test.mjs scripts/launch-dsh.test.mjs scripts/prepare-manuel-source.test.mjs scripts/personal-configuration.test.mjs scripts/supervise-dsh.test.mjs scripts/network-startup-patch.test.mjs scripts/dsh-compat/*.test.mjs
pnpm test:preset-upgrade   # two real cores, a fake model and a browser; about 15 s once both cores are cached
node --check scripts/verify-manuel-candidate.mjs
bash -n scripts/dsh-launcher
```

These use temporary real files and fake child programs; they do not launch DSH, contact
a provider, read credential values or modify a live profile. Live/scratch browser boot
is a separate, explicit verification step, not implied by these checks.
