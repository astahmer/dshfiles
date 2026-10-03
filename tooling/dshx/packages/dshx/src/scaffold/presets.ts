import { DEFAULT_COMPATIBILITY } from '../compat/index.js'
import type { DshCompatibility } from '../compat/types.js'

/**
 * Preset scaffolding for the contributions a plugin actually writes.
 *
 * `add ui` covers a single slot. The three contributions that follow it in every
 * real plugin — a panel that is a main view plus a sidebar row, a typed API the
 * Host serves, and a tool the agent can call — had no generator at all, so each
 * one was hand-written twice here before it was written once correctly.
 *
 * Each preset emits the whole shape, including the parts that are easy to get
 * wrong: the two registrations a panel needs and the import that makes its slot
 * typecheck, the host/client pair an API needs, and the three fields a tool must
 * declare or it will not register.
 */

export type PresetName = 'panel' | 'api' | 'tool'

export interface PresetOptions {
  readonly preset: PresetName
  /** Package id, used for the generated symbol names and the API id. */
  readonly packageId: string
  /** Panel id or slug, used as the sidebar row id and the main panel key. */
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

/** Files one preset writes, plus the manifest edits it implies. */
export const presetFiles = (options: PresetOptions): readonly PresetFile[] => {
  switch (options.preset) {
    case 'panel':
      return panelFiles(options)
    case 'api':
      return apiFiles(options)
    case 'tool':
      return toolFiles(options)
  }
}

const panelFiles = (options: PresetOptions): readonly PresetFile[] => {
  const id = options.id
  const stem = kebab(id).replace(/-panel$/, '')
  const component = `${pascal(stem)}Panel`
  return [
    {
      path: `src/${stem}-panel.tsx`,
      content: `import { useApi } from '@dshfiles/dshx/client'
import type {} from '@dshfiles/dshx/client'
import styles from './${stem}-panel.module.css'

/**
 * The ${id} panel.
 *
 * A panel is two registrations rather than one: the sidebar row that selects it
 * and the main view it renders into. Registering only the row leaves a button that
 * goes nowhere; registering only the view leaves a panel nothing can open.
 */
export const ${component} = (): JSX.Element => (
  <div className={styles.page}>
    <h1 className={styles.title}>${id}</h1>
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
  ]
}

/** The client entry a panel needs, as a patch to an existing `src/client.tsx`. */
export const panelClientEntry = (options: PresetOptions): string => {
  const stem = kebab(options.id).replace(/-panel$/, '')
  const component = `${pascal(stem)}Panel`
  return `import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { defineClient } from '@dshfiles/dshx/client'
import { ${component} } from './${stem}-panel.js'

const PANEL_ID = '${options.id}'

export default defineClient({
  name: '${options.packageId}',
  setup(ctx) {
    // The row is the only way in, so its order places it among the sidebar rows;
    // the main view is addressed by the same key.
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 1, label: () => '${options.id}' }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: PANEL_ID }, ${component}),
    )
  },
})

const PanelGlyph = (props: { readonly size?: number; readonly active?: boolean }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8 12h8" />
  </svg>
)
`
}

const apiFiles = (options: PresetOptions): readonly PresetFile[] => {
  const name = pascal(options.id)
  const apiId = kebab(options.id)
  return [
    {
      path: 'src/api.ts',
      content: `import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/**
 * Wire contract for ${apiId}.
 *
 * One schema per method keeps the Host handler and the Client hook reading the
 * same shape, so a change that only one side sees is a type error rather than a
 * runtime surprise. Nothing crosses this boundary that the caller needs to trust:
 * credentials stay on the Host.
 */
export const ${name}Api = defineApi({
  id: '${apiId}',
  version: 1,
  methods: {
    read: method({ input: z.void(), output: z.object({ ok: z.boolean() }) }),
  },
})
`,
    },
    {
      path: `src/${kebab(options.id).replace(/-api$/, '')}-host.ts`,
      content: `import { ${name}Api } from './api.js'

/**
 * Host side of the ${apiId} API.
 *
 * Declared through the shared contract, so a handler that drifts from the schema
 * fails the build instead of the client.
 */
export const ${kebab(options.id).replace(/-/g, '_')}_host_api = ${name}Api.host({
  read: async () => ({ ok: true }),
})
`,
    },
  ]
}

/** The api handler the Host entry must spread into its own `apis`. */
export const apiHostEntry = (options: PresetOptions): string =>
  `import { ${pascal(options.id)}Api } from './api.js'

export const ${kebab(options.id).replace(/-/g, '_')}_host_api = ${pascal(options.id)}Api.host({
  read: async () => ({ ok: true }),
})
`

const toolFiles = (options: PresetOptions): readonly PresetFile[] => {
  const name = kebab(options.id)
  const symbol = pascal(options.id)
  return [
    {
      path: `src/${name}-tool.ts`,
      content: `import { defineTool } from '@dshfiles/dshx/api'

/**
 * The ${name} tool.
 *
 * A tool that omits \`output.schema\` or \`output.render\` is not offered to the model
 * with a usable shape, which is the most common reason a registered tool never
 * appears in a session.
 */
export const ${symbol}Tool = defineTool({
  name: '${name}',
  description: 'Describe what this tool does and when the model should reach for it.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    render: value => ({ kind: 'text', text: JSON.stringify(value) }),
  },
  execute: async () => ({ ok: true }),
})
`,
    },
  ]
}

export { DEFAULT_COMPATIBILITY }