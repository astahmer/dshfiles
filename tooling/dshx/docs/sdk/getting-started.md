# Native plugin SDK

The new API is additive. `defineHost`, `defineClient`, `defineSlot`, native named exports, and the raw Cordis context remain available. DSH owns discovery, activation, services, RPC, slots, settings, and cleanup. DSHX supplies authoring APIs and emits the same native Host module and lazy Client factory as before.

This page documents implemented APIs. Our [source fork](../../FORK.md) is built locally; the upstream npm package does not contain these changes.

### Host package bundling

Host packages stay external by default so DSH can provide one shared runtime identity. A Host may opt specific package roots into its single-file artifact when it must use a local fork:

```ts
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  host: {
    bundleDependencies: ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-session'],
  },
})
```

The list accepts bare package roots, not subpaths. Node built-ins and `@deepseek-ai/cordis` remain external; bundling another Cordis copy would split the Host's service identity.

## Create and develop

Build the source fork's `create-dshx` and `@dshfiles/dshx` packages, then invoke its CLI:

```sh
node packages/dshx/dist/cli/bin.js create my-plugin --template ui
cd my-plugin
pnpm check
pnpm dev
```

`basic`, `ui`, `tool`, and `full-stack` choose a command, React panel, tool, or shared RPC/settings example. Existing `starter` and `showcase` names remain available. Host-only templates have no browser entry or client metadata. The fork's create command links the generated project to this local SDK source; it does not silently substitute an upstream release. CSS Modules, Tailwind, and ordinary CSS imports use the existing Vite pipeline.

Templates include native provider metadata. When adding a Client capability in `uses`, run `pnpm exec dshx check --fix` to derive the required provider edges. Aliased imports and local constant tuples are recognized without evaluating source. Dynamic definitions and raw native extensions retain explicit metadata.

`pnpm dev` uses DSHX's existing project profile and native Host/Client tooling: Client HMR and Host restart remain native DSH operations. Use `dshx dev --port 0` for an isolated port while another DSH instance is running.

For complete paths based on the owned DSH plugins—including schema-backed panels, session-bound UI and tool calls, settings, state, subprocesses, and raw Cordis extensions—see [authoring recipes](../recipes.md).

## Add a command

`src/host.ts`:

```ts
import { definePlugin } from '@dshfiles/dshx/host'

export default definePlugin({
  id: 'hello',
  uses: ['commands'],
  setup(api) {
    api.commands.register({
      name: 'hello',
      description: 'Say hello',
      handler(invocation) {
        return { kind: 'success', text: `Hello${invocation.rawInput}` }
      },
    })
  },
})
```

These are DSH slash commands with native invocation/result types. Browser shortcuts are a separate native service. `uses` creates native service injection before activation and controls which capability members TypeScript exposes. It is not a permission sandbox. A required service disappearing unloads the native plugin; Cordis owns reactivation when it returns.

## Add ordinary React UI

`src/client.tsx`:

```tsx
import { defineClientPlugin } from '@dshfiles/dshx/client'

function Inspector() {
  return <section className="inspector">My plugin view</section>
}

export default defineClientPlugin({
  id: 'hello',
  uses: ['sidebar'],
  setup(api) {
    api.sidebar.register({ id: 'hello-inspector', title: 'Inspector', component: Inspector })
  },
})
```

The adapter pairs the native keyed `main` contribution with a `sidebar.panellist` navigation row. DSH owns selection and rendering. The returned handle has `show()` and `dispose()`; unload also removes both contributions. The reserved `conversation` id is rejected. Main views have root scope and receive native standard props; they have no guaranteed session binding. An optional icon component receives native `size` and `active` props. CSS imports and the existing Vite pipeline continue working.

`api.panels.register(...)` provides the same pairing when panel terminology is more useful. For arbitrary extension points, use the native typed registration:

```tsx
export default defineClientPlugin({
  id: 'hello',
  uses: ['ui'],
  setup(api) {
    api.ui.register({ name: 'sidebar.footer.action', id: 'hello-footer', order: 100 }, props => <span>{props.wide ? 'Hello' : 'H'}</span>)
  },
})
```

