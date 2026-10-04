# Installing into a DSH profile

Profiles live in `~/.dsh/profiles/<name>/`. Edit `cordis.patch.yml` for config,
never `cordis.yml`. `pnpm profile:sync --profile <name>` links every owned
bundle into a profile the supported way (below), so reach for it before editing
a profile manifest by hand.

```sh
dsh --profile web --dump-config          # full composed tree
dsh --profile web --dump-config-schema   # JSON Schema for entries and patches
```

The `web` profile manifest and patch are also declared in nixfiles
(`modules/dsh.nix`, `assets/dsh/web-profile/`). Those assets currently describe
an older plugin set, so `nixapply` would replace the live `web` manifest; keep
them in step when `web` changes.

## `pnpm add <path>` is blocked; `pnpm install` is not

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
  (`0.0.1-rc.x`) from what DSH 0.2.0-rc.2 ships internally. Installing them to
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
