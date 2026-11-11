# Plans

A plan lives here only while work remains. When its last task is done and
verified, run the [`complete-plan`](../.agents/skills/complete-plan/SKILL.md)
skill: the decisions, limits, final behavior and verification commands move
into the docs that own the behavior (a package README or its `docs/`,
`tooling/dshx/docs`, or [`docs/`](../docs/README.md) for cross-cutting topics),
and the plan is deleted. A partly done plan is trimmed to its open items, with
a link to where the finished part is documented. Shipped behavior is never
documented only here.

Checkboxes and receipts in a plan are history, not fresh verification.

## Product and plugin work

| Plan                                              | Open work                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Agent session history](agent-session-history.md) | Bounded, permission-scoped Session search and read for Agents beyond live descendants; JJ change associations; orchestration-write authorization.                              |
| [Async Agent questions](async-agent-questions.md) | Real-provider cold resume across a Host restart (needs a user-approved restart), Markdown feedback linked to element annotations, two design questions.                        |
| [Multi-host](multi-host/README.md)                | Target and service owner, owner-side durable service, supervisor token boundary, Linux release acceptance.                                                                     |
| [Fleet DX](fleet-dx/README.md)                    | Host-aware core `subagent` / `backlog_start_thread`, real-SSH proof of origin grouping and fetch-before-thread, browser proof of the version-drift line.                       |
| [Verification evidence](verification-evidence.md) | Browser proof only: re-run the journey, plus a peer-fallback and rebase-stage scratch journey.                                                                                 |
| [Backlog](backlog/README.md)                      | Rich-composer body editing, settled-thread item return, paging and Inbox journeys, `Closes b:` from PR bodies, cross-host error details, Linear delegate mapping, screenshots. |
| [Inline chat UI](inline-chat-ui.md)               | Open P2 cards: approval card restyle, source citations, the jj revision a turn produced.                                                                                       |
| [ADE: remaining work](ade-ux/README.md)           | Native question forms in the Inbox, git-worktree scopes, a physical iPhone pass, e2e re-runs; design in [docs/ade-ux](../docs/ade-ux/README.md).                               |
| [Thread sharing](thread-share/README.md)          | v1 shipped as `@dshfiles/thread-share` (opt-in, not seeded); open: v2 collaborative threads (design only), opentunnel revisit.                                                 |
| [Browser preview panel](browser-preview-panel.md) | Agent ↔ user hand-off (P5): an element highlight in the Agent browser and user annotations sent to the thread.                                                                 |
| [t3code parity](t3code-parity.md)                 | Remaining t3code gaps (push, MCP Apps, preview recording, PR picker, other forges, OAuth); a closed-rows index maps shipped IDs to their plugin docs.                          |

## Testing, research and housekeeping

| Plan                                                                 | Open work                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Plugin E2E coverage](plugin-e2e-coverage.md)                        | First full nightly baseline and triage, run results in `features:report`, artifact size, catalog review, boot-state accessor upstream.                                                                    |
| [Host gaps](dsh-host-gaps.md)                                        | Behaviors our plugins cannot build until DSH exposes a capability. A decision register (own / upstream / drop), not a task plan.                                                                          |
| [Reference feature additions](reference-feature-additions.md)        | Evidence-gated feature and adoption backlog from reference products; shipped rows removed 2026-11-10.                                                                                                     |
| [Competitor releases 2026-11](competitor-releases-2026-11/README.md) | 20 ranked gaps, none shipped: tool/instruction diet follow-ups, idle compaction, resume-cost warning, thread artifacts, child approvals in the parent, find in thread.                                    |
| [Self-improvement](self-improve/README.md)                           | Open improvements mined from DSH Session history; the ledger dedups and reopens them. A standing backlog, not a task plan.                                                                                |
| [Data fetching](data-fetching/README.md)                             | Batching and the page-wide store are live (0 % queued); open: P0-6..10 slow reads, `retry: 1` overrides, socket census in the user's browser, change events, batch attribution in the HAR summary, P6–P8. |
| [Performance optimization](performance-optimization/README.md)       | C05, C15, H10, H12, T06 and the T02 remainder; H05, T03 and T05 partly done.                                                                                                                              |
| [Native-fork waste](native-fork-waste/README.md)                     | A tool catalog shared across Sessions (proposal) and one Effect copy in client bundles (blocked on namespace identity).                                                                                   |
| [Ultra-fast DSH](ultra-fast/README.md)                               | A long-lived tab keeps ~250 subscribed Sessions resident and reopens them on reconnect.                                                                                                                   |
| [Lint cleanup](lint-cleanup/README.md)                               | Re-measure on `main`, then remove the ratcheted baseline with real fixes and lower each cap as a rule empties.                                                                                            |
| [Effect-native follow-ups](effect-native-follow-ups/README.md)       | No code port is left; rows 1, 5, 11 and 13 need Linux, a logged-in browser HAR or a restart.                                                                                                            |

