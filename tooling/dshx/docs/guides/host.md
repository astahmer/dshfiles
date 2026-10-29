# Host API

**Status: Supported**

**Entry: `@dshfiles/dshx/host`**

## `defineHost(definition)`

```ts
interface HostDefinition {
  readonly name?: string
  readonly inject?: readonly string[]
  readonly tools?: readonly (ToolDefinition | ((ctx: Context) => ToolDefinition))[]
  readonly commands?: readonly CommandDefinition[]
  readonly prompts?: readonly PromptContribution[]
  readonly settings?: readonly SettingsContribution[]
  readonly apis?: readonly ApiHostRegistration[]
  readonly toolEdits?: readonly ToolEdit[]
  readonly agentPresets?: readonly PresetDefinition[]
  readonly providers?: readonly ProviderContribution[]
  readonly models?: readonly ModelDiscoveryContribution[]
  readonly skills?: readonly SkillRegistration[]
  readonly mcpServers?: readonly McpServerConfig[]
  readonly hooks?: HostHooks | ((ctx: Context) => HostHooks)
  readonly setup?: (ctx: Context) => void | Promise<void>
}
```

`defineHost()` preserves the exact inferred object type and rejects unknown fields. Use only `apis`; the singular `api` field was removed in `0.1.2`.

```ts
import { defineHost, defineTool } from '@dshfiles/dshx/host'

const statusTool = defineTool({
  name: 'plugin_status',
  description: 'Return plugin status.',
  parameters: {},
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute() {
    return 'ready'
  },
})

export default defineHost({
  name: 'my-plugin',
  tools: [statusTool],
})
```

`defineTool` is the official DSH Tool helper. A tool may instead be a synchronous factory receiving the Host's injected Cordis context: `tools: [ctx => createMyTool(ctx)]`. Declare every service the factory uses in `inject`. DSHX calls the factory during Host activation and registers the returned tool with the same owner metadata and lifecycle as a static tool. Do not read Host services from the scoped `execution.agent.ctx` unless that context declares them.

`defineCommand` is an identity helper over the official `CommandDefinition`; DSHX does not wrap command parsing or execution.

## Registration order

The generated `apply(ctx)` executes contributions in this fixed order:

1. Tools, in array order.
2. Commands, in array order.
3. Prompt Sections and Contexts, in array order.
4. Settings, in array order.
5. APIs, after every API channel is registered.
6. `setup(ctx)`.

Equal-order Prompt contributions retain Host array registration order. Official registries remain authoritative for duplicate names, shadowing, scope, validation, and disposal.

## Automatic injects

DSHX starts with `inject`, removes duplicates, and appends a service only when its contribution list is non-empty.

| Contribution | Cordis service |
| ------------ | -------------- |
| `tools`      | `tools`        |
| `commands`   | `commands`     |
| `prompts`    | `systemPrompt` |
| `settings`   | `settings`     |
| `apis`       | `connection`   |

An empty or omitted list adds no service. Package/provider edges in `package.json` are separate from Cordis service names and are validated by `dshx check` and `dshx build`.

## `setup(ctx)` and disposal

Use `setup` for direct official services or behavior that has no DSHX contribution helper:

```ts
export default defineHost({
  inject: ['events'],
  setup(ctx) {
    ctx.effect(() => {
      const dispose = startObserver(ctx)
      return () => dispose()
    }, 'my-plugin observer')
  },
})
```

DSHX does not keep a disposer array. Register lifecycle ownership with `ctx.effect()` or use the disposer semantics of the official registry being called. A Settings `.host({ setup })` disposer is passed to `ctx.effect()` automatically.

## Runtime validation

The built adapter reports a Host-definition diagnostic when the default export is not a `defineHost()` object, contains an unknown field, uses a malformed contribution, or supplies a non-function `setup`. Native DSH Host modules remain supported when they export named `name`, `inject`, `Config`, and `apply` instead of a default definition.

## Hooks that rewrite behaviour: `hooks`

Typed hooks over DSH's own middleware. Each runs in DSH's chain for that point; `undefined` leaves the decision to the
rest of the chain, and a hook that throws is logged under `dshx:hooks` and treated as `undefined`. Pass a function of
the Host context to read services (`hooks: ctx => ({ … })`); a factory declares the services it reads in `inject`.

