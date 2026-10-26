import Schema from '@deepseek-ai/schemastery'
import { createElement } from 'react'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { provideSettingsPageRenderer } from '../src/client/index.js'
import { registerPluginPageSettings } from '../src/settings/plugin-page.js'

interface CapturedSpec {
  readonly field: string
  format(value: unknown): string
  parse(text: string): unknown
}

const schema = Schema.object({
  defaultView: Schema.union([Schema.const('graph').description('Revision graph'), Schema.const('source').description('Source Control')]).default('graph'),
  ancestorCount: Schema.natural().min(1).max(20).default(5).description('Ancestor groups shown.'),
  diffExpanded: Schema.boolean().default(false),
  diffLayout: Schema.union([Schema.const('auto').description('Auto (unified in the side panel, split on a wide main page)'), Schema.const('split')]).default(
    'auto',
  ),
  parkedSessionIds: Schema.array(Schema.string()).default([]).hidden(),
  token: Schema.string().role('secret').default(''),
})

const specs: CapturedSpec[] = []

class FakeFormModel {
  constructor(_scope: unknown, fieldSpecs: CapturedSpec[]) {
    specs.push(...fieldSpecs)
  }
  bind<S>(project: () => S) {
    const value = project()
    return { getSnapshot: () => value, subscribe: () => () => undefined }
  }
  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
  }
  field(field: string) {
    return { text: field === 'diffExpanded' ? 'true' : '', overridden: field === 'diffExpanded', invalid: false }
  }
  actions() {
    return { edit: () => undefined, resetField: () => undefined, save: () => undefined, discard: () => undefined }
  }
  dispose() {}
}

const tag =
  (name: string) =>
  (props: Record<string, unknown>): unknown =>
    createElement(name, { 'data-label': props.label ?? null, 'data-checked': props.checked ?? null, 'data-hint': props.hint ?? null }, props.children as never)

const primitives = {
  SettingsFormModel: FakeFormModel,
  SettingsForm: tag('settings-form'),
  SettingsValueField: tag('value-field'),
  Switch: tag('switch-control'),
  SegmentedControl: tag('segmented-control'),
  Tag: tag('tag-badge'),
}

const pageContext = (options: { readonly whileServed?: boolean } = {}) => {
  const registrations: { options: Record<string, unknown>; component: (props: Record<string, unknown>) => unknown }[] = []
  let serve: (() => () => void) | undefined
  const describeSnapshot = { view: { namespaces: [{ ns: 'dshfiles-jujutsu', schema: schema.toJSON(), secrets: [] }] } }
  const page = {
    configForms: {
      get: () => ({}),
      describe: () => ({ getSnapshot: () => describeSnapshot, subscribe: () => () => undefined }),
      ...(options.whileServed !== false && {
        whileServed: (_namespaces: readonly string[], register: () => () => void) => {
          serve = register
          return () => undefined
        },
      }),
    },
    settingsSchema: { rehydrate: (json: unknown) => new Schema(json as never) },
    slots: {
      inject: (_name: string, register: () => unknown) => {
        register()
        return () => undefined
      },
      register: (registration: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) => {
        registrations.push({ options: registration, component })
      },
    },
    effect: (execute: () => () => void) => execute(),
  }
  const ctx = { inject: (_deps: readonly string[], callback: (value: typeof page) => void) => callback(page) }
  return { ctx, registrations, serve: () => serve?.(), describeSnapshot }
}

// The runtime loads platform modules through the Client module loader's
// require; under Node that is the CommonJS loader, whose cache stands in for it.
const nodeRequire = createRequire(new URL('../src/settings/plugin-page.ts', import.meta.url))
const primitivesPath = nodeRequire.resolve('@deepseek-ai/dsh-client-ui-primitives')
const { renderToStaticMarkup } = nodeRequire('react-dom/server') as { renderToStaticMarkup(element: unknown): string }

afterEach(() => {
  specs.length = 0
  delete nodeRequire.cache[primitivesPath]
})

const provideModules = (): void => {
  nodeRequire.cache[primitivesPath] = { id: primitivesPath, filename: primitivesPath, loaded: true, exports: primitives } as never
}

