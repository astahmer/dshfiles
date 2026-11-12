# OpenCode v2 plugin compatibility

Backlog: b:591. Goal: run a documented subset of OpenCode V2 server plugins
(`@opencode/plugin` 2.2.x, the Promise API) inside DSH through an owned Host
plugin, `@dshfiles/opencode-compat`, report every API outside that subset by
name, and prove it with a representative plugin. No DSH core patch, no client
faking of Host state.

**Resume here:** land the stack on `main`, then run `complete-plan` (move the tables into the plugin README and delete this plan). Follow-ups: per-plugin Cordis child scopes, package-name specifiers, `ctx.event.subscribe`.

## Sources

1. OpenCode reference checkout `~/.references/opencode` at
   `67139d6827af` (2026-11-02), package `packages/plugin` 2.2.5 (npm `latest`
   2.2.7 on 2026-11-12). Contract files: `src/promise/plugin.ts` (`Context`,
   `Plugin`, `Cleanup`), `src/promise/registration.ts`, `src/promise/tool.ts`,
   `src/promise/skill.ts`, `src/promise/session.ts`, `src/promise/storage.ts`,
   `src/README.md`, `packages/schema/src/tool.ts`. Representative real plugin:
   `packages/plugins/figma/index.ts`.
2. DSH 0.2.1-rc.2 Host contracts: `dsh-tools` (`ctx.tools.register`,
   `defineTool`, `tools/pre-execute`, `tools/post-execute`, `ctx.tools.guard`),
   `dsh-skill` (`ctx.skills.register`), `dsh-system-prompt`
   (`system-prompt/assemble` → `PromptAssembly { sections, contexts, tools }`),
   `dsh-agent` (`agent/request`, `agent/turn-stopping`), `dsh-llm`
   (`llm/stream`, whose agent-loop request is frozen by design).

## Decision: build with dshx

1. **Adopt:** none. The dshmarket index (5,324 plugins, checked 2026-11-12)
   has OpenCode providers, themes and session importers, but nothing that
   loads OpenCode plugin modules.
2. **Port:** no. The OpenCode loader is Bun-first, resolves `effect` and
   `@opencode/plugin` to the OpenCode host's runtime instances, and is wired
   to OpenCode's own domain services. Nothing of it runs against DSH services.
   We reimplement the contract; OpenCode (MIT) is the spec, not vendored code.
3. **Build:** a Host-only dshx bundle that loads configured plugin modules,
   hands each a `Context` whose supported domains call DSH Host services, and
   whose other members are recorded and refused.

## Shape

1. Package `plugins/@dshfiles/opencode-compat`, Loader row
   `dshfiles-opencode-compat`, Host entry only (no client surface, so no
   screenshot). Not seeded into `profiles/web`: loading third-party plugin
   code in the Host is an explicit user choice.
2. Settings (namespace `dshfiles-opencode-compat`):
   1. `plugins`: list of `{ specifier, options, enabled }`. `specifier` is an
      absolute path to a module or directory, or a package name resolved from
      the profile directory. `options` is a JSON object passed as
      `ctx.options`. Default `[]`.
   2. `onUnsupported`: `report` (default: the call resolves to a no-op
      `Registration` or rejects with `OpenCodeUnsupportedError`, and is listed
      in status) or `fail` (the plugin's setup fails and its contributions are
      rolled back).
3. Module contract: the default export (or a named `plugin`/`server` export)
   is `{ id: string, setup(ctx) }`, as `Plugin.define` returns. The adapter
   never imports `@opencode/plugin`; a plugin that imports it at runtime
   brings its own copy from its own `node_modules` (`Plugin.define` is the
   identity function). Effect `Schema` values are accepted only from the
   `effect` instance the Host resolves; a foreign instance is reported.
4. Agent tool `opencode_plugins_status` (read-only): each configured plugin,
   its state (`loaded`, `failed`, `disabled`), its contributed tools, skills
   and hooks, and every unsupported API it touched, with the first call site.
   There is deliberately no agent tool to add or enable a plugin: that would
   let the model load arbitrary code into the Host (same reasoning as
   `policies`).