```ts
export default defineHost({
  hooks: {
    promptAdmission: ({ agent, messages }) => (isPaused(agent.id) ? 'reject' : { messages: messages.map(redact) }),
    request: ({ config }) => (config.model.startsWith('opus') ? { maxTokens: 8_000 } : undefined),
    systemPrompt: ({ assembly }) => ({ ...assembly, sections: [...assembly.sections, { name: 'acme:rule', text: 'Cite files.' }] }),
    retry: ({ failure }) => (failure.code === 'OVERLOADED' ? 'retry' : undefined),
    permission: request => (request.toolName === 'read' ? 'allowed-once' : undefined),
    toolBefore: execution => (execution.name === 'bash' && isDestructive(execution.arguments) ? { kind: 'deny', reason: 'Ask first.' } : undefined),
    toolAfter: (execution, result) => (result.isError ? undefined : { kind: 'accept', content: redactContent(result.content) }),
    shellEnv: { name: 'acme', variables: { ACME_HOME: { description: 'Acme root' } }, resolve: () => ({ ACME_HOME: '/opt/acme' }) },
    http: (request, response) => {
      if (request.url !== '/api/acme/health') return false
      response.end('ok')
      return true
    },
  },
})
```

| Hook | DSH point | Runs | Returns |
| --- | --- | --- | --- |
| `promptAdmission` | `agent/pre-step` | before later listeners | `{ messages }` to replace what the step admits (text, files), `'reject'` to hold the step |
| `request` | `agent/request` | after the chain | a patch of provider, model, reasoning effort, temperature, max tokens, stop |
| `systemPrompt` | `system-prompt/assemble` | after the chain | the assembly: sections, contexts, tool schemas |
| `retry` | `agent/request-error` | after the chain | `'retry'` or `'stop'` |
| `permission` | `approval/request` | before the chain | an approval outcome, answering for the user |
| `toolBefore` | `tools/pre-execute` | before the chain | `allow`, `deny`, `cancel` or `ask` |
| `toolAfter` | `tools/post-execute` | after the chain (not after a `block`) | `accept` with new content or value, or `block` with feedback |
| `shellEnv` | `shellEnv.register` | per `bash` call | environment variables |
| `http` | `connection/request` | for authenticated requests under `/api`, before Connection routes them | `true` once the response is written |

Not covered: request hooks by kind for side calls (compaction, titles). `llm/stream` is the only point that sees them,
and its `next()` streams the original options, so a listener cannot rewrite them without running the whole chain twice.
The agent loop's message list is rewritten through `@dshfiles/request-messages`' `agent/request-messages` event, and its
tool list through [`toolEdits`](#editing-other-plugins-tools-tooledits). WebSocket upgrades have no DSH middleware point.

## Registering agents, providers, models, skills and MCP servers

Each field registers into DSH's own registry for the plugin's lifetime; the registry validates and refuses duplicates.

```ts
export default defineHost({
  agentPresets: [{ id: 'acme-reviewer', name: 'Reviewer', plugins: [{ name: '@deepseek-ai/dsh-tool-fs' }] }],
  providers: [
    {
      providers: ['acme'],
      adapter: new AcmeAdapter(), // an LlmAdapter from @deepseek-ai/dsh-llm
      configurable: [{ provider: 'acme', displayName: 'Acme', settingsNs: 'acme-llm', settingsPath: ['apiKey'] }],
    },
  ],
  models: [{ settingsNs: 'acme-llm', discover: async (request, signal) => listAcmeModels(request, signal) }],
  skills: [{ name: 'acme-release', description: 'How Acme ships a release.', source: 'runtime', content: '…' }],
  mcpServers: [{ transport: 'stdio', serverName: 'acme-docs', command: 'acme-docs-mcp' }],
})
```

| Field | DSH registry | Inject added |
| --- | --- | --- |
| `agentPresets` | `agentPresets.register` (a preset is a list of Loader rows) | `agentPresets` |
| `providers` | `llm.registerAdapter`, `llm.registerConfigurableProviders` (Settings › Models) | `llm` |
| `models` | `llm.registerModelDiscovery` | `llm` |
| `skills` | `skills.register` | `skills` |
| `mcpServers` | one `@deepseek-ai/dsh-mcp-client` plugin per server, loaded on first use from the Host installation | none |

Commands already have `commands`. Not covered, because DSH 0.2.1 has no registry for them: references (the Session
reference resolver and file references are fixed services), integrations (no DSH concept), and credentials (one
`CredentialProvider` service that stores values by reference; owned plugins keep `secret:` references resolved through
the Secret Catalog instead). Registrations that change at runtime (ai-accounts' per-account providers) keep calling the
services, whose handles can `replace` entries.

## Editing other plugins' tools: `toolEdits`

`tools` adds tools. `toolEdits` changes the tools an agent sees, whoever registered them:

```ts
export default defineHost({
  toolEdits: [
    { tools: 'bash', update: tool => ({ ...tool, description: `${tool.description} Prefer rg over grep.` }) },
    { tools: 'web_fetch', remove: true, agents: agent => agent.session.header.cwd?.startsWith('/secure') === true },
    { tools: /^jj_/, rename: name => `vcs_${name}` }, // a namespace: the old names disappear
    { codeMode: true, agents: agent => agent.id === reviewerSessionId }, // DSH's `ptc` presentation: one run_code tool
  ],
})
```

- Each edit applies per agent, in that agent's own tool scope (DSH's `tools.register`, `tools.restrict` and
  `tools.presentAs` on `agent.ctx`), to every live agent and each one created later. The global registry and other
  agents are untouched, and every edit is lifted when the plugin unloads or the agent ends.
- `update` returns the definition the agent sees and runs, so it may also wrap `execute`. `rename` keeps the original
  definition (or the updated one) under the new name.
- Only global tools can be edited (`defineHost({ tools })`, API tools, MCP tools): a tool an agent preset registers in
  the agent's own scope is not restrictable or shadowable there. An edit that matches nothing, or that DSH refuses
  (`codeMode` on a preset that already chose a presentation), is logged under `dshx:tool-edits` and skipped.
- Tools registered after an agent was created are not edited for that agent.

## Plugin storage: `pluginStorage(ctx, namespace)`

Durable key-value storage for one plugin, kept by the Host's storage domain (`@deepseek-ai/dsh-storage-domain`, in
every web profile) in one `dshx_plugin_kv` domain per process. Use the plugin's package name as the namespace: the
browser half reads the same entries through `hostStorage(api)`.

