# Installing into a DSH profile

Profiles live in `~/.dsh/profiles/<name>/`. Edit `cordis.patch.yml` for config,
never `cordis.yml`. `pnpm profile:sync --profile <name>` links owned bundles
into a profile the supported way (below), so reach for it before editing a
profile manifest by hand. A profile with a seed in this repository
(`profiles/<name>/package.json`) is reconciled from that seed (below); any
other profile gets every owned bundle. `--bundle <name>` adds or refreshes one bundle and
leaves the rest alone.

```sh
dsh --profile web --dump-config          # full composed tree
dsh --profile web --dump-config-schema   # JSON Schema for entries and patches
```

## The web profile reconciles itself

The `web` profile seed lives in this repo: `profiles/web/package.json` and
`profiles/web/cordis.patch.yml`. `scripts/profile-sync.ts` is the one
reconciler for it, and three callers run it:

- the nixfiles `dsh web` supervisor, before every start and every restart
  (the thread sidebar's Restart included), from `$DSHFILES_DIR`;
- `dshx checkout sync` (by hand or after Rebase), when the moved range touched
  `profiles/`; it then reports "restart to apply". It skips when
  `DSHFILES_DIR` names another checkout, so the profile never flips between two;
- the nixfiles Home Manager activation, on `nixapply`.

Promoting or dropping a bundle means editing the seed; the next restart applies
it. No nixfiles change and no `nixapply` is needed. A run:

- copies missing seed files (`package.json`, `cordis.patch.yml`,
  `pnpm-workspace.yaml`, and `ai-accounts.json` to
  `$DSH_HOME/plugins/ai-accounts/accounts.json`); existing files are not replaced;
- applies the seed's dependencies with relative `link:` paths resolved to the
  checkout running it, and its bundle list, keeping the profile's bundle order;
- removes entries a previous run managed and the seed dropped, unless the user
  changed them since, and any `@dshfiles/*` row the seed lacks; every other
  entry (a registry plugin added with `dsh plugin add`) stays;
- restores the region between `# BEGIN NIX-MANAGED DSH PLUGINS` and
  `# END NIX-MANAGED DSH PLUGINS` in `cordis.patch.yml`; the rest stays local;
- runs `pnpm install --prefer-offline` (bounded to 180 s) only when the
  manifest differs from the last one it installed or `node_modules` is missing.
  An unchanged profile costs a few milliseconds.

`pnpm verify:web-profile-contract` (included in `pnpm check:green`) checks that
profile bundles link their source packages, every external and direct owned-plugin
dependency is included in both the profile dependencies and bundle list, and
there are no one-sided bundle registrations. `pnpm test:web-profile-contract`
keeps the missing-provider cases covered.

It writes under DSH's own `package.json.lock` and replaces files atomically. Its
record of managed entries is `.dshfiles-profile-sync.json` in the profile; it
reads the older `.nixfiles-managed-plugins.json` once and removes it. When a
run fails (a seed bundle missing, pnpm failing), the supervisor logs a warning
and starts DSH with the previous profile.

Preview a run against any home with `--dry-run`, and test against a scratch
home and seed with `--home <dir> --seed <dir>`.

### Migrating from the Nix copy

Until nixfiles carried this change, its activation ran its own copy of the
reconciler, so seed changes needed `nixapply`. Run `nixapply` once after
updating nixfiles: it installs the supervisor that syncs before each start,
and `dsh-web` with `DSHFILES_DIR` defaulting to the `dsh.dshfilesCheckout`
option. Restart DSH once afterwards; from then on Restart is enough.

## `pnpm add <path>` is blocked; `pnpm install` is not

This pnpm resolves a local path spec through _registry name resolution_, so
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

The directory's own path must be the scoped package name
(`plugins/@dshfiles/ai-accounts`): pnpm reads the folder name as the package
name, and an ancestor containing `@` makes it split the path at the wrong
segment. Do not fight this by renaming `package.json` alone.

## Peer dependencies are a real trap

`~/.dsh/profiles/web/pnpm-workspace.yaml` sets `autoInstallPeers: false`, and
that is correct. Plugins get their `@deepseek-ai/*` packages from the profile's
own bundle tree at runtime, not from `node_modules`.

Two failure modes to recognize:

- **Turning `autoInstallPeers` on is worse than the bug you are fixing.** It
  tries to resolve `@deepseek-ai/dsh-type-meta`, which is not on npm at all
  (404).
- **The public `@deepseek-ai/*` npm line is a different, older generation**
  (`0.0.1-rc.x`) from what DSH 0.2.1-rc.2 ships internally. Installing them to
  satisfy a peer will make the plugin manager reject them as version-incompatible
  — correctly, because they genuinely are not the same code.

A plugin whose `package.json` has `peerDependencies` on `@deepseek-ai/*` but an
empty or missing `dependencies` block **cannot work** in this profile. Verified
example: `dsh-codex-switch@0.1.0-alpha.8` (all 8 published versions are alpha)
installs without error, then logs `llm-openai-codex: failed to import` at every
boot. Check for this shape before investing in a plugin.

## pnpm majors must not be mixed

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
