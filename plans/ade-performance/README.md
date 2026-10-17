# ADE interaction-speed audit

## Scope and guardrails

Measure what users actually see across the ADE; compare architecture options; prototype and benchmark one reversible improvement; deliver a recommendation and phased roadmap. Do not implement a final framework/state migration. Keep DSH Host authoritative, use a uniquely named scratch DSH only, do not touch `127.0.0.1:3080` or `~/.dsh`, and do not push or restart the live app.

## Progress

| Track | Status | Evidence / next action |
|---|---|---|
| Runtime and ownership audit | Complete | DSH `0.2.1-rc.2`; React 18.3.1, TanStack Query 5.104.1 and Virtual 3.14.13. Host owns session history/follow; warm switches reuse only still-retained open sessions. |
| Plugin hot-path audit | Complete | Sidebar, Activity Timeline, Agent Communication and Jujutsu code-shape findings; all performance claims remain hypotheses until measured. |
| Framework/local-first comparison | In progress | Keep React + Query as baseline; validate alternatives and version/ownership constraints against official sources. |
| Scratch browser and provider setup | In progress | Scratch `ade-speed-20261018a` passes doctor with 180 active entries and all 19 selected bundles. The `verification-receipts` seed currently times out at its stale `Settings` selector; inspect/fix harness or use the live AI Accounts path. |
| Correct-content benchmark at 1/5/20+ active agents | Pending | Capture cold/warm visible-content paint proxies, p50/p95, long tasks, DOM and heap; distinguish rendered transcript content from titles or skeletons. |
| Reversible prototype and comparison | Pending | Select only after baseline points to a concrete bottleneck; compare before/after in the same scratch profile and workload. |
| Final audit and reversible roadmap | Pending | Separate verified runtime facts, static code shape, benchmark measurements and unknowns; state all limits. |

## Measurement rules

- A sample counts only when the expected visible content is present in the transcript or target panel and has survived two animation-frame callbacks; titles, loading shells, stale content and DOM mutations alone do not count.
- Report cold and warm states separately, with enough samples for p50 and p95. Record viewport, browser/runtime, thread/event counts, active-agent count, DOM nodes, JS heap where available, and long-task/frame-blocking evidence.
- Label timings from `dshx dev open` as journey-step timings, not as correct-content paint.
- Use scratch-only fake-provider data. Never copy launch tokens or raw authenticated URLs into artifacts.

## Resume here

Finish validating the scratch AI Accounts route and fake-provider behavior; then measure correct transcript content for cold/warm navigation and command/panel interactions at 1, 5 and 20+ active agents. Choose a prototype from measured evidence, rerun the same workload, and write the final report. Clean up every scratch process and fake provider before closing.