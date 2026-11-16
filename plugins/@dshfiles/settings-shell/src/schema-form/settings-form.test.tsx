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

const formOf = (snapshot: ConfigFormSnapshot<unknown>): ConfigForm<unknown> => ({
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  mutate: async () => true,
  set: async () => true,
  unset: async () => true,
})

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
})