## Open follow-ups

Leftovers of finished plans. The plan files were deleted; each line links to the doc that now owns the topic.

- **HMR gate** ([design](../plugins/@dshfiles/hmr-gate/docs/design.md)): confirm in a scratch DSH with Host HMR enabled
  that `hmr/reload` releases a deferral, watch a client-only rebuild apply live, and decide whether the Plugins row
  gains retry and page-reload actions.
- **Host loop freezes** ([Host loop freezes](../plugins/@dshfiles/session-search/docs/host-loop-freezes.md)): measure
  the idle background tax of the activity timeline and usage store writes against the 5 ms/s gate; never measured.
- **fff search** ([benchmark](../plugins/@dshfiles/fff-search/docs/benchmark.md)): larger-corpus and reasoning-model
  runs.
- **Capabilities hub** ([README](../plugins/@dshfiles/capabilities-hub/README.md#skillssh)): in-app skills.sh search
  and install wait for an official authenticated catalog contract.
- **Plugin guide** ([README](../plugins/@dshfiles/plugin-guide/README.md#decisions)): live slot occupancy needs a
  Host-owned typed read API, designed and approved first.

## Proposed, not started

Ideas that were investigated but never built. Their plan files were deleted; this line is what survives. Reopen one by
writing a new plan.

- **Agent Calendar** (2026-11-05). A retrospective turn-time Calendar tab inside Usage, built from `turn/start` and
  `turn/end` markers: wall-clock agent time per project and Session, never claiming billable time or mixing duration
  with token usage. Direction: a Host projection table, Day/3-day/Week views and CSV, reusing Usage so no second
  analytics owner appears.
- **External usage history** (2026-11-05). Opt-in, cross-harness token usage inside Usage. TokiToki already reports
  other harnesses locally, so DSH integration must justify its privacy cost with native charts; Codex rollout and
  OpenCode stores are best-effort sources, Claude OTel is forward-only and Cursor has no documented local schema.
- **~/dev cleanup** (2026-10-13). A read-only audit of `~/dev` left 23 workspaces and repositories needing the owner's
  keep/archive/remove call, including a 28-workspace store whose 34 commits exist only locally. Re-run the audit before
  acting; nothing there is removed without the owner's decision.

- **Slot assembly crash safety** (2026-10-19). A recomposition that briefly leaves the sole `root` slot owner
  (`frame-layout`) with zero registrations makes the stock renderer throw `SlotAssemblyError` past every error boundary
  and blanks the Web UI until a reload. Direction: register a shadowed fallback `root` entry that shows a recovery card,
  and record the renderer and shell half as a Host gap.
- **Shared account pool** (2026-10-22, research only). Several people and devices sharing AI accounts need centrally
  enforced account-contribution percentages and per-member caps, which device-local pools cannot agree on. Direction:
  an opt-in Shared pools section in AI Accounts backed by a small headless pool service that owns membership,
  credentials and one accounting ledger, reusing a gateway (New API, sub2api) only where it passes a compatibility
  spike, with each provider's redistribution permission checked first.
