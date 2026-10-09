# Plugin state audit — TanStack Query / Form / xstate (2026-10-09)

Rule: server/async state → `@dshfiles/plugin-ui/query` (useQuery/useMutation/invalidate, `refetchInterval` instead of
setInterval); multi-field forms → `@dshfiles/plugin-ui/form` (`useAppForm`, zod); tangled ≥3-state flows → xstate v5
via a new `@dshfiles/plugin-ui/machine` subpath (re-export `xstate` + `@xstate/react`, pinned once in plugin-ui;
machines own flow state only, server data stays in Query and is called through `fromPromise` actors).

Already on the kit: jujutsu client.tsx (+ auto-refresh), mcp-servers, multi-host forms/queries, plugin-marketplace,
queue-reorder. optmem has no UI.

| # | Plugin | Where | Target | Value | Size | Done |
|---|---|---|---|---|---|---|
| 1 | ai-accounts | use-accounts-panel-state.ts:14-248 (9 useState/8 effects, draft) | Query ×3 + mutation(save) + useAppForm draft | high | L | [~] Query/mutations done; draft kept in useState: it re-syncs from the selected account and renames commit on blur, so a form store would be a second source of truth beside the auto-saver |
| 2 | ai-accounts | use-accounts-panel-state.ts:212-225 (sign-in setInterval poll) | query refetchInterval until signed in | high | S | [x] |
| 3 | ai-accounts | usage-history-panel.tsx:139-272 | Query ×3 (refetchInterval) + mutations | high | M | [x] |
| 4 | ai-accounts | use-accounts-usage.ts:41-74 | query + mutation(refreshUsage) → setQueryData | high | S | [x] |
| 5 | secret-catalog | secret-catalog-panel.tsx:89-131,229-261 | query(list) + 3 mutations + invalidate | high | M | [x] |
| 6 | secret-catalog | secret-mutation-dialog.tsx:75-86 (10 fields) | useAppForm + zod | high | M | [x] |
| 7 | jujutsu | workspace-restore-panel.tsx:31-158 (select→prepare→confirm→receipt) | machine (pilot for /machine) | high | M | [x] workspace-restore-machine.ts |
| 8 | settings-search | settings-field-editor.tsx:52-110 | useAppForm + 2 mutations | high | M | [x] |
| 9 | project-checks | client.tsx:110-147 | Query ×3 (enabled: open) + mutation(run) | med | S | [x] |
| 10 | project-folder-picker | project-folder-picker.tsx:84-176 | query(browse) + 3 mutations | med | M | [x] |
| 11 | ai-accounts | quota-continuations.tsx:17-62 | query + mutation (variables = busy id) | med | S | [x] |
| 12 | ai-accounts | native-providers-list.tsx:24-47 | query refetchInterval while pending + mutation | med | S | [x] |
| 13 | ai-accounts | models-page-accounts.tsx:30-56 + auto-save.ts | auto-save machine shared by both editors | med | M | [x] auto-save.ts is an xstate machine; both editors use useAutoSaver (latest save/delay via ref) |
| 14 | multi-host | client.tsx:335-391 (view lease + setInterval poll) | spawned lease actor per runtime view | med | M | [ ] |
| 15 | jujutsu | session-fork-panel.tsx:42-117 | mutation(fork) + useInfiniteQuery (history) | med | M | [x] mutations for fork + loadOlder; history stays the Host-retained event window (no fetchable pages for useInfiniteQuery) |
| 16 | jujutsu | client.tsx:228-229,260-276,356-399 (drag→preview→confirm) | machine (same shape as #7) | med | M | [x] revision-action-machine.ts (menus share it) |
| 17 | thread-sidebar | sidebar-shell.tsx:338-340,659-667 (restart dialog) | mutation | med | S | [skip] restart.test.ts guards sidebar-shell against plugin-ui/query after a QueryClient crash; useApiQuery stays |
| 18 | thread-sidebar | client.tsx:187-229,300-312 (snooze/markRead) | mutations with onError notice | low | S | [skip] same sidebar no-QueryClient guard as #17 |
| 19 | multi-host | client.tsx:118,206-328,395-411 (global error mirror) | per-mutation error + invalidate | low | S | [ ] |
| 20 | diff-viewed | viewed-toggle.tsx:13-27 | useQuery | low | S | [x] |
| 21 | prompt-stash | prompt-stash-action.tsx:27,145-295 | useAppForm | low | S | [skip] kit fields lack maxLength/counter; save logic is storage-conflict checks, not field validation |
| 22 | prompt-stash | prompt-stash.tsx:39-40 | useAppForm | low | S | [skip] same as #21 |
| 23 | mcp-servers/marketplace | catalog-browser.tsx:91-102, mcp-quick-panel.tsx:79-82, MarketplaceTab.tsx:402 | shared `useDebouncedValue` in the kit | low | S | [x] plugin-ui hooks/debounced-value (quick panel had no debounce left) |

Order: #1–6, #8 (Query/Form) → add `/machine` with #7 as pilot → #16, #13, #14 → rest.

Agent prompt template (one plugin per agent, parallel-safe across plugins):
> In /Users/astahmer/dev/dshfiles (jj, shared working copy — touch only `plugins/@dshfiles/<plugin>`), refactor items
> #… of plans/plugin-state-audit.md to TanStack Query/Form from `@dshfiles/plugin-ui/{query,form}` (keys prefixed with
> the plugin id, forward `signal`, invalidate after mutations, refetchInterval instead of setInterval). Preserve
> behaviour, a11y names and old-host tolerance. Tests for behaviour; typecheck/test/build; host dist import check
> (node 22.23.3). Tick the items here; path-scoped jj revision with trailer
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Terse report.

