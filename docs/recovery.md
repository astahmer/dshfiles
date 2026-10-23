# Recovering a broken DSH

When `dsh web` stops working — a blank page, the "Failed to load plugins" card,
every turn failing — do this first, then debug from inside a working DSH.

## 1. Start the last known good DSH (about 20 seconds)

```sh
dsh-lkg
```

Open <http://127.0.0.1:3099> (the tokenized URL is printed). This is a frozen,
complete copy of a DSH that last passed every health check: core, every
`@dshfiles` plugin, the web profile. It starts from a fresh APFS clone of your
live `~/.dsh`, so your AI accounts, credentials, plugin storage and threads are
all there. Codex, OpenCode, Claude and Command Code accounts work as usual.

It never runs code from this repository, the pnpm global install or `~/.dsh`,
and never writes to `~/.dsh`. Work done in it stays in
`~/.dsh-lkg/state/recover` (the previous one is kept once as
`recover.prev`); it does not flow back to the live install.

| Variable              | Effect                           |
| --------------------- | -------------------------------- |
| `DSH_LKG_CLEAN=1`     | start without your live data     |
| `DSH_LKG_PORT=<port>` | listen elsewhere than 3099       |
| `DSH_LKG_LIVE_HOME`   | clone data from another DSH home |

If `dsh-lkg` is not defined (a shell without the Nix setup), run
`~/.dsh-lkg/bin/dsh-recover` directly.

## 2. Find out what broke

Most breakages come from one of four places that a `jj` revision does not
cover, which is why checking out an older revision usually changes nothing:

