# Plugin UI rebuild — handoff (2026-10-08)

Running notes so another agent can resume. Plan of record: [plugin-ui-library.md](plugin-ui-library.md).
User goal: DSH plugins must look and behave like our BB plugins (`~/dev/bb-plugins/plugins/*`), built on
shadcn/ui via `@dshfiles/plugin-ui`. Reference screenshots: `plans/dsh-customization/screenshots/` plus the
user's round-2 shots (sidebar header ⋮ menu, jujutsu full diff / expanded revision, jj-view Source Control,
AI accounts usage popover).

## How things work now

- `@dshfiles/plugin-ui` = shadcn/ui (CLI-installed into `src/components/ui`), Tailwind v4 with `dshx:` prefix,
  no global Preflight. Colors map `@theme inline` → `--dsw-*` (light/dark follow DSH). Preflight scoped to
  `.dshx-root`, shadcn portal `*-content`/`*-overlay`, and shadcn controls — never bare `[data-slot]` (DSH
  tags its own outlets with it). README in the package has the rules and the "add a registry component" steps
  (CLI keeps re-adding a junk `cn` npm dep and extensionless imports — strip/fix after every `shadcn add`).
- Each plugin: `src/client.css` (`@import '@dshfiles/plugin-ui/styles.css'; @source './';`), imported by the
  client entry; `dshx.config.ts` adds `pluginUiVite()` and `build.minify: true`.
- dshx fork: `build.minify` option; protocol guard, capability rewrite and CSS fold accept minified output
  (tests in `tooling/dshx/packages/dshx/tests/client-build.spec.ts`).
- Live DSH (`dsh web`, profile `web`) links the repo plugins; `pnpm build` in a plugin hot-reloads its client.
  Host-side / package.json / settings-namespace changes need a DSH restart (user does it; never restart it).
  Clients must tolerate the OLD host until then.

## Status by plugin

| Plugin | State |
|---|---|
| plugin-ui | done; kit fixes committed |
| jujutsu (+ project-folder-picker) | round 2 committed: drag rebase/bookmarks, full diff, Flat/Tree, revision actions, jj-view Source Control, repo palette, DSH Settings. Graph verified live; Source Control / full diff / drag not yet clicked through |
| thread-sidebar / shortcuts / sidebar-commands | round 2 committed (header row + ⋮ menu, ⌘P thread palette, ⌘K palette, footer overflow, DSH Settings with old-host fallback). Verified live: ⋮ menu, ⌘P palette, no console errors |
| secret-catalog | round 2 committed |
| mcp-servers | round 2 committed (OAuth, catalog browser, settings, old-snapshot decode). Sign in/out needs DSH restart |
| ai-accounts | round 2 committed: auto/manual save, Claude/Command Code/Cursor usage, recorder + quota bug fixes, BB footer usage popover (verified live), Settings › Models block. Claude/Cursor readers untested against real accounts |
| plugin-marketplace | committed (catalog fixed; recommendation: remove in favour of dshmarket — awaiting user) |
| settings-search, diff-viewed, prompt-stash, multi-host, queue-reorder | committed |

## Open items / needs user

1. Restart DSH to pick up host/settings changes (jujutsu, thread-sidebar, secret-catalog, mcp-servers,
   settings-search, queue-reorder, plugin-marketplace, ai-accounts).
2. Decide: remove our plugin-marketplace (dshmarket covers it)?
3. Not possible without DSH Host changes: BB link-existing-thread / auto-handoff-parent (no parent API),
   settings-search jump-to-section, collapse viewed files in DSH review tab, MCP live health, legacy SSE.
4. BB plugins without DSH counterpart: memory-watch, sidebar-resize (fold into thread-sidebar),
   tokitoki-usage (merge into ai-accounts popover).

5. ai-accounts: keychain reads for Claude/Cursor may trigger a one-time macOS prompt — acceptable? Verify
   Cursor usage endpoint + Claude keychain item for non-default CLAUDE_CONFIG_DIR after restart. Live data
   showed `codex` returning 401 (re-login) and OpenCode Go not signed in.

## Next candidates

- Click through jujutsu Source Control, Full diff, drag rebase/bookmark live after restart.
- MCP OAuth against a real provider after restart.
- memory-watch port; fold sidebar-resize into thread-sidebar; tokitoki-usage into the ai-accounts popover.
- Kit gaps reported: form TextField lacks input className / hidden label; Popover-anchored "picker shell".

## Resume checklist

- `jj log -r 'tpupylmz::@'` shows one described revision per unit; `@` holds uncommitted agent work.
- Per plugin: `pnpm typecheck && pnpm test && pnpm build`; then check the browser console for slot crashes.
- Split finished work with `jj split -m "<conventional message>" <plugin dir>`.
