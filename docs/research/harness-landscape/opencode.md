# OpenCode

**Snapshot:** 2026-10-28. Confidence labels describe vendor/source evidence, not independent runtime testing.

## What it does better than DSH

- **Coding-agent runtime breadth (verified):** terminal/TUI plus web, IDE extension and desktop surfaces; docs distinguish OpenCode 1 and 2. V1 release `v1.19.4` was published Oct 22, 2026. Avoid mixing V1 behavior and V2 claims. OpenCode product is more directly packaged as a code-agent CLI/app than DSH's configurable web harness.
- **Provider range and local-model access (verified as documented):** claims 75+ providers and local models through its provider/Models.dev architecture. Exact parity of provider/account/quota management with DSH was not established; DSH already has AI Accounts, native providers and multi-provider fallbacks.
- **Agent/runtime extensibility (verified):** JavaScript/TypeScript plugins load locally or from npm, with hooks around tools, sessions, messages, files, LSP, permissions and events; plugins can add tools and interact with SDK/shell. MIT licensed.
- **Coding policy surface (verified):** build/full-access and read-only plan modes; granular allow/ask/deny by tool/input/path and per-agent. `/undo` and `/redo` are available. Default permissions are relatively permissive for many actions; `.env` prompts.

## DSH overlap and differences

This workspace has typed dshx plugins, user/agent tools, MCP management, plugin marketplace, privacy controls, extensive provider/account routing and quota/fallback features, editor/chat/workbench surfaces and per-thread Jujutsu isolation. Those are real overlaps; “DSH has no plugins/providers/undo” would be wrong. Difference: OpenCode is a focused, installable coding-agent runtime with terminal/IDE/desktop targets; DSH packages a personalized plugin-oriented host and orchestration plane.

## Improvements worth considering

1. Borrow the **developer ergonomics** of a first-party coding CLI/IDE bridge: reliable open-from-editor, current project context, test feedback and focused diffs.
2. Study OpenCode's **event/hook affordances** as a standard for plugin observability and interception, while preserving DSH's typed API ownership, safety gates and profile composition.
3. Improve documentation and status indicators around **tool permissions and reversible edits**; don't copy permissive defaults without an explicit policy decision.
4. Keep model choice broad, but benchmark actual provider coverage against DSH's current AI Accounts matrix before asserting a gap.

## Caveats

OpenCode has two major versions with separate docs; CLI side-by-side installation is not the default. Open-source MIT code is not itself a privacy guarantee: provider processing depends on the selected route. Current exact service pricing/retention was not verified; do not invent it.

## First-party sources

- https://opencode.ai/docs/
- https://opencode.ai/v2/docs/
- https://opencode.ai/docs/providers/
- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/permissions/
- https://github.com/anomalyco/opencode/releases/tag/v1.19.4
- https://raw.githubusercontent.com/anomalyco/opencode/dev/LICENSE
