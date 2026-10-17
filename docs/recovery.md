# Recovering a broken DSH

When `dsh web` stops working — a blank page, the "Failed to load plugins" card,
every turn failing — do this first, then debug from inside a working DSH.

## 1. Start the last known good DSH (about 20 seconds)

```sh
dsh lkg
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

If `dsh lkg` is not defined (a shell without the Nix setup), run
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
- **`node-addon-require-builtin unsupported`**: the command ran on nixpkgs Node;
  use `dsh` through the shell function, or `fnm exec --using=v22.23.3 -- …`.

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
