# Orca — Stably AI's Orca IDE

**Disambiguation:** Stably AI's `stablyai/orca` / onorca.dev, an agent development environment, selected as the closest harness/control-plane match. Not VirtusLab Orca (development-flow framework) or echoVic/orca-agent (coding agent). **Snapshot:** 2026-10-28.

## What it does better than DSH

- **Parallel code tasks with real Git worktrees (verified):** each task gets a worktree, associated terminal/browser/editor/diff; agents can work in parallel with isolated files. This is more task- and code-centric than DSH's conversation/thread-first flow.
- **Visual task review and delivery:** annotate diffs, commit/push/open PR, and connect tasks with GitHub/Linear/Jira/GitLab. Strong issue-to-PR product loop.
- **Remote/persistent surface:** desktop on macOS/Windows/Linux, mobile companion, SSH/self-hosted runtime and BYO cloud VMs; remote clients connect to the environment-owning runtime.
- **Agent fleet orchestration:** CLI agents and supported native chats, durable tasks/runs/messages/decision gates, schedules and usage/rate-limit views.

## DSH overlap and differences

DSH already has parent/child agents, agent questions/communication, durable sessions, project checks, remote DSH runtimes, usage analytics, memory, and Jujutsu-first per-thread workspaces with guarded integration. Don't claim these are absent. Differences: Orca offers Git worktree task isolation, agent-specific multi-terminal coding surface, per-task visual review, work-item/PR links and mobile client. DSH has provider/account quota-aware routing, wider general harness features and a sophisticated Jujutsu workflow.

## Improvements worth considering

1. Evaluate a task layer over DSH threads with explicit dependencies, runs, dispatches and decision gates; only if workflows benefit from it beyond existing agent delegation.
2. Build task-specific worktree/diff/terminal review using existing safe VCS contract; assess Git support versus the existing JJ adapter rather than replacing it.
3. Add issue/PR linking and task state as optional integrations with clear ownership and reversible state.
4. Prioritize remote answer/approval/streaming gaps before adding mobile clients.
5. Treat defaults that bypass approval (“Yolo” modes documented by Orca) as a deliberate security tradeoff, not the baseline to copy.

## Privacy / cost caveats

MIT open source; app is free, model/provider usage and compute are separate, Enterprise price undisclosed. Vendor says prompts/code go directly to configured providers and claims no prompt/output/path data in its telemetry; anonymous usage events go to PostHog with opt-out. Enterprise page says SOC 2 readiness, not certification. These are vendor claims. Default agent permission flags can bypass approval; verify each mode.

## First-party sources

- https://github.com/stablyai/orca
- https://www.onorca.dev/docs
- https://www.onorca.dev/docs/model/worktrees
- https://www.onorca.dev/docs/ways-to-run
- https://www.onorca.dev/docs/cli/orchestration
- https://www.onorca.dev/docs/agents/supported
- https://www.onorca.dev/docs/telemetry
- https://www.onorca.dev/privacy
- https://www.onorca.dev/enterprise
- https://www.onorca.dev/download
- https://www.onorca.dev/changelog
- https://www.onorca.dev/terms