Both native registration overloads remain typed, including store, children, inject, locale and slot-specific owner props. Contributions wait for the slot declaration, disappear when it collapses, return when it is declared again, and stop waiting on plugin unload. Register into inner additive slots: replacing `root` or `sidebar` replaces the native shell/column.

## Composer actions

```tsx
import { defineClientPlugin, type ComposerActionProps } from '@dshfiles/dshx/client'

function GreetingAction({ inputActions }: ComposerActionProps) {
  return (
    <button type="button" onClick={() => inputActions.setDraft('Hello!')}>
      Greeting
    </button>
  )
}

export default defineClientPlugin({
  id: 'greeting',
  uses: ['composer'],
  setup(api) {
    api.composer.registerAction({ id: 'greeting-action', placement: 'left', component: GreetingAction })
  },
})
```

The component receives the real Session standard props. Native `inputActions` owns the draft. For asynchronous insertion, capture a native insertion span first and pass it to `insertText` when work finishes; its `false` result means the draft moved or submission began. Native draft attachment actions accept existing browser-owned ids. Creating a new durable attachment kind or upload transport is not supplied by this wrapper. Use typed UI slots for explicit replacement of a native attachment rail.

## Tools, events and resources

```ts
import { definePlugin, defineTool } from '@dshfiles/dshx/host'

export default definePlugin({
  id: 'hello',
  uses: ['tools'],
  setup(api) {
    api.tools.register(
      defineTool({
        name: 'hello_tool',
        description: 'Return a greeting',
        parameters: { name: { type: 'string' } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(input, execution) {
          execution.signal.throwIfAborted()
          return `Hello ${input.name}`
        },
      }),
    )
    api.events.on('ready', () => {})
    api.lifecycle.onDispose(() => {
      /* close a resource owned by this plugin */
    })
    // Full native scoped context, including advanced Cordis effects and DI:
    api.raw.ctx
  },
})
```

Native tools retain execution policy, schema inference, rendering, concurrency and cancellation. Events preserve Cordis signatures and dispatch modes. Import the native event package's types when augmenting events not already included by your capabilities. Native listeners and registration methods already own their cleanup; do not wrap every registration in another effect. Use `lifecycle.onDispose` for resources you acquire yourself, or return cleanup from `setup`.

## Typed native configuration

`definePlugin` accepts a Standard Schema as `Config`. Its output type becomes `api.config`, and Cordis validates and transforms the row once before each activation. DSHX does not parse it again:

```ts
import { z } from 'zod'
import { definePlugin } from '@dshfiles/dshx/host'

export default definePlugin({
  id: 'hello',
  Config: z.object({
    enabled: z.boolean().default(true),
    endpoint: z.string().url(),
  }),
  setup(api) {
    api.config.enabled // boolean
    api.config.endpoint // string
  },
})
```

Validation issue messages and thrown validator errors are redacted before Cordis reports them; safe field paths remain visible. Use synchronous Standard Schema validators because the installed Cordis Config contract does not support asynchronous validation. Definitions without `Config` keep the existing untyped native config behavior. `Config` and DSHX `settings` are separate Host contracts and cannot be declared together on one entry.

## Typed Host ↔ Client communication

Keep the boundary explicit and share the contract once. Standard Schema inputs validate actual requests; generic TypeScript-only methods do not add runtime validation.

`src/contracts.ts`:

```ts
import { defineApi, method } from '@dshfiles/dshx/api'
export const greetings = defineApi({
  id: 'greetings',
  version: 1,
  methods: { get: method<void, { message: string }>() },
})
```

Host setup, with `uses: ['rpc']`:

```ts
await api.rpc.register(
  greetings.host({
    get: ({ signal, peer }) => {
      signal.throwIfAborted()
      // The admitted native operator peer is available for advanced use.
      void peer
      return { message: 'Hello' }
    },
  }),
)
```

