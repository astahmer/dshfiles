# Skills and capabilities hub plan

## Context

- Current [web profile](../profiles/web/package.json#L38-L83) already includes `dshmarket`, Framework Hub (`@dshfiles/plugin-marketplace`), and `@dshfiles/mcp-servers`.
- [Agent Toolkit](../plugins/@dshfiles/agent-toolkit/README.md#L3-L18) inventories capabilities available to a Session; it is not a global catalog or installer. DSH marketplace “Skills” entries are DSH plugins that manage skills, not skills.sh `SKILL.md` content.
- Official [skills.sh API docs](https://www.skills.sh/docs/api) describe catalog endpoints, but unauthenticated search returned 401 and requires Vercel OIDC. Official [CLI docs](https://www.skills.sh/docs/cli) document `npx skills add`; telemetry can be disabled with `DISABLE_TELEMETRY=1`.
- Existing DSH managers own different trust surfaces: agent skill instructions, MCP tools/credentials, and executable DSH plugins must remain separate.

## Goal

Give the user one navigation point for discovering and opening Skills, MCP, and DSH plugin managers, while avoiding duplicate installers and keeping skills.sh catalog access gated on a supported auth path.

## What

First evaluate a lightweight `Capabilities Hub` panel as a launchpad: links to existing MCP and plugin managers, local skill inventory entry point, and skills.sh link/CLI guidance. Add in-app remote skills.sh search/install only if an official, supported authentication and installation contract is available.

## Why

The user wants a unified Skills/MCP/DSH Plugins experience. Current managers already cover MCP and DSH plugins; the unique gap is skills.sh discovery. A thin hub can reduce navigation friction without duplicating capability owners.

## How

### Conceptual model

Separate `Discover` from `Installed/active`. The Hub routes to existing managers; each owner retains its install, credentials, validation, and runtime status. Skill text is untrusted agent instruction; MCP configuration grants tools/credentials; DSH plugins execute code in the Host/Client.

### Operations / behavior

- V1 presents tabs/sections for Skills, MCP, and DSH Plugins.
- MCP and plugin sections deep-link to existing managers, not mirrored state.
- Skills section identifies local inventory and links to skills.sh; show official CLI command with telemetry disabled, but do not run installs automatically.
- If approved auth/catalog contract arrives, add read-only catalog search and explicit install preview/confirmation as a later phase.

### Tech choices

| Choice | Decision | Rationale |
|--------|----------|-----------|
| New full marketplace | No | Existing dshmarket, Framework Hub, and MCP manager cover those domains. |
| New Hub | Conditional, thin launchpad only | Useful if one entry point is desired; no duplicate ownership. |
| skills.sh API | Link-out/CLI only until supported Vercel OIDC flow is available | Do not put OIDC credentials in Client code or invent auth. |
| Installation | User-triggered, previewed, explicit target; no auto-execution | Skill files affect agent instructions and may be untrusted. |
| Telemetry | Set `DISABLE_TELEMETRY=1` for CLI subprocesses | Respect local/private usage expectations. |

### Architecture

```text
Capabilities Hub UI
  ├─ Skills: local inventory + skills.sh link/CLI guidance
  ├─ MCP: deep-link to @dshfiles/mcp-servers
  └─ DSH plugins: deep-link to dshmarket / Framework Hub

Future, gated:
official Skills.sh auth/catalog adapter -> validated preview -> explicit install target
```

## What this allows

- One launch point for current Skills, MCP, and DSH plugin managers.
- A safe path to evaluate skills.sh without exposing credentials or silently installing content.
- Clear status and provenance for local versus remote skills.

## What this does not allow

- A second MCP credential editor or DSH plugin installer.
- Treating skills.sh `SKILL.md` as executable DSH plugin code.
- In-app remote catalog search before auth is supported; automatic installation; hidden telemetry.

## UI & UX

### Desktop

Use simple tabs/sections with status (`installed/local`, `remote catalog`, `external manager`). Skill entries show source, target path, version/commit, and untrusted-instruction warning. MCP and DSH plugin cards open their existing manager.

### Mobile

Stack tabs into a section selector; preserve clear distinction between discover and installed/active state.

### Common interactions

| Action | Result |
|--------|--------|
| Open MCP/Plugins tab | Navigate to existing owner; no duplicated settings. |
| Open skills.sh | Launch official catalog externally; no client token. |
| Install a skill (future) | Preview content/source/target; require explicit confirmation and telemetry opt-out. |

## Data model

V1 has no new catalog database. A small static route/config list may map tab labels to existing manager routes. Future remote search must decode a versioned skills.sh response into a validated catalog DTO and must not expose bearer tokens or raw responses to Client.

## Implementation steps

1. Confirm user values one launch point over direct navigation; inventory existing manager routes and local skill inventory APIs.
2. Build a minimal DSH panel/entry point that deep-links to existing MCP and DSH plugin managers; do not mirror their state.
3. Add Skills section with local inventory pointer and external skills.sh link/CLI guidance. Use official CLI only after verifying installed version and target path; set `DISABLE_TELEMETRY=1`.
4. Keep search/install disabled unless official Vercel OIDC flow is supported by the Host and can store credentials safely; otherwise show clear link-out status.
5. If catalog auth becomes available, add read-only search, validated preview, explicit user-selected install scope, provenance/version, conflict handling, and security review.
6. Test that navigation preserves existing manager behavior and that skill content, MCP credentials, and plugin execution warnings remain distinct.

## Open questions

1. Is a launchpad useful if skills.sh search remains external, or should the whole hub wait for catalog access?
2. Which skill scopes should be visible/installable: user, project, or both?
3. Can the official CLI install into DSH's desired skill directories without unsupported configuration?
4. Is Vercel OIDC account setup acceptable, or should the feature remain link-out only?

## Acceptance criteria

- [ ] MCP and DSH plugin controls remain owned by existing managers; no duplicate state/configuration.
- [ ] V1 performs no unauthenticated API calls and stores no OIDC/API credential in Client.
- [ ] Skills.sh link-out works; any CLI path is version-checked and disables telemetry.
- [ ] Any future install previews source, destination, version/content change, and requires explicit confirmation.
- [ ] Skill instructions, MCP tool/credential access, and DSH executable plugins have separate trust labels.
- [ ] No remote-search success is claimed until an authenticated supported contract is verified.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-16 | Conditionally useful as a thin launchpad; preserve existing managers | Current DSH already has marketplace and MCP surfaces. |
| 2026-10-16 | Gate skills.sh in-app search/install on supported OIDC/CLI path | Anonymous API search is blocked and client-side credentials are unsafe. |
