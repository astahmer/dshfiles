# Cline

**Snapshot:** 2026-10-28. Open-source Apache-2.0 client; product surface is changing rapidly. Pricing and privacy claims are deliberately limited to sources checked.

## What it does better than DSH

- **Coding agent embedded in IDEs and CLI (verified):** VS Code/JetBrains extension, CLI/TUI, desktop app, SDK and cloud-agent offerings share a core. This shortens the path from code context to edit and review.
- **Explicit approval posture (verified):** docs emphasize human approval for tool actions. It supports provider choice/BYO keys and local open-weight models; user can select an execution/data route.
- **Coding-focused extensions (verified):** MCP, rules, skills, hooks, connectors, schedules, agent teams/subagents and plugins. Important limit: plugin support was documented for CLI/SDK/Kanban, not the VS Code/JetBrains extension.
- Apache-2.0 open source; use incurs provider/API cost or Cline credit/subscription options depending on configuration.

## DSH overlap and differences

DSH already has plugin composition, MCP, custom agents, tool approvals through native DSH surfaces, model/provider/account selection, project checks, editor, chat and remote workspaces. It is not accurate to call DSH “closed” or without provider choice. Cline's edge is editor-first code interaction and shared coding-agent runtime across surfaces.

## Improvements worth considering

1. Native IDE context and visible inline diff/approval are the most tangible product gap; prefer integration over cloning Cline's editor.
2. Improve named action/permission presets and explain when a command or file write needs approval.
3. Publish a supported portable project rules/skills convention and route it through existing DSH trust/consent mechanisms.
4. Provide task-local test/lint/run feedback with an auditable change set and safe revert.

## Privacy / pricing caveat

Users can select local models or providers, but source/prompt processing depends on that route. Comprehensive retention/no-training commitments and exact ClinePass price were not verified in the checked official material; do not infer them.

## First-party sources

- https://github.com/cline/cline
- https://raw.githubusercontent.com/cline/cline/main/LICENSE
- https://docs.cline.bot/cline-overview
- https://docs.cline.bot/getting-started/config
- https://docs.cline.bot/getting-started/cline-provider
- https://docs.cline.bot/mcp/mcp-overview
- https://docs.cline.bot/customization/plugins
- https://docs.cline.bot/getting-started/clinepass
- https://cline.bot/pricing
- https://cline.bot/privacy
