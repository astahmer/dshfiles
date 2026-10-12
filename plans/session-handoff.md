# Session handoff — open items (2026-10-10)

Open items from the Claude coordinator session that have no other owning plan. Remove a line when it lands;
delete this file when empty.

## Before the next DSH restart (web, :3080)
- [ ] Run `nixapply`, then restart: loads OptMem (compat mode), the ai-accounts commandcode skip (`rqstxxov`),
  failure recovery, Luna Reserve routing, queue file editing, real API error messages.
- [ ] In flight (agent): fix `mcp-servers` / `secret-catalog` build failures (`dshx.features.json`), scratch boot
  "session-persistence-jsonl: format catalog v4 does not match Session v5", split the mixed `wpztzsot` "wip"
  revision in main if main is unpushed.
- [ ] Live patch warning `entry "llm-commandcode" not found` (`--dump-config`; that row is not composed in `web`).
- [ ] Restart preflight (2026-10-11): `dsh --profile web --dump-config` exits 0 and every host bundle imports under
  Node 22.23.3, but import + composition ≠ `apply` — read the boot output for "did not activate" lines. Only 22
  owned dirs are composed (promotion item under Later).
- [ ] Re-check for running agents before killing :3080 (29 idle / 1 running at the 2026-10-11 capture); a restart
  drops every in-flight turn, including other agents' sessions.

## Later
- [ ] Luna Reserve live check when a Codex weekly limit is next spent (routing is fixture-tested only).
- [ ] Failure recovery: exhausted accounts cool off 5 min, not until their real quota reset.
- [ ] Queue edit in place on the Host (today Submit/Cancel re-queue a copy at the same position);
  see [queue-attachment-editing.md](queue-attachment-editing.md).
- [ ] Own commandcode route (404, no auth.json read, no effort tiers) — [own-commandcode-route.md](own-commandcode-route.md).
- [ ] Restart indicator misses host-only plugins (e.g. optmem); optmem settings can't show on its Plugins page.
- [ ] Repo `pnpm lint` / `fmt:check` leftovers outside touched files.
- [ ] ADE leftovers and dock-everything/workbench panel kinds — [ade/README.md](ade/README.md), [ade/docking.md](ade/docking.md).
- [ ] Delete `plugins/@dshfiles/plugin-marketplace` after `nixapply` + restart; delete `~/.dsh/profiles/scratch-jj`.
- [ ] Host persisted-read concurrency for thread-content search: the installed provider still reads cold persisted
  logs serially. The source patch sets `persistedReadConcurrency: 4` in the canonical Host/provider checkout (not
  this repository), so live search keeps the old concurrency until that core change ships.
- [ ] Web profile source integration (2026-10-12): the accepted `workspace-folder-picker` bundle is in the
  `workspace-folder-picker-browser-latest` seed and installed `~/.dsh/profiles/web`; the installed link points to that
  named workspace. `dsh --profile web --dump-config` reports 24 unique `@dshfiles` names and `backend: hybrid`.
  `profile:sync --dry-run` shows 26 owned bundles total, with only `cursor-agent` and `dsh-core-runtime` absent.
  Canonical `/Users/astahmer/dev/dshfiles/profiles/web/package.json` still lacks the bundle, and its default workspace
  has unrelated in-flight OptMem changes. Do not rewrite it; integrate both feature code and seed after those changes
  are safe. Until then, a canonical Nix apply can remove the installed bundle.
- [ ] Live activation: installed DSH is `0.2.0-rc.2`, which predates the hybrid Host/API change. Keep the live process
  running; install a compatible Core build before any user-controlled restart. Never restart live DSH.
- [ ] Vendored core runtime is stale (decided 2026-10-11: not now, no canonical checkout path given):
  `tooling/dsh-core/api-session-controller/lib/index.js` is the Oct 7 22:53 build while `src/` is Oct 11 18:49. Types
  were hand-patched in `lib/types/types.d.ts`; the runtime was not — `updateAttention` is present but
  `lastTurnFailureAt` is absent, so thread-sidebar's "latest turn failures" projection reports nothing at runtime.
  Fix with `DSH_SOURCE_ROOT=<canonical deepseek-harness checkout> pnpm run sync:core-api-session-controller`.
- [ ] `pnpm run check:dshx` still fails, now one step later (2026-10-11): `build`, `typecheck` and `test` pass (57
  files / 571 tests) after `fix(dshx): align the communication specs with the passive delivery model` — the
  `notifyAgent` / `deliverPending` / schema-v2 assertions are gone. The remaining red is `features:check` with 81
  findings: 75 declared scenarios without an `@scenario` tag, 4 orphan tags, 1 duplicate tag and 1 missing test
  reference. That is the catalog work owned by [plugin-e2e-coverage.md](plugin-e2e-coverage.md); `check:green` cannot
  be green until it lands.
- [ ] Global `jj` skill triggers ("unify the history", "spine branch", "linear history") are edited in the sources
  but not deployed: the AGENTS repo needs `jj bookmark set main` + push, then `nix flake update agents` +
  `nixapply`. `~/.agents` is a read-only Nix build, so applying alone does not pick up the base-skill change.
