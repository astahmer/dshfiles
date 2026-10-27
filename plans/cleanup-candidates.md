# Cleanup candidates

Evidence gathered 2026-10-27: `knip` (files, exports, dependencies), profile membership
(`profiles/web/package.json` and `~/.dsh/profiles/*`), references across the repo, and plan
status lines. Agent tool-usage counts only cover agent calls, not UI use, so nothing here is
judged unused from analytics alone.

Resume here: get decisions on section B, then delete section A in one revision per item.

## A. Delete (clear evidence)

| #   | What                                                                                                                                                                                                                                          | Evidence                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A1  | Tracked patch leftovers: `plugins/@dshfiles/jujutsu/src/{chat-reference-overlay.tsx,core.ts,host.ts,session-project-path.ts}.orig`, `session-project-path.ts.rej`, `plugins/@dshfiles/thread-sidebar/src/{client.tsx,sidebar-shell.tsx}.orig` | Merge debris, nothing imports them                                                                        |
| A2  | Unused dependencies: `@deepseek-ai/dsh-client-ui-session` (agent-preset), `mime-types` and `zod` (session-controller)                                                                                                                         | knip. Also add the unlisted `@deepseek-ai/dsh-session-persistence-jsonl` used by session-controller tests |
| A3  | Finished plans never retired: `plans/global-dock` ("closed 2026-10-25"), `plans/session-search.md` ("delivered and verified")                                                                                                                 | Run `complete-plan` on each                                                                               |
| A4  | Duplicate plans: `plans/agent-session-history.md` + `plans/agent-session-history/`; `plans/self-improve/` + `plans/self-improve-2026-10/`                                                                                                     | Merge each pair                                                                                           |
| A5  | `scripts/fff-bench-dsh.ts`                                                                                                                                                                                                                    | No reference anywhere                                                                                     |
| A6  | 347 unused exports, largest clusters: chat fork (`ContextBody` sub-bodies, `StatsPills` helpers, conversation-node definitions), annotations schemas, agents `MAX_*` constants                                                                | knip `--include exports`. Keep exports in vendored native forks if upstream diffing matters               |

## B. Probably useless (needs a decision)

| #   | What                                                                                                                                                                                                    | Evidence                                             | Options                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| B7  | Plugins built but not shipped to `web`: `agent-preset`, `model-selection` (native forks, listed active in `docs/native-forks.md`), `loopback-access`, `tool-search`                                     | Only the `probe` profile loads them                  | Promote to `web`, or delete                |
| B8  | `/goto` in `sidebar-commands`                                                                                                                                                                           | The command palette already lists panels and threads | Keep only if the slash entry point matters |
| B9  | "Proposed, nothing implemented" plans: `host-loop-freezes` (10-18), `slot-assembly-crash-safety` (10-19), `hmr-compat-gate` (10-23), `workbench-main` (10-25), `shared-account-pool.md` (research only) | Status lines                                         | Turn into backlog items, delete the files  |
| B10 | Stalled "in progress" plans: `agent-session-observability` (10-14), `async-agent-questions.md` (10-15), `pulls-review` (10-17), `backlog`, `e2e-speed`, `fff-search` (10-19)                            | Last touched over a week ago                         | Finish or drop                             |
| B11 | `apps/desktop` (Electron wrapper)                                                                                                                                                                       | Runs in `check:green`; no sign of use                | Delete, or move out of `check:green`       |
| B12 | `reference-repos.md` at the repo root                                                                                                                                                                   | One entry                                            | Move to `docs/` or the backlog             |

## C. Checked and needed

- `credential-port`, `optmem-core`, `project-folder-picker`, `session-source-port`, `plugin-ui`: libraries with dependents.
- knip found no unused files.
- Workbench and chat-focus page globals: still in use (see `plans/opencode-parity.md` A14).
