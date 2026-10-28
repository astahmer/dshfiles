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

| JSON key               | Environment override              | Default / validation                                                                  |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `sourceRoot`           | `DSHFILES_DIR`                    | Checkout containing the helper; absolute directory                                    |
| `dshHome`              | `DSH_HOME`                        | `$HOME/.dsh`; absolute directory                                                      |
| `nodeBinary`           | `DSHFILES_NODE_BINARY`            | Current Node executable; absolute filename                                            |
| `coreEntry`            | `DSH_CORE_ENTRY`                  | **Required before launching**; installed DSH core entry, absolute filename            |
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
native explicit `--profile` options). Without arguments, it checks for an existing
process, obtains a nonblocking per-DSH-home `flock`, then runs the configured source
supervisor. It never stops an existing Host. The supervisor retains confirmed-request
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
node --experimental-strip-types --test scripts/launcher-config.test.mjs scripts/launch-dsh.test.mjs scripts/prepare-manuel-source.test.mjs scripts/personal-configuration.test.mjs scripts/supervise-dsh.test.mjs scripts/network-startup-patch.test.mjs
node --check scripts/verify-manuel-candidate.mjs
bash -n scripts/dsh-launcher
```

These use temporary real files and fake child programs; they do not launch DSH, contact
a provider, read credential values or modify a live profile. Live/scratch browser boot
is a separate, explicit verification step, not implied by these checks.
