# DSHX documentation

DSHX exposes a small authoring surface and keeps compiler/runtime internals out of application bundles. These labels describe API maturity and change policy.

| Label             | Meaning                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Supported**     | Documented production API. Breaking changes require a migration note and an entry in [compatibility](./compatibility.md).      |
| **API Candidate** | Intended authoring shape; names and behavior may change. Breaking changes are recorded in [compatibility](./compatibility.md). |
| **Experimental**  | May change at any time; import only from an `experimental` or Tooling entry.                                                   |
| **Tooling**       | Node-only compiler, compatibility, diagnostic, and CLI APIs. Never import into Host or Client source.                          |

## API chapters

1. [Host](./guides/host.md) — `defineHost`, Tools, Commands, registration order, injection, and lifecycle.
2. [Client, Locale, and Slots](./guides/client.md) — `defineClient`, `defineLocale`, `defineSlot`, official Slot props, Hook-driven capabilities, and lifecycle.
3. [Typed API](./guides/api.md) — `defineApi`, Standard Schema transforms, Host handlers, imperative calls, `useApiQuery`, Host events (`useApiEvent`), and errors.
4. [Settings](./guides/settings.md) — shared Schemastery contract, Host ownership, safe Client decoding, reads, and mutations.
5. [Prompt](./guides/prompt.md) — Prompt Sections, dynamic Contexts, ordering, scope, assembly, and ownership.
6. [Conversation](./guides/conversation.md) — experimental pure event lifecycle plus React renderer.
7. [Build](./guides/build.md) — bounded config, Vite plugin extensions, CSS/assets, declarations, and watch behavior.
8. [Creator](./guides/creator.md) — template/style matrix, generated dependencies, and automation.
9. [Tooling](./guides/tooling.md) — experimental Node-side build/watch, config, compatibility, diagnostics, CLI, and repair APIs.
10. [Tracing](./guides/tracing.md) — metadata-only Host spans, OTLP/HTTP JSON export behind `OTEL_EXPORTER_OTLP_*`, and what is never recorded.

Additional references:

- [CLI reference](./cli-reference.md)
- [Agent communication](./agent-communication.md) — the shared typed service, quiet delivery model, CLI, MCP, and activation steps.
- [Compatibility and verification](./compatibility.md)
- [Installed verification binaries](./verification-binaries.md) — optional stock DSH and Chromium selection for isolated checks.
- [Architecture](./architecture.md)
- [Dependency policy](./dependency-policy.md) — when to adopt a package instead of writing a generic helper.

## Public entry points

| Entry                                      | Status                 | Browser-safe | Purpose                                                                       |
| ------------------------------------------ | ---------------------- | ------------ | ----------------------------------------------------------------------------- |
| `@dshfiles/dshx`                           | API Candidate          | Yes          | `defineConfig`, `DshxConfig` only                                             |
| `@dshfiles/dshx/config`                    | API Candidate          | Yes          | Same config-only surface                                                      |
| `@dshfiles/dshx/host`                      | Supported              | No           | Host definitions, contributions, and scoped lifecycle setup                   |
| `@dshfiles/dshx/client`                    | API Candidate          | Yes          | Client definitions, Locale/Slot contributions, and React Hooks                |
| `@dshfiles/dshx/api`                       | API Candidate          | Yes          | Shared typed API contracts and error guards                                   |
| `@dshfiles/dshx/settings`                  | API Candidate          | Yes          | Shared Settings contracts                                                     |
| `@dshfiles/dshx/tracing`                   | API Candidate          | No           | Host spans and OTLP trace export (off unless an endpoint is configured)       |
| `@dshfiles/dshx/experimental/conversation` | Experimental           | Yes          | Conversation lifecycle and renderer contributions                             |
| `@dshfiles/dshx/tooling`                   | Tooling / Experimental | No           | Compiler, config resolution, compatibility, diagnostics, CLI, and repair APIs |

The removed `@dshfiles/dshx/compiler`, `/compat`, `/cli`, and `/conversation` entries have no runtime aliases.

## Ownership boundary

DSHX defines contracts, validates project wiring, runs Vite builds, and generates DSH-loadable modules. Official DSH/Cordis services continue to own registries, scopes, transport, Prompt assembly, Settings persistence, Conversation replay, disposer lifetimes, and HMR cleanup.
