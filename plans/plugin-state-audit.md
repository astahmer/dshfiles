# Plugin state audit — TanStack Query / Form / xstate (2026-10-09)

Rule: server/async state → `@dshfiles/plugin-ui/query` (useQuery/useMutation/invalidate, `refetchInterval` instead of
setInterval); multi-field forms → `@dshfiles/plugin-ui/form` (`useAppForm`, zod); tangled ≥3-state flows → xstate v5
via a new `@dshfiles/plugin-ui/machine` subpath (re-export `xstate` + `@xstate/react`, pinned once in plugin-ui;
machines own flow state only, server data stays in Query and is called through `fromPromise` actors).

Already on the kit: jujutsu client.tsx (+ auto-refresh), mcp-servers, multi-host forms/queries, plugin-marketplace,
queue-reorder. optmem has no UI.

| # | Plugin | Where | Target | Value | Size | Done |
|---|---|---|---|---|---|---|
| 1 | ai-accounts | use-accounts-panel-state.ts:14-248 (9 useState/8 effects, draft) | Query ×3 + mutation(save) + useAppForm draft | high | L | [ ] |
| 2 | ai-accounts | use-accounts-panel-state.ts:212-225 (sign-in setInterval poll) | query refetchInterval until signed in | high | S | [ ] |
| 3 | ai-accounts | usage-history-panel.tsx:139-272 | Query ×3 (refetchInterval) + mutations | high | M | [ ] |
| 4 | ai-accounts | use-accounts-usage.ts:41-74 | query + mutation(refreshUsage) → setQueryData | high | S | [ ] |
| 5 | secret-catalog | secret-catalog-panel.tsx:89-131,229-261 | query(list) + 3 mutations + invalidate | high | M | [ ] |
| 6 | secret-catalog | secret-mutation-dialog.tsx:75-86 (10 fields) | useAppForm + zod | high | M | [ ] |
| 7 | jujutsu | workspace-restore-panel.tsx:31-158 (select→prepare→confirm→receipt) | machine (pilot for /machine) | high | M | [ ] |
| 8 | settings-search | settings-field-editor.tsx:52-110 | useAppForm + 2 mutations | high | M | [ ] |
| 9 | project-checks | client.tsx:110-147 | Query ×3 (enabled: open) + mutation(run) | med | S | [ ] |
| 10 | project-folder-picker | project-folder-picker.tsx:84-176 | query(browse) + 3 mutations | med | M | [ ] |
| 11 | ai-accounts | quota-continuations.tsx:17-62 | query + mutation (variables = busy id) | med | S | [ ] |
| 12 | ai-accounts | native-providers-list.tsx:24-47 | query refetchInterval while pending + mutation | med | S | [ ] |
| 13 | ai-accounts | models-page-accounts.tsx:30-56 + auto-save.ts | auto-save machine shared by both editors | med | M | [ ] |
| 14 | multi-host | client.tsx:335-391 (view lease + setInterval poll) | spawned lease actor per runtime view | med | M | [ ] |
| 15 | jujutsu | session-fork-panel.tsx:42-117 | mutation(fork) + useInfiniteQuery (history) | med | M | [ ] |
| 16 | jujutsu | client.tsx:228-229,260-276,356-399 (drag→preview→confirm) | machine (same shape as #7) | med | M | [ ] |
| 17 | thread-sidebar | sidebar-shell.tsx:338-340,659-667 (restart dialog) | mutation | med | S | [ ] |
| 18 | thread-sidebar | client.tsx:187-229,300-312 (snooze/markRead) | mutations with onError notice | low | S | [ ] |
| 19 | multi-host | client.tsx:118,206-328,395-411 (global error mirror) | per-mutation error + invalidate | low | S | [ ] |
| 20 | diff-viewed | viewed-toggle.tsx:13-27 | useQuery | low | S | [ ] |
| 21 | prompt-stash | prompt-stash-action.tsx:27,145-295 | useAppForm | low | S | [ ] |
| 22 | prompt-stash | prompt-stash.tsx:39-40 | useAppForm | low | S | [ ] |
| 23 | mcp-servers/marketplace | catalog-browser.tsx:91-102, mcp-quick-panel.tsx:79-82, MarketplaceTab.tsx:402 | shared `useDebouncedValue` in the kit | low | S | [ ] |

Order: #1–6, #8 (Query/Form) → add `/machine` with #7 as pilot → #16, #13, #14 → rest.

Agent prompt template (one plugin per agent, parallel-safe across plugins):
> In /Users/astahmer/dev/dshfiles (jj, shared working copy — touch only `plugins/@dshfiles/<plugin>`), refactor items
> #… of plans/plugin-state-audit.md to TanStack Query/Form from `@dshfiles/plugin-ui/{query,form}` (keys prefixed with
> the plugin id, forward `signal`, invalidate after mutations, refetchInterval instead of setInterval). Preserve
> behaviour, a11y names and old-host tolerance. Tests for behaviour; typecheck/test/build; host dist import check
> (node 22.23.3). Tick the items here; path-scoped jj revision with trailer
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Terse report.