```ts
import { pluginStorage } from '@dshfiles/dshx/host'

const storage = pluginStorage(ctx, '@acme/plugin')
await storage.set('runs/2026-10-29', { ok: true }) // JSON, at most 256 KiB; resolves once durable
const entry = await storage.get('runs/2026-10-29') // { key, value, updatedAt } | undefined
await storage.delete('runs/2026-10-29') // true when it existed
let page = await storage.list({ prefix: 'runs/', limit: 100 })
while (page.cursor !== null) page = await storage.list({ prefix: 'runs/', cursor: page.cursor })
```

- `list` returns keys in code-unit order, at most `limit` (default 100, max 500), and a `cursor` (the last key) while
  more match; pass it back to read the next page. Keys may contain `/`, so a prefix works as a folder.
- Without the storage-domain row every call rejects with `PluginApiError` code `storage-unavailable`, whose message
  says which row to add.
- The first loaded dshx Host with an API (the registry leader) serves the `storage` API (owner `@dshfiles/dshx`) to browsers and publishes its `changed` event (`{ namespace, key, deleted }`) for every write, from the
  Host half or a browser.
- Prefer it to a plugin-owned domain for small, schemaless state. A plugin that needs typed tables, its own schema
  version or a global singleton still declares its own `defineDomain`.

## One-off model calls: `generate(ctx, input)`

One model call outside any thread: no tools, nothing written to a Session log. It replaces the hand-rolled
`llm.stream` + `BlockAssembler` loop.

```ts
import { generate } from '@dshfiles/dshx/host'

const { text } = await generate(ctx, { prompt: diff, system: 'Summarize this change in one line.', signal })
const { value } = await generate(ctx, {
  prompt: 'Name this thread.',
  schema: z.object({ title: z.string().max(60) }), // value: { title: string }
  model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  sessionId, // providers keyed per session need the thread id
})
```

- `model` defaults to the Host's default model (`agentDefaultModel`). A reasoning effort the model refuses is dropped
  and the call retried once.
- With `schema` (any Standard Schema; zod also publishes its JSON Schema to the model) the reply must be one JSON value;
  a code fence is tolerated. One invalid reply is answered with the validation issues; a second fails.
- Failures are `PluginApiError`s with codes `llm-unavailable`, `model-unavailable`, `generate-failed`,
  `generate-aborted` and `generate-invalid-output`, so an API handler can return them to a browser as they are.
- The call is marked `purpose: 'compaction'`, the side-call marker usage recorders and the request-messages polyfill
  read; a plugin that needs it in a thread's own request series runs it through that thread instead.
- `generate` imports `@deepseek-ai/dsh-llm` on its first call, so a Host that never calls it carries no dsh-llm import;
  one that does declares it in `peerDependencies` (DSHX4005 says so at build).

## Related chapters

- [Prompt](./prompt.md)
- [Settings](./settings.md)
- [Typed API](./api.md)
- [Build](./build.md)
