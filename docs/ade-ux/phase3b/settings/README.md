# Phase 3b evidence: one Settings page and prefix-free tab titles

Captured 2026-11-04 from a scratch DSH (stock core 0.2.1-rc.2, every owned bundle) built from the `ade-3b-settings`
JJ workspace on top of `jj:wnvtzlmz` (main after Phase 3a). Same WebKit driver and sizes as the
[Phase 0 baseline](../../baseline/README.md): desktop 1440×900, phone 390×844 as iPhone (scaled to 75 %), quantised
PNG. No shot had document-level horizontal overflow (`scrollWidth = clientWidth`).

## Images

| Shot | What it shows | Compare with |
| --- | --- | --- |
| [00-before-settings-desktop](<00-before-settings-desktop.png>) | Before (main): rail › Settings › All settings, one flat list with a "Plugins" group of package-named pages (`agent-loop`, `bash-sandbox`, `web`, `tool-subagent/model-…`), AI Accounts twice | [07d-settings-desktop](<../../baseline/07d-settings-desktop.png>) |
| [01-settings-page-desktop](<01-settings-page-desktop.png>) | The rail's Settings opens the page at once; navigation by task group (General, Models & accounts, Agents, …) | 00 |
| [02-settings-search-desktop](<02-settings-search-desktop.png>) | Search "open settings" finds the key binding with its keys | — |
| [03-settings-jev-desktop](<03-settings-jev-desktop.png>) | Tools & MCP › Jev: Backlog's and Memory's Jev settings together, one place | — |
| [04-settings-ai-accounts-desktop](<04-settings-ai-accounts-desktop.png>) | Models & accounts › AI accounts: one entry, its section and plugin settings | 00 (AI Accounts twice) |
| [05-settings-mcp-link-desktop](<05-settings-mcp-link-desktop.png>) | Tools & MCP › MCP servers: a deep link to the page its plugin owns | — |
| [06-tab-without-prefix-desktop](<06-tab-without-prefix-desktop.png>) | A page tab titled "AI accounts", not "AI Accounts: Accounts" | baseline tab strips |
| [20-settings-page-phone](<20-settings-page-phone.png>) | Phone: More › Settings pushes the page; the group list becomes an entry picker | — |
| [21-settings-search-phone](<21-settings-search-phone.png>) | Phone search "jev" | — |
| [22-settings-groups-phone](<22-settings-groups-phone.png>) | Phone entry picker, grouped by task | — |

## What changed

| Before | Now |
| --- | --- |
| Four presentations: dialog, expanded dialog, main tab, right side panel (+ `openIn` setting) | One page in the stage; gear, rail, palette, `Mod+,` and `dshfiles:open-settings` all open it. `openIn` is retired (hidden, still validates) |
| Native sections in one list, every plugin page under "Plugins", 11 more under a collapsed "More settings" | Ten task groups of plan §4.6 (+ Other); the map is `plugins/@dshfiles/settings-shell/src/settings-groups.ts` |
| Page titles from manifests: `agent-loop`, `bash-sandbox`, `web`, `tool-subagent/model-selection-settings`, `Dshx plugin marketplace` | Agent loop, Shell sandbox, Web server, Subagent models, Plugin marketplace; any unplaced id is humanized |
| AI Accounts: a section and a plugin page, both "AI Accounts" | One "AI accounts" entry: section + plugin settings |
| MCP servers, Secrets, Hosts only as left-nav pages | Also Settings entries that open their plugin's page (link, no copied UI) |
| Jev settings on the Backlog page and the Memory page | Tools & MCP › Jev; their pages point there |
| Layout fixed / free docking only in the rail's Settings list | Also General › Layout (the thread sidebar's own `layoutMode` field) |
| Search: setting titles, descriptions, key paths, section names | + entry and group names, former names, and key bindings by name or keys |
| Tab titles "Usage: Analytics", "Jujutsu: Revision graph", "Settings Shell: Settings" | "Usage", "History", "Settings" (destination section labels; else the label minus `Plugin: `) |

## Not done here

- Scope control: no setting stores a per-project or per-thread value today, so pages say "Applies to every project
  and thread" instead of offering a control (plan §4.6 "Mixed" needs scoped storage first).
- Jev: Backlog and Memory still store their own key; one shared key is Phase 5 ("Jev key set in 1 place").
  The Backlog panel's in-panel Jev settings are owned by the Backlog page migration and were not touched.
- Notifications has no entry yet: no plugin stores notification settings outside the thread list.
