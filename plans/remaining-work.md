# Remaining work across plans

Tracker of open items from every plan in `plans/` (digest of 2026-10-09). Update the checkbox here and in the
owning plan when an item lands. Host-blocked features live in [dsh-host-gaps.md](dsh-host-gaps.md); the plugin
UI rebuild status lives in [plugin-ui-handoff.md](plugin-ui-handoff.md).

## Current progress (2026-10-10)

Landed since 2026-10-09 (jj revisions in the repo log): BB-style thread rows (density, project/machine line,
child threads with "N more…", project colours), back/forward + ⌘[ ⌘], header icon drag reorder; usage meters
(per-account, "Limit reached", strip above Settings, shared order/hide, context menu, drag), Codex Luna Reserve
read + `gpt-reserve` routing (fixture-tested only); one-click jj toggle (header, composer chips, command);
ADE Phase 3 palette hub (Host commands, ⌘P files → editor, frecency, `>` `#` `:` `?` prefixes); workbench as a
right side-panel tab + header toggle + command; missing turn summary fix; 300 s stream idle timeout.

Landed 2026-10-10 (later): jj details race fix (`ywumusqy`, reads by commit id with `--ignore-working-copy`, inline
Retry); dshx settings forms on every plugin's Host Plugins page (`wmuzpmyk`), `DSHX1207` inject typo check
(`lvlrznvq`), API handler error logging + `PluginApiError` (`yvtxnpyu`); sidebar `sidebar.footer.above` slot for
the usage strip, meter label setting, history menu next to ← →, `hideBrandLogo`, "Restart DSH to apply updates"
indicator; dock-everything plan in [ade/docking.md](ade/docking.md) (feasible without a fork; D0 probe first).

Small follow-ups:
- [x] jujutsu prepare/confirm: throw `PluginApiError` so real messages reach the panel
- [x] ai-accounts Settings: price catalog line shows "fetched [object Object]"
- [x] dshx `tests/config.spec.ts:51` unused `@ts-expect-error` (typecheck error)
- [ ] restart indicator misses host-only plugins (e.g. optmem) — Host client registry doesn't list them
- [ ] optmem settings can't show on its Plugins page (no client half)
- [x] palette-perf tests flaky under machine load (thresholds or isolate)
- [ ] 423 old `conflicts()` revisions in dshfiles from shared-working-copy agents — tidy (abandon/resolve)

## Handoff (2026-10-10, Claude session near its usage limit)

Landed since last update: jj panel VirtualList + keyboard nav + scroll-to-@ (`ktovxoms`, plugin-ui `/virtual`),
polling pause when hidden (`qlrkyxvl`), "Open in editor" from changed-file lists (`tyxulltq`), jujutsu lint
(`mvwzzpxv`); PI_AI_ERROR Envoy replay-buffer overflow retried as TRANSPORT (`yoouomyw`, needs DSH restart);
jj history unified twice (undo ops `ac933835aa89`, `88b08d737db7`), 1,123 old leftovers abandoned; Schedule
delivery test kept (`yzukrqzw`); verify-core-runtime-scratch.mjs current version kept.

In flight when the session stopped (check `jj log` for their revisions before redoing):
- [ ] queue-reorder: edit a queued item through the composer (text + attachments back in composer; Submit puts
  it back at the same position, Cancel/Escape restores the original; races covered); then forget the
  `queue-rich-edit` workspace if inactive (keep its dir)
