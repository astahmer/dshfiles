import Schemastery from '@deepseek-ai/schemastery'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from '../native/locales.js'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue } from './schema-model.js'
import { SettingsForm } from './settings-form.js'

const text = (value: JsonValue | undefined): string => Schema.decodeUnknownOption(Schema.String)(value).pipe(Option.getOrElse(() => ''))
const wire = (schema: Schemastery): JsonValue => Schema.decodeUnknownSync(jsonValueSchema)(schema.toJSON())
const t: ShellTranslate = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

const formOf = (snapshot: ConfigFormSnapshot<unknown>, mutate: ConfigForm<unknown>['mutate'] = async () => true): ConfigForm<unknown> => ({
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  mutate,
  set: async () => true,
  unset: async () => true,
})

/** Types into a field and leaves it, as a person does: React commits a draft on blur. */
const typeAndLeave = async (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    setValue?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const row = (path: string): HTMLElement | null => container.querySelector(`[data-setting-path="${path}"]`)

describe('settings form rows', () => {
  const schema = wire(
    Schemastery.object({
      focusThreadInSidebar: Schemastery.boolean().default(true).description('Scroll the thread into view.'),
      maxTabs: Schemastery.natural().default(10).description('Most tabs kept open.'),
    }),
  )
  const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
  const form = formOf({
    status: 'ready',
    value: { focusThreadInSidebar: true, maxTabs: 8 },
    base: { focusThreadInSidebar: true, maxTabs: 10 },
    user: { maxTabs: 8 },
    revision: 1,
    writable: true,
  })

  it('shows a setting as its label, description and control, without its config key or a default source', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={form} namespace="example" t={t} />))
    const untouched = row('focusThreadInSidebar')
    expect(untouched?.textContent).toContain('Focus thread in sidebar')
    expect(untouched?.textContent).not.toContain('focusThreadInSidebar')
    expect(untouched?.querySelector('[data-setting-source]')).toBeNull()
    expect(untouched?.textContent).not.toContain('source.default')
  })

  it('stacks every row below 28rem: the text, then the control (round five B7)', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={form} namespace="example" t={t} />))
    const layout = row('focusThreadInSidebar')?.querySelector('[data-setting-row-layout]')
    expect(layout?.className).toContain('dshx:@max-pane-narrow:flex-col')
  })

  it('names the source of a value that is not the default, and what a reset re-inherits', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={form} namespace="example" t={t} />))
    const modified = row('maxTabs')
    expect(modified?.querySelector('[data-setting-source="user"]')?.textContent).toBe('source.user · source.inherits {"value":"10"}')
    expect(modified?.textContent).not.toContain('maxTabs')
    expect([...(modified?.querySelectorAll('button') ?? [])].some(button => button.textContent === 'form.reset')).toBe(true)
  })

  it('shows the key of a setting a search matched by its key, highlighted', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={form} highlight="maxtabs" namespace="example" t={t} />))
    expect(row('maxTabs')?.querySelector('code mark')?.textContent).toBe('maxTabs')
    expect(row('focusThreadInSidebar')?.querySelector('code')).toBeNull()
  })

  it('flips a switch at once, marks it busy (never disabled) while the Host saves, and reverts a refusal', async () => {
    let settle: (accepted: boolean) => void = () => undefined
    const pending = formOf(
      { status: 'ready', value: { focusThreadInSidebar: true, maxTabs: 8 }, base: {}, user: {}, revision: 1, writable: true },
      () =>
        new Promise<boolean>(resolvePromise => {
          settle = resolvePromise
        }),
    )
    await act(async () => root.render(<SettingsForm fields={fields} form={pending} namespace="example" t={t} />))
    const toggle = (): HTMLButtonElement | null | undefined => row('focusThreadInSidebar')?.querySelector<HTMLButtonElement>('[role="switch"]')
    toggle()?.focus()
    await act(async () => toggle()?.click())
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(toggle()?.getAttribute('aria-busy')).toBe('true')
    expect(toggle()?.disabled).toBe(false)
    expect(document.activeElement).toBe(toggle())

    await act(async () => settle(false))
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(toggle()?.hasAttribute('aria-busy')).toBe(false)
    expect(row('focusThreadInSidebar')?.querySelector('[role="alert"]')?.textContent).toBe('form.refused')
  })
})

