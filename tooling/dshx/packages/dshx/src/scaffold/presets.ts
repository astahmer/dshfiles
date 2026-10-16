import { DEFAULT_COMPATIBILITY } from '../compat/index.js'
import type { DshCompatibility } from '../compat/types.js'

/**
 * Preset scaffolding for the contributions a plugin actually writes.
 *
 * `add ui` covers a single slot. The contributions that follow it in every real
 * plugin — a panel, a typed API, a tool — each went without a generator, so each
 * one was hand-written twice before it was written once correctly.
 *
 * A preset emits the whole shape, including the parts that are easy to get
 * wrong: the imports that make the panel id typecheck, the handler and the
 * client hook a contract implies, and the registration test that proves a
 * mount/unmount cycle instead of snapshotting the generated string. The preset
 * writes only new files; the wiring into the existing client and host entries
 * is the scaffolder's job (preset.ts), using the entry snippets below.
 */
export type PresetName = 'panel' | 'api'

export interface PresetOptions {
  readonly preset: PresetName
  /** Package id, used for the generated symbol names and the API id. */
  readonly packageId: string
  /** Panel id or slug, used as the sidebar row id, the main panel key, and the API channel. */
  readonly id: string
  readonly compatibility?: DshCompatibility
}

export interface PresetFile {
  /** Path relative to the project root. */
  readonly path: string
  readonly content: string
}

const kebab = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

const pascal = (value: string): string =>
  kebab(value)
    .split('-')
    .filter(part => part.length > 0)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')

/** Cordis Loader entry id for a package, scoped so it cannot replace a native row. */
const packageEntryId = (packageId: string): string => {
  const slug = kebab(packageId.split('/').at(-1) ?? 'plugin')
  const scope = kebab(packageId.split('/')[0]?.replace('@', '') ?? '')
  return scope === '' ? slug : `${scope}-${slug}`
}

export interface PresetSymbols {
  readonly stem: string
  readonly component: string
  readonly apiId: string
  readonly apiSymbol: string
  readonly hostSymbol: string
}

/** Names the presets and the wiring share, derived once so they cannot drift apart. */
const presetSymbols = (options: PresetOptions): PresetSymbols => {
  const stem = kebab(options.id).replace(/-panel$/, '')
  let apiId = kebab(options.id).replace(/-api$/, '')
  if (/^\d/.test(apiId) || apiId === '') apiId = 'api'
  return {
    stem: stem === '' ? 'panel' : stem,
    component: `${pascal(stem === '' ? 'panel' : stem)}Panel`,
    apiId,
    apiSymbol: `${pascal(apiId)}Api`,
    hostSymbol: `${pascal(apiId)}ApiHost`,
  }
}

/** Files one preset writes, plus the manifest edits it implies. */
const presetFiles = (options: PresetOptions): readonly PresetFile[] => {
  switch (options.preset) {
    case 'panel':
      return panelFiles(options)
    case 'api':
      return apiFiles(options)
  }
}

const panelFiles = (options: PresetOptions): readonly PresetFile[] => {
  const { stem, component } = presetSymbols(options)
  return [
    {
      path: `src/${stem}-panel.tsx`,
      content: `import styles from './${stem}-panel.module.css'

/**
 * The ${options.id} panel.
 *
 * The Panels capability registers this component into the main view and the
 * sidebar row under one id, so the row always opens the view it names.
 */
export const ${component} = (): JSX.Element => (
  <div className={styles.page}>
    <h1 className={styles.title}>${options.id}</h1>
  </div>
)
`,
    },
    {
      path: `src/${stem}-panel.module.css`,
      content: `.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  color: var(--dsw-alias-label-primary);
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
`,
    },
    {
      path: `tests/${stem}.spec.ts`,
      content: `import { describe, expect, it } from 'vitest'
import { createTestClient } from '@dshfiles/dshx/testing'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import clientPlugin from '../src/client.js'

describe('the ${options.id} panel', () => {
  it('registers the row and the view under one id and removes both on unload', async () => {
    const client = await createTestClient()
    const disposeRoot = client.slots.register(
      {
        name: 'root',
        children: {
          main: { kind: 'keyed', scope: 'root' },
          'sidebar.panellist': { kind: 'list', scope: 'root' },
        },
      },
      (props: PropsRenderSlots<'main' | 'sidebar.panellist'>) => {
        void props
        return null
      },
    )
    const disposeLayout = client.ctx.provide('layout', { selectPanel: () => undefined })
    try {
      const mounted = await client.mount(clientPlugin)
      expect(client.slots.entries('main')).toHaveLength(1)
      expect(client.slots.entries('sidebar.panellist')).toHaveLength(1)
      await mounted.reload()
      expect(client.slots.entries('main')).toHaveLength(1)
      expect(client.slots.entries('sidebar.panellist')).toHaveLength(1)
      await mounted.dispose()
      expect(client.slots.entries('main')).toHaveLength(0)
      expect(client.slots.entries('sidebar.panellist')).toHaveLength(0)
    } finally {
      disposeRoot()
      disposeLayout()
      await client.dispose()
    }
  })
})
`,
    },
  ]
}

