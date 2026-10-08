# Remaining work across plans

Tracker of open items from every plan in `plans/` (digest of 2026-10-09). Update the checkbox here and in the
owning plan when an item lands. Host-blocked features live in [dsh-host-gaps.md](dsh-host-gaps.md); the plugin
UI rebuild status lives in [plugin-ui-handoff.md](plugin-ui-handoff.md).

## Suggested order

1. Own Command Code route → drop `@mars-sea` (M)
2. E2E user journeys over the rebuilt UIs (M)
3. Claude Code agent adapter + Agent accounts UI (L)
4. OptMem persistent memory ([optmem/](optmem/README.md)) — in progress

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