describe('a setting edited as JSON', () => {
  const schema = wire(Schemastery.object({ allowedModels: Schemastery.array(Schemastery.object({ provider: Schemastery.string() })).default([]) }))
  const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
  const snapshot: ConfigFormSnapshot<unknown> = {
    status: 'ready',
    value: { allowedModels: [] },
    base: { allowedModels: [] },
    user: {},
    revision: 1,
    writable: true,
  }
  const editor = (): HTMLTextAreaElement => {
    const field = row('allowedModels')?.querySelector('textarea')
    if (field === null || field === undefined) throw new Error('JSON field missing')
    return field
  }
  const alertText = (): string | undefined => row('allowedModels')?.querySelector('[role="alert"]')?.textContent ?? undefined
  const type = async (value: string): Promise<void> => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setValue?.call(editor(), value)
      editor().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('says what the value is before anything is typed', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot)} namespace="example" t={t} />))
    expect(row('allowedModels')?.textContent).toContain('form.jsonList')
    expect(alertText()).toBeUndefined()
  })

  it('flags broken JSON while it is typed and never saves it', async () => {
    const mutate = vi.fn<ConfigForm<unknown>['mutate']>(async () => true)
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot, mutate)} namespace="example" t={t} />))
    await type('[{"provider": ')
    expect(alertText()).toContain('form.invalidJson')
    expect(editor().getAttribute('aria-invalid')).toBe('true')
    await typeAndLeave(editor(), '[{"provider": ')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('refuses a value of the wrong shape and says which brackets the list needs', async () => {
    const mutate = vi.fn<ConfigForm<unknown>['mutate']>(async () => true)
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot, mutate)} namespace="example" t={t} />))
    await typeAndLeave(editor(), '{"provider": "deepseek"}')
    expect(alertText()).toContain('form.invalidJsonList')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('restores the saved value on request, and saves a valid list', async () => {
    const mutate = vi.fn<ConfigForm<unknown>['mutate']>(async () => true)
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot, mutate)} namespace="example" t={t} />))
    await type('nope')
    const restore = [...(row('allowedModels')?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'form.restoreJson')
    await act(async () => restore?.click())
    expect(editor().value).toBe('[]')
    expect(alertText()).toBeUndefined()
    await typeAndLeave(editor(), '[{"provider": "deepseek"}]')
    expect(mutate.mock.calls.map(([ops]) => ops)).toEqual([[{ op: 'set', path: ['allowedModels'], value: [{ provider: 'deepseek' }] }]])
  })
})

describe('machine values', () => {
  const schema = wire(
    Schemastery.object({
      maxRequestFilesBytes: Schemastery.natural().min(1_048_576).default(134_217_728),
      streamIdleTimeoutMs: Schemastery.natural().default(300_000),
      baseURL: Schemastery.string(),
    }),
  )
  const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
  const snapshot: ConfigFormSnapshot<unknown> = {
    status: 'ready',
    value: { maxRequestFilesBytes: 134_217_728, streamIdleTimeoutMs: 300_000 },
    base: { maxRequestFilesBytes: 134_217_728, streamIdleTimeoutMs: 300_000 },
    user: {},
    revision: 1,
    writable: true,
  }
  const numberField = (path: string): HTMLInputElement | null => row(path)?.querySelector('input') ?? null

  it('shows a byte count in MB and a millisecond count in seconds, with one unit', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot)} namespace="example" t={t} />))
    expect(numberField('maxRequestFilesBytes')?.value).toBe('128')
    expect(row('maxRequestFilesBytes')?.textContent).toBe('Max request files' + 'MB')
    expect(numberField('streamIdleTimeoutMs')?.value).toBe('300')
    expect(row('streamIdleTimeoutMs')?.textContent).toBe('Stream idle timeout' + 's')
  })

  it('stores the same unit the schema declares: 256 MB is saved in bytes, 1.5 s in milliseconds', async () => {
    const mutate = vi.fn<ConfigForm<unknown>['mutate']>(async () => true)
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot, mutate)} namespace="example" t={t} />))
    const bytes = numberField('maxRequestFilesBytes')
    const timeout = numberField('streamIdleTimeoutMs')
    if (bytes === null || timeout === null) throw new Error('number fields missing')
    await typeAndLeave(bytes, '256')
    await typeAndLeave(timeout, '1.5')
    expect(mutate.mock.calls.map(([ops]) => ops)).toEqual([
      [{ op: 'set', path: ['maxRequestFilesBytes'], value: 268_435_456 }],
      [{ op: 'set', path: ['streamIdleTimeoutMs'], value: 1500 }],
    ])
  })

  it('refuses a value under the minimum, naming the bounds in the unit shown', async () => {
    const mutate = vi.fn<ConfigForm<unknown>['mutate']>(async () => true)
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot, mutate)} namespace="example" t={t} />))
    const bytes = numberField('maxRequestFilesBytes')
    if (bytes === null) throw new Error('number field missing')
    await typeAndLeave(bytes, '0.5')
    expect(mutate).not.toHaveBeenCalled()
    expect(row('maxRequestFilesBytes')?.querySelector('[role="alert"]')?.textContent).toBe('form.invalidNumber {"min":1,"max":"∞"}')
  })

  it('formats a number field in the interface language, not the browser one (0.8, never 0,8)', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot)} namespace="example" t={t} />))
    expect(numberField('streamIdleTimeoutMs')?.getAttribute('lang')).toBe('form.numberLocale')
  })

  it('says nothing about the source of a value whose schema declares no default', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot)} namespace="example" t={t} />))
    expect(row('baseURL')?.querySelector('[data-setting-source]')).toBeNull()
    expect(row('baseURL')?.textContent).not.toContain('source.unknown')
  })
})