- [ ] ai-accounts: configurable failure policy per kind (transport, 429, exhausted, auth, oversized): retry /
  fail over / Luna Reserve / shrink / fail; defaults transport→retry then fail over, exhausted→reserve then
  fail over, 429→fail over then wait; works in jj workspace `ai-failover` (don't commit `tooling/dsh-core/*/lib`)
- [ ] editor: tab dedupe (relative/absolute), binary/image preview, file list refresh on `workspaceFiles.changes`,
  ⌘P `.gitignore`, open from thread tool-call paths (or note gap in dsh-host-gaps.md), minimal explorer panel

Urgent before the next DSH restart:
- [ ] `probe` fails to boot: ai-accounts and the CommandCode provider register the same adapter (after
  "fix(profiles): activate configured CommandCode provider"); check whether `web` is affected and fix
- [ ] repo `pnpm lint` errors in mcp-servers, secret-catalog, plugin-marketplace, ai-accounts
- [ ] delete scratch profile `~/.dsh/profiles/scratch-jj` (leftover, harmless)

Next, in order (workbench/dock work last):
1. Luna Reserve live check when a Codex weekly limit is next spent
2. ADE leftovers: P0.5 bundle diet (shared deps) + pause polling when hidden, P0.6 perf e2e, P1.10/L3 jj
   revision VirtualList, P2.1–P2.2 explorer + file tree auto-refresh, P2.4–P2.5 open-from-anywhere (diffs, tool
   calls), dedupe relative/absolute tabs, binary preview, P2.7 gutter, ⌘P `.gitignore`, `@` symbols (needs a
   language service)
3. Delete `plugins/@dshfiles/plugin-marketplace` (after `nixapply` + restart); OptMem 100k bench rerun when idle
   (see [optmem/README.md](optmem/README.md) "Resume here")
4. Dock everything / workbench panel registry (per docking.md)

## Suggested order (older plans)

1. Own Command Code route → drop `@mars-sea` (M)
2. E2E user journeys over the rebuilt UIs (M)
3. Claude Code agent adapter + Agent accounts UI (L)
4. OptMem persistent memory ([optmem/](optmem/README.md)) — stages 1–5 done; only the 100k bench rerun left

## By plan

### Claude/Cursor accounts — [claude-cursor-accounts.md](claude-cursor-accounts.md) (in progress, 0/14 criteria)
- [ ] Claude Code adapter (stream-JSON, per-account `CLAUDE_CONFIG_DIR`); no driver kind exists yet
- [ ] Cursor multi-account isolation gate
- [ ] Agent accounts UI + runtime selector pinned to the Session
- [ ] Fake-provider registry test
- [ ] One real authenticated provider turn (Cursor first — cheapest proof of the seam)

### Own Command Code route — [own-commandcode-route.md](own-commandcode-route.md) (phase 1 done)
- [ ] Phase 2: `kind: commandcode` account in the `web` profile; check which provider wins
- [ ] Phase 3: port reasoning tiers, retry, `imageRequestPricing` (empty-response tests may already exist — verify)
- [ ] Phase 4: drop `llm-commandcode` and the `@mars-sea` dependency (removes the crowded footer card)

### E2E testing — [dsh-e2e-testing.md](dsh-e2e-testing.md) (in progress)
- [ ] Boot criteria: throwing `apply` fails smoke, healthy/pending pass, `web` boots clean, fresh clone without manual browser install
- [ ] Step 7: first user journey (send, reply, queue order) + one journey per rebuilt plugin panel
- [ ] Step 9: upstream `window.__DSH_BOOT_STATE__`
- Open questions: per-revision vs release runs; real vs minimal profile; CLI vs CI

### Software roadmap — [software-additions-roadmap.md](software-additions-roadmap.md)
- [ ] P1A–D: real provider turn (all proofs synthetic); active-profile attention API/UI
- [ ] P2: panel movement, element feedback (Host-gated)
- [ ] P4A dock, 4B visual feedback, 4D attention inbox / child-work dashboard, artifacts
- [ ] P5: PR-watch owner; Cursor driver fork/history replay; Session Controller source binding
- [ ] P6/P7 deferred
- [ ] jj: isolated workspace launch UI (5B), review comments back to the agent (F18), fetch preview

### Reference features — [reference-feature-additions.md](reference-feature-additions.md)
- Catalogue only; pick from F01–F92 / I01–I15 not yet on the roadmap (PR watch F20, dockable workspace I01,
  element feedback I02, artifacts I12, …)

### Desktop shell — [desktop-shell/](desktop-shell/README.md) (phases 0–1 done)
- [ ] Phase 2 lifecycle edges: child dies, port taken, second window; re-prove on Electron 43.6.0
- [ ] Phase 3: signed `.app` from `nix build .#desktop`
- [ ] Phase 4: auto-update (blocked on a release channel)

### Multi-host — [multi-host/](multi-host/README.md) (P1–P3 done)
- [ ] P4: browser proof for approval, upload, terminal, popup close/reopen; Pi OpenCode Go 200-vs-401; real model turn
- [ ] P5: supervised deployment, rollback, daily-profile activation
- [ ] 7 open questions (consumers, capability discovery, bundle placement, client isolation, offline cache, central account, SSH/LSP)

### Async agent questions — [async-agent-questions.md](async-agent-questions.md) (mostly done)
- [ ] Scratch-profile browser acceptance (timed card, pending continuation, late answer, cancel, restart)
- [ ] Element anchors (blocked on an evidence provider)
- Open questions: default timeout; ancestor vs parent; `defer` for roots; `questions/` pruning

### Plugin boot integrity — [plugin-boot-integrity.md](plugin-boot-integrity.md)
- [ ] Tick/verify the 6 criteria (code landed: DSHX2403, `--boot`)

### Repo hardening — [repo-hardening/](repo-hardening/README.md)
- [ ] Fix stale status header (phases 7–9 are ticked)
- [ ] Decide on renaming unscoped Loader row ids (would orphan stored settings)

### Plugin UI rebuild — [plugin-ui-handoff.md](plugin-ui-handoff.md)
- [ ] Delete `plugins/@dshfiles/plugin-marketplace` after `nixapply` + DSH restart
- [ ] Live click-through: jujutsu Source Control / full diff / drag; MCP OAuth with a real provider; Claude/Cursor usage
- [ ] MCP preferences into DSH Settings (needs a split Host entry)
- [ ] Port memory-watch; fold sidebar-resize into thread-sidebar; tokitoki usage into the AI accounts popover
