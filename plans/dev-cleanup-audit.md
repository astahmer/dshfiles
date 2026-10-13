# ~/dev cleanup audit (2026-10-13)

Read-only audit. Nothing was deleted, moved, snapshotted or rewritten (all jj calls used `--ignore-working-copy`).

## Method

- **kind / store**: `.jj/repo` pointer file (`jj-ws`) or directory (`jj-root`); `.git` dir. Workspace name read from `.jj/working_copy/checkout`; "listed" = present in `jj workspace list` of the store.
- **size**: `du -sh`. **last touched**: newest file mtime, pruning `node_modules`, `dist`, `.git`, `.jj`.
- **unique work (jj)**: `(::<ws>@ ~ ::(present(main)|trunk()|remote_bookmarks())) ~ empty()`. For forgotten (unlisted) workspaces the `@` commit was resolved at the operation recorded in their checkout file (`jj --at-op`). Hidden revisions were matched against main by change id, then by description.
- **unsnapshotted edits**: files newer than `.jj/working_copy/tree_state`, plus on-disk files not tracked in `@` (generated `lib/`, `.features-gen/`, `test-results/`, `.cache/`, screenshots and build output were filtered out).
- **git**: `status --porcelain`, `stash list`, `log --branches --not --remotes`, local branches not contained in any remote branch.
- **references**: `~/.config/nixfiles` (= `~/dev/nixfiles`) modules/hosts, `~/.dsh/profiles/*/package.json` `link:` entries plus installed symlinks, `~/.dsh/storages/workspace.json`, and `lsof -a -d cwd` (all processes).

Important: `jj workspace forget` does not drop non-empty commits. They stay visible in the store. Removing a workspace directory only loses what is on disk and not yet snapshotted. "Hidden" revisions in unlisted workspaces were already abandoned or rewritten, and removing the directory does not change that.

## Summary

| recommendation | rows | size |
|---|---|---|
| safe to remove | 55 | 34.7 GB |
| archive first | 14 | 15.8 GB |
| ask | 49 | 57.7 GB |
| keep | 43 | 50.9 GB |

Not counted twice: child rows of `dshfiles-core-narrow-threads` are included in the container size. The `dshfiles-threads` container is kept, so its 18+7 removable children are counted on their own rows.

Notable risks:
- `dshfiles` local `main` is 1 commit ahead of `main@origin` (unpushed), and git shows 103 unpushed commits across local branches.
- The `dsh-core-rich-queue-edit` store (28 workspaces, ~50 GB) has no pushed copy. Its `origin` is upstream `deepseek-harness`, and it has no remote bookmarks. 34 own commits exist only here.
- `dsh-plugins` has no remote (109 revisions exist only locally).
- `~/.dsh/profiles/probe` links `~/dev/dshfiles-jujutsu-cache`, which no longer exists (broken link).
- 9 empty orphan heads in the dshfiles store, plus 3 non-empty orphan heads (`yvrxluwzntwv` 47 files, `yqsmquvurslp` dshx pin, `xwvklqlzyqly` comm-audit leaf). The non-empty ones are for **ask**, not abandon.
- Listed `dshfiles-threads/*` workspaces were touched today (up to 14:51). Confirm that no DSH thread still uses the retired jj-integration before forgetting them.

## Decision table

