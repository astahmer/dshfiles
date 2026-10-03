# DSHX SDK implementation evidence

Design and capability decisions: [architecture](dshx-plugin-sdk.md),
[research evidence](dshx-sdk-evidence.md).

## Repository ownership

The DSHX source hard fork is being consolidated under `tooling/dshx` inside the
`dshfiles` repository. The main package identity is `@dshfiles/dshx`; it is
consumed from local source, with no dependency on the upstream registry package.
The nested JJ/Git boundary and upstream tracking refs are being removed. Source
license, attribution, and original baseline are recorded in
`tooling/dshx/FORK.md`.

`plugins/@dshfiles/ai-accounts` is the first local consumer. It is developed and
configured in this repository; the running `web` profile remains a separate
runtime verification boundary.

## Native foundation implemented

- Explicit `definePlugin` and `defineClientPlugin` entrypoints retain native
  module exports, service injection, Cordis activation, and cleanup.
- Capability objects delegate commands, tools, prompts, slots, panels, sidebar
  navigation, and RPC to the caller's actual scoped native services.
- `api.raw.ctx`, native typed events, and cleanup are always available.
- Panel registration groups native `main` and `sidebar.panellist` contributions;
  generic UI registration follows native slot declaration disappearance and
  recreation. React components receive the real slot props.
- Existing low-level definitions remain available. Their `setup(ctx)` keeps its
  original one-argument calling convention.
- Node test utilities use native CommandRuntime, ToolRuntime, SystemPrompt,
  Cordis, and the renderer's actual SlotRegistry. They do not simulate the app
  or claim to test React rendering, sessions, or profile activation.
- A compiled SDK plugin test builds TypeScript/TSX through Vite, loads the native
  Host module and lazy Client factory, then proves reload and unregistering.

## Protocol-2 repairs

The implementation uses ConfigForms, exports editable native Config, validates
one settings contract per Loader entry, preserves native settings write
refusal, and decodes client settings snapshots. Namespace is the Loader entry
id, not a new registry.

Removed conversation event registries and unsupported loopback RPC authority
options fail with corrective diagnostics. Native Connection owns
authentication and transport. RPC payload validation rejects lossy JSON and
duplicate channel ownership; peer information survives into typed handler
context. Browser bundles do not import Node compatibility resolution. Native
built-in locale ids keep their closed type union.

The profile runner executes an existing local DSH binary directly, avoiding an
unnecessary pnpm bootstrap and package-manager store mismatch.

## Reproducibility and validation

The core package pins development DSH packages to `0.2.0-rc.2`, Cordis to
`~4.0.4`, Schemastery to `~3.18.4`, and matching React/React DOM 18 versions.
Dependencies install from the checked-in pnpm lockfile; temporary links to a
global installation are no longer needed. The Node test loader shares React
platform modules like the real browser loader does.

Foundation baseline `8442b487f4bc3f6aae78e0abd2a6d5ce29f0501c` passed 351 tests
across 32 files after a normal pnpm install, including the compiled-plugin
test. Typecheck, package build, and source lint passed at that baseline. Those
results do not cover the later in-flight SDK changes. The watch fixtures wait
for Vite's `END` boundary before editing; watch/socket checks require normal
local execution. Other workspace apps retain older dependency generations and
are not covered by these core checks.

The AI Accounts consumer has passed typecheck and build, and a disposable
profile boot served its client bundle with HTTP 200 and no plugin boot errors.
The DSH 0.2 `webServer` injection fix was applied locally to the profile
composition. The actual running GUI has not yet been restarted to verify the
Settings page in its window; probe and bundle evidence do not prove that live
UI state.

## Remaining work

1. Finish flattening the hard fork into the parent JJ repo, rename all owned SDK
   imports and local links, and regenerate the affected lockfiles after the
   active AI Accounts edits settle.
2. Bring the fork's package manager and TypeScript versions in line with this
   repo's Node toolchain contract, then run focused checks on the consolidated
   tree.
3. Complete composer helpers, source-derived provider metadata, SDK-first
   scaffold templates, test/package CLI workflows, diagnostics, documentation,
   and isolated real DSH activation.
4. Restart the `web` GUI only after the active agent's account/config work is
   complete, then verify the rendered Settings page and the requested account
   routes there.

Native APIs without an additive primitive remain explicitly unsupported rather
than being replaced with a parallel implementation.
