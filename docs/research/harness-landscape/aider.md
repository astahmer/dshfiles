# Aider

**Snapshot:** 2026-10-28. Free/open-source terminal coding agent; provider inference cost is separate.

## What it does better than DSH

- **Focused pair-programming loop:** terminal agent works directly in a local repo, can lint/test and repair, reports changes as Git commits, and supports `/undo`/diff/dirty-file protection.
- **Compact code context (verified):** repo map ranks symbols/relationships and budgets tokens to provide codebase context efficiently. Useful pattern for any agent that needs broad project awareness without stuffing entire repositories into prompts.
- **Architect/editor mode:** separate models can plan and implement; supports scripting and IDE watch mode; broad cloud/local model choices.
- Simple, inspectable editing workflow and deterministic Git audit are strengths over a broad harness UI.

## DSH overlap and differences

DSH has per-project checks, Jujutsu thread workspaces, revision graph/diff actions, model/provider choice, agents and rich session management. Aider's advantage is the tightly coupled edit → lint/test → diff/commit loop and repository map. DSH's JJ integration provides stronger parallel thread isolation/landing and broader orchestration.

## Improvements worth considering

1. Add optional symbol-aware context generation/selection to the coding workflow; benchmark token and task quality, do not adopt a repo map speculatively.
2. Make per-task changed files, test commands/results and review/undo one compact, repeatable surface.
3. Ensure coding tasks can launch existing Project Checks and see durable receipts without waiting until a generic session end.
4. Preserve DSH's concurrency controls and safe Jujutsu integration rather than copying a single-repo Git commit policy.

## Limits / privacy

Aider FAQ says it is not optimized for very large repos and its basic workflow handles one Git repository at a time. Code/prompts go to the chosen provider; local models can keep processing local, but Aider's own telemetry policy describes interaction metadata (feature/error/model ids) on a random id with opt-out. Third-party provider privacy applies.

## First-party sources

- https://aider.chat/
- https://aider.chat/docs/repomap.html
- https://aider.chat/docs/git.html
- https://aider.chat/docs/usage/lint-test.html
- https://aider.chat/docs/usage/modes.html
- https://aider.chat/docs/llms.html
- https://aider.chat/docs/faq.html
- https://aider.chat/docs/legal/privacy.html
- https://raw.githubusercontent.com/Aider-AI/aider/main/LICENSE.txt
