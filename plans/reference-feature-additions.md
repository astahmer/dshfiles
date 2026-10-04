# Reference feature additions plan

## Context

Survey date: 2026-10-05. Scope: useful product behavior from T3 Code,
OpenCode 2, and BB, compared with our existing plugins, the installed DSH
runtime, and available community plugins. This is an investigation and phased
plan; no plugin was installed, enabled, or changed for this survey.

The recommendation is to improve the daily coding loop first: find past work,
review changes reliably, set drafts aside, and understand delegated work. Adopt
compatible community implementations where they cover the actual need. Keep
filesystem isolation, conversation rollback, provider execution, and browser
ownership separate from presentation features.

### Evidence and limits

| Reference | Inspected baseline | Evidence |
|---|---|---|
| T3 Code | `pingdotgg/t3code@efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448`, upstream main fetched on survey date | Source archive: contracts, web feature modules, server services, user and orchestration documentation. The old installed Alpha app is 0.0.36; it is not the baseline for current feature claims. |
| OpenCode2 | Installed Nix package 2.0.20; matching upstream tag `v2.0.20`, commit `84c9be93a56304a108f1a22df0c5d62c26d5b6ca` | Core service contracts and app session commands, review, context, terminal, and request modules. This is `anomalyco/opencode`, not one of the unrelated repositories named `opencode2`. |
| BB | Installed `bb.app` / `bb-app` 0.44.0 | Installed CLI command index, thread-operation and creation references, plugin API index; local `../bb-plugins` behavior and implementation. No private conversations, credentials, or databases read. |
| DSH | Actual executable resolves `@deepseek-ai/dsh@0.2.0-rc.2` | Installed declarations and implementation for Session, Agent, SubagentRuntime, WorkspaceRegistry, ScheduleService, SessionQueryEngine, workspace changes, skills, input, references, and sidebar tabs. |
| Our plugins | Working checkout at survey time | Plugin READMEs and focused source outlines; existing customization, async questions, desktop, and boot integrity plans. Presence of source is not a runtime acceptance claim. |
| Marketplace | `awesome-dsh-plugin.com/plugins.json`, reported updated 2026-10-01, 4,412 entries | Whole catalog searched across relevant feature terms; published package archives inspected for shortlisted candidates. Counts, stars, and descriptions are discovery aids, not adoption evidence. |

`dsh --profile web --dump-config` produced a composed tree containing
`session-query-sqlite`, but also warned that patches target missing
`llm-openai-codex` and `preset-standard:tool-ask-user` entries. Do not infer
successful boot or active feature behavior from that dump. Resolve composition
warnings before combined runtime acceptance. The command used the installed
official fnm Node 22.23.3; the ambient shell had Node 24.20.0, which differs
from this repository's pin.

No DSH runtime interaction or comparative performance benchmark was run.
The T3 collaborative browser opened and navigated to the marketplace, but its
snapshot tool failed twice with `PreviewAutomationExecutionError`; no browser
acceptance is claimed. The source survey is broad, not proof that every feature
works on this profile. Each proposed implementation has a probe gate below.

### Source index

These pinned paths make the feature matrix reproducible without depending on
temporary survey files.

