# Claude Code

**Snapshot:** 2026-10-28. Vendor-described capabilities and security controls are not independent audits.

## What it does better than DSH

- **Integrated coding surfaces (verified):** terminal, VS Code/JetBrains, Claude Desktop, Claude.ai/cloud, Remote Control/mobile, Slack/Chrome and CI/security workflows. This polished first-party path makes “start task → edit → review” easier than assembling a general-purpose harness.
- **Layered extension model (verified):** project/user instructions and memory, skills, lifecycle hooks, MCP, subagents, plugins and Agent SDK. DSH also has plugins, MCP, persistent agents, memory, schedules and tools; Claude's strength is a cohesive native experience and external integration ecosystem.
- **Granular security UX (verified in official security page):** manual mode read-only by default and per-action consent; auto-mode classifier with ask/deny overrides; Bash sandboxing and filesystem/network isolation; working-directory boundaries and injection safeguards; managed MCP allowlists and enterprise audit/configuration.
- **Cloud and local mode clarity:** cloud sessions use isolated Anthropic-managed VMs and restricted network; Remote Control is local execution but syncs transcripts to Anthropic servers over TLS. This explicit distinction is a strong communication pattern.

## DSH overlap and differences

DSH has Claude account integration and routes requests through the official CLI for certain Claude account types, while keeping a separate DSH tool loop; provider accounts/quota/fallback and extensible plugins are strengths. The inspected workspace does not prove native feature parity with Claude's IDE extension, cloud VM workflow, enterprise-managed controls or its sandbox. DSH's Jujutsu workspaces are not a security sandbox.

## Improvements worth considering

1. State plainly what stays on the Host, what is sent to providers, where transcripts are retained, and which surfaces execute locally vs remotely.
2. Create named permission presets with enforceable tool/file/process/network limits and visible approval receipts; keep allow/deny scope explicit.
3. Close a documented IDE integration loop (open thread from selection, diagnostics/test status, return review/diff) before expanding desktop UI.
4. Define remote/cloud execution only with a threat model, short-lived credentials, scoped egress, audit trail and cleanup guarantees.

## Pricing / deployment caveats

Claude Code is proprietary; can route via Anthropic services and supported cloud providers (AWS Bedrock, Google Vertex, Microsoft Foundry). Billing differs by route and plan. Numeric current pricing was not verified. Security behaviors above are vendor-documented, not independently assured.

## First-party sources

- https://code.claude.com/docs/en/overview
- https://code.claude.com/docs/en/platforms
- https://code.claude.com/docs/en/features-overview
- https://code.claude.com/docs/en/how-claude-code-works
- https://code.claude.com/docs/en/security.md
- https://code.claude.com/docs/en/claude-code-on-the-web.md
- https://code.claude.com/docs/en/data-usage.md
- https://code.claude.com/docs/en/zero-data-retention
- https://code.claude.com/docs/en/third-party-integrations
- https://code.claude.com/docs/en/costs
- https://www.anthropic.com/pricing
