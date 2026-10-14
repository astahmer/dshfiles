/**
 * Renders a package's served Settings namespaces on its own Plugins page.
 *
 * The Plugins page shows a bundle's configuration only through the
 * `plugins.bundle.config` slot, keyed by package name; native companions fill it
 * by hand. DSHX already exposes every Settings contract as the entry's volatile
 * Config, so the same shared ConfigForm every other surface writes through is
 * reused here: edits on this page and in plugin-owned settings UIs round-trip.
 *
 * Everything is optional. A Host without the Plugins page, ConfigForms, the
 * schema service, or the primitives module simply shows nothing.
 */
import type { ReactNode } from 'react'
import { settingsPageRenderer, subscribeSettingsPageRenderer } from './page-renderer.js'

type ReactRuntime = typeof import('react')
declare const require: ((name: string) => unknown) | undefined

const PLUGIN_PAGE_SLOT = 'plugins.bundle.config'
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
const MAX_SEGMENTED_CHOICES = 4
const MAX_SEGMENTED_LABEL_LENGTH = 24

const FORM_LABELS = {
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  save: 'Save',
  saving: 'Saving…',
}

interface SchemaNode {
  (value?: unknown): unknown
  readonly type: string
  readonly dict?: Readonly<Record<string, SchemaNode>>
  readonly list?: readonly SchemaNode[]
  readonly value?: unknown
  readonly meta?: { readonly description?: unknown; readonly hidden?: unknown; readonly role?: unknown }
}

type FieldWrite = { readonly kind: 'set'; readonly value: unknown } | { readonly kind: 'clear' }

interface FieldSpec {
  readonly field: string
  readonly format: (value: unknown) => string
  readonly parse: (text: string) => FieldWrite | undefined
}

interface FieldState {
  readonly text: string
  readonly overridden: boolean
  readonly invalid: boolean
}

interface FormShell {
  readonly available: boolean
  readonly writable: boolean
  readonly dirty: boolean
  readonly invalid: boolean
  readonly saving: boolean
  readonly failed: boolean
}

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface FormModel {
  bind<S>(project: () => S): ObservableSnapshot<S>
  shell(): FormShell
  field(field: string): FieldState
  actions(): { edit(field: string, text: string): void; resetField(field: string): void; save(): void; discard(): void }
  dispose(): void
}

interface Primitives {
  readonly SettingsFormModel: new (scope: unknown, specs: FieldSpec[]) => FormModel
  readonly SettingsForm: (props: Record<string, unknown>) => ReactNode
  readonly SettingsValueField: (props: Record<string, unknown>) => ReactNode
  readonly Switch: (props: Record<string, unknown>) => ReactNode
  readonly SegmentedControl: (props: Record<string, unknown>) => ReactNode
  readonly Tag: (props: Record<string, unknown>) => ReactNode
}

interface NamespaceView {
  readonly ns: string
  readonly schema: unknown
  readonly secrets?: readonly { readonly path: readonly string[] }[]
}

interface DescribeSnapshot {
  readonly view?: { readonly namespaces: readonly NamespaceView[] } | undefined
}

