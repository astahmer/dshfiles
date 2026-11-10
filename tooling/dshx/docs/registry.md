# Plugin registry

A registry is a set of static JSON files that says where to find DSH plugins and plugin source. Anything that serves files can host one. It is modelled on the [shadcn registry](https://ui.shadcn.com/docs/registry), with one structural difference: a DSH plugin is a built package listed in a profile, so most items point at a package instead of carrying source.

A registry adds a way to find and pin packages. It is not a second installer: a plugin item ends in the same `dsh plugin add` as any other package, and `npm` keeps working beside it.

```sh
dshx registry add acme https://plugins.acme.dev/registry.json
dshx registry search notes
dshx add acme:notes --profile probe                # a built plugin, into a profile
dshx update acme:notes --profile probe
dshx remove acme:notes --profile probe

dshx add acme:rate-limit-tool --project ./my-plugin  # source, into a plugin project
```

## Item types

| Type | Delivers | Installs into | You own the code | Update |
| ------------ | --------------------------------------- | ------------------------- | No | Replaces the package |
| `dsh:plugin` | A built package: npm version or tarball | A DSH profile | No | Replaces the package |
| `dsh:source` | Files: a tool, a slot, a panel, an API | A dshx plugin project | Yes | Stops at files you edited |

The two types do not mix in one dependency graph, because they install into different places.

"dshx resources" in this format means `dsh:source`: the building blocks `dshx add ui|tool|hook` and the presets generate. Agent skills and profile presets are not item types.

## Addresses

`dshx add`, `update` and `remove` read their operand in this order. Everything that already meant something keeps that meaning.

| Operand                                    | Meaning                                   |
| ------------------------------------------ | ----------------------------------------- |
| `https://x.dev/r/mini.json`                | Registry item                             |
| `./r/mini.json`, `/abs/mini.json`          | Registry item (a path ending in `.json`)  |
| `acme:mini`                                | Registry item, through a configured alias |
| `@scope/name`, `name@1.2.0`                | npm package, unchanged                    |
| `./plugin`, `/abs/plugin`, `link:./plugin` | Plugin directory, unchanged               |

shadcn's `@acme/mini` syntax is not used because `@scope/name` already means an npm package here. `link`, `file`, `npm`, `jsr`, `git`, `github`, `gitlab`, `bitbucket`, `workspace`, `catalog`, `http` and `https` cannot be aliases.

Aliases are per DSH home, in `$DSH_HOME/dshx-registries.json`. Removing one leaves installed items working, because each install records the item's URL.

## Format

`schemaVersion` is `1` in every document. A reader refuses any other value and says to update dshx.

### `registry.json`: the index

```json
{
  "schemaVersion": 1,
  "name": "acme",
  "homepage": "https://plugins.acme.dev",
  "items": [
    {
      "name": "notes",
      "type": "dsh:plugin",
      "version": "1.2.0",
      "title": "Notes",
      "description": "Pin notes to a thread.",
      "engines": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" },
      "url": "r/notes.json"
    }
  ]
}
```

The index exists for discovery. `url` is relative to the index. An install reads the item document, so the index never decides what gets installed.

### Fields every item has

| Field                                                   | Required | Meaning                                                                                                                                |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                         | yes      | `1`.                                                                                                                                   |
| `name`                                                  | yes      | Lowercase letters, digits and dashes. Unique in its registry.                                                                          |
| `type`                                                  | yes      | `dsh:plugin` or `dsh:source`.                                                                                                          |
| `version`                                               | yes      | Exact semver. An item document holds one version: the current one.                                                                     |
| `engines.dsh`                                           | no       | Semver range of DSH versions it runs on. Absent means any.                                                                             |
| `registryDependencies`                                  | no       | Items installed first: a sibling name (`base`, read as `./base.json`) or an absolute URL. Aliases are local, so they are refused here. |
| `title`, `description`, `author`, `license`, `homepage` | no       | Display only.                                                                                                                          |

### `dsh:plugin`

```json
{
  "schemaVersion": 1,
  "name": "notes",
  "type": "dsh:plugin",
  "version": "1.2.0",
  "engines": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" },
  "package": "@acme/notes",
  "source": {
    "type": "tarball",
    "url": "../tarballs/notes-1.2.0.tgz",
    "integrity": "sha512-…"
  }
}
```

`package` is the npm name the package installs under. `source` is one of:

| `source.type` | Fields                        | Install                                                                                           |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `tarball`     | `url`, `integrity` (required) | Downloaded once, verified, kept in the profile, then `dsh plugin add file:<kept copy>`.           |
| `npm`         | `registry` (optional)         | `dsh plugin add <package>@<version>`. pnpm's lockfile pins the content; the item carries no hash. |

`integrity` is a `sha512-<base64>` SRI value, the same form pnpm records. A tarball is an `npm pack` output. Relative `url`s resolve against the item.

### `dsh:source`

```json
{
  "schemaVersion": 1,
  "name": "rate-limit-tool",
  "type": "dsh:source",
  "version": "1.0.0",
  "engines": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" },
  "dependencies": { "bottleneck": "2.19.5" },
  "files": [{ "target": "src/tools/rate-limit.ts", "content": "export const …" }],
  "docs": "Register the tool in src/host.ts."
}
```

| Field          | Required | Meaning                                                                                                                     |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `files`        | yes      | Non-empty. `target` is relative to the project; `content` is the file text, inlined.                                        |
| `dependencies` | no       | Exact npm versions added to the project's `dependencies`. A name the project already has keeps its version, with a warning. |
| `docs`         | no       | Printed after install. An item never edits your entry files, so this is where the wiring goes.                              |

A `target` cannot leave the project, directly or through a symlink, and cannot be `package.json`, `dshx.config.*`, `cordis.patch.yml`, `.dshx-registry.json`, anything under `node_modules/`, or anything under a dot-directory such as `.github/`.

### `dshx.registry.json`: what an author writes

`dshx registry build` reads this file and writes the documents above.

```json
{
  "name": "acme",
  "homepage": "https://plugins.acme.dev",
  "items": [
    { "type": "dsh:plugin", "path": "plugins/notes", "distribution": "tarball", "name": "notes" },
    { "type": "dsh:plugin", "path": "plugins/other", "distribution": "npm", "registryDependencies": ["notes"] },
    {
      "type": "dsh:source",
      "name": "rate-limit-tool",
      "version": "1.0.0",
      "files": [{ "path": "blocks/rate-limit.ts", "target": "src/tools/rate-limit.ts" }],
      "docs": "Register the tool in src/host.ts."
    }
  ]
}
```

`name`, `title`, `author`, `npmRegistry` and `registryDependencies` are optional on a plugin entry. The item name defaults to the package name with its scope kept (`@acme/notes` → `acme-notes`). `version`, `description`, `license`, `homepage` and `engines.dsh` come from the package's `package.json`, so they cannot drift from the package.

```sh
dshx build                                              # in each plugin
dshx registry build --source dshx.registry.json --out public/registry
```

The output is `registry.json`, `r/<item>.json` and `tarballs/<item>-<version>.tgz`. Serve that directory as it is. Older tarballs are left in place.

The build runs the [`dshx publish --dry-run`](./cli-reference.md#dshx-publish---dry-run-check-a-registry-release-without-uploading) checks. For a tarball, `"private": true` is allowed, because nothing goes to npm, and a `workspace:` or `catalog:` dependency is an error, because `npm pack` leaves it unresolved. It also refuses unknown dependencies, cycles, mixed-type graphs and targets an install would refuse.

## Dependencies

There are three kinds, and each has one owner.

| Declared in                      | Means                                  | Resolved by                        |
| -------------------------------- | -------------------------------------- | ---------------------------------- |
| item `registryDependencies`      | Another registry item, installed first | `dshx`                             |
| package `dependencies`           | An npm package the plugin needs        | pnpm, when the package installs    |
| `dsh:source` item `dependencies` | An npm package the copied files need   | You: `pnpm install` after the copy |

A package's `peerDependencies` is not on this list. Profiles run with `autoInstallPeers: false`, so a peer outside `@deepseek-ai/*` is installed by nothing. [Read the trap](../../../docs/profile-installs.md#peer-dependencies-are-a-real-trap) before relying on one.

A Host bundle must be able to resolve every package it imports once it is installed. `dshx create` bundles `effect` and `zod` into the Host entry for that reason. Bundling is also the stronger choice for a registry, because the tarball's hash then covers that code. `DSHX6409` refuses a package that imports something it does not declare.

`remove` never cascades. Dependencies stay installed because something else may use them, and removing an item another item declared gives a warning.

## Compatibility

| Item type    | Who decides                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsh:plugin` | DSH, from the package's own manifest (`engines.dsh` and `peerDependencies`). dshx only warns when `engines.dsh` excludes the running DSH. A rejection and its `dsh plugin allow-version` recovery are DSH's own. |
| `dsh:source` | dshx, because DSH never sees copied source. It refuses when `engines.dsh` excludes the running DSH; `--force` copies anyway.                                                                                     |

So `engines.dsh` on a plugin item is a claim for discovery, and `dshx registry search` shows it. The package's manifest is the fact. `dshx registry build` copies it from there. See [compatibility](./compatibility.md#versions-in-a-plugin).

Prereleases count as inside a range, because DSH itself ships them.

## Lifecycle

`--dry-run` prints the plan without writing, and `--json` prints an envelope. Nothing restarts DSH: a profile change needs **Restart the DSH host process**.

### Built plugins

| Command                       | What happens                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dshx add <item>`             | Installs `registryDependencies` first, then the item. `--option key=value` merges into its row config, as for any package. A second run reports `up to date`.                     |
| `dshx update <item\|package>` | Reads the recorded item URL again and moves to what the registry now publishes. Row config is kept. The registry names the version, so `name@version` and `--latest` are refused. |
| `dshx remove <item\|package>` | Runs `dsh plugin remove`, drops the row override, the record and the kept tarball.                                                                                                |

The record is `.dshx-registry/installed.json` in the profile, because `file:` in `package.json` cannot say where a tarball came from. Installing the same package another way (`dshx add name@version`) ends the record, so `update` never moves it back.

Keeping the tarball in `.dshx-registry/tarballs/` means `pnpm install` still resolves the profile when the registry is offline.

### Source

All three take `--project <dir>`, which defaults to the current directory for `add`.

| Command                              | What happens                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `dshx add <item>`                    | Copies files, adds `dependencies`, prints `docs`. Stops if a target exists and it did not write it; the whole copy rolls back on a failure.  |
| `dshx update <item> --project <dir>` | Replaces files that still hold what it wrote, and deletes files the item dropped. Stops at a file you edited; `--force` replaces it.         |
| `dshx remove <item> --project <dir>` | Deletes files that still hold what it wrote, and any directory that leaves empty. Edited files stay unless `--force`. npm dependencies stay. |

The record is `.dshx-registry.json` in the project. Commit it: it is what tells local edits from registry content.

## Trust

A plugin runs inside the Host with the Host's authority, and copied source runs once you build it. A registry is code you choose to run, so review it as you would any dependency. What the format does guarantee:

| Risk                                  | What stops it                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A tarball changes after review        | `integrity` is required and checked before install. pnpm installs the verified copy; it never downloads a second time.                                  |
| A release changes in place            | The same version with a different hash stops `add` and `update`. `--force` accepts it after you have read why.                                          |
| An item lies about its package        | The tarball's own `package.json` must match `package` and `version` and declare `dsh.bundle`.                                                           |
| A remote document reads local files   | A remote document can reach only remote URLs, and https can never fall back to http. Plain http is allowed on loopback only, for developing a registry. |
| A registry shadows an owned plugin    | Items claiming `@dshfiles/*` are refused.                                                                                                               |
| A source item writes outside its lane | See the `target` rules above.                                                                                                                           |

Not covered: signatures, so `integrity` proves the bytes match the item, not who wrote the item. Serve registries over https and pin the origin you trust. Registries that need authentication are not supported yet.

## DSH's plugin market

DSH has its own plugin market index ("format 1", `@deepseek-ai/dsh-plugin-market-index`), read by the optional market bundle's Discover page. It is one JSON file listing many versions per plugin, with sort keys and icons, and it installs npm or commit-pinned git packages.

This format is deliberately close, and differs where its job differs:

| Concern          | Market index format 1              | This registry                   |
| ---------------- | ---------------------------------- | ------------------------------- |
| Runtime range    | `engines.dsh`                      | `engines.dsh`                   |
| Source kind      | `source.type`: `npm`, `git`        | `source.type`: `npm`, `tarball` |
| Versions         | Every version in the index         | The current version per item    |
| Hosted bytes     | None                               | `tarball` with `integrity`      |
| Source copy      | No                                 | `dsh:source`                    |
| Dependency graph | No                                 | `registryDependencies`          |
| Client           | Web Discover page, `plugin_market` | `dshx`                          |

A package published to npm can be listed in both. Use the market index for browsing in the Web UI, and a registry for tarballs, source copies and dependency graphs.

## Package distribution

npm is not replaced. A registry item with `source.type: npm` is a pointer to a normal release, and `dshx add name@version`, `dshx update` and `dshx publish --dry-run` work as before. Owned bundles still go through `pnpm profile:sync`; see [profile installs](../../../docs/profile-installs.md).

## Not in format 1

- Multiple versions per item, or pinning one. Point at another item URL to hold a version.
- `git` sources. `source.type` is closed, so a future type fails cleanly on older readers.
- Automatic wiring of `dsh:source` into entry files; `docs` says what to do.
- Authenticated registries and signatures.
- Item types for agent skills or profile presets.