| path | kind | store | size | last touched | unique work | references | recommendation |
|---|---|---|---|---|---|---|---|
| dshfiles-ade | jj-ws | dshfiles (ws `ade-thread-provision`, not listed) | 987M | 2026-10-12 16:27 | no (unlisted, @ empty orphan `bae393cf`) | - | safe to remove |
| dshfiles-ade-ux | jj-ws | dshfiles (ws `ade-ux`, not listed) | 1.7G | 2026-10-12 19:26 | no (unlisted, @ empty, only generated files untracked) | - | safe to remove |
| dshfiles-agent-attention | jj-ws | dshfiles (ws `agent-attention`, not listed) | 1.5G | 2026-10-10 19:07 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-agent-communication-fix | jj-ws | dshfiles (ws `agent-communication-fix`, not listed) | 1.5G | 2026-10-11 01:43 | no (11 hidden revs, all landed by description) | - | safe to remove |
| dshfiles-agent-communication-observability-recovery | jj-ws | dshfiles (ws `agent-communication-observability-recovery`, not listed) | 1.4G | 2026-10-11 01:43 | no (11 hidden revs, all landed by description) | - | safe to remove |
| dshfiles-agent-session-history | jj-ws | dshfiles (ws `agent-session-history`, not listed) | 25M | 2026-10-10 19:07 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-agent-session-history-current | jj-ws | dshfiles (ws `agent-session-history-current`, not listed) | 25M | 2026-10-11 01:43 | no (8 hidden revs, all landed by description) | - | safe to remove |
| dshfiles-ai-failover | jj-ws | dshfiles (ws `ai-failover`, not listed) | 1.3G | 2026-10-10 19:07 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-consolidation | jj-ws | dshfiles (ws `consolidation`, not listed) | 1.6G | 2026-10-12 21:31 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-core-narrow-threads | plain |  | 56M | 2026-10-13 01:34 | container only | - | safe to remove |
| dshfiles-core-narrow-threads/dshfiles-core-narrow-0f366e5e | jj-ws | dshfiles (ws `dshfiles-core-narrow-0f366e5e`, not listed) | 28M | 2026-10-13 01:33 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-core-narrow-threads/dshfiles-core-narrow-30413344 | jj-ws | dshfiles (ws `dshfiles-core-narrow-30413344`, not listed) | 28M | 2026-10-13 01:34 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-core-repo-rule | jj-ws | dshfiles (ws `core-repo-rule`, not listed) | 25M | 2026-10-10 18:41 | no (1 hidden rev, landed by description) | - | safe to remove |
| dshfiles-dep-hygiene | jj-ws | dshfiles (ws `dep-hygiene`, not listed) | 1.7G | 2026-10-13 01:06 | no (unlisted, @ empty; 1 unsnapshotted tsbuildinfo) | - | safe to remove |
| dshfiles-integration-spine | jj-ws | dshfiles (ws `integration-spine-20261012`, not listed) | 4.3G | 2026-10-12 16:32 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-lkg | jj-ws | dshfiles (ws `lkg`, not listed) | 1.7G | 2026-10-12 19:51 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-release-candidate | jj-ws | dshfiles (ws `release-candidate`, not listed) | 1.7G | 2026-10-13 13:18 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-sidebar-attention-settings | jj-ws | dshfiles (ws `thread-attention-settings`, not listed) | 1.4G | 2026-10-11 01:43 | no (11 hidden revs, all landed by description) | - | safe to remove |
| dshfiles-spine-integration-20261011 | jj-ws | dshfiles (ws `spine-integration`, not listed) | 980M | 2026-10-11 20:38 | no (84 revs, all rewritten into main) | - | safe to remove |
| dshfiles-spine-rebuild | jj-ws | dshfiles (ws `spine-rebuild`, not listed) | 161M | 2026-10-11 22:58 | no (127 revs, all rewritten into main) | - | safe to remove |
| dshfiles-store-editor-fix | jj-ws | dshfiles (ws `store-editor-fix`, not listed) | 4.9G | 2026-10-12 15:26 | no (unlisted, @ empty orphan `3f378eb4`) | - | safe to remove |
| dshfiles-thread-archive-toast-final | jj-ws | dshfiles (ws `thread-archive-toast-final`, not listed) | 2.0G | 2026-10-12 14:16 | no (unlisted, @ empty; only generated .features-gen) | - | safe to remove |
| dshfiles-threads/dshfiles-09ed7083 | jj-ws | dshfiles (ws `dshfiles-09ed7083`, not listed) | 28M | 2026-10-12 19:18 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-221d06c1 | jj-ws | dshfiles (ws `dshfiles-221d06c1`, listed) | 28M | 2026-10-13 13:15 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-2518de26 | jj-ws | dshfiles (ws `dshfiles-2518de26`, listed) | 28M | 2026-10-12 17:40 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-3139eb19 | jj-ws | dshfiles (ws `dshfiles-3139eb19`, not listed) | 28M | 2026-10-12 19:19 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-34f3a9ee | jj-ws | dshfiles (ws `dshfiles-34f3a9ee`, not listed) | 28M | 2026-10-12 19:28 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-4aa21270 | jj-ws | dshfiles (ws `dshfiles-4aa21270`, listed) | 28M | 2026-10-13 13:44 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-4c9f7432 | jj-ws | dshfiles (ws `dshfiles-4c9f7432`, listed) | 28M | 2026-10-12 17:41 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-4d7101f5 | jj-ws | dshfiles (ws `dshfiles-4d7101f5`, not listed) | 28M | 2026-10-12 19:18 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-58cfc8e7 | jj-ws | dshfiles (ws `dshfiles-58cfc8e7`, listed) | 28M | 2026-10-13 13:44 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-6928173d | jj-ws | dshfiles (ws `dshfiles-6928173d`, not listed) | 28M | 2026-10-13 01:35 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-707ac8ac | jj-ws | dshfiles (ws `dshfiles-707ac8ac`, listed) | 28M | 2026-10-13 01:21 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-72876684 | jj-ws | dshfiles (ws `dshfiles-72876684`, listed) | 28M | 2026-10-12 17:37 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-7d55906b | jj-ws | dshfiles (ws `dshfiles-7d55906b`, listed) | 28M | 2026-10-13 12:59 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-801bffec | jj-ws | dshfiles (ws `dshfiles-801bffec`, not listed) | 28M | 2026-10-12 19:19 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-8dad1a6c | jj-ws | dshfiles (ws `dshfiles-8dad1a6c`, not listed) | 28M | 2026-10-12 19:19 | no (unlisted, @ empty, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-9a4f0d89 | jj-ws | dshfiles (ws `dshfiles-9a4f0d89`, listed) | 28M | 2026-10-13 11:24 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-a271d88f | jj-ws | dshfiles (ws `dshfiles-a271d88f`, listed) | 28M | 2026-10-13 10:40 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-a3f4245b | jj-ws | dshfiles (ws `dshfiles-a3f4245b`, listed) | 28M | 2026-10-12 17:41 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-a8c2ba1d | jj-ws | dshfiles (ws `dshfiles-a8c2ba1d`, listed) | 28M | 2026-10-13 13:11 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-b6857ee4 | jj-ws | dshfiles (ws `dshfiles-b6857ee4`, listed) | 28M | 2026-10-12 17:37 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-d7f4b056 | jj-ws | dshfiles (ws `dshfiles-d7f4b056`, listed) | 28M | 2026-10-12 17:37 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-e0bccf48 | jj-ws | dshfiles (ws `dshfiles-e0bccf48`, listed) | 28M | 2026-10-13 13:15 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-e637bc32 | jj-ws | dshfiles (ws `dshfiles-e637bc32`, listed) | 28M | 2026-10-13 13:15 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-f044c54b | jj-ws | dshfiles (ws `dshfiles-f044c54b`, listed) | 28M | 2026-10-12 17:41 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-threads/dshfiles-fd375641 | jj-ws | dshfiles (ws `dshfiles-fd375641`, listed) | 28M | 2026-10-13 13:11 | no (listed, @ empty, 0 unique revs, nothing untracked) | - | safe to remove |
| dshfiles-unified | jj-ws | dshfiles (ws `dshfiles-unified`, not listed) | 1.2G | 2026-10-07 22:03 | no (unlisted, @ landed) | - | safe to remove |
| dshfiles-unify-20261010 | jj-ws | dshfiles (ws `unify-20261010`, not listed) | 26M | 2026-10-10 19:14 | no (unlisted, @ landed) | - | safe to remove |
| dshfiles-workspace-cleanup | jj-ws | dshfiles (ws `workspace-cleanup`, not listed) | 1.7G | 2026-10-12 20:31 | no (unlisted, @ empty) | - | safe to remove |
| dshfiles-workspace-folder-picker-browser-latest | jj-ws | dshfiles (ws `workspace-folder-picker-browser-latest`, not listed) | 1.8G | 2026-10-12 15:54 | no (unlisted, @ empty; only generated .features-gen) | - | safe to remove |
| effect | git | own (git) | 212M | 2026-08-23 18:02 | no (git clone; branch pushed to `fork`; stale worktree entry; copy at ~/.references/effect) | - | safe to remove |
| pandwind-adversarial-fixes-2026-10-08 | jj-ws | pandwind (ws `adversarial-fixes-2026-10-08`, listed) | 114M | 2026-10-09 21:22 | no (listed, 0 unique revs; untracked = generated playground/.astro/.d.ts) | - | safe to remove |
| pandwind-adversarial-review-2026-10-08 | jj-ws | pandwind (ws `adversarial-review-2026-10-08`, listed) | 72M | 2026-10-09 17:37 | no (listed, 0 unique revs, nothing untracked) | - | safe to remove |
| particle-gate | plain |  | 0B | - | no (empty directory) | - | safe to remove |
| _archived-dsh-default-workspace | jj-root+git | own | 439M | 2026-10-03 19:38 | no remote; 3 revs exist only here | - | archive first |
| css-in-js-bench | git | own (git) | 90M | 2026-09-22 21:36 | git: 7 unpushed commits (all also in css-in-js-bench-rerun-20260923) + 7 modified files + 3 untracked dbg*.mjs | - | archive first |
| dsh-plugins-ts | jj-ws | dsh-plugins (ws `ts-migration`, not listed) | 2.3M | 2026-10-03 09:38 | forgotten workspace `ts-migration`; its 2 TS-migration revs are abandoned; 83 untracked .js sources only on disk | - | archive first |
| dshfiles-agent-comm-overhaul | jj-ws | dshfiles (ws `agent-communication-overhaul`, not listed) | 1.5G | 2026-10-11 17:30 | unlisted; hidden non-empty @ (13 files, agent-communication) not found on main | - | archive first |
| dshfiles-agent-communication-observability | jj-ws | dshfiles (ws `agent-communication-observability`, not listed) | 1.3G | 2026-10-10 21:01 | 7 unsnapshotted edits (plans + agent-communication src) + untracked host-request.ts/.test.ts; @ commit hidden | - | archive first |
| dshfiles-history-unify | jj-ws | dshfiles (ws `history-unify`, not listed) | 26M | 2026-10-11 02:12 | unlisted; 2 hidden undescribed revs (e2e support, panel) not found on main | - | archive first |
| dshfiles-jj-isolation | jj-root+git | own | 41M | 2026-10-12 14:30 | own jj store (remote = ../dshfiles); 13/14 revs in dshfiles; @ `wip` holds uncommitted thread-provision.ts + migrate.mjs edits | - | archive first |
| dshfiles-plugin-e2e-coverage | jj-ws | dshfiles (ws `plugin-e2e-coverage`, not listed) | 1.7G | 2026-10-10 18:50 | unlisted; hidden @ (12 files, dshx.features.json) not found on main | - | archive first |
| dshfiles-plugin-e2e-coverage-resume | jj-ws | dshfiles (ws `plugin-e2e-coverage-resume`, not listed) | 1.7G | 2026-10-11 03:34 | unlisted; 27 hidden revs, 26 landed; hidden @ (17 files, plans + features) not found | - | archive first |
| dshfiles-queue-rich-edit | jj-ws | dshfiles (ws `queue-rich-edit`, not listed) | 1.2G | 2026-10-10 17:29 | unlisted; hidden @ (queue-reorder client, 3 files) not found on main | - | archive first |
| dshfiles-roadmap-continuation | jj-ws | dshfiles (ws `roadmap-continuation`, not listed) | 1.5G | 2026-10-07 12:04 | unlisted; 65 hidden revs, 62 landed; 3 roadmap-doc revs not found | - | archive first |
| dshfiles-software-roadmap-core | jj-ws | dshfiles (ws `software-roadmap-core`, not listed) | 1.7G | 2026-10-06 00:51 | unlisted; 16 hidden revs, 14 landed; `feat(prompt-stash)` + roadmap doc not found by description | - | archive first |
| dshfiles-software-roadmap-resume | jj-ws | dshfiles (ws `software-roadmap-resume`, not listed) | 4.6G | 2026-10-07 03:40 | unlisted; 55 hidden revs, 53 landed; 2 roadmap-doc revs not found | - | archive first |
| dshfiles-workspace-folder-picker-browser | jj-ws | dshfiles (ws `workspace-folder-picker-browser`, not listed) | 27M | 2026-10-11 22:30 | unlisted; 104 revs landed; 2 hidden (thread-sidebar checkpoint, lockfile) not found | - | archive first |
| agents-user-preferences | jj-ws | agents (ws `user-preferences`, listed) | 184K | 2026-10-11 03:08 | listed; 1 rev not in default (`docs(agents): inline durable user preferences`) | - | ask |
| css-in-js-arena-createcss-cx-20260925 | jj-ws | css-in-js-arena-rerun-20260923 (ws `codex-createcss-cx-20260925`, listed) | 32M | 2026-09-26 11:36 | listed; 3-7 own revs not in default (survive `forget`); untracked = builds + screenshots | - | ask |
| css-in-js-arena-css-primary-20260924 | jj-ws | css-in-js-arena-rerun-20260923 (ws `codex-css-primary-20260924`, listed) | 32M | 2026-09-25 03:19 | listed; 3-7 own revs not in default (survive `forget`); untracked = builds + screenshots | - | ask |
| css-in-js-arena-plan-completion-20260924 | jj-ws | css-in-js-arena-rerun-20260923 (ws `codex-plan-completion-20260924`, listed) | 31M | 2026-09-24 20:28 | listed; 3-7 own revs not in default (survive `forget`); untracked = builds + screenshots | - | ask |
| css-in-js-arena-rerun-20260923 | jj-root+git | own | 45M | 2026-09-25 13:44 | 2 own revs not pushed (third-party benchmark repo) | - | ask |
| css-in-js-bench-css-primary-20260924 | jj-ws | css-in-js-bench-rerun-20260923 (ws `codex-css-primary-20260924`, listed) | 127M | 2026-09-25 03:12 | listed; 3-9 own revs not in default (survive `forget`); untracked = generated BENCHMARK reports/assets | - | ask |
| css-in-js-bench-plan-completion-20260924 | jj-ws | css-in-js-bench-rerun-20260923 (ws `codex-plan-completion-20260924`, listed) | 126M | 2026-09-24 19:03 | listed; 3-9 own revs not in default (survive `forget`); untracked = generated BENCHMARK reports/assets | - | ask |
| css-in-js-bench-rerun-20260923 | jj-root+git | own | 169M | 2026-09-23 22:11 | 9 own revs + 7 unpushed git commits (scratch/pandwind-buildtime-lane) | - | ask |
| css-in-js-bench-rerun-20260926 | jj-ws | css-in-js-bench-rerun-20260923 (ws `codex-bench-rerun-20260926`, listed) | 133M | 2026-09-26 17:13 | listed; 3-9 own revs not in default (survive `forget`); untracked = generated BENCHMARK reports/assets | - | ask |
| dsh-core-activity-alpha2-test | jj-ws | dsh-core-rich-queue-edit (ws `activity-alpha2`, listed) | 2.3G | 2026-10-10 20:14 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-activity-metadata | jj-ws | dsh-core-rich-queue-edit (ws `activity-metadata`, listed) | 2.1G | 2026-10-10 20:23 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-activity-rc2 | jj-ws | dsh-core-rich-queue-edit (ws `activity-rc2`, listed) | 2.2G | 2026-10-11 00:28 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-activity-rc2-backport | jj-ws | dsh-core-rich-queue-edit (ws `activity-rc2-backport`, listed) | 148M | 2026-10-10 22:11 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-agent-session-history | jj-ws | dsh-core-rich-queue-edit (ws `agent-session-history-core`, listed) | 2.0G | 2026-10-12 00:24 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-ask-question-submit-mode | jj-ws | dsh-core-rich-queue-edit (ws `ask-question-submit-mode`, listed) | 2.1G | 2026-10-11 04:06 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-ask-question-submit-mode-integration | jj-ws | dsh-core-rich-queue-edit (ws `ask-question-submit-mode-integration`, listed) | 148M | 2026-10-11 04:15 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-directory-browser-scope | jj-ws | dsh-core-rich-queue-edit (ws `workspace-directory-browser`, listed) | 2.2G | 2026-10-12 03:02 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-directory-picker-config | jj-ws | dsh-core-rich-queue-edit (ws `directory-picker-config`, listed) | 2.0G | 2026-10-11 04:41 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-file-reference-integration | jj-ws | dsh-core-rich-queue-edit (ws `file-reference-integration`, listed) | 2.2G | 2026-10-11 20:29 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-file-reference-opening | jj-ws | dsh-core-rich-queue-edit (ws `file-reference-opening`, listed) | 2.1G | 2026-10-11 03:29 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-model-reasoning | jj-ws | dsh-core-rich-queue-edit (ws `model-reasoning`, listed) | 2.5G | 2026-10-11 15:58 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-palette-search | jj-ws | dsh-core-rich-queue-edit (ws `palette-search`, listed) | 148M | 2026-10-11 01:21 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-rich-queue-api | jj-ws | dsh-core-rich-queue-edit (ws `queue-rich-api`, listed) | 2.0G | 2026-10-09 16:38 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-rich-queue-client | jj-ws | dsh-core-rich-queue-edit (ws `queue-rich-client`, listed) | 2.0G | 2026-10-09 17:10 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-session-deeplinks | jj-ws | dsh-core-rich-queue-edit (ws `session-deeplinks`, listed) | 2.0G | 2026-10-11 04:19 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-session-error-projection | jj-ws | dsh-core-rich-queue-edit (ws `session-error-projection`, listed) | 2.0G | 2026-10-11 16:16 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-settings-native-integration | jj-ws | dsh-core-rich-queue-edit (ws `settings-native-integration`, listed) | 2.1G | 2026-10-11 21:33 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-settings-native-verify-20261011 | jj-ws | dsh-core-rich-queue-edit (ws `settings-native-verify-20261011`, listed) | 2.1G | 2026-10-11 23:23 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-settings-search-native | jj-ws | dsh-core-rich-queue-edit (ws `settings-search-native`, listed) | 2.2G | 2026-10-11 16:35 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-action-customization | jj-ws | dsh-core-rich-queue-edit (ws `thread-action-customization`, listed) | 2.0G | 2026-10-11 16:01 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-action-overflow | jj-ws | dsh-core-rich-queue-edit (ws `thread-action-overflow`, listed) | 2.1G | 2026-10-11 21:30 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-mention | jj-ws | dsh-core-rich-queue-edit (ws `thread-mention-agent-context`, listed) | 2.1G | 2026-10-11 16:29 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-park-fix | jj-ws | dsh-core-rich-queue-edit (ws `thread-park-fix`, listed) | 148M | 2026-10-11 02:30 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-read-auto-settle | jj-ws | dsh-core-rich-queue-edit (ws `thread-read-auto-settle`, listed) | 148M | 2026-10-11 04:11 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-search | jj-ws | dsh-core-rich-queue-edit (ws `thread-search`, listed) | 2.2G | 2026-10-11 02:49 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dsh-core-thread-search-concurrency | jj-ws | dsh-core-rich-queue-edit (ws `thread-search-concurrency`, listed) | 2.0G | 2026-10-11 21:58 | listed; own revs live only in this unpushed store (survive `forget`); untracked = build output | - | ask |
| dshfiles-agent-comm-audit | jj-ws | dshfiles (ws `agent-comm-audit`, listed) | 1.7G | 2026-10-12 10:38 | listed; 1 rev not on main (`workspace leaf`: docs/jj-history-consolidation.md) | - | ask |
| dshfiles-chrome-profile-debug | jj-ws | dshfiles (ws `chrome-profile-debug`, listed) | 990M | 2026-10-12 18:29 | listed; 1 rev not on main (`fix(web): share one EventSource per origin`, 497 lines) | profile web (shared-streams link) | ask |
| dshfiles-command-palette | jj-ws | dshfiles (ws `command-palette`, not listed) | 1.3G | 2026-10-11 01:43 | 9 hidden revs, all landed by description; referenced by a profile | profile probe (command-palette link) | ask |
| dshfiles-core-narrow | jj-ws | dshfiles (ws `core-narrow`, not listed) | 1.7G | 2026-10-13 10:29 | no (unlisted, @ empty); but referenced by a profile | profile optmem-full (11 links) | ask |
| dshfiles-history-repair | jj-ws | dshfiles (ws `history-repair`, listed) | 901M | 2026-10-12 10:49 | listed; 1 rev not on main (`workspace leaf`, incl. tooling/dsh-core/FORK.md) | - | ask |
| dshfiles-optmem-reliability | jj-ws | dshfiles (ws `optmem-reliability`, listed) | 1.7G | 2026-10-12 20:08 | listed; 2 revs not on main (`fix(optmem): route provider failures...`, `docs: audit fork-dependent capabilities`) | - | ask |
| dshfiles-pnpm-root | jj-ws | dshfiles (ws `pnpm-root`, listed) | 1.2G | 2026-10-13 01:29 | listed; 2 revs not on main (single-root pnpm workspace migration) | - | ask |
| dshfiles-threads/dshfiles-94a9c92d | jj-ws | dshfiles (ws `dshfiles-94a9c92d`, listed) | 28M | 2026-10-13 14:51 | no (listed, @ empty, 0 unique revs); still in DSH registry | DSH registry | ask |
| dshfiles-threads/dshfiles-bd3a657a | jj-ws | dshfiles (ws `dshfiles-bd3a657a`, listed) | 28M | 2026-10-13 14:04 | no (listed, @ empty, 0 unique revs); still in DSH registry | DSH registry | ask |
| dshfiles-threads/dshfiles-c989a897 | jj-ws | dshfiles (ws `dshfiles-c989a897`, listed) | 28M | 2026-10-13 14:05 | no (listed, @ empty, 0 unique revs); still in DSH registry | DSH registry | ask |
| home-infra-dsh-pi-runtime | jj-ws | home-infra (ws `dsh-pi-runtime`, listed) | 105M | 2026-10-06 03:10 | listed; 4 revs not in default (Pi DSH runtime) | - | ask |
| nixfiles-dsh-profile-preflight | jj-ws | nixfiles (ws `dsh-profile-preflight`, listed) | 1.6M | 2026-10-13 13:39 | listed; 1 rev not in default (`fix(dsh): guard web profile during runtime`), touched today | - | ask |
| nixfiles-dsh-profile-startup | jj-ws | nixfiles (ws `dsh-profile-startup`, listed) | 1.5M | 2026-10-13 13:39 | listed; 1 rev not in default (`fix(dsh): guard web profile during runtime`), touched today | - | ask |
| agents | jj-root+git | own | 2.6M | 2026-10-11 23:58 | 7 revs not pushed | - | keep |
| astahmer.dev | jj-root+git | own | 103M | 2026-08-27 13:29 | 2 revs not pushed | - | keep |
| atdocs | jj-root+git | own | 3.1G | 2026-09-28 01:36 | 16 revs not pushed; git main ahead (18) | procs (zsh) | keep |
| bb-plugins | jj-root+git | own | 655M | 2026-10-05 12:00 | 0 unique | DSH registry | keep |
| cluster-ui | jj-root+git | own | 175M | 2026-10-05 12:29 | 7 revs not pushed | procs (zsh) | keep |
| dadabase | jj-root+git | own | 5.9G | 2026-10-12 14:45 | 1 rev + 1 git stash + branch wip/triple-features | procs (herdr, zsh) | keep |
| datasoup-blacksoup | jj-root+git | own | 4.2M | 2026-10-07 12:04 | 0 unique | - | keep |
| deps | plain |  | 197M | 2026-10-05 03:07 | hand-written deps/skepsis | nixfiles ($HOME/dev/deps, deps/skepsis/cli.ts) | keep |
| dsh-core-ade-hook | jj-ws | dsh-core-rich-queue-edit (ws `ade-workspace-hook`, listed) | 255M | 2026-10-13 14:00 | active workspace (touched today); listed; 2 own revs in unpushed store | - | keep |
| dsh-core-rich-queue-edit | jj-root+git | own | 2.3G | 2026-10-10 20:48 | store root; 34 own revs exist nowhere else (never pushed) | - | keep |
| dsh-plugins | jj-root | own | 127M | 2026-10-03 13:19 | no remote at all: 109 revs exist only here | DSH registry | keep |
| dshfiles | jj-root+git | own | 5.1G | 2026-10-13 16:05 | local `main` 1 commit ahead of main@origin; 22 non-empty revs outside main/remotes repo-wide; 10 unsnapshotted test-evidence files | nixfiles (profiles/web); profiles adelph, probe, scratch-jj, vanilla, web; DSH registry; procs (node, pnpm, tsc, jj, zsh) | keep |
| dshfiles-catalog-journeys | jj-ws | dshfiles (ws `catalog-journeys`, listed) | 1.6G | 2026-10-13 16:20 | active workspace (user); untracked/unsnapshotted edits in progress | procs (node, headless, pnpm, zsh) | keep |
| dshfiles-host-picker | jj-ws | dshfiles (ws `host-picker`, listed) | 1.6G | 2026-10-13 16:25 | active workspace (user); 6 unsnapshotted src files + 3 untracked tests | - | keep |
| dshfiles-optmem-bench | jj-ws | dshfiles (ws `optmem-bench`, listed) | 1.6G | 2026-10-13 16:18 | active workspace (user); untracked/unsnapshotted edits in progress | procs (claude, node, zsh) | keep |
| dshfiles-repo-cleanup | jj-ws | dshfiles (ws `repo-cleanup`, listed) | 1.7G | 2026-10-13 15:26 | active workspace (user); untracked/unsnapshotted edits in progress | - | keep |
| dshfiles-threads | plain |  | 789M | 2026-10-13 14:51 | container; keep while the 3 registry-referenced threads stay | - | keep |
| emi-healthfit | jj-root+git | own | 347M | 2026-10-08 15:41 | 4 revs not pushed | procs (zsh) | keep |
| emilint | jj-root+git | own | 2.6M | 2026-09-30 21:53 | 0 unique | - | keep |
| emisoup | jj-root+git | own | 4.7G | 2026-10-10 22:07 | 96 revs not pushed | DSH registry; procs (zsh) | keep |
| fleetdiff | jj-root+git | own | 991M | 2026-08-25 17:38 | 12 revs not pushed; ignored .spike/ | procs (zsh) | keep |
| formula.now | jj-root+git | own | 86M | 2026-08-29 00:34 | 4 revs not pushed | - | keep |
| home-infra | jj-root+git | own | 87M | 2026-09-26 00:00 | 0 unique | procs (zsh) | keep |
| ideas | jj-root+git | own | 1.6M | 2026-08-25 00:32 | 0 unique | - | keep |
| itwas | jj-root+git | own | 1.4G | 2026-10-05 12:29 | 10 revs not pushed | procs (zsh) | keep |
| jjw | jj-root+git | own | 7.1M | 2026-10-02 12:28 | 5 revs not pushed | - | keep |
| nixfiles | jj-root+git | own | 362M | 2026-10-13 16:01 | important | ~/.config/nixfiles symlink; DSH registry; procs (nixd, tsc, node, zsh) | keep |
| nixfiles-dsh-web | jj-ws | nixfiles (ws `dsh-web-plain`, listed) | 1.4M | 2026-10-13 16:05 | listed; 1 rev not in default; running process | procs (nix, tail, zsh) | keep |
| panda | jj-root+git | own | 870M | 2026-08-27 21:18 | 5 own revs not pushed (fork of chakra-ui/panda) | - | keep |
| pandwind | jj-root+git | own | 3.2G | 2026-10-10 01:00 | 0 unique; 2 local recovery bookmarks not on remote | DSH registry; procs (node) | keep |
| pandwind-shadcn | jj-root+git | own | 2.1M | 2026-09-06 14:20 | no remote; 3 revs only here | - | keep |
| paper-clone | jj-root+git | own | 623M | 2026-09-12 21:45 | 9 revs not pushed | - | keep |
| pds-cloudflare | jj-root+git | own | 284K | 2026-08-25 00:51 | no remote; `main` only here | - | keep |
| quoi-encore.fr | jj-root+git | own | 3.0M | 2026-09-07 18:58 | 1 rev not pushed | procs (zsh) | keep |
| secret-cli | jj-root+git | own | 888K | 2026-09-30 19:53 | 1 rev not pushed | - | keep |
| shiftshift-tauri | jj-root+git | own | 3.7G | 2026-10-13 15:14 | 0 unique; touched today | - | keep |
| tokitoki | jj-root+git | own | 777M | 2026-10-02 00:38 | 8 revs not pushed | - | keep |
| typed-openapi | jj-root+git | own | 361M | 2026-09-25 22:17 | 15 revs + 3 unpushed branches | - | keep |
| unbullshitify | jj-root+git | own | 2.8M | 2026-08-24 13:40 | 0 unique revs; ignored infra state packages/infra/.alchemy/ | procs (zsh) | keep |
| visualjj-range-diff-helper | jj-root+git | own | 633M | 2026-09-10 16:47 | 27 revs + branch feat/single-file-diff not pushed | - | keep |
| vitrine-app | jj-root+git | own | 1.2G | 2026-10-05 12:29 | 14 revs not pushed | procs (zsh) | keep |
| welii | jj-root+git | own | 6.3G | 2026-10-13 16:32 | important; 213 own revs not on remote (welii-bite workspace has no root path) | procs (many) | keep |
| x-to-bsky | jj-root+git | own | 36M | 2026-10-10 23:00 | 1 rev not pushed (fork of semnil/x-to-bsky) | DSH registry; procs (zsh) | keep |

## Safe removal script (NOT RUN)

> Not executed. It covers the **safe to remove** rows only. Review it before running. It assumes nothing changed since 2026-10-13 16:30.

```bash
set -euo pipefail
cd ~/dev/dshfiles

# 1. Listed dshfiles thread workspaces: forget, then delete the directory
for h in 221d06c1 2518de26 4aa21270 4c9f7432 58cfc8e7 707ac8ac 72876684 7d55906b 9a4f0d89 a271d88f a3f4245b a8c2ba1d b6857ee4 d7f4b056 e0bccf48 e637bc32 f044c54b fd375641; do
  jj workspace forget "dshfiles-$h"
  rm -rf ~/dev/dshfiles-threads/"dshfiles-$h"
done

# 2. Unlisted (already forgotten) dshfiles workspaces: delete the directory only
for h in 09ed7083 3139eb19 34f3a9ee 4d7101f5 6928173d 801bffec 8dad1a6c; do
  rm -rf ~/dev/dshfiles-threads/"dshfiles-$h"
done
rm -rf ~/dev/dshfiles-core-narrow-threads
for d in ade ade-ux agent-attention agent-communication-fix agent-communication-observability-recovery \
         agent-session-history agent-session-history-current ai-failover consolidation core-repo-rule dep-hygiene \
         integration-spine lkg release-candidate sidebar-attention-settings spine-integration-20261011 spine-rebuild \
         store-editor-fix thread-archive-toast-final unified unify-20261010 workspace-cleanup \
         workspace-folder-picker-browser-latest; do
  rm -rf ~/dev/"dshfiles-$d"
done

# 3. Empty orphan revisions in the dshfiles store (no children, no bookmark, not any workspace @)
jj log -r 'e00df0f7bd69 | da3ad2be9d43 | 9c59f35cfd6e | bae393cf9532 | 3f378eb44bdd | 6bd486fc9e03 | 54e999839944 | 53eb7e3a433c | 3d0984200fe6' \
  -T 'commit_id.short() ++ " " ++ if(empty, "empty", "NOT-EMPTY") ++ "\n"'   # verify all show "empty"
jj abandon 'e00df0f7bd69 | da3ad2be9d43 | 9c59f35cfd6e | bae393cf9532 | 3f378eb44bdd | 6bd486fc9e03 | 54e999839944 | 53eb7e3a433c | 3d0984200fe6'
# step 1 may leave more empty heads behind; list them and review before abandoning:
jj log -r '(heads(mutable()) & empty()) ~ working_copies() ~ bookmarks()'

# 4. pandwind side workspaces (0 unique revisions, only generated files on disk)
cd ~/dev/pandwind
jj workspace forget adversarial-fixes-2026-10-08 adversarial-review-2026-10-08
rm -rf ~/dev/pandwind-adversarial-fixes-2026-10-08 ~/dev/pandwind-adversarial-review-2026-10-08

# 5. Plain leftovers
rmdir ~/dev/particle-gate                 # empty directory
rm -rf ~/dev/effect                       # upstream clone; branch pushed to `fork`; ~/.references/effect remains
```
