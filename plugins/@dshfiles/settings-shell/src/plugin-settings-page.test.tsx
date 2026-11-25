import Schemastery from '@deepseek-ai/schemastery'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from './native/locales.js'
import { PageViewMemoryProvider, PluginSettingsPageView } from './plugin-settings-page.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue } from './schema-form/schema-model.js'

const text = (value: JsonValue | undefined): string => Schema.decodeUnknownOption(Schema.String)(value).pipe(Option.getOrElse(() => ''))
const schema = Schema.decodeUnknownSync(jsonValueSchema)(
  Schemastery.object({ maxTabs: Schemastery.natural().default(12), dense: Schemastery.boolean().default(false) }).toJSON(),
)
const page: PluginSettingsPage = {
  pageId: 'plugin:example',
  ns: 'example',
  title: 'Example',
  description: '',
  group: 'plugins',
  fields: SettingsSchemaModel.settingFields({ schema, secrets: [], text }),
  modifiedPaths: ['dense'],
}
const t: ShellTranslate = key => key
const snapshot: ConfigFormSnapshot<unknown> = {
  status: 'ready',
  value: { maxTabs: 12, dense: true },
  base: { maxTabs: 12, dense: false },
  user: { dense: true },
  revision: 1,
  writable: true,
}
const form: ConfigForm<unknown> = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  mutate: async () => true,
  set: async () => true,
  unset: async () => true,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // jsdom lays nothing out, so it has no scrollIntoView.
  HTMLElement.prototype.scrollIntoView = () => undefined
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** The page as a Settings instance draws it: absent while search results replace it, back when a result is opened. */
const show = async (input: { readonly visible: boolean; readonly focusPath?: readonly string[] }): Promise<void> => {
  await act(async () =>
    root.render(
      <PageViewMemoryProvider>
        {input.visible && <PluginSettingsPageView form={form} page={page} t={t} {...(input.focusPath === undefined ? {} : { focusPath: input.focusPath })} />}
      </PageViewMemoryProvider>,
    ),
  )
}

const jsonEditor = (): HTMLTextAreaElement | null => container.querySelector('[data-settings-json] textarea')
const viewButton = (name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name && button.closest('[hidden]') === null)
const openAdvanced = async (): Promise<void> => {
  const trigger = container.querySelector<HTMLButtonElement>('[data-settings-advanced]')
  if (trigger?.getAttribute('aria-expanded') !== 'true') await act(async () => trigger?.click())
}

describe('plugin settings page', () => {
  it('reopens a field from search in the JSON view it left, with the key selected', async () => {
    await show({ visible: true })
    await openAdvanced()
    const json = [...container.querySelectorAll('button')].find(button => button.textContent === 'view.json')
    await act(async () => json?.click())
    expect(jsonEditor()?.closest('[hidden]')).toBeNull()
    await show({ visible: false })
    await show({ visible: true, focusPath: ['dense'] })
    const editor = jsonEditor()
    expect(editor?.closest('[hidden]')).toBeNull()
    expect(container.querySelector('[data-settings-namespace]')?.closest('[hidden]')).not.toBeNull()
    expect(document.activeElement).toBe(editor)
    expect(editor?.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('"dense"')
  })

  it('says nothing about scope while every setting applies everywhere', async () => {
    await show({ visible: true })
    expect(container.querySelector('[data-settings-page]')?.textContent).not.toContain('entry.scope')
  })

  it('opens a focused field in the form when the form was showing', async () => {
    await show({ visible: true, focusPath: ['dense'] })
    expect(jsonEditor()).toBeNull()
    expect(container.querySelector('[data-settings-namespace]')?.closest('[hidden]')).toBeNull()
  })

  it('keeps the JSON view and Plugin details under Advanced, after the settings', async () => {
    await act(async () =>
      root.render(
        <PageViewMemoryProvider>
          <PluginSettingsPageView entry={<div data-entry-card="">entry</div>} form={form} page={page} t={t} />
        </PageViewMemoryProvider>,
      ),
    )
    expect(viewButton('view.json')).toBeUndefined()
    expect(container.querySelector('[data-entry-card]')).toBeNull()
    const trigger = container.querySelector<HTMLButtonElement>('[data-settings-advanced]')
    expect(trigger?.getAttribute('aria-label')).toBe('form.advancedOf')
    await openAdvanced()
    expect(viewButton('view.json')).toBeDefined()
    expect(container.querySelector('[data-entry-card]')).not.toBeNull()
  })

  it('moves focus with the view switch, so it never falls to body', async () => {
    await show({ visible: true })
    await openAdvanced()
    viewButton('view.json')?.focus()
    await act(async () => viewButton('view.json')?.click())
    expect(document.activeElement).toBe(viewButton('view.json'))
    await act(async () => viewButton('view.form')?.click())
    expect(document.activeElement).toBe(viewButton('view.form'))
  })

  it('titles the page with the one contextual heading, 15/20 at 600 (council round 4 B5)', async () => {
    await show({ visible: true })
    expect(container.querySelector('h2')?.className).toContain('dshx:text-heading')
    // The 880 lane, as the Settings column (council round 7 B1).
    expect(container.querySelector('section')?.className).toContain('dshx:max-w-lane')
    expect(container.querySelector('section')?.className).not.toContain('680px')
  })

  it('keeps its title for screen readers only beside the side column row that names it (council round 4 B1)', async () => {
    await act(async () =>
      root.render(
        <PageViewMemoryProvider>
          <PluginSettingsPageView form={form} heading="named" page={page} t={t} />
        </PageViewMemoryProvider>,
      ),
    )
    expect(container.querySelector('h2')?.className).toContain('dshx:sr-only')
    expect(container.querySelector('h2')?.className).not.toContain('dshx:text-title')
  })
})