5. Telemetry: custom spans `opencode-plugin load` (import plus setup, one per
   plugin) and `opencode-plugin reload`; contributed tools ride the automatic
   `agent-tool` span. Each asserted with `recordSpans()`.

## Supported subset

| OpenCode contract                                                                      | DSH mapping                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Plugin.define({ id, setup })`, setup cleanup return                                   | Cordis fork scope per plugin; cleanup runs on scope dispose (settings change, plugin disable, Host reload) | Async setup awaited; a throwing setup marks the plugin `failed` and disposes what it registered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Registration.dispose()`                                                               | Dispose of the matching Cordis effect                                                                      | Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ctx.options`                                                                          | the row's `options` JSON                                                                                   | Frozen copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ctx.app`                                                                              | `{ name: 'dsh', version: <Host version>, channel: 'opencode-compat' }`                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.tool.transform` editor `add` / `list` / `get` / `update` / `remove` / `namespace` | `ctx.tools.register(defineTool(...))` per added tool                                                       | Editor sees this plugin's tools plus earlier plugins' compat tools; DSH native tools are listed read-only, `update`/`remove` on them is reported. `namespace` prefixes names (`<ns>_<name>`). Input schema: Effect `Schema` (via the Host `effect` JSON Schema encoder), Standard Schema with `~standard.jsonSchema`, or raw JSON Schema in DSH's enforced subset; anything else fails that tool with a reported reason. `execute` gets `{ sessionID, agent, messageID, id, signal, progress }`; `progress` is a no-op. Result `content` (string or text blocks) becomes tool content; `output` becomes the canonical value; `Tool.Error` becomes a tool error. `options.codemode`/`pinned`/`permission` are ignored and reported once. |
| `ctx.tool.reload()`                                                                    | Re-run every tool transform of the plugin, diff, re-register                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.tool.list()`                                                                      | Compat tools after all transforms                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.tool.hook('execute.before')`                                                      | `tools/pre-execute` waterfall                                                                              | Observes every tool call. Throwing denies the call with the error message. Mutating `input` or `tool` is not applied (DSH freezes arguments) and denies the call with a reason naming the unsupported rewrite (Host gap row 112).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ctx.tool.hook('execute.after')`                                                       | `tools/post-execute` waterfall                                                                             | `status`, `result` (`content`, `output`, `metadata`) or `error`. Replacing `result.content` replaces the content the model sees; other edits are reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.skill.transform` editor `add` / `list` / `get` / `update` / `remove`              | `ctx.skills.register(...)` (runtime provider)                                                              | `Skill.Info` → DSH skill (`name`, `description`, `content`; `autoinvoke: false` → `modelInvocable: false`). `update`/`remove` only on this plugin's own skills.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.skill.reload()`                                                                   | Re-run skill transforms                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.session.hook('context')`                                                          | `system-prompt/assemble` waterfall                                                                         | `system` maps to the assembly's sections (edit, append, remove text); `tools[name].description` edits and `delete tools[name]` map to the assembly's tool list. `messages` and `options` edits are reported and ignored: DSH builds the request from the Session log and freezes it (intentional, not a gap). `sessionID`/`agent`/`model` come from the assemble context when present.                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.storage.get` / `set` / `remove` / `scan`                                          | Plugin-owned JSON store under the profile data dir, one namespace per plugin id                            | Keys and `scan({ prefix, after, limit })` ordering as OpenCode documents; values are JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.event.subscribe`                                                                  | —                                                                                                          | Phase 2 candidate (`session/event` projection). Unsupported in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Unsupported in v1

Every member below exists on the context object, so a plugin never sees a
`TypeError`; each call or property read is recorded in status and follows
`onUnsupported`:

1. Provider and model plumbing: `ctx.provider.*`, `ctx.model.*`, `ctx.aisdk.*`,
   `ctx.credential.*`. DSH routes models through its own LLM adapters and the
   `ai-accounts` plugin; no AI SDK instance exists to hand out.
2. `ctx.mcp.*` (MCP server config is owned by `@dshfiles/mcp-servers`; a
   bridge is phase 2 if a real plugin needs it).
3. `ctx.command.*`, `ctx.agent.*`, `ctx.reference.*`, `ctx.integration.*`,
   `ctx.websearch.*`, `ctx.vcs.*`, `ctx.worktree.*`, `ctx.rpc.*`,
   `ctx.plugin.list`.
4. Session API verbs (`ctx.session.create`, `prompt`, `synthetic`,
   `compact`, `interrupt`, …) and every session hook except `context`:
   `prompt`, `compaction`, `generate`, `title`, `model.request`,
   `http.request`, `http.response`, `experimental.ws.*`, `retry`,
   `experimental.idle`.
5. `ctx.permission.*`, `ctx.shell.hook`, `ctx.location`,
   `ctx.experimental.*`, `ctx.generate`.
6. TUI and GUI entrypoints (`./tui`, `./gui-experimental`) and the Effect
   API (`@opencode/plugin/effect`). Only the server entrypoint loads.
7. Hot reload on plugin source change. A settings change reloads; a source
   change needs a settings toggle.

## Representative plugins

1. Fixture `tests/fixtures/opencode-sample/index.js`, written to the
   documented contract (no adapter imports): adds an `oc_echo` tool with an
   Effect `Schema` input, an `execute.before` hook that denies a marker
   argument, an `execute.after` hook that appends a suffix, one skill, a
   `context` hook that appends a system line, storage reads/writes, a cleanup
   function, and one unsupported call (`ctx.mcp.transform`).
2. The upstream `opencode.figma` plugin loaded from a copy of
   `packages/plugins/figma` with its `skills/`: its skills register, its
   `ctx.mcp.transform` is reported. Proves a real third-party plugin, not only
   our fixture.

## Slices

Each slice is one jj revision (or a short stack) in its own thread workspace.

| Slice | Scope                                                                                                                                                                                                                                                                            | Owner        | State                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| P     | This plan; Host gap row 112                                                                                                                                                                                                                                                      | lead         | done                                                                                                            |
| A     | Scaffold bundle (workspace contract, Loader row, settings, `dshx.features.json`), module loader, per-plugin Cordis scope, cleanup/dispose, unsupported-API recorder (proxy) with `report`/`fail`, `opencode_plugins_status` tool, `opencode-plugin load` span, unit + Host tests | codex        | done (Cordis child scope replaced by adapter-tracked registrations)                                             |
| B     | `ctx.tool` domain: editor, schema conversion, `defineTool` bridge, reload, `execute.before`/`execute.after` hooks; Host tests inside the real DSH tool runtime                                                                                                                   | codex + lead | done                                                                                                            |
| C     | `ctx.skill`, `ctx.session.hook('context')` via `system-prompt/assemble`, `ctx.storage`; Host tests                                                                                                                                                                               | codex + lead | done (lead: edits to existing sections apply)                                                                   |
| D     | Fixture plugin + figma copy, end-to-end Host test, E2E feature (fake Command Code model calls `oc_echo`), README with the supported/unsupported tables, `features:check`                                                                                                         | codex + lead | done (unmodified upstream figma `index.ts`; Figma skill bodies replaced by placeholders, Figma Developer Terms) |
| V     | Lead review, focused checks, scratch-DSH journey, `pnpm test/lint/typecheck/fmt` once, b:591 update                                                                                                                                                                              | lead         | in progress                                                                                                     |

B and C run in parallel after A lands; they own separate domain files and
touch only the context factory's wiring line.

## Verification

1. `pnpm --dir plugins/@dshfiles/opencode-compat test` and `typecheck`.
2. `node plugins/scripts/check-workspace-contract.ts` (via its pnpm script),
   `pnpm features:check`.
3. Built Host bundle import check (`dsh-plugin-verify`).
4. Scratch DSH (`verify-dsh` / the E2E feature): a thread on the fake model
   calls `oc_echo`, gets the hooked result; status lists the unsupported
   `ctx.mcp.transform`. Never the live instance.
