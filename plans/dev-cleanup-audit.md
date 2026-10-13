# ~/dev cleanup: open decisions

Read-only audit of `~/dev` taken 2026-10-13. By 2026-10-14 every directory in
its safe-removal script was gone from disk, as were 42 of the 65 "ask" or
"archive first" rows. The 23 rows below are still there and need the owner's
call; nothing here should be removed without it.

Columns: **unique work** is `(::<ws>@ ~ ::(main|trunk()|remote_bookmarks())) ~
empty()` for jj, unpushed branches and stashes for git; **references** are
nixfiles modules, `~/.dsh/profiles/*` `link:` entries, the DSH workspace
registry and process cwds. `jj workspace forget` never drops non-empty commits;
deleting a workspace directory only loses unsnapshotted files.

Notable risks:
- `dshfiles` local `main` is 1 commit ahead of `main@origin` (unpushed), and git shows 103 unpushed commits across local branches.
- The `dsh-core-rich-queue-edit` store (28 workspaces, ~50 GB) has no pushed copy. Its `origin` is upstream `deepseek-harness`, and it has no remote bookmarks. 34 own commits exist only here.
- `dsh-plugins` has no remote (109 revisions exist only locally).
- `~/.dsh/profiles/probe` links `~/dev/dshfiles-jujutsu-cache`, which no longer exists (broken link).
- 9 empty orphan heads in the dshfiles store, plus 3 non-empty orphan heads (`yvrxluwzntwv` 47 files, `yqsmquvurslp` dshx pin, `xwvklqlzyqly` comm-audit leaf). The non-empty ones are for **ask**, not abandon.
- Listed `dshfiles-threads/*` workspaces were touched today (up to 14:51). Confirm that no DSH thread still uses the retired jj-integration before forgetting them.

## Undecided rows