| ID | Source |
|---|---|
| T1 | [T3 composer behavior](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/docs/user/composer.md), `apps/web/src/promptStashStore.ts`, and `packages/contracts/src/composerContext.ts` at the same revision |
| T2 | [T3 thread sidebar](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/docs/user/thread-sidebar.md) |
| T3 | [T3 source control](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/docs/user/source-control.md), `packages/contracts/src/review.ts`, `threadPullRequest.ts`, and `apps/server/src/orchestration-v2/pullRequestWatch.ts` |
| T4 | [T3 delegation contract](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/docs/orchestration-v2/orchestrator-mcp-server.md) and `packages/contracts/src/orchestratorMcp.ts` |
| T5 | [T3 provider capabilities](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/docs/orchestration-v2/provider-capability-system.md), `provider-switching-and-context.md`, and `feature-lifecycles.md` |
| T6 | [T3 scheduler contract](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/packages/contracts/src/scheduledTask.ts) and `apps/server/src/scheduledTasks/ScheduledTaskService.ts` |
| T7 | [T3 browser automation contract](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/packages/contracts/src/previewAutomation.ts), `preview.ts`, and `apps/web/src/lib/previewAnnotation.ts` |
| T8 | [T3 SnapShots](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/docs/user/snap-shot.md), `terminal.md`, `usage.md`, `remote-access.md`, and `mobile-notifications.md` |
| O1 | [OpenCode2 session commands](https://github.com/anomalyco/opencode/blob/84c9be93a56304a108f1a22df0c5d62c26d5b6ca/packages/app/src/session/commands/use-session-commands.tsx) |
| O2 | [OpenCode2 context inspector](https://github.com/anomalyco/opencode/blob/84c9be93a56304a108f1a22df0c5d62c26d5b6ca/packages/app/src/session/files/session-context-tab.tsx), `session/timeline/session-context-usage.tsx`, and `session/review/` |
| O3 | [OpenCode2 snapshots](https://github.com/anomalyco/opencode/blob/84c9be93a56304a108f1a22df0c5d62c26d5b6ca/packages/core/src/snapshot.ts), `session/revert.ts`, `session/inbox.ts`, and `session/compaction.ts` |
| O4 | [OpenCode2 worktrees](https://github.com/anomalyco/opencode/blob/84c9be93a56304a108f1a22df0c5d62c26d5b6ca/packages/core/src/worktree.ts), `worktree/strategies.ts`, and `vcs.ts` |
| O5 | [OpenCode2 permissions](https://github.com/anomalyco/opencode/blob/84c9be93a56304a108f1a22df0c5d62c26d5b6ca/packages/core/src/permission.ts), `form.ts`, `skill.ts`, `session/transfer.ts`, and `packages/app/src/session/terminal/` |
| O6 | [OpenCode2 browser plugin](https://github.com/anomalyco/opencode/blob/84c9be93a56304a108f1a22df0c5d62c26d5b6ca/packages/plugin-browser/README.md), `packages/core/src/codemode/`, `formatter.ts`, and `tool-output.ts` |
| B1 | Installed `bb-app/server/dist/builtin-skills/bb-cli/references/command-index.md`: thread, environment, terminal, machine, browser, diagnostics, voice, and skill groups |
| B2 | Installed `bb-app/server/dist/builtin-skills/bb-cli/references/thread-operation.md` and `thread-creation.md`; plugin authoring `backend-api-index.md` |
| B3 | Local [BB plugin inventory](../../bb-plugins/README.md) and each plugin README, especially [diff-viewed](../../bb-plugins/plugins/diff-viewed/README.md), [memory-watch](../../bb-plugins/plugins/memory-watch/README.md), [auto-handoff-parent](../../bb-plugins/plugins/auto-handoff-parent/README.md), and [preserve-child-threads](../../bb-plugins/plugins/preserve-child-threads/README.md) |
| D1 | Installed `@deepseek-ai/dsh-session/lib/types/index.d.ts`, `dsh-agent/lib/types/index.d.ts` and `runtime-types.d.ts`, `dsh-subagent/lib/types/index.d.ts` |
| D2 | Installed `dsh-session-query/lib/types/index.d.ts`, `dsh-workspace/lib/types/index.d.ts`, `dsh-workspace-changes/lib/types/types.d.ts` |
| D3 | Installed `dsh-schedule/lib/types/index.d.ts` and `types.d.ts`, `dsh-session-checkpoint-policy/lib/types/index.d.ts`, `dsh-skill/lib/types/index.d.ts` |
| D4 | Installed `dsh-client-ui-conversation/lib/types/client/contract/{input,draft-editor}.d.ts`, `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts`, and API workspace-file declarations |

Related work: [customization](dsh-customization/README.md),
[integration review](dsh-customization/integration-review.md),
[async questions](async-agent-questions.md),
[desktop shell](desktop-shell/README.md),
[boot integrity](plugin-boot-integrity.md).

## Goal

Choose a small, evidence-backed sequence of DSH additions that improves coding,
review, and parallel work without maintaining duplicate native features or
pretending that a UI plugin supplies missing Host capabilities.

## What

### Feature inventory and disposition

`Extend` means change an existing owned plugin. `Adopt probe` means a concrete
community candidate exists but must earn runtime acceptance. `Build` means
implement against DSH with dshx after the stated contract gate. `Host first`
means the public seam is missing or insufficient for the promised behavior.
`Covered` does not imply all acceptance checks have passed.

#### Conversation, composer, and navigation

| ID | Reference behavior | DSH coverage or gap | Disposition |
|---|---|---|---|
| F01 | Global title/content search and reopening past work (T2, B1) | Native `SessionQueryEngine` has indexed session/event search, filters and cursors; our sidebar is not a full-text results surface | **Adopt probe** `@hyzyn/dsh-search`; include archived work and exact event navigation if supported |
| F02 | Find within a conversation; previous/next user-message navigation (O1, O2) | Native chat navigation plus community `@ryuu-64/dsh-find-all` and `dsh-turnbar` candidates | Probe native behavior, then adopt a focused find bar; do not build another timeline by default |
| F03 | Quick-open files, line selection, add selection as context (O1, T1) | Native file/reference services exist; marketplace quick-open excludes 0.2 | **Fork/port** its useful path-search behavior only if native search falls short; prefer a small file palette over a replacement workbench |
| F04 | Unified command palette and discoverable shortcuts (O1, T1) | Native command contributions and our `shortcuts` already exist | **Extend** shortcuts with registered command discovery; survey `dsh-spotlight`, no parallel action registry |
| F05 | Prompt stash with multiple saved drafts (T1) | Candidate stash is text-only and does not admit this exact rc.2 peer baseline | **Fork/port** text-only stash first; rich drafts require a dshx/Host contract gate |
| F06 | Recall previously sent prompts (T1) | Community `dsh-composer-history`; useful but smaller benefit than stashing | Adopt probe after F05, preserve current unsent draft and reference semantics |
| F07 | Quote response, file/thread/PR/terminal context chips (T1, O1) | DSH input has references and revision-guarded insertion; file and session reference packages already ship | **Extend** context producers; terminal/review context first, reuse native chips |
| F08 | Drag threads into composer and lazy context lookup (T1) | Existing thread links plus native session references | Improve discovery in `thread-sidebar`; references should not copy whole histories or change lineage |
| F09 | Edit earlier prompt, fork from a message, undo/redo (T1, O1, O3) | Session fork exists; in-place rewind is not an equivalent operation | Expose **native fork** if absent; in-place rollback is F39, not a frontend shortcut |
| F10 | Multi-select pin/archive/reorder, project groups, hide settled work (T2, B1) | Mostly covered by `thread-sidebar`; some organization preferences are browser-local | **Extend** existing sidebar only after runtime acceptance; durable manual parent linking needs F41 |
| F11 | Snooze and wake threads (T2) | Existing park is browser-local; no native parked/snoozed projection found | **Host first** for synchronized snooze. Optional browser-local timer must say it is local |
| F12 | Unread state and attention badges (T2, B1) | Activity/read semantics must be defined; `updatedAt` is not a reliable last-work timestamp | **Extend** sidebar using explicit last-seen sequence; Host first for cross-device read state |
| F13 | Attach files, answer questions with files, preview HTML/PDF (T1, T8, B2) | Native attachments, file upload, renderer and question UI already exist | Probe native behavior; add only verified missing formats or question attachment contract |
| F14 | Voice input and screen/window capture (T8, B1) | Desktop OS capabilities, with marketplace candidates | Later optional shell integration; no always-on recording or separate plugin just for a button |

#### Coding and review

| ID | Reference behavior | DSH coverage or gap | Disposition |
|---|---|---|---|
| F15 | Diff files viewed, count/progress, hide reviewed files (T3, B3) | Native turn changes include summaries and diffs; our JJ panel has revision/file detail but no review ledger | **Build** `review-progress` using DSH/dshx; BB supplies behavior, not DOM patch architecture |
| F16 | Invalidate viewed state when reviewed content changes (T3, B3) | BB counts alone miss edits with equal added/deleted counts | Required part of F15: digest exact content/range, not line counts |
| F17 | Turn/revision/working-copy diff scopes and tree/list views (T3, O2) | Native turn changes and owned JJ inspection overlap | **Extend** JJ for repository ranges; review panel composes these sources without another VCS mutation owner |
| F18 | Inline comments and send selected hunks back to agent (T1, T3) | Revision-guarded draft insertion exists; durable review comment schema does not yet exist here | Phase two of F15, attach bounded immutable hunk context and explicit source identity |
| F19 | PR issue picker, read linked PR status (T3) | Candidate `dsh-github-picker` covers reference insertion, not a complete PR workflow | **Adopt probe** picker; build a small linked-PR panel only for missing status/watch behavior |
| F20 | Wake agent for check failures, comments, conflicts (T3) | Native schedule and Agent creation/resume/steering can be building blocks; no native PR-watch service found | **Build** `pull-request-watch` after durable execution/authority gate; avoid agent polling loops |
| F21 | Create PR, edit description, request review, merge, auto-merge (T3, B1) | External forge actions, not local diff UI | Later explicit actions via existing CLI/auth; start read-only, preserve remote mutation confirmation |
| F22 | Stacked PRs, multiple forge providers (T3) | Specialized workflow, substantial integration surface | Defer until GitHub linkage proves valuable; no universal forge abstraction for one caller |
| F23 | Worktree/workspace create, setup hooks, parallel isolated sessions (T2, O4, B2) | WorkspaceRegistry registers existing canonical directories; Agent creation accepts validated cwd | **Extend** JJ with `jj workspace` provisioning and DSH session creation; bind cwd before first turn. Not moving a live session |
| F24 | Transfer existing thread to another environment/machine (O1, B1) | No durable live-session workspace-transfer contract found in inspected DSH surface | **Host first**; creating a directory alone cannot rebind the session |
| F25 | Editor tabs, split panes, terminal panes, file preview (O1, O2, T8) | Native right-sidebar tabs, panes, terminal and file APIs already ship; `dsh-better-sidebar` overlaps heavily | Native probe first; adopt workbench only if it earns its broad replacement scope |
| F26 | Terminal history/search and captured output context (T8, O5, B1) | Native terminal and jobs; context producer integration can add value | Add bounded terminal-selection context in F07; separately probe whether durable history is missing |
| F27 | Background shell jobs, reconnect and inspect execution (O5, B2) | Native jobs and persistent shell tools exist | Covered at service level; integrate attention UI, do not create another process runner |
| F28 | Project commands, dependency setup, external editor launch (T8, B1) | Native dependency tool and open-in-app services overlap | Verify native coverage, then add explicit per-project command affordances; no automatic hook execution on import |

#### Agents, context, and automation

| ID | Reference behavior | DSH coverage or gap | Disposition |
|---|---|---|---|
| F29 | Delegated-task graph, inspect child state, interrupt, send follow-up (T2, T4, B2) | Native `SubagentRuntime` has catalogs, descendants, prompt and interrupt authority; owned messaging handles independent peers | **Extend** `agent-communication` with a work dashboard; keep owned child operations routed through SubagentRuntime |
| F30 | Provider-aware delegation with capability discovery (T4, T5) | DSH has named providers and explicit capabilities; no need to clone T3 orchestration graph | Use native contracts; expose actual capabilities and unsupported actions in F29 |
| F31 | Completed child output returned to parent (T4, B3) | DSH already has continuable settlement messages | Covered; test reconnect/delivery once. BB `auto-handoff-parent` repairs creation lineage, not completion delivery |
| F32 | Preserve children when parent is archived (B3) | DSH has its own archive admission and runtime ownership; BB plugin counteracts BB cascade semantics | Probe native archive behavior; do not install an archive-then-unarchive timestamp workaround |
| F33 | Async nonblocking questions and delegated decisions (T5, O5) | Native timed root questions; child routing already has a dedicated plan | Implement [async questions](async-agent-questions.md), do not create a second question system |
| F34 | Attention inbox: completions, errors, approvals, questions (T8, B1) | Existing approval/question cards; notification candidates available | **Adopt probe** focused notifications, then **extend** F29/sidebar with deduplicated attention state |
| F35 | Scheduled prompts and recurring jobs with browser closed (T6, B1) | Native ScheduleService has once/interval/daily/weekly/cron, catalog, history and concurrency-checked updates | Enable/validate native schedule first. New-session recurring jobs need separate execution contract |
| F36 | Kanban tasks, run history, pinned model/workspace (T6) | Community task board has Host ledger and its own cron/execution machinery | **Adopt probe** only if visual task management is wanted; do not build a competing scheduler |
| F37 | Goals, todo/proposed plans and stop conditions (T5, O1) | Native goal, todo, plan, workflow and Ralph tools/UI ship | Covered at package level; validate preset reachability rather than port tools |
| F38 | Context occupancy, inspect instructions/skills, manual compact (O1, O2, O3) | Native compaction and conversation context occupancy; AI Accounts owns usage history | **Build/extend** focused context inspector only for missing provenance. Keep cost analytics in AI Accounts |
| F39 | Conversation rewind coordinated with filesystem restore (T5, O3) | Session fork exists; `session-checkpoint-policy` is a durability flush policy, not file rollback | **Host first** for atomic conversation/filesystem rollback. Reject direct event-log surgery |
| F40 | Switch execution provider and return to old native session (T5) | Choosing an LLM route/account differs from running a Claude/Codex/OpenCode CLI session | Defer full harness adapters. Provider switching needs capabilities, transcript handoff, approvals, and ownership contracts |
| F41 | Link arbitrary existing sessions into a parent tree (B3, T2) | DSH distinguishes durable fork lineage and live parent ownership; no public reparent verb found | **Host first** for durable lineage; optional organizational links must be separately named and must not confer runtime authority |
| F42 | Skills explorer, provenance, invocation policy, recoverable removal (O5, B1) | Native skill catalogs/providers and community explorer exist | **Adopt probe** `@linxin666/dsh-client-ui-skill-explorer`; retain read-only bundled/symlink boundaries |
| F43 | Long-term memory and instruction discovery (O2, B1) | Many community memory systems; no evidence of missing recall workflow from this survey | Defer memory backend selection; use context inspector to identify actual pain first |
| F44 | Export/import session and portable handoff (O1, O5, T5, B1) | Native session log export/reference and fork machinery overlap | Probe export; portable import needs format validation, redaction, attachment ownership and policy restoration |
| F45 | Automated independent review/quality loops (T4) | Existing delegation plus many marketplace reviewers | Opt-in later, bounded rounds and budget; do not force every turn through extra LLM calls |

#### Browser, runtime, settings, and delivery

| ID | Reference behavior | DSH coverage or gap | Disposition |
|---|---|---|---|
| F46 | Shared browser tab, screenshot, DOM/console/network evidence (T7, O6, B1) | BrowserSkill community bridge exists; DSH core has no inspected browser-ownership service | **Adopt probe** BrowserSkill for browser operations; integrated shared preview is a separate product increment |
| F47 | Pick element, annotate region/style, attach evidence at composer cursor (T7) | Native attachment/reference producers can consume evidence; shared browser lifecycle missing | Later narrow `browser-context` integration on accepted browser provider, no arbitrary iframe claims |
| F48 | Browser profile import / saved cookies (T8, B1) | Credentials, not ordinary settings | Defer; explicit user-triggered import only, isolated local storage and provenance |
| F49 | Mobile/remote access, pairing, reconnect, offline sends (T8, B1) | Marketplace remote UI exists; authentication, deployment and queue semantics exceed a cosmetic plugin | Separate adoption probe after local workflows stabilize; no unauthenticated tunnel shortcut |
| F50 | Host machines, containers, remote environments (B1, B2) | Infrastructure lifecycle and credential boundary | Defer; Nix owns machine configuration. Not a DSH sidebar plugin project |
| F51 | Process memory/resource diagnostics (T8, B3) | BB memory-watch measures owned processes; DSH plugins share Node heap | **Extend** boot diagnostics with bounded Host process metrics; do not claim per-plugin heap attribution |
| F52 | Plugin safe mode, failure explanation, missing service diagnosis (B1) | Existing boot integrity plan/dshx work owns this concern | Finish [boot integrity](plugin-boot-integrity.md); do not add a second guardian implementation |
| F53 | Account/quota usage and cost history (T8, B3) | Owned AI Accounts and usage history already implement this domain | **Extend** missing providers/limits there, not another meter |
| F54 | MCP catalogs, OAuth, tool inspection (O1, B3) | Owned MCP Servers already covers domain; OAuth details need runtime acceptance | Complete existing package acceptance; adoption only for a concrete missing connector capability |
| F55 | Secrets/settings search/folder picker (B3) | Owned plugins/shared picker exist | Covered; preserve boundaries and finish runtime acceptance |
| F56 | Resize sidebar, navigation links, footer commands (B3) | Owned shell uses native layout geometry and contributions | Extend existing shell only if exact missing interaction reproduced |
| F57 | Themes, motion, typography, notification sounds (T8, O1, B1) | Native settings plus large theme marketplace | Adopt optional cosmetic plugin when requested; low priority for coding loop |
| F58 | Install/update services, desktop shell, remote client distribution (T8, B1) | Existing desktop-shell plan plus Nix machine setup | Improve shell/Nix, not a new Host bundle |
| F59 | Code Mode: discover tools, call multiple tools through code (O6) | Native PTC runtime and workflow-PTC packages already ship | Validate native PTC preset before porting another evaluator; bounded execution and permission mediation remain Host responsibilities |
| F60 | Format files after edit/write (O6) | OpenCode2 has Formatter service; DSH tool/file policy can host explicit integration | Optional project-local formatter bridge after checking native hooks; opt-in, actual repo commands, no global formatter choice |
| F61 | Language-server diagnostics following edits | Matching OpenCode2 edit/write source explicitly leaves LSP runtime as TODO | Do not claim this is an existing v2 feature to port. Independent future adapter only if needed |
| F62 | Oversized tool output retention and context pruning (O3, O6) | Native spill policy, tool-result pruner, timeout policy and compaction packages exist | Benchmark native truncation/spill discoverability; fix toolchain/domain gap rather than invent a second retention engine |
| F63 | Per-project model/permission defaults, sandbox and explicit approvals (T5, O5) | Native settings, agent options, permission presets and filesystem/shell sandbox services | Verify scope/inheritance; no UI option may relax runtime authorization implicitly |
| F64 | Activity log and failure/retry visibility (T5, T8, B1) | Session events, telemetry and existing boot diagnostics supply sources | Extend attention/diagnostics with bounded event history; no unbounded raw transport logger |
| F65 | Plugin authoring inspector, RPC and safe development loop (B1) | Local dshx inspect/check/build and boot-integrity work cover the core need | Improve local dshx only where multiple plugins expose a concrete missing contract; no parallel plugin framework |

### Marketplace adoption audit

Actual npm names matter: several repository leaf names returned registry 404s
before the scoped published packages were identified. Archives were downloaded
for inspection only. None is marked runtime-compatible merely because it has
matching peers or a resolvable import.

| Candidate inspected | Findings against installed runtime | Choice |
|---|---|---|
| `@hyzyn/dsh-search@0.4.4` | Peer range explicitly admits rc.2. Host calls `sessionQuery.searchSessions` with event filters and bounded limit, with a scan fallback. Implementation filters out subagent headers; exact hit/archived coverage must be tested. No static `@deepseek-ai/*` runtime imports found in inspected JS | **Adopt probe** for F01. Extend/fork only if child search or event jumps are essential and absent |
| `dsh-quick-open@0.3.0` | DSH client peer ranges end below 0.2. Empty dependencies; references old sidebar service surface | **Fork/port** path search for F03 if native file search is inadequate. Do not install unchanged |
| `dsh-prompt-stash@0.3.2` | Exact DSH peers include rc.1 but exclude installed rc.2. Uses native draft actions, refuses both attachments and reference occurrences, persists plain text locally | **Fork/port** for F05 text-only behavior; full rich draft fidelity needs contract work, not a widened peer range |
| `dsh-better-sidebar@0.24.1` | Peers admit the 0.2 rc line, substantial editor/rendering dependencies; no direct native package dependencies in published dependencies | **Adopt probe** only for F25. Compare sidebar slot ownership with our shell; do not replace everything to gain one pane |
| `@linxin666/dsh-client-ui-skill-explorer@0.4.4` | DSH peer `>=0.2.0-rc.1`; Host scans/discovers skills and exposes mutation routes. No static native runtime imports found in inspected JS | **Adopt probe** F42, including canonical-root and paired-access authorization checks |
| `@linxin666/dsh-client-ui-task-board@0.4.4` | DSH peer `>=0.2.0-rc.1`; Host owns ledger, cron and real session execution. Has one direct `@deepseek-ai/*` dependency: verify singleton identity before boot | **Adopt probe** F36 only if task-board workflow earns value; do not build our own board meanwhile |
| `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.2` | Peers admit 0.2 rc; imports existing tools/primitives and schemastery. Uses external `bsk` executable, scoped browser ownership, archive cleanup and loopback observation routes | **Adopt probe** F46. Check official prebuilt `bsk` artifact and Nix wiring first. Shared preview/annotation remains additional work |
| `dsh-github-picker@0.5.3` | Peers explicitly target rc.2; inspected static LLM/Typert imports map to installed exports. Covers issue/PR context insertion | **Adopt probe** F19 reference picker, not a PR watch or forge client |
| `dsh-notification@0.1.2` | Reads native `agent/status`, `agent/error`, and waterfall `approval/request`; calls `next()` correctly. OS notifier and optional webhook; no direct native dependencies, has schemastery peer | **Adopt probe** basic desktop notifications only after import resolution; disable webhooks and sensitive detail by default |
| `@idoall/dsh-notify@0.4.1` | Peer ranges admit 0.2; in-page status/toast implementation, not equivalent to OS notifications | Probe if native attention UI is inadequate; avoid two overlapping notification systems |
| Unscoped `dsh-notify@0.1.7` | Windows PowerShell toast/tray package, different owner from `@idoall/dsh-notify`; empty dependencies | Reject for this macOS need |
| `dsh-rewind@0.11.12` | References removed `dsh-client-runtime`; implementation includes rewind/event repair and file restore rather than a single native rollback operation | Reject unchanged; F39 is a Host contract project |

Most shortlisted bundles rely on peers without direct native dependencies.
This profile has a known import-resolution trap for that shape. A peer match
therefore permits further investigation, not installation confidence. Resolve
every runtime import using the actual profile bundle loader; verify shared
cordis/loader identity and boot output. Do not turn `autoInstallPeers` on or
install public older-generation `@deepseek-ai/*` packages to satisfy imports.

Static import checks found installed package/export entries for the shortlisted
0.2 browser and PR bridges. This does not cover computed imports, named-export
shape, Client composition, or authorization. Search and explorer bundling hides
some dependency boundaries; inspect those in the scratch profile.

## Why

The highest-value gaps are repeated interruptions in an otherwise usable
workflow: losing the location of past decisions, re-reviewing changed files,
discarding a draft to ask something urgent, and guessing which child needs
attention. These are focused surfaces on existing DSH services.

Large copies of T3's harness graph, OpenCode's worktree runtime, or BB's remote
machine system would create another ownership layer. Native scheduling, goals,
jobs, attachments and questions already carry much of that behavior. Use them
before increasing the maintenance surface.

## How

### Conceptual model

```mermaid
flowchart LR
  UI[Search / review / attention / drafts] --> Native[Native DSH services and projections]
  UI --> Owned[Existing owned plugin domains]
  UI --> Bridges[Accepted browser / PR adapters]
  Owned --> Native
  Bridges --> Native
  Missing[Missing public contract] --> Host[Host contract change]
  Missing --> SDK[dshx typing and inspection support]
```

DSH owns agents, sessions, inboxes, permissions and native reminder execution.
Existing owned plugins own their domains. New bundles own only earned state:
review marks, PR subscriptions, or presentation state. A shared dshx abstraction
is added when multiple real callers need the same contract; do not introduce
a generic orchestration service for this plan.

### Priority and operations / behavior

| Priority | Work package | Value | Effort / dependency | First measurable gate |
|---|---|---|---|---|
| P0 | Existing profile/boot acceptance | Every feature depends on coherent composition | Resolve recorded warnings; use existing boot integrity work | Zero owned-entry activation failures in combined probe; native services visible |
| P1.1 | Search (F01/F02) | Recover past decisions without manual thread scanning | Low to medium; adopt search, avoid replacing sidebar | On fixed corpus, locate archived and live known answers; no stale result after query switch; record p50/p95 latency |
| P1.2 | Review progress (F15–F18) | Review long diffs once, revisit only changed content | Medium; new focused DSH UI, native/JJ sources | Same-line-count content edit clears mark; progress counts complete scoped file set |
| P1.3 | Plain-text prompt stash (F05) | Interrupt writing without losing draft | Low to medium; port compatibility and preserve proven text-only behavior | Stash/restore through reload; original draft survives refused restore; no unsupported rich content erased |
| P1.4 | Delegation/attention dashboard (F29/F34) | See blockers and address child work correctly | Medium; extend messaging/sidebar, native runtime authority | Parent with mixed child states survives reopen; only authorized child actions succeed |
| P1.5 | Async questions | Continue independent work while a decision waits | Already specified elsewhere | Run acceptance in existing async-questions plan, including late answers |
| P2.1 | Skills explorer (F42) | Find loaded skills and invocation policy | Adoption probe; inspect mutation boundaries | Correct source/provenance; bundled read-only entries cannot be deleted |
| P2.2 | Context/terminal/review references (F07/F38) | Give precise evidence, understand context pressure | Native context producers; provenance gaps may need Host support | Insertion lands at captured selection or refuses stale draft; no unbounded history copied |
| P2.3 | PR picker then durable PR watch (F19/F20) | Stop manually checking CI/review | Adopt picker; build watch after restart and wake contract | Same remote event yields one wake; no wake after unsubscribe; resume failures visible |
| P2.4 | Isolated JJ workspace launch (F23) | Safe parallel changes with ordinary DSH sessions | Extend JJ; separate provisioning and session creation | First tool executes in intended cwd; failed launch cleans only newly owned idle resources |
| P2.5 | Native schedule validation / optional board (F35/F36) | Repeated work with browser closed | Reuse native scheduler; board needs demand evidence | Browser-closed delivery, timezone/DST, restart and overlap behavior documented |
| P3 | Browser evidence (F46/F47) | Shared reproducible UI debugging context | External binary/provider first; larger integration | User and agent refer to same tab/capture, cleanup never closes borrowed browser |
| P3 | Runtime diagnostics (F51/F52) | Diagnose failures without guessing | Extend boot integrity/desktop shell | Process metrics labelled accurately, diagnostics redact tokenized URLs |
| Host backlog | F11/F24/F39/F40/F41 | Durable semantics unavailable to a cosmetic plugin | Separate contracts and designs | Typed supported/unsupported behavior before any UI implementation |

Effort labels are relative, not calendar estimates. P1 is the proposed first
implementation batch; the plan does not authorize automatic promotion to web.

### Tech choices

| Choice | Decision | Rationale |
|---|---|---|
| Adopt / fork / build | Explicit choice per matrix and package audit | Adoption is default, but incompatible or incomplete packages are not silently accepted |
| New authoring | Local `@dshfiles/dshx`, TypeScript/React and existing package conventions | Keep DSH 0.2 typing and bundling fixes in the owned toolchain |
| Review identity | Content-derived digest with source/range identity | Added/deleted counts are not a content fingerprint |
| Search backend | Native `SessionQueryEngine` and existing SQLite implementation | No second private conversation index |
| Mutations | Named native services and narrowly validated Host methods | No DOM-triggered remote mutation or direct session database edits |
| Scheduling | Native ScheduleService for session-bound reminders | Do not duplicate durability, timezone and delivery semantics |
| PR integration | External forge adapter with bounded requests and local subscription state | Keep remote state and local wake state distinct |
| Machine tooling | Official prebuilt binaries, pinned through Nix | Reproducible setup; source builds are last resort |

The inspected T3 and OpenCode source LICENSE files both declare MIT; preserve
their notices and source attribution when vendoring. The inspected personal BB
plugin manifests do not declare a license. Reimplement behavior unless source
ownership/license is established; preserve provenance for any copied code.
No fork needs an upstream remote unless ongoing synchronization is requested.

### Architecture and contract gates

1. **Search:** reuse native search with bounded pages and cancellation. Store
   query/filter/page in URL. Adopted search excludes children today: decide
   whether to expose a child filter rather than assume those results exist.
   Exact event jumps need a supported chat navigation target; if absent, ask
   for that contract instead of querying DOM text.
2. **Review:** native `WorkspaceChanges.summary/diff` is live-session data;
   summaries stop being available when the session is disposed. Clearly label
   that scope. Persistent historical review needs an authorized immutable
   artifact capture before disposal or a Host read contract. Repository-wide
   ranges should come from the existing JJ domain. Never show captured history
   as the current working copy.
3. **Drafts:** `InputState` exposes text, occurrences, attachment IDs, draft
   revision and submission phase; `InputActions` has text and attachment actions.
   Browser attachment IDs are not durable assets. A rich draft needs native
   snapshot/restore and attachment retention semantics, not serialized runtime
   IDs. The first port is explicitly text-only and refuses rich drafts intact.
4. **Delegation:** use `listChildren/listDescendants` and parent-authorized
   native prompt/interrupt operations. Peer inboxes remain the independent-agent
   messaging domain. An organizational parent link never grants child-control
   authority. Persisted catalog entries may have no live controllable agent.
5. **PR watch:** subscriptions own a task and event cursor; the Host owns bounded
   network checks and durable delivery. Session resume/steer has to preserve
   preset, cwd, permissions, archived state and handle disposal. A remote event
   can be recorded even when waking is refused. Native schedule reminders are
   session prompts, not permission to run arbitrary background code.
6. **Workspaces:** create JJ workspace and setup resources, then register its
   existing directory with WorkspaceRegistry and create a session with that cwd.
   Use provisioning receipts and repository identity checks. No automatic
   cleanup of a workspace with live agents, dirty files, or user-owned terminals.
7. **Browser:** OpenCode2 separates server tool/permission ownership from desktop tab/CDP ownership; this is a useful boundary, not permission to import its desktop runtime. A provider owns browser session, tab IDs, cancellation and archive
   cleanup; context UI owns only references and annotations. Local-only BrowserSkill
   observation routes do not establish remote pairing support.

## What this allows

1. Recover prior decisions and attach exact context without reading every thread.
2. Track which file versions were reviewed and send precise correction requests.
3. Preserve interrupted writing and identify questions or children needing attention.
4. Add PR, workspace, skill, and browser workflows in measured increments.
5. Turn missing repeated seams into narrow Host/dshx improvements.

## What this does not allow

1. Direct mutation of session logs to imitate native rewind or live reparenting.
2. Restoring files across other agents' changes without drift detection and ownership.
3. Reporting per-plugin heap usage from a shared-process total.
4. Treating account/model switching as execution-harness switching.
5. Claiming browser automation, remote pairing, or plugin adoption from static checks.

## UI & UX

### Desktop

Keep the current shell. Global search opens results with workspace, title,
snippet and event identity. Review uses a right-sidebar tab: scope selector,
file list, viewed count, unviewed filter, and file comparison. Delegated work
uses another tab plus compact sidebar attention badges. Stash is a composer
command/button with a saved-draft menu and clear text-only limitation.

### Mobile

Reuse existing responsive tabs and sheets. Search and attention work as lists;
review opens one file at a time. Hide unavailable desktop capture and terminal
actions. No desktop-only pointer interaction is the sole way to perform an
essential action; snooze should not promise cross-device behavior until durable.

### Common interactions

| Action | Result |
|---|---|
| Select search result | Opens session and supported event target; an unavailable target explains fallback |
| Mark file viewed | Saves exact review identity, folds file, updates count |
| Reviewed file changes | Mark becomes changed/unviewed even when line counts are unchanged |
| Attach selected hunk/output | Inserts bounded source-backed reference if draft revision still matches |
| Stash text-only draft | Durable local save completes before composer is cleared |
| Stash rich draft | Refuses intact until rich snapshot contract exists |
| Restore into nonempty composer | Offers explicit replace/insert/cancel; no silent overwrite |
| Open child row | Shows native state and lineage; only available authorized actions enabled |
| Subscribe to PR | Shows scope, polling cadence and wake policy; unsubscribe cancels future checks |
| Start isolated work | Shows resolved workspace/cwd and setup result before first agent turn |

## Data model

These are proposed domain records, not new parallel Session/Agent tables.
Validate persisted input and version migrations at each owning boundary.

| Domain | Proposed state | Ownership / retention |
|---|---|---|
| Search | Query, filters, cursor, selected result | URL and cancellable native query; no transcript duplication |
| Review | `sourceKind`, repository/workspace identity, session or PR identity, range identity, path/previousPath, content digest, viewed timestamp | Review plugin, bounded retention and explicit reset; authoritative source remains native/JJ/forge |
| Plain stash | Schema version, session ID, entry ID, text, created time | Local browser storage, bounded entries; no attachment/runtime IDs |
| Rich stash later | Native draft snapshot with durable reference/asset handles | Only after native ownership/retention contract |
| Attention | Event identity, session/child ID, kind, observed/acknowledged sequence | Native projection plus narrowly scoped UI state; Host store only for cross-device semantics |
| PR subscription | Repository identity, PR URL, target session, enabled flag, cursor, last observed state, last delivery ID, wake policy | Host store; secrets resolved through existing auth, never subscription data |
| Workspace provisioning | Repository identity, JJ workspace name/path, launch request ID, setup stage, created resources, target session | JJ domain, idempotent receipts; never infer ownership from path alone |
| Browser evidence | Provider session/tab ID, URL, capture time, artifact handle, bounded selector/annotation | Browser provider owns lifecycle; renderer uses sanitized display fields |

## Implementation steps

1. Resolve current composition warnings through existing work, then record
   native UI coverage and boot integrity in an isolated profile. Do not
   restart or change the active web server to perform this survey's experiments.
2. Probe P1 candidates individually. Pin exact package versions, resolve Host
   and Client imports through the real bundle loader, inspect required services,
   and read complete boot stdout. Reject duplicate top-level row IDs and locale
   namespaces before combined boot.
3. Compare native search with the adopted search candidate on a fixed synthetic
   corpus including live, archived, forked and delegated sessions. Record missing
   results, navigation behavior, latency and stale-query handling.
4. Implement review-progress against one proven diff source first. Add content
   digests, complete scoped counts, reload persistence and narrow regression
   checks. Add JJ range and review-context support only after that source works.
5. Port text-only stash against installed native input actions. Preserve refused
   drafts, bound storage and provide keyboard access. For rich drafts, inventory
   a second real caller before extracting shared snapshot support into dshx;
   Host must own any missing asset lifetime semantics.
6. Extend existing agent communication/sidebar with native child/attention
   projections. Test actual parent authority, offline children, repeated
   settlement, and late answers; complete the existing async-question plan.
7. Probe skills explorer and PR picker. Build PR watch only after proving durable
   wake ownership with crash/restart and unsubscribe races. No second scheduler.
8. Extend JJ for isolated workspace launch and explicit setup receipts. Prove
   cwd before first turn and refusal to remove dirty/in-use resources.
9. Validate native reminders with browser closed. Evaluate task board separately
   if task hierarchy/kanban is useful; inspect its own execution and cron semantics.
10. Probe BrowserSkill with official prebuilt tooling managed by Nix. Only then
    add shared browser evidence/annotation UX and document local/remote limits.
11. Run combined Client/Host acceptance with the owned plugins, inspect live
    browser evidence, and report measured improvement for each proposed promotion.
    Remove rejected experiments and stop only the probe processes we started.
12. Keep each accepted implementation as a focused, described JJ revision.
    Preserve copied-source licenses/provenance and update this plan's decisions.

## Open questions

These are implementation gates, not requests blocking this investigation.

1. Does native chat already satisfy exact search-hit navigation and in-history
   find? Verify before choosing search UI changes.
2. Is text-only per-session stash sufficient initially, or does rich draft
   support justify a native snapshot/asset retention contract? First batch assumes text-only.
3. Are historical turn reviews needed after session disposal? Initial scope is
   live native turn diffs plus stable JJ ranges; historical capture is separate.
4. Should PR events notify only, or resume agents automatically? Initial design
   is notification-only until explicit wake policy is selected.
5. Does the desired recurring workflow reuse one session or create a fresh
   session each run? Native reminders cover the former; prove executor ownership for the latter.
6. Is a kanban task board useful beyond existing goals/todos and delegation
   visibility? Adopt only after a real workflow demonstrates value.
7. Which browser experience matters first: browser tools alone or a shared
   preview with annotations? Initial probe targets tools and ownership.

## Acceptance criteria

- [ ] Every accepted feature has a reference behavior, measured existing gap,
  explicit adopt/fork/build choice, and verified DSH service/slot contract.
- [ ] Package imports resolve in the scratch profile without installing another
  generation of native packages; Host boot and Client composition succeed.
- [ ] Search locates known live/archived content, cancels superseded queries,
  and documents child-session policy and exact-jump limitations.
- [ ] Review invalidates on same-count edits, rename, binary content and range
  changes; omitted/capped files are never presented as fully reviewed.
- [ ] Stash cannot erase rich or concurrently edited drafts, and only clears
  composer after successful storage. Missing assets are explicit in any later rich implementation.
- [ ] Child dashboard distinguishes catalog history from live control and rejects
  unauthorized parent/peer actions. Native settlement is not duplicated.
- [ ] Notifications are deduplicated and redact prompt text, secrets and tokenized
  URLs; webhook transmission remains off unless deliberately configured.
- [ ] PR watch persists cursor/delivery state, bounds retries, handles overlapping
  polls, and stops future delivery after unsubscribe. Delivery guarantees are documented.
- [ ] Workspace launch binds correct cwd before work and preserves dirty/live
  resources on failed launch, disposal, or user cancellation.
- [ ] Schedule behavior is tested with browser closed, Host restart, timezone/DST
  and overlap; native reminder semantics are not mislabeled as a job executor.
- [ ] Browser cleanup releases owned resources without closing borrowed user
  tabs; screenshots/cookies have explicit scope and lifetime.
- [ ] Each promotion states measured gain versus native/current baseline and
  reports focused tests, browser proof and unresolved limitations separately.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-05 | First batch: search, review progress, text stash, delegation/attention, existing async questions | Frequent coding-loop pain with narrow DSH boundaries |
| 2026-10-05 | Reuse native scheduling, jobs, goals, compaction, references and terminal | Installed contracts already own these capabilities |
| 2026-10-05 | Probe scoped community search, skills, browser and PR picker | Concrete implementations exist; no reason to own duplicates before testing |
| 2026-10-05 | Port stash and possibly quick-open rather than widen peers blindly | Published ranges exclude installed runtime; stash also lacks rich draft behavior |
| 2026-10-05 | Build review-progress against DSH rather than carry BB DOM adaptation | BB behavior is useful; BB integration architecture and weak count fingerprint are not |
| 2026-10-05 | Keep rollback, synchronized snooze, live workspace transfer and arbitrary reparenting in Host backlog | Missing durable semantics cannot be supplied by UI alone |
| 2026-10-05 | Investigate only; no profile mutation or feature implementation | User requested survey and Markdown plan |