Client setup, with `uses: ['rpc']`:

```ts
const host = api.rpc.use(greetings)
const result = await host.get()
```

For components, existing `useApi` and `useApiQuery` hooks retain their native Connection provider, cancellation, and inferred result types. The compiler uses the same package identity on both halves. Connection owns Host/Origin and browser authentication. DSH 0.2 does not support the old per-handler `authority` option; explicit values now fail with a corrective message. Use native admission primitives for stricter policies. JSON transport rejects values that would be lost or changed by serialization, including non-finite numbers, class instances and nested undefined values.

## Settings in DSH 0.2

```ts
import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const preferences = defineSettings({
  namespace: 'hello', // Must match the native Loader entry id in cordis.patch.yml.
  schema: Schema.object({ enabled: Schema.boolean().default(true) }),
})
```

Add `settings: [preferences]` to the Host definition. DSHX exports a volatile native `Config` before activation so DSH can derive the editable form, defaults and validation. One native Loader entry owns one contract; combine fields or use separate plugin entries. Settings always apply live. `base`, `validate`, and `applies: 'restart'` are rejected instead of silently ignored. Profile composition defaults remain native profile concerns.

Client components use existing `useSettings(preferences)`. DSHX reads `ConfigForms`, preserves the native snapshot/revision/write queue, and applies your optional redacted-value decoder. `set` and `unset` resolve `true` for acceptance and `false` for refusal; transport failures reject. Secret-bearing contracts require a Client decoder that removes secrets. No optimistic preferences store is added.

Experimental `defineConversation(...).render(...)` relies on the protocol-1 event registry. That registry is absent in protocol 2: the new adapter diagnoses this explicitly. Ordinary conversation UI slots remain available; arbitrary new durable event vocabularies and attachment kinds need native DSH seams.

## Test registrations without booting DSH

```ts
import { createTestHost, mountPlugin } from '@dshfiles/dshx/testing'
import plugin from './host.js'

const host = await createTestHost()
try {
  const mounted = await mountPlugin(host, plugin)
  expect(host.commands.get('hello')).toBeDefined()
  await mounted.reload()
  await mounted.dispose()
  expect(host.commands.get('hello')).toBeUndefined()
} finally {
  await host.dispose()
}
```

The Host harness uses actual Cordis, CommandRuntime, ToolRuntime and SystemPrompt. It does not emulate a session, model execution, RPC transport or profile persistence. Register extra native providers through `host.ctx` when your plugin needs them.

New projects include Vitest, a `pnpm test` script, and a native registration/unload test in `tests/host.spec.ts`. Full-stack templates test their tool contributions independently of connection and settings providers. Existing projects can install `vitest` in devDependencies and run `pnpm exec dshx test`. `--file tests/plugin.spec.ts` filters the run. The command uses that project's Vitest installation and propagates test failures.

`createTestClient()` loads the native SlotRegistry factory without mounting React. Declare test-owned root children through `client.slots.register(...)`, then inspect `client.slots.entries('main')`. Declaration loss/recreation, native ownership, reload and unload are exercised against the real registry. Add a native layout service to test `panels`/`sidebar`; the harness does not invent application layout state. Use ordinary React/browser tests for visual rendering and native standard props.

## Build and package

```sh
pnpm check
pnpm build
pnpm exec dshx package
```

`package` runs the compatibility, metadata, typecheck, and build gates, validates every declared entrypoint, then checks npm's actual pack list before producing an ordinary `.tgz`. Missing Host/Client artifacts, type declarations, executable exports, or the native Cordis bundle descriptor fail with corrective diagnostics. Packaging does not publish or install into your profile.

For distribution, the plugin remains a native DSH bundle: package metadata and `cordis.patch.yml` load the compiled Host module and lazy Client factory. DSH/Cordis remain responsible for discovery, dependencies, assembly, admission, and unload. Normal runtime npm dependencies belong in `dependencies`; DSH/React platform packages remain shared peers/development types. Validate against the receiving DSH version before publishing.