type PageFixture = ReturnType<typeof pageContext>

/** Server-render one registered page the way the Plugins page renders it: its injected face, the page view, the mirror. */
const renderPage = (page: PageFixture, registration: PageFixture['registrations'][number]): string =>
  renderToStaticMarkup(
    createElement(registration.component as never, {
      ...(registration.options.inject as () => Record<string, unknown>)(),
      view: 'page',
      useDescribe: (selector: (snapshot: unknown) => unknown) => selector(page.describeSnapshot),
    }),
  )

describe('Plugins page settings', () => {
  it('registers the bundle form under the package name only once a namespace is served', () => {
    provideModules()
    const page = pageContext()
    registerPluginPageSettings(page.ctx, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu'] })
    expect(page.registrations).toHaveLength(0)
    page.serve()
    expect(page.registrations.map(item => [item.options.name, item.options.key])).toEqual([['plugins.bundle.config', '@dshfiles/jujutsu']])
  })

  it('renders visible fields with a control per schema kind and skips hidden and secret fields', () => {
    provideModules()
    const page = pageContext()
    registerPluginPageSettings(page.ctx, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu'] })
    page.serve()
    const markup = renderPage(page, page.registrations[0]!)
    expect(markup).toContain('<segmented-control data-label="Default view">')
    expect(markup).toContain('<value-field data-label="Ancestor count" data-hint="Ancestor groups shown.">')
    expect(markup).toMatch(/<select id="dshx-plugin-settings-dshfiles-jujutsu-diffLayout"[^>]*aria-label="Diff layout"/)
    expect(markup).toContain('<switch-control data-label="Diff expanded" data-checked="true">')
    expect(markup).toContain('<tag-badge>Overridden</tag-badge>')
    expect(markup).not.toContain('Parked session ids')
    expect(markup).not.toContain('Token')
  })

  it('accepts only drafts the schema accepts and clears on an empty draft', () => {
    provideModules()
    const page = pageContext()
    registerPluginPageSettings(page.ctx, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu'] })
    page.serve()
    renderPage(page, page.registrations[0]!)
    const spec = (field: string): CapturedSpec => specs.find(item => item.field === field)!
    expect(spec('ancestorCount').parse('3')).toEqual({ kind: 'set', value: 3 })
    expect(spec('ancestorCount').parse('50')).toBeUndefined()
    expect(spec('ancestorCount').parse(' ')).toEqual({ kind: 'clear' })
    expect(spec('defaultView').parse('"source"')).toEqual({ kind: 'set', value: 'source' })
    expect(spec('defaultView').parse('"tree"')).toBeUndefined()
    expect(spec('defaultView').format('graph')).toBe('"graph"')
    expect(spec('diffExpanded').parse('false')).toEqual({ kind: 'set', value: false })
  })

  it('hands the page to a provided renderer, and falls back to the built-in form once it leaves', () => {
    provideModules()
    const page = pageContext()
    registerPluginPageSettings(page.ctx, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu', 'unserved'] })
    page.serve()
    const registration = page.registrations[0]!
    const render = (): string => renderPage(page, registration)
    const release = provideSettingsPageRenderer(props =>
      createElement('rich-page', { 'data-package': props.packageId, 'data-namespaces': props.namespaces.join(',') }),
    )
    expect(render()).toBe('<rich-page data-package="@dshfiles/jujutsu" data-namespaces="dshfiles-jujutsu"></rich-page>')
    release()
    expect(render()).toContain('<segmented-control data-label="Default view">')
  })

  it('stays silent on a Host without optional injection or served-namespace tracking', () => {
    provideModules()
    expect(() => registerPluginPageSettings({}, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu'] })).not.toThrow()
    const page = pageContext({ whileServed: false })
    registerPluginPageSettings(page.ctx, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu'] })
    expect(page.registrations).toHaveLength(0)
  })

  it('stays silent when the primitives module cannot load', () => {
    const page = pageContext()
    registerPluginPageSettings(page.ctx, { packageId: '@dshfiles/jujutsu', namespaces: ['dshfiles-jujutsu'] })
    page.serve()
    expect(page.registrations).toHaveLength(0)
  })
})