describe('advanced settings', () => {
  const schema = wire(
    Schemastery.object({
      pickActiveTab: Schemastery.boolean().default(true),
      chromePath: Schemastery.string().default('').collapse(),
      cdpPort: Schemastery.natural().default(9222).collapse(),
    }),
  )
  const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
  const base = { pickActiveTab: true, chromePath: '', cdpPort: 9222 }
  const untouched: ConfigFormSnapshot<unknown> = { status: 'ready', value: base, base, user: {}, revision: 1, writable: true }
  const fold = (): HTMLButtonElement | null => container.querySelector('[data-settings-advanced]')

  it('folds the settings a schema marks, behind one labelled control, closed', async () => {
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(untouched)} namespace="example" t={t} />))
    expect(row('pickActiveTab')).not.toBeNull()
    expect(row('chromePath')).toBeNull()
    expect(fold()?.textContent).toBe('form.advanced {"count":2}')
    expect(fold()?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => fold()?.click())
    expect(row('chromePath')).not.toBeNull()
    expect(row('cdpPort')).not.toBeNull()
  })

  it('opens the fold by itself for a modified advanced setting and for one a link focuses', async () => {
    const modified: ConfigFormSnapshot<unknown> = { ...untouched, value: { ...base, cdpPort: 9333 }, user: { cdpPort: 9333 } }
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(modified)} namespace="example" t={t} />))
    expect(row('cdpPort')).not.toBeNull()
    await act(async () => root.render(<div />))
    HTMLElement.prototype.scrollIntoView = () => undefined
    await act(async () => root.render(<SettingsForm fields={fields} focusPath={['chromePath']} form={formOf(untouched)} namespace="example" t={t} />))
    expect(row('chromePath')).not.toBeNull()
  })

  it('lists a matching advanced setting in search results without the fold', async () => {
    await act(async () =>
      root.render(<SettingsForm fields={fields.filter(field => field.key === 'cdpPort')} form={formOf(untouched)} highlight="cdp" namespace="example" t={t} />),
    )
    expect(fold()).toBeNull()
    expect(row('cdpPort')).not.toBeNull()
  })

  it('draws no fold for a schema that marks nothing', async () => {
    await act(async () => root.render(<SettingsForm fields={fields.filter(field => !field.advanced)} form={formOf(untouched)} namespace="example" t={t} />))
    expect(fold()).toBeNull()
  })
})

describe('settings held by a nested object', () => {
  it('heads them with a sentence-case label, never an all-caps one', async () => {
    const schema = wire(Schemastery.object({ autoCleanup: Schemastery.object({ onSettle: Schemastery.boolean().default(false) }) }))
    const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
    const snapshot: ConfigFormSnapshot<unknown> = { status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true }
    await act(async () => root.render(<SettingsForm fields={fields} form={formOf(snapshot)} namespace="example" t={t} />))
    const heading = container.querySelector('h4')
    expect(heading?.textContent).toBe('Auto cleanup')
    expect(heading?.className).not.toContain('uppercase')
  })
})
