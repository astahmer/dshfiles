# Repository guardrails

The repository uses one pnpm workspace and lockfile for the root, owned plugins,
dshx and desktop. Profiles remain separate installation targets; their local
bundle links are intentional. See [profile installs](profile-installs.md) before
changing an installed profile.

## Dependencies and TypeScript

`saveExact: true` in [the workspace configuration](../pnpm-workspace.yaml) keeps
new dependency declarations exact. Repeated versions belong in its catalog.
Peer dependencies retain compatibility ranges; local `workspace:`, `link:` and
`file:` references express workspace topology rather than registry versions.
The [workspace contract](../plugins/scripts/check-workspace-contract.ts) rejects
non-peer registry ranges and requires each bundle's build, test and typecheck
scripts. There are no registry-range exceptions in that contract.

Owned plugin TypeScript configs extend the shared
[client base](../tsconfig.base.client.json). The contract prevents disabling
`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `verbatimModuleSyntax` or `isolatedModules`. Forwarded
optional values must be modeled explicitly; omit absent library props instead
of forcing them through a cast.

## Lint and unused-code gates

[Oxlint configuration](../.oxlintrc.json) loads the generated emilint plugin.
[Vendor provenance](../tooling/antislop/README.md) identifies the published
source revision; update and rebuild in emilint rather than editing its generated
bundle here. Structural checks use the vendored ast-grep rules plus narrow
repository-owned rules in [the antislop directory](../tooling/antislop/README.md).
Do not implement the same rule in both checkers.

[The lint ratchet](../scripts/lint-ratchet.ts) fails on any error or any warning
count above [its cap](../scripts/lint-ratchet.json). An unknown rule has cap zero.
Lower caps when removing findings; never raise them to conceal regressions.
Low-count assertion, reflection, broad-object and passthrough rules are errors.
Remaining warnings are migration debt, not permission to add more findings.

`antislop/no-export-bag` is an error with `minExports: 3` and cap zero. Avoid bags
of cohesive callable exports; prefer one domain namespace class with static
methods, or an injected service for dependency-bearing operations, so ownership
stays explicit. The rule exempts hooks, PascalCase exports, TSX, tests and
generated code. Repository options also exclude shadcn components, dshx public
entrypoints and test support. These are explicit public or fixture boundaries,
not places to hide product helpers.

[The root Knip configuration](../knip.jsonc) covers the root, desktop, plugins
and dshx. It declares bundle/public entrypoints and hand-run scripts explicitly.
Its scoped exceptions retain the unregistered Jujutsu locale dictionary,
Host-provided peer copies, fixture trees and shared-runtime dependencies resolved
by name. Review those exceptions at their owning boundary rather than deleting
dependencies based only on a static report. Production-only scans need separate
test-support exclusions; the normal gate is the configured root scan.

Git hooks do not run for JJ commits. Use the repository checks and JJ's formatter
integration rather than adding lefthook as an unenforced gate.

## Client flow ownership

Host snapshots and async reads belong to Query; writes belong to mutations;
multi-field editors use the shared Form bindings; browser persistence uses
`createStoredValue`. See [client state ownership](client-state-ownership.md) for
the Host/browser split.

Use an XState actor for a multi-state async protocol, not every open/close toggle
or DOM flag. Define typed actors with throwing placeholders, provide concrete
operations in a thin hook, and let components select state and send events.
Cancellation and operation identities fence stale completions. Test machines
with real actors and controlled promises, including cancel and stale-result
cases. Serialize persistence writes and retain migration data until adoption
succeeds. Split large components along flow ownership, not arbitrary line counts.

Examples include sidebar preference migration and bounded quota recovery,
Settings' open-config flow, AI Accounts removal, Jujutsu graph navigation and
review migration, and Prompt Stash's library editor and draft migration. Leave
ported native stores diffable against upstream. Simple Workbench, Memory and
command-palette presentation state does not justify an additional actor.
Memory Host shutdown/drain and the JJ workspace sweeper are separate lifecycle
work, not prerequisites for these client-state guardrails.

## HTTP fakes and verification

HTTP test services expose pure Hono app factories with explicit routes.
`@hono/node-server` binds loopback port zero; `streamSSE` owns streaming. Provider
chat dispatch stays independently testable. Command Code, OAuth MCP and Hub
fakes follow this pattern; stdio MCP and CLI fakes do not need HTTP adapters.
See [the E2E guide](e2e-testing.md) for fixtures, journeys and scratch verification.

Run the narrow checks while iterating:

```sh
node plugins/scripts/check-workspace-contract.ts
node --run lint
node --run knip
node --run check:diff
```

`pnpm run check` adds script, dshx, plugin and desktop validation, profile
contracts, boot and smoke journeys, plus lint and formatting. Before landing a
plugin change, also run its scoped journeys with
`DSHX_E2E_ONLY=<plugin> node --run check:e2e` and the applicable scratch
`dshx dev` path. Keep focused evidence separate from unrelated baseline failures.
Never restart the live DSH to validate a guardrail or plugin change.