| Layer               | Where                                                            | Rewound by jj?       |
| ------------------- | ---------------------------------------------------------------- | -------------------- |
| DSH core            | the pnpm global install of `@deepseek-ai/dsh`                    | no                   |
| Live web profile    | `~/.dsh/profiles/web/cordis.patch.yml`, `package.json`           | no                   |
| Built plugin output | `plugins/@dshfiles/*/dist`                                       | only after a rebuild |
| Node                | `fnm` Node 22.23.3 (nixpkgs Node cannot load DSH's native addon) | no                   |

Checks, in order:

```sh
dsh --version                                   # core version actually running
ls -t ~/.dsh/logs/startup-*.log | head -1       # last startup diagnostics
node scripts/dsh-lkg/cli.mjs list               # known-good snapshots
```

- **"N entries did not activate … waiting for service X"**: a service was renamed
  or removed by a core upgrade. Compare the row in the live
  `~/.dsh/profiles/web/cordis.patch.yml` with this repository's
  [`profiles/web/cordis.patch.yml`](../profiles/web/cordis.patch.yml) and with the
  shipped `@deepseek-ai/dsh-web-app` patch. Profile sync only rewrites its
  managed region, so a row fixed in the repository can stay stale in the live
  profile.
- **Every turn fails with `unknown prompt variable`**: same cause, in the
  `preset-standard` row.
- **A plugin `failed to import`**: rebuild it (`pnpm --filter <pkg> build`).
- **The UI says `active Service "sessionController" is unavailable`, history
  never loads, and every `/api/dshx-*/…` answers 404**: the running Host lost its
  Session surface. `session-controller` waits for `sessionQuery`, and this
  profile disables the stock `session-query-sqlite` row because
  `@dshfiles/session-search` owns that service — so a surface that disappears
  while the Host keeps serving HTTP means that plugin's registration was
  dropped at runtime, which a failed hot reload after a `dist` rebuild does.
  Nothing in the running process re-registers a lost service: restart `dsh web`
  (Ctrl-C in the launcher terminal, then `dsh-web`). The same cascade printed
  at **boot** is a profile problem instead — compare the live
  `session-query-sqlite` and `session-search` rows with this repository's
  `profiles/web/cordis.patch.yml`.
  The launcher now probes that surface once the Host is up and restarts it when
  it stays unavailable, and restarts it after an unexpected exit; both are
  capped, and `DSH_WEB_HEALTH_PROBE=off` disables the probe (see
  `modules/dsh.nix` and `assets/dsh/supervise-web.mjs` in nixfiles).
- **`node-addon-require-builtin unsupported`**: the command ran on nixpkgs Node;
  use `dsh` through the shell function, or `fnm exec --using=v22.23.3 -- …`.
- **`No usable native binding found for node-addon-require-builtin-darwin-arm64`**:
  the global install was laid out in pnpm's global virtual store
  (`node_modules/@deepseek-ai/dsh` resolves into `store/v11/links`), where the
  addon's loader cannot see its platform package. A `pnpm patch`, `pnpm install`
  or `pnpm add -g` run with `enableGlobalVirtualStore` on does that. Rerun
  `pnpm install --frozen-lockfile --force --config.enableGlobalVirtualStore=false`
  in the global install root, the directory above `node_modules/.pnpm` in the
  `dsh` shim's `cmd-shim-target`.

## 3. Fix, then let the snapshot follow

Fix the live install, restart `dsh web`, and keep it up for ten minutes: the
supervisor then refreshes the snapshot (`snapshot --if-changed`), and only
promotes it if the Host, a session round trip and a real browser load all pass.
To refresh by hand:

```sh
DSH_LKG_ADMIN=1 node scripts/dsh-lkg/cli.mjs snapshot --label "<what changed>"
```

A refused candidate leaves the previous snapshot current and writes its Host
output to `~/.dsh-lkg/logs/health-<id>.log`; set `DSH_LKG_KEEP_FAILED=1` to keep
the candidate itself for inspection.

## 4. A running Host can lose its Session surface

This wedge is a *recomposition* casualty, not a bad build: a fresh boot of the
same checkout and profile activates every entry (verified 2026-10-19 at 01:57
and 11:24), while a running Host that hot-replaces its link-installed bundles
does not. Confirm it after the fact by correlating four timestamps:

| Evidence                                            | 2026-10-19 |
| --------------------------------------------------- | ---------- |
| Host `startedAt` (`dshx status --json`)              | 10:49:05   |
| `plugins/@dshfiles/*/dist/index.js` mtime            | 11:12      |
| `~/.dsh/profiles/web/cordis.patch.yml` mtime         | 11:13      |
| `dshx status` reporting `gateway/service-unavailable` | 11:14      |

Two inputs trigger it: DSH's `hmr` row watches the profile manifest and the user
patch files, and a recomposition also replaces the plugins whose link-installed
files changed on disk. A landing thread that rebases while the Host runs (checkout
sync → rebuild) primes it, and the profile sync that then rewrites
`cordis.patch.yml` fires it.

Host HMR is therefore **off by default**: `- id: hmr` / `disabled: true` in this
repository's `profiles/web/cordis.patch.yml` (inside the NIX-MANAGED region, so
profile sync carries it to every live profile) and, until that seed row reaches
the live file, as a local row in `~/.dsh/profiles/web/cordis.patch.yml`. Client
HMR (`@deepseek-ai/dsh-client-hmr`) is a separate bundle and stays on. The
accepted costs:

- enabling or disabling a plugin in Settings now needs a restart;
- a rebuild reaches the browser but not the running Host, so a new client bundle
  can ask the old Host for a method it does not have until the next restart.

Revisit when a Host replacement is proven safe (the suspect is
`@dshfiles/session-search` registering `sessionQuery` through a nested async
`ctx.plugin` inside a `ctx.effect`, where the stock provider registers at row
level); see [dsh-host-gaps](../plans/dsh-host-gaps.md). Until then the launcher
probes the Session surface and restarts the Host when it stays unavailable.

## Upgrading DSH

Never upgrade the global install in place. Go through the gate, which installs
the new core beside the live one, boots it with the live profile, plugins and a
clone of your data, runs one real turn, and only then switches the live
install and snapshots it:

```sh
DSH_LKG_ADMIN=1 node scripts/dsh-lkg/cli.mjs upgrade <version>
```

When it refuses, the live install is unchanged; port the plugins or the
profile to the new release first (see [native plugin
overrides](native-plugin-overrides.md)), then run it again.

Details of the snapshot store, checks and immutability are in
[`scripts/dsh-lkg/README.md`](../scripts/dsh-lkg/README.md).
