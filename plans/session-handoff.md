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
- [ ] ADE P0.5 shared runtime approved by the user (2026-10-11): `@dshfiles/shared-runtime` supplier plugin + dshx `sharedRuntime.provide` / consumer `shared` + CSS-hash skip; plugin-ui stays a build-time library; needs profile sync + restart.