/**
 * The client entry a panel needs, for a project that has no client half yet.
 *
 * Provider faces the manifest imports stick to: the panel capability injects the
 * Slot registry and the layout controller, and the type-only imports are what
 * make the `main`/`sidebar.panellist` names typecheck.
 */
const panelClientEntry = (options: PresetOptions & { title?: string }): string => {
  const { stem, component } = presetSymbols(options)
  return `import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { ${component} } from './${stem}-panel.js'

export default defineClientPlugin({
  id: '${packageEntryId(options.packageId)}',
  name: '${options.packageId}',
  uses: ['panels'],
  setup(api) {
    api.panels.register({ id: '${options.id}', title: '${options.title ?? options.id}', component: ${component} })
  },
})
`
}

const apiFiles = (options: PresetOptions): readonly PresetFile[] => {
  const { apiId, apiSymbol, hostSymbol, stem } = presetSymbols(options)
  return [
    {
      path: `src/api/${apiId}.ts`,
      content: `import { z } from 'zod'
import { defineApi, method } from '@dshfiles/dshx/api'

/**
 * Wire contract for ${apiId}.
 *
 * One schema per method keeps the Host handler and the Client hook reading the
 * same shape, so a change that only one side sees is a type error rather than a
 * runtime surprise. Nothing crosses this boundary that the caller needs to
 * trust: credentials stay on the Host.
 */
export const ${apiSymbol} = defineApi({
  id: '${apiId}',
  version: 1,
  methods: {
    read: method({
      input: z.object({ name: z.string().trim().min(1) }),
      output: z.object({ greeting: z.string(), readyAt: z.string() }),
    }),
  },
})
`,
    },
    {
      path: `src/${apiId}-host.ts`,
      content: `import { ${apiSymbol} } from './api/${apiId}.js'

/**
 * Host side of the ${apiId} API.
 *
 * Declare the handler through the shared contract, so a handler that drifts from
 * the schema fails the build instead of the client. The scaffolder wires this
 * symbol into the plugin's \`apis\` list.
 */
export const ${hostSymbol} = ${apiSymbol}.host({
  read: async ({ input }) => ({ greeting: \`Hello \${input.name}\`, readyAt: new Date().toISOString() }),
})
`,
    },
    {
      path: `src/${stem}-usage.tsx`,
      content: `import { useApiQuery } from '@dshfiles/dshx/client'
import { ${apiSymbol} } from './api/${apiId}.js'

/**
 * Client usage example for the ${apiId} API.
 *
 * The Host half is wired. Register this component into a panel or existing Slot
 * with \`dshx add ui --file src/${stem}-usage.tsx\`, then replace the example input.
 */
export const ${pascal(apiId)}Usage = (): JSX.Element => {
  const read = useApiQuery(${apiSymbol}, 'read', { input: { name: 'World' }, enabled: true })
  return (
    <section>
      <h2>${options.id}</h2>
      {read.data === undefined ? (
        <p role="status">{read.error === undefined || read.error === null ? 'Waiting for the Host…' : read.error.message}</p>
      ) : (
        <p>{read.data.greeting} · ready at {read.data.readyAt}</p>
      )}
    </section>
  )
}
`,
    },
    {
      path: `tests/${apiId}.spec.ts`,
      content: `import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestHost } from '@dshfiles/dshx/testing'
import { definePlugin } from '@dshfiles/dshx/host'
import { ${apiSymbol} } from '../src/api/${apiId}.js'
import { ${hostSymbol} } from '../src/${apiId}-host.js'

const responseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.object({
      version: z.number(),
      output: z.object({ greeting: z.string(), readyAt: z.string() }),
    }) }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
  ]),
})

describe('the ${apiId} API', () => {
  it('validates input, serves the wired handler, and removes its route on unload', async () => {
    const host = await createTestHost()
    const connection = host.connection
    try {
      const mounted = await host.mount(
        definePlugin({ id: '${packageEntryId(options.packageId)}-api-test', apis: [${hostSymbol}] }),
        { packageId: '${options.packageId}' },
      )
      const response = await connection.requestApi({ packageId: '${options.packageId}', apiId: '${apiId}', method: 'read', version: 1, input: { name: '  Author  ' } })
      const body = responseSchema.parse(await response.json())
      expect(body.result).toMatchObject({ ok: true, value: { output: { greeting: 'Hello Author' } } })

      const invalidResponse = await connection.requestApi({ packageId: '${options.packageId}', apiId: '${apiId}', method: 'read', version: 1, input: { name: 42 } })
      const invalidBody = responseSchema.parse(await invalidResponse.json())
      expect(invalidBody.result).toMatchObject({ ok: false, error: { code: 'contract' } })

      await mounted.reload()
      expect(connection.routeCount).toBe(1)
      await mounted.dispose()
      expect(connection.routeCount).toBe(0)
    } finally {
      await host.dispose()
    }
  })
})
`,
    },
  ]
}

export class ScaffoldPresets {
  static readonly symbols = presetSymbols
  static readonly files = presetFiles
  static readonly panelClientEntry = panelClientEntry
}

export { DEFAULT_COMPATIBILITY }