| path | kind | store | size | last touched | unique work | references | recommendation |
|---|---|---|---|---|---|---|---|
| css-in-js-bench | git | own (git) | 90M | 2026-09-22 21:36 | git: 7 unpushed commits (all also in css-in-js-bench-rerun-20260923) + 7 modified files + 3 untracked dbg*.mjs | - | archive first |
| agents-user-preferences | jj-ws | agents (ws `user-preferences`, listed) | 184K | 2026-10-11 03:08 | listed; 1 rev not in default (`docs(agents): inline durable user preferences`) | - | ask |
| css-in-js-arena-createcss-cx-20260925 | jj-ws | css-in-js-arena-rerun-20260923 (ws `codex-createcss-cx-20260925`, listed) | 32M | 2026-09-26 11:36 | listed; 3-7 own revs not in default (survive `forget`); untracked = builds + screenshots | - | ask |
| css-in-js-arena-css-primary-20260924 | jj-ws | css-in-js-arena-rerun-20260923 (ws `codex-css-primary-20260924`, listed) | 32M | 2026-09-25 03:19 | listed; 3-7 own revs not in default (survive `forget`); untracked = builds + screenshots | - | ask |
| css-in-js-arena-plan-completion-20260924 | jj-ws | css-in-js-arena-rerun-20260923 (ws `codex-plan-completion-20260924`, listed) | 31M | 2026-09-24 20:28 | listed; 3-7 own revs not in default (survive `forget`); untracked = builds + screenshots | - | ask |
| css-in-js-arena-rerun-20260923 | jj-root+git | own | 45M | 2026-09-25 13:44 | 2 own revs not pushed (third-party benchmark repo) | - | ask |
| css-in-js-bench-css-primary-20260924 | jj-ws | css-in-js-bench-rerun-20260923 (ws `codex-css-primary-20260924`, listed) | 127M | 2026-09-25 03:12 | listed; 3-9 own revs not in default (survive `forget`); untracked = generated BENCHMARK reports/assets | - | ask |
| css-in-js-bench-plan-completion-20260924 | jj-ws | css-in-js-bench-rerun-20260923 (ws `codex-plan-completion-20260924`, listed) | 126M | 2026-09-24 19:03 | listed; 3-9 own revs not in default (survive `forget`); untracked = generated BENCHMARK reports/assets | - | ask |
| css-in-js-bench-rerun-20260923 | jj-root+git | own | 169M | 2026-09-23 22:11 | 9 own revs + 7 unpushed git commits (scratch/pandwind-buildtime-lane) | - | ask |
| css-in-js-bench-rerun-20260926 | jj-ws | css-in-js-bench-rerun-20260923 (ws `codex-bench-rerun-20260926`, listed) | 133M | 2026-09-26 17:13 | listed; 3-9 own revs not in default (survive `forget`); untracked = generated BENCHMARK reports/assets | - | ask |
| dsh-core-agent-session-history | jj-ws | dsh-core-rich-queue-edit (ws `agent-session-history-core`, listed) | 2.0G | 2026-10-12 00:24 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dshfiles-agent-comm-audit | jj-ws | dshfiles (ws `agent-comm-audit`, listed) | 1.7G | 2026-10-12 10:38 | listed; 1 rev not on main (`workspace leaf`: docs/jj-history-consolidation.md) | - | ask |
| dshfiles-chrome-profile-debug | jj-ws | dshfiles (ws `chrome-profile-debug`, listed) | 990M | 2026-10-12 18:29 | listed; 1 rev not on main (`fix(web): share one EventSource per origin`, 497 lines) | profile web (shared-streams link) | ask |
| dshfiles-command-palette | jj-ws | dshfiles (ws `command-palette`, not listed) | 1.3G | 2026-10-11 01:43 | 9 hidden revs, all landed by description; referenced by a profile | profile probe (command-palette link) | ask |
| dshfiles-core-narrow | jj-ws | dshfiles (ws `core-narrow`, not listed) | 1.7G | 2026-10-13 10:29 | no (unlisted, @ empty); but referenced by a profile | profile optmem-full (11 links) | ask |
| dshfiles-history-repair | jj-ws | dshfiles (ws `history-repair`, listed) | 901M | 2026-10-12 10:49 | listed; 1 rev not on main (`workspace leaf`, incl. tooling/dsh-core/FORK.md) | - | ask |
| dshfiles-optmem-reliability | jj-ws | dshfiles (ws `optmem-reliability`, listed) | 1.7G | 2026-10-12 20:08 | listed; 2 revs not on main (`fix(optmem): route provider failures...`, `docs: audit fork-dependent capabilities`) | - | ask |
| dshfiles-pnpm-root | jj-ws | dshfiles (ws `pnpm-root`, listed) | 1.2G | 2026-10-13 01:29 | listed; 2 revs not on main (single-root pnpm workspace migration) | - | ask |
| dshfiles-threads/dshfiles-94a9c92d | jj-ws | dshfiles (ws `dshfiles-94a9c92d`, listed) | 28M | 2026-10-13 14:51 | no (listed, @ empty, 0 unique revs); still in DSH registry | DSH registry | ask |
| dshfiles-threads/dshfiles-bd3a657a | jj-ws | dshfiles (ws `dshfiles-bd3a657a`, listed) | 28M | 2026-10-13 14:04 | no (listed, @ empty, 0 unique revs); still in DSH registry | DSH registry | ask |
| home-infra-dsh-pi-runtime | jj-ws | home-infra (ws `dsh-pi-runtime`, listed) | 105M | 2026-10-06 03:10 | listed; 4 revs not in default (Pi DSH runtime) | - | ask |
| nixfiles-dsh-profile-preflight | jj-ws | nixfiles (ws `dsh-profile-preflight`, listed) | 1.6M | 2026-10-13 13:39 | listed; 1 rev not in default (`fix(dsh): guard web profile during runtime`), touched today | - | ask |
| nixfiles-dsh-profile-startup | jj-ws | nixfiles (ws `dsh-profile-startup`, listed) | 1.5M | 2026-10-13 13:39 | listed; 1 rev not in default (`fix(dsh): guard web profile during runtime`), touched today | - | ask |

Delete this file once every row is removed, archived or marked keep.