interface ConfigFormsService {
  get(entryId: string): unknown
  describe(): ObservableSnapshot<DescribeSnapshot> & { ensure?(): Promise<void> }
  whileServed?(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

interface SchemaService {
  rehydrate(serialized: unknown): SchemaNode
}

interface PageContext {
  readonly configForms: ConfigFormsService
  readonly settingsSchema: SchemaService
  readonly slots: {
    inject(name: string, register: () => unknown): () => void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  effect(execute: () => () => void, label?: string): unknown
}

interface InjectableContext {
  inject?(deps: readonly string[], callback: (ctx: PageContext) => void): unknown
}

type FieldKind =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'choice'; readonly options: readonly { readonly value: unknown; readonly label: string }[] }
  | { readonly kind: 'number' }
  | { readonly kind: 'text' }
  | { readonly kind: 'json' }

interface PageField {
  readonly name: string
  readonly label: string
  readonly hint: string
  readonly type: FieldKind
  readonly spec: FieldSpec
}

interface PageProps {
  readonly view?: 'summary' | 'page'
  readonly packageId: string
  readonly useDescribe: <S>(selector: (snapshot: DescribeSnapshot) => S) => S
  readonly forms: ConfigFormsService
  readonly schemaService: SchemaService
  readonly namespaces: readonly string[]
}

const loadModule = (name: string): unknown => {
  // SAFETY: only the presence of a callable `require` is read; it is checked before the call.
  const loader = typeof require === 'function' ? require : (globalThis as { require?: (name: string) => unknown }).require
  if (typeof loader !== 'function') return undefined
  try {
    return loader(name)
  } catch {
    return undefined
  }
}

const descriptionText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return ''
  // SAFETY: narrowed to a non-null object above; every read below is type-checked.
  const localized = value as Record<string, unknown>
  const text = localized.en ?? localized[''] ?? Object.values(localized)[0]
  return typeof text === 'string' ? text : ''
}

const humanize = (name: string): string => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const fieldKind = (node: SchemaNode): FieldKind => {
  if (node.type === 'boolean') return { kind: 'boolean' }
  if (node.type === 'number') return { kind: 'number' }
  if (node.type === 'string') return { kind: 'text' }
  const branches = node.type === 'union' ? (node.list ?? []) : []
  if (branches.length > 0 && branches.every(branch => branch.type === 'const')) {
    return {
      kind: 'choice',
      options: branches.map(branch => ({ value: branch.value, label: descriptionText(branch.meta?.description) || String(branch.value) })),
    }
  }
  return { kind: 'json' }
}

const formatValue = (type: FieldKind, value: unknown): string => {
  if (value === undefined) return ''
  if (type.kind === 'boolean') return value === true ? 'true' : value === false ? 'false' : ''
  if (type.kind === 'number') return typeof value === 'number' ? String(value) : ''
  if (type.kind === 'text') return typeof value === 'string' ? value : ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

const draftValue = (type: FieldKind, text: string): { readonly value: unknown } | undefined => {
  if (type.kind === 'text') return { value: text }
  if (type.kind === 'boolean') return text === 'true' ? { value: true } : text === 'false' ? { value: false } : undefined
  if (type.kind === 'number') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? { value: parsed } : undefined
  }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

const fieldSpec = (name: string, node: SchemaNode, type: FieldKind): FieldSpec => ({
  field: name,
  format: value => formatValue(type, value),
  parse: text => {
    if (text.trim() === '') return { kind: 'clear' }
    const draft = draftValue(type, type.kind === 'text' ? text : text.trim())
    if (draft === undefined) return undefined
    try {
      node(draft.value)
    } catch {
      return undefined
    }
    return { kind: 'set', value: draft.value }
  },
})

/** The top-level, visible, non-secret fields of one namespace schema. */
const pageFields = (root: SchemaNode, secrets: readonly { readonly path: readonly string[] }[]): readonly PageField[] => {
  if (root.type !== 'object' || root.dict === undefined) return []
  const secretRoots = new Set(secrets.map(secret => secret.path[0]))
  return Object.entries(root.dict).flatMap(([name, node]) => {
    if (node.meta?.hidden === true || node.meta?.role === 'secret' || secretRoots.has(name)) return []
    const type = fieldKind(node)
    return [{ name, label: humanize(name), hint: descriptionText(node.meta?.description), type, spec: fieldSpec(name, node, type) }]
  })
}

const createPluginPage = (react: ReactRuntime, primitives: Primitives): ((props: PageProps) => ReactNode) => {
  const h = react.createElement

  const FieldRow = (props: {
    readonly field: PageField
    readonly state: FieldState
    readonly disabled: boolean
    readonly control: ReactNode
    readonly onReset: () => void
  }): ReactNode =>
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h(
          'span',
          { style: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' } },
          props.field.label,
        ),
        props.state.overridden
          ? h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
              h(primitives.Tag, { tone: 'neutral' }, 'Overridden'),
              h(
                'button',
                {
                  type: 'button',
                  disabled: props.disabled,
                  onClick: props.onReset,
                  style: { border: 0, background: 'none', padding: 0, fontSize: 12, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' },
                },
                'Reset to default',
              ),
            )
          : null,
        props.control,
      ),
      props.field.hint === ''
        ? null
        : h('p', { style: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, props.field.hint),
    )

  const NamespaceForm = (props: {
    readonly ns: string
    readonly heading: boolean
    readonly schemaJson: string
    readonly secrets: readonly { readonly path: readonly string[] }[]
    readonly forms: ConfigFormsService
    readonly schemaService: SchemaService
  }): ReactNode => {
    const fields = react.useMemo(() => {
      try {
        return pageFields(props.schemaService.rehydrate(JSON.parse(props.schemaJson)), props.secrets)
      } catch {
        return []
      }
    }, [props.schemaService, props.schemaJson, props.secrets])
    const model = react.useMemo(
      () =>
        new primitives.SettingsFormModel(
          props.forms.get(props.ns),
          fields.map(field => field.spec),
        ),
      [props.forms, props.ns, fields],
    )
    react.useEffect(() => () => model.dispose(), [model])
    const store = react.useMemo(() => model.bind(() => ({ shell: model.shell(), fields: fields.map(field => model.field(field.name)) })), [model, fields])
    const state = react.useSyncExternalStore(
      listener => store.subscribe(listener),
      () => store.getSnapshot(),
      () => store.getSnapshot(),
    )
    const actions = react.useMemo(() => model.actions(), [model])
    if (fields.length === 0) return null
    const disabled = !state.shell.writable
    const controls = fields.map((field, index) => {
      const fieldState = state.fields[index]!
      const id = `dshx-plugin-settings-${props.ns}-${field.name}`
      const onReset = (): void => actions.resetField(field.name)
      if (field.type.kind === 'boolean') {
        const control = h(primitives.Switch, {
          checked: fieldState.text === 'true',
          label: field.label,
          disabled,
          onChange: (next: boolean) => actions.edit(field.name, String(next)),
        })
        return h(FieldRow, { key: field.name, field, state: fieldState, disabled, control, onReset })
      }
      if (field.type.kind === 'choice') {
        const options = field.type.options.map((option, optionIndex) => ({ value: String(optionIndex), label: option.label }))
        const selected = String(field.type.options.findIndex(option => JSON.stringify(option.value) === fieldState.text))
        const select = (indexText: string): void => {
          const option = field.type.kind === 'choice' ? field.type.options[Number(indexText)] : undefined
          if (option !== undefined) actions.edit(field.name, JSON.stringify(option.value))
        }
        const control =
          options.length <= MAX_SEGMENTED_CHOICES && options.every(option => option.label.length <= MAX_SEGMENTED_LABEL_LENGTH)
            ? h(primitives.SegmentedControl, { id, value: selected, options, label: field.label, disabled, onChange: select })
            : h(
                'select',
                {
                  id,
                  value: selected,
                  disabled,
                  'aria-label': field.label,
                  onChange: (event: { target: { value: string } }) => select(event.target.value),
                  style: {
                    maxWidth: '60%',
                    padding: '4px 8px',
                    fontSize: 12,
                    borderRadius: 'var(--dsw-radius-sm)',
                    border: '0.5px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-4)',
                    color: 'var(--dsw-alias-label-primary)',
                  },
                },
                options.map(option => h('option', { key: option.value, value: option.value }, option.label)),
              )
        return h(FieldRow, { key: field.name, field, state: fieldState, disabled, control, onReset })
      }
      return h(primitives.SettingsValueField, {
        key: field.name,
        id,
        label: field.label,
        hint: field.type.kind === 'json' ? [field.hint, 'JSON value.'].filter(Boolean).join(' ') : field.hint,
        overriddenLabel: 'Overridden',
        resetLabel: 'Reset to default',
        invalidLabel: field.type.kind === 'number' ? 'Enter a number in range, or leave blank to use the default.' : 'This value is not accepted.',
        numeric: field.type.kind === 'number',
        disabled,
        ...fieldState,
        onEdit: (text: string) => actions.edit(field.name, text),
        onReset,
      })
    })
    return h(
      'section',
      null,
      props.heading ? h('h4', { style: { margin: '8px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, props.ns) : null,
      h(primitives.SettingsForm, { labels: FORM_LABELS, state: state.shell, onSave: actions.save, onDiscard: actions.discard }, controls),
    )
  }

  return (props: PageProps): ReactNode => {
    const views = props.useDescribe(snapshot => snapshot.view?.namespaces)
    const renderer = react.useSyncExternalStore(subscribeSettingsPageRenderer, settingsPageRenderer, settingsPageRenderer)
    react.useEffect(() => {
      void props.forms.describe().ensure?.()
    }, [props.forms])
    if (props.view === 'summary') return null
    const served = props.namespaces.flatMap(ns => {
      const view = views?.find(item => item.ns === ns)
      return view === undefined ? [] : [view]
    })
    if (renderer !== undefined) return h(renderer, { packageId: props.packageId, namespaces: served.map(view => view.ns) })
    return h(
      react.Fragment,
      null,
      served.map(view =>
        h(NamespaceForm, {
          key: view.ns,
          ns: view.ns,
          heading: served.length > 1,
          schemaJson: JSON.stringify(view.schema),
          secrets: view.secrets ?? [],
          forms: props.forms,
          schemaService: props.schemaService,
        }),
      ),
    )
  }
}

/** Register the package's Settings form on its Plugins page while any of its namespaces is served. */
export const registerPluginPageSettings = (ctx: unknown, options: { readonly packageId: string; readonly namespaces: readonly string[] }): void => {
  // SAFETY: `inject` is called only after the typeof check below.
  const host = ctx as InjectableContext
  if (options.namespaces.length === 0 || typeof host.inject !== 'function') return
  host.inject(['configForms', 'settingsSchema', 'slots'], page => {
    if (typeof page.configForms.whileServed !== 'function') return
    // SAFETY: platform module identities served by the Client module loader; primitives' exports are probed before use.
    const react = loadModule('react') as ReactRuntime | undefined
    const primitives = loadModule(PRIMITIVES_MODULE) as Primitives | undefined
    if (react === undefined || typeof primitives?.SettingsFormModel !== 'function' || typeof primitives.SettingsForm !== 'function') return
    const component = createPluginPage(react, primitives)
    const face = {
      packageId: options.packageId,
      hooks: { describe: page.configForms.describe() },
      forms: page.configForms,
      schemaService: page.settingsSchema,
      namespaces: options.namespaces,
    }
    page.effect(
      () =>
        page.configForms.whileServed!(options.namespaces, () =>
          page.slots.inject(PLUGIN_PAGE_SLOT, () => page.slots.register({ name: PLUGIN_PAGE_SLOT, key: options.packageId, inject: () => face }, component)),
        ),
      `dshx plugin page settings: ${options.packageId}`,
    )
  })
}
