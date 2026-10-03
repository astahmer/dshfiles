# DSHX SDK implementation evidence

Design and capability decisions: [architecture](dshx-plugin-sdk.md),
[research evidence](dshx-sdk-evidence.md).

## Checkout ownership

SDK development lives in `forks/dshx-fork`, an independent colocated Jujutsu
checkout based on `c9ea7e6eef5b04aef2360d60102309cbde53d36b`. Its upstream
bookmark remains `dshx-upstream` at
`8048a780a263cbd788b71d316f2ec84a272158f8`.

The ongoing DSH account-plugin session owns
`/Users/astahmer/Documents/deepseek-harness/default-workspace`, including its
original fork and `@dshfiles/ai-accounts`. We read its progress through
`node scripts/dsh-session-status.mjs`; this prints tool descriptions rather
than credentials or tool payloads. We have not changed that checkout, its
account configuration, or its running profile. A later relocation must preserve
the independent SDK commits rather than replace this fork with the older copy.

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

The prior compatibility commit compiled but retained several protocol-1
assumptions. The implementation now uses ConfigForms, exports editable native
Config, validates one settings contract per Loader entry, preserves native
settings write refusal, and decodes client settings snapshots. Namespace is
the Loader entry id, not a new registry.

Removed conversation event registries and loopback RPC authority options fail
with corrective diagnostics instead of claiming unsupported capabilities.
Native Connection owns authentication and transport. RPC payload validation
rejects lossy JSON and duplicate channel ownership; peer information survives
into typed handler context. Browser bundles do not import Node compatibility
resolution. Native built-in locale ids keep their closed type union.

The profile runner executes an existing local DSH binary directly, avoiding an
unnecessary pnpm bootstrap and package-manager store mismatch.

## Reproducibility and validation

The core package pins development DSH packages to `0.2.0-rc.2`, Cordis to
`~4.0.4`, Schemastery to `~3.18.4`, and matching React/React DOM 18 versions.
Dependencies install through the refreshed pnpm lockfile; temporary links to
the user's global installation are no longer needed. The Node test loader
shares React platform modules like the real browser loader does.

Foundation commit: `8442b487f4bc3f6aae78e0abd2a6d5ce29f0501c`.
All 351 tests across 32 files passed after a normal pnpm installation, including
the compiled-plugin test. Typecheck, package build, and source lint passed.
The watch fixtures now wait for Vite's `END` boundary before editing; an artifact
can appear before the initial watch setup has finished. Watch/socket checks
need normal local execution; the restricted shell cannot exercise those OS
integrations. Other upstream workspace apps retain their older dependency
generation and have not been claimed as verified by these core checks.

The user clarified that this is a maintained source hardfork. The temporary
patch export has been removed; source files and their own Jujutsu/Git history
are the implementation. See `forks/dshx-fork/FORK.md`. The fork remains an
independent source repository while the account-plugin agent edits the parent
repository history. No patch application or upstream DSHX installation is needed.

## Remaining work toward the full goal

This is an implemented foundation, not a claim that the complete ecosystem
toolchain is finished. Next slices cover native composer helpers, source-derived
provider metadata, SDK-first scaffold templates, test/package CLI workflows,
diagnostics and publishing documentation, dependency/workspace examples, and
isolated real DSH activation. No shared profile mutation is needed to develop
those slices. Native APIs without an additive primitive remain explicitly
unsupported, rather than being replaced with a parallel implementation.
