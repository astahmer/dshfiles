# OpenAI Codex

**Snapshot:** 2026-10-28. Keep Codex CLI, editor/desktop app, and hosted Codex Web/cloud distinct; one product's openness does not imply all surfaces are open source.

## What it does better than DSH

- **Cohesive first-party surface set (verified):** local terminal CLI, editor integrations, desktop app, and separate hosted Codex Web/cloud agent. Turnkey productization and cloud execution are stronger than this DSH web-profile's primarily host/plugin orchestration.
- **Code-task execution (verified at product level):** CLI is a local coding agent; hosted product provides a vendor-operated execution path. Exact cloud architecture and detailed task controls were not verified here.
- **Onboarding/auth (verified):** CLI supports ChatGPT-plan sign-in or API key; docs present install paths for macOS/Linux/Windows. Eligible plan entitlement and usage limits vary.

## DSH overlap and differences

DSH AI Accounts directly supports Codex routes, quota windows, account routing, fallbacks, and Codex Fast mode; it can manage sessions and isolate coding threads in Jujutsu workspaces. Thus Codex is already a provider/runtime route in this setup. The gap is the first-party IDE/desktop/cloud product around the model, not Codex model access.

## Improvements worth considering

1. Make DSH-to-editor handoff and diff/check feedback effortless instead of competing on a standalone editor.
2. Document provider neutrality and account-aware fallback as a deliberate differentiator; expose reliable cost/quota context at task start.
3. Treat cloud execution as a separate product decision requiring environment isolation, credentials, logs, retention, billing and approval guarantees—not simply another remote thread.
4. Compare Codex cloud's actual isolation/security against DSH's explicit warning that Jujutsu workspace isolation is not a sandbox before making security claims.

## License, pricing, security: caveats

Codex CLI source is Apache-2.0; this does not open-source the app or hosted service. Plans include ChatGPT subscriptions subject to changing limits; API use bills separately. Fixed current price and cloud/app internals were not verified. Security docs could not be inspected sufficiently in this pass; no sandbox superiority claim is made.

## First-party sources

- https://github.com/openai/codex
- https://raw.githubusercontent.com/openai/codex/main/README.md
- https://github.com/openai/codex/releases
- https://help.openai.com/en/articles/11369540-codex-in-chatgpt
- https://openai.com/pricing/
- https://learn.chatgpt.com/codex/security-administration
- https://learn.chatgpt.com/codex/configuration
