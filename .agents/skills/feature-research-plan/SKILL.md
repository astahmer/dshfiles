---
name: feature-research-plan
description: Researches competitors and DSH feature fit, then returns evidence-backed adopt/extend/build/defer recommendations and phased plans. Use when deciding how DSH should address one or more feature ideas after competitor research.
---

# DSH feature research and triage

## Workflow

1. **Scope the decision.** Restate user outcome, included feature tracks, explicit skips, and implementation permissions. Keep tracks separate; never research an item the user skipped.
2. **Fan out independent tracks.** Use parallel subagents for a few tracks; use the workflow orchestrator for broad research. Give each agent one bounded feature and a shared report schema. Research agents return findings and plans, never implementation.
3. **Research competitors.** Prefer first-party docs, versioned source, official marketplace listings, and release notes. Compare capability, data/source, platform/version limits, licensing, pricing/auth, privacy, and security. Mark claims verified, best-effort, or unknown; cite exact URLs and local paths/lines.
4. **Inspect DSH.** Check the active profile, existing plugins, plans, and installed runtime contracts. Separate optional packages from mounted features. Use Cordis Inspect for read-only discovery, but do not treat its providers as plugin-callable business APIs. Verify Host capabilities before proposing UI.
5. **Map ownership.** Decide whether need belongs in an existing plugin, new plugin, adopted/forked plugin, Host/core capability, or no code. Name data owner, lifecycle, persistence, permissions, and failure behavior. Keep quota, token usage, wall-clock activity, schedules, and skill/plugin trust boundaries distinct.
6. **Return a plan.** Include user outcome; competitor matrix; current DSH overlap; recommendation; architecture/data ownership; phased steps; acceptance criteria; risks and open questions. Use `feature-plan` and its template when durable plan files are requested; otherwise return a reviewable plan in the report.
7. **Parent reviews.** Recheck high-impact claims and choose one disposition per track: adopt, extend existing, fork, new plugin, Host change, defer, or skip. Research agents do not approve their own implementation. Prefer reuse only when it covers user needs fully.
8. **Gate implementation.** Only after parent approval, delegate implementation to a different agent in a fresh JJ workspace. Include approved scope, plan, and acceptance criteria. Leave plan-only tracks untouched. Follow repository JJ rules; never push or restart the live app without permission.

## Safety and evidence

- Research agents make no source, profile, lockfile, database, or runtime changes. Write plan files only when requested.
- Never inspect private local histories, secrets, or prompt bodies unless user explicitly asks and the exact data is necessary. Prefer schemas and official fixtures.
- Do not present undocumented endpoints as stable. Record authentication, telemetry, data retention, license, and version constraints.
- Verify installed versions and active composition, not README claims alone. Missing Host capability means name a Host gap; do not invent a client workaround.
- Distinguish executable plugins, MCP servers/credentials, and agent skill instructions; use separate risk warnings and consent.
- End with concise recommendation, plan-only/implementation status, and sources. State when no files changed.
