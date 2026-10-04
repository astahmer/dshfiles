# dshfiles

Our [DeepSeek Harness](https://dshmarket.com) (DSH) setup: the plugins we own,
and the toolchain that builds them. `AGENTS.md` explains when to adopt a
marketplace plugin instead of writing one.

## Layout

| Path | What lives there |
|---|---|
| `plugins/@dshfiles/*` | Owned plugins, one pnpm workspace |
| `tooling/dshx` | `@dshfiles/dshx`, our hard fork of the dshx build tool (`FORK.md`) |
| `apps/desktop` | Electron shell around `dsh web` |
| `scripts` | Profile sync, boot smoke, browser probe |
| `plans` | Living plans; `plans/repo-hardening` tracks the current cleanup |

## Plugins

| Package | Kind | What it does |
|---|---|---|
| `agent-communication` | bundle | Durable topic and direct messaging between independent DSH Agents |
| `ai-accounts` | bundle | Per-account Codex, OpenCode Go and Command Code provider instances |
| `jujutsu` | bundle | Jujutsu revision graph and confirmed Source Control actions |
| `mcp-servers` | bundle | Profile-wide MCP server configurations backed by native DSH MCP clients |
| `plugin-marketplace` | bundle | Settings tab that installs DSH plugins from a catalog |
| `project-folder-picker` | library | React picker for registered projects and Host folders |
| `queue-reorder` | bundle | Drag-to-reorder the message queue through the durable inbox splice |
| `secret-catalog` | bundle | Browse and manage `secret` CLI aliases per project |
| `settings-search` | bundle | Search every Settings field and edit it in place |
| `shortcuts` | bundle | Capture-phase keyboard shortcuts that beat the browser's own |
| `thread-sidebar` | bundle | Project-scoped thread groups replacing the DSH sidebar |

A bundle is a cordis bundle with a `cordis.patch.yml`; a library is imported by
bundles and never installed on its own.

## Working here

Node comes from fnm (`.node-version`), not Nix: `dsh` fails at boot on Nix's
Node build. See `AGENTS.md` for the details and the other traps.

```sh
pnpm install:all          # both workspaces
pnpm check                # dshx and plugin gates, lint, format
pnpm profile:sync --profile probe
fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe
```

`profile:sync` links every owned bundle into a profile and installs it;
`profile:boot` boots that profile and fails on any entry that did not activate.
Try changes in `probe` before `web`.
