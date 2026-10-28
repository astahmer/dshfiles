# T3 Code

**Snapshot:** 2026-10-28; first-party docs/repository. Release `v0.1.3` (Oct 27) and project README describes product as very early; factor maturity into any adoption decision.

## What it does better than DSH

- **Native multi-device control plane (verified):** web, Electron desktop and iOS/Android apps control locally or remotely running agents/workspaces. It treats remote access as the product, not as a specialist plugin surface.
- **External-agent adapters (verified):** supports Claude Code, Codex, Cursor, Grok Build, OpenCode and Google Antigravity, with their local auth/setup. DSH's AI Accounts routes several providers and multi-host threads but does not evidence comparable first-class control of these external runtimes.
- **Remote topology and workflow (verified):** LAN/private network, Tailscale HTTPS, T3 Connect tunnel and SSH-managed desktop; projects/files/provider credentials remain on the environment-owning host. Host browser tabs can be viewed/controlled remotely. Linked environments permit starting, messaging, waiting on and stopping work across machines.
- **Orchestration architecture (verified from internals docs):** RPC client/server, provider adapters, persisted event log, command receipts/projections/outbox effects; hidden Git refs for checkpoints. This explicit command/effect model and remote contract are useful architecture references.

## DSH overlap and differences

DSH already has SSH tunnels, identity-pinned remote runtimes, remote threads, agent communication/questions, Jujutsu integration, local chat/composer and Host-owned credentials. T3's advantage is product integration and client reach, provider-runtime adapters, and the explicit server orchestration architecture—not “DSH lacks remote threads.” DSH's current remote limitations include polled transcripts, approvals/questions and terminals staying in host UI, and no session handoff between machines.

## Improvements worth considering

1. Make remote thread control more complete: streaming transcript updates, answer/approval routing and consistent terminal/tool capabilities, with the existing host as authority.
2. Add optional clients only after validating demand; T3 demonstrates clear rationale for mobile/web access to an environment-owned runtime.
3. Consider durable command/event receipts around cross-host operations; do not replace DSH session truth with speculative client state.
4. Offer integrations to external agent runtimes only with explicit per-runtime permissions, lifecycle handling, credential boundaries and truthful status.
5. Study T3's least-privilege pairing scopes. Its own docs warn that unscoped pairing tokens default broad permissions, so copy the scope model—not its unsafe default.

## Privacy, licensing, maturity

MIT licensed; provider/API costs remain separate. T3 Connect/cloud tunnel pricing and data-retention policy were not established. Pairing tokens are sensitive; carefully scope and revoke access. Version 0.1.x and the “early” warning mean feature stability is limited.

## First-party sources

- https://github.com/pingdotgg/t3code
- https://github.com/pingdotgg/t3code/releases/tag/v0.1.3
- https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/remote-access.md
- https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/internals/overview.md
- https://raw.githubusercontent.com/pingdotgg/t3code/main/LICENSE
- https://t3.codes
- https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824
- https://play.google.com/store/apps/details?id=com.t3tools.t3code
