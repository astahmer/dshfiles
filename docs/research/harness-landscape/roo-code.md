# Roo Code (legacy / sunset)

**Snapshot:** 2026-10-28. Official docs announce extension shutdown May 15, 2026 and direct users to ZooCode or Cline; GitHub repository is archived. Treat features as historical design reference, not an active top competitor.

## What it did better than DSH

- **IDE-based coding task UX:** VS Code task flow with Architect/Code/Ask roles and an Orchestrator; code/filesystem/terminal context remained close to the editor.
- **Configurable model/provider selection, MCP and approvals:** selectable provider/model, role-specific instructions, checkpoints, auto-approval controls. User paid selected provider (historical; exact current offer is not applicable).
- **Open source:** Apache-2.0. This made the architecture and controls inspectable; it did not guarantee the provider's data handling.

## DSH overlap and lesson

DSH's agents, model routes, per-thread workspaces, tools/MCP, memory and project checks cover many harness-level concepts. Roo's strongest differentiator was the IDE-native coding loop, not generic agent orchestration. Its sunset also illustrates product-continuity risk in a fast-moving ecosystem.

## Improvements worth considering

1. Integrate with established IDEs for project-aware task creation and file/test context.
2. Keep roles/modes as configurable agent presets, but make permission differences explicit and Host-enforced.
3. Use checkpoints/diffs as a review affordance while retaining DSH's JJ revision model and guarded integration.
4. Do not adopt an abandoned extension as a new dependency without evaluating fork maintenance and current alternatives.

## Privacy caveat

The historical privacy policy describes code/prompts sent to the selected model provider, local credentials and PostHog telemetry with opt-out. These are Roo-era statements and may not transfer to ZooCode/Cline or any successor.

## First-party sources

- https://roocodeinc.github.io/Roo-Code/ (shutdown notice)
- https://github.com/RooCodeInc/Roo-Code (archived status)
- https://api.github.com/repos/RooCodeInc/Roo-Code
- https://roocodeinc.github.io/Roo-Code/basic-usage/using-modes
- https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/PRIVACY.md
- https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/LICENSE