## Library / Host-utility swaps (audit 2026-10-09)

| # | Where | Swap | Value | Size | Done |
|---|---|---|---|---|---|
| L1 | mcp-servers/src/oauth.ts:100-216 | `oauth4webapi` (adds issuer check RFC 8414 §3.3, correct OIDC discovery URL, `WWW-Authenticate` resource_metadata hint) | high (security) | M | [x] |
| L2 | jujutsu/src/full-diff-dialog.tsx:78-94 (up to ~1.1 MB patch, all rows mounted) | ~~`@tanstack/react-virtual` + Host `useCodeHighlighter`~~ superseded by `@pierre/diffs` 1.5.2 `PatchView` (`@dshfiles/plugin-ui/diff`: virtualized, Shiki, unified/split) in full-diff dialog, inline revision patch and Source Control file diff; jujutsu client.js 594→1,881 KB (150→381 KB gz) with the slim Shiki alias | high | M | [x] |
| L3 | jujutsu/src/client.tsx:763 revision list (≤500 rows) | same VirtualList | med | M | [ ] |
| L4 | thread-sidebar/client.tsx:129, jujutsu/client.tsx:158 (two disagreeing relative-time fns) | Host `relativeTime` | med | S | [x] |
| L5 | thread-sidebar/client.tsx:297, ai-accounts/use-accounts-panel-state.ts:180 | Host `writeClipboard` | low | S | [x] |
| L6 | thread-sidebar/palette.ts:62 `filterByLabel` | Host `rankByName` (keep weighted `rankThreads`) | low | S | [x] |
| L7 | 5 localStorage stores (sidebar-state.tsx:31, viewed-marks.ts:44, jujutsu client.tsx:134 + preferences.ts:58, edge-usage.tsx:53) | plugin-ui `createStoredValue(key, zodSchema)` (useSyncExternalStore + storage event) | med | S | [x] sidebar prefs, diff-viewed marks, jujutsu repo path+history, edge position; jujutsu review progress (byte cap, no-change-on-failure) and preferences.ts (one-shot legacy migration) stay direct |
| L8 | thread-sidebar/sidebar-shell.tsx:729 customize drag | add move up/down buttons (keyboard a11y); pragmatic-drag-and-drop only if reused with L9 | med | S | [x] |
| L9 | jujutsu drag (client.tsx:198,414,821) | `@atlaskit/pragmatic-drag-and-drop` + auto-scroll (optional) | low-med | M | [ ] |
| L10 | ai-accounts/native-provider-patch.ts:43 heuristic | `yaml` parseDocument check (host side) | low-med | S | [x] yaml 2.9.1 parseDocument before and after the append |
| L11 | jujutsu/core.ts:180 second +/- pass | `parseGitPatch` removed with the hand-rolled renderer; host `parsePatchStats` is the only count pass, `@pierre/diffs` parses for rendering | low | S | [x] |

Skipped (small/clear or lib not worth it): debounces (@tanstack/pacer still 0.x), optmem backoff, auto-save.ts,
command-line.ts quoting, file-tree/graph, keychain wrapper, sidebar splitter, parse-diff/react-diff-view.
`@pierre/trees` 1.0.0-beta.6 for the jujutsu changed-file Tree: no per-row checkbox or inline hover-action API
(one text/icon decoration per row plus a context menu), so review marks and row actions would need hacks; it also
ships a Preact 11 beta runtime and a second `@pierre/theming`.
