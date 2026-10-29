# Coding harness landscape: DSH versus 10 alternatives

**As of:** 2026-10-28. This is a curated comparison set, not an independently measured popularity ranking. Product claims cite first-party documentation/repositories; living docs and pricing can change. “Verified” means vendor-documented, not independently audited. Search was unavailable (Brave key missing); research used direct first-party sources. DSH claims were checked against this workspace's web profile and owned-plugin docs, not asserted for every possible DSH profile.

## Read the reports

1. [OpenCode](opencode.md) — extensible open-source agent/runtime, provider breadth.
2. [T3 Code](t3-code.md) — multi-device control plane for multiple coding agents.
3. [OpenAI Codex](codex.md) — separate CLI, app/editor, and cloud products.
4. [Claude Code](claude-code.md) — strong integrated toolchain, permissions, enterprise controls.
5. [Cursor](cursor.md) — IDE-first agent and cloud workflow.
6. [Cline](cline.md) — open-source, approval-led IDE/CLI agent.
7. [Roo Code](roo-code.md) — historical reference; product announced shutdown and repo archived.
8. [Aider](aider.md) — focused terminal pair-programming/edit-test loop.
9. [Orca (Stably AI)](orca.md) — parallel coding-agent worktrees and review/work-item flow.
10. [Windsurf / Cascade](windsurf.md) — brand transition to Devin; don’t assume standalone Windsurf continuity.

Gemini CLI was researched but excluded from the ten: official docs described a June 2026 migration for unpaid/Google One users to Antigravity CLI, so it is a transition watchlist entry rather than a stable top-ten comparison target. Sources: https://geminicli.com/docs/ and https://github.com/google-gemini/gemini-cli

## DSH baseline observed here

This is not a generic “DSH core” feature list: comparison target is this repository's web profile composition in [`profiles/web/package.json`](../../../profiles/web/package.json) and owned behavior documented in local sources:

- Custom persistent agents dispatch ordinary DSH threads; memory scopes, delegation restrictions and schedules ([agents](../../../plugins/@dshfiles/agents/README.md)).
- Provider/account routing, quota tracking, fallback, recovery, model settings for Codex/Claude/OpenCode Go/Command Code/Copilot, and identity/quota-only Cursor support ([AI Accounts](../../../plugins/@dshfiles/ai-accounts/README.md)).
- SSH-remote DSH runtimes and remote threads; not a managed cloud coding-agent product ([multi-host](../../../plugins/@dshfiles/multi-host/README.md)).
- Per-thread Jujutsu workspaces, guarded integration/rebase, cleanup, optional automatic integration; isolation is not a sandbox, and Git worktrees are not handled by this plugin ([thread workspaces](../../../plugins/@dshfiles/jj-integration/README.md)).
- Local model/tool usage analytics, cost estimates, telemetry, tools/MCP, memory/search, backlog, project checks, agent questions/communication and plugin-defined functionality are present in the profile manifest and owned-plugin docs.

**Overall assessment:** DSH is strongest as a customizable, provider/account-aware agent harness and operations/workspace control plane. Competitors most consistently outperform it at a cohesive coding-native surface: IDE/editor integration, code-aware inline edit/review, built-in terminal/test feedback, turnkey cloud execution, per-task isolated Git worktrees and polished product distribution. These are relative product gaps, not proof DSH cannot be extended.

## What competitors do better, in aggregate

| Edge | Products showing it | DSH reality |
|---|---|---|
| Editor-native code selection/inline diff/code context | Cursor, Cline, Roo (legacy), Windsurf/Cascade | DSH has editor and rich chat, but no evidence of equivalent IDE-grade coding loop/completion in inspected docs. |
| Hosted or easy multi-device execution | Codex, Claude Code, Cursor, T3, Orca, Devin Desktop | DSH supports SSH-hosted DSH runtimes and mirrored threads, but not equivalent managed cloud agent fleet or mobile/IDE reach. |
| Task-first coding orchestration + Git worktrees + visual review | Orca; also Codex/Cursor cloud flows | DSH isolates per-thread with Jujutsu and guarded integration; not Git worktrees, and no comparable multi-terminal/browser/work-item-to-PR surface was evidenced. |
| Coding-focused test/repair + reversible edits | Aider, OpenCode, Cline, Claude/Codex | DSH offers Project Checks and VCS integration, but edit → run → inspect diff → undo is less first-class. |
| Packaged ecosystem/policy and turnkey install | Cursor, Claude, OpenCode | DSH has typed plugins and marketplace integration; discoverability, compatibility/trust UX and portable conventions could be stronger. |
| Explicit permission/sandbox UX | Claude Code, Cline, OpenCode (details vary) | DSH has native tool/preset controls; Jujutsu workspaces are explicitly not sandboxes. No uniform guarantee claimed. |

## Recommended improvements

1. **Bridge to editors rather than build an IDE.** Prototype supported IDE integration/handoff: open a DSH thread from a project/editor selection, return agent results/diffs, surface diagnostics/tests and preserve thread identity. Validate Host/API and security scopes first.
2. **Make the coding loop coherent.** In current composer/workbench, offer concise project task view: changed-file review, check receipts, “what changed / next action,” safe undo/revert or VCS preview. Reuse existing Project Checks and Jujutsu APIs; mutations remain previewed and confirmed.
3. **Offer Git isolation deliberately.** Evaluate Git worktree support alongside Jujutsu only if real projects require it. Preserve ownership, safe cleanup, busy-session checks, isolation-vs-sandbox distinction and non-forced landing. Don't replace proven JJ flow wholesale.
4. **Improve remote handoff.** Close multi-host gaps (streaming, approvals/questions, terminal/model/attachment parity), then assess native mobile/editor client against evidenced demand. Remote execution remains host-owned; do not imply managed cloud.
5. **Portable extension/project context.** Support documented instruction/skill conventions (AGENTS.md, MCP, skills) with provenance and explicit trust; show compatibility/permissions in discovery. DSH's typed Host API remains authoritative.
6. **Expose per-task operating policy.** Explain approval posture and file/process/network scope. Claim sandbox only where a real Host boundary enforces it; JJ workspaces alone do not.

### Decision sequence (recommendations, not approved work)

- **Now:** improve multi-host gaps and editor/workbench handoff; require measured acceptance journeys.
- **Next:** evaluate Git worktree adapter, project context portability and task-level review/undo against real workflows.
- **Defer:** cloud task hosting, mobile client and enterprise control-plane features pending demand, security, staffing and operating-cost review.

### Claim and source policy

Each report includes first-party URLs and caveats. Privacy descriptions are vendor claims, not independent audits. Prices are date-sensitive and included only where official data was obtained. Product names may refer to different projects: Orca means Stably AI's Orca IDE. Windsurf is treated as an evolving/redirected brand. No feature adoption or implementation is implied.
