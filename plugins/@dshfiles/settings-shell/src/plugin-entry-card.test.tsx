import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from './native/locales.js'
import { PluginEntryDisclosure } from './plugin-entry-card.js'

const t: ShellTranslate = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

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

const fold = (): HTMLButtonElement | null => container.querySelector('[data-plugin-details]')

describe('plugin details', () => {
  it('keeps the entry id and the plugin switch behind one closed control, named for its page', async () => {
    await act(async () =>
      root.render(
        <PluginEntryDisclosure open={false} page="Main tabs" t={t}>
          <code>include:dshfiles-main-tabs</code>
        </PluginEntryDisclosure>,
      ),
    )
    expect(container.textContent).toBe('entryCard.details')
    expect(fold()?.getAttribute('aria-label')).toBe('entryCard.detailsOf {"page":"Main tabs"}')
    expect(fold()?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => fold()?.click())
    expect(container.textContent).toContain('include:dshfiles-main-tabs')
  })

  it('starts open when the entry has something to say, such as a change waiting for a restart', async () => {
    await act(async () =>
      root.render(
        <PluginEntryDisclosure open page="Main tabs" t={t}>
          <span>Stops after a restart</span>
        </PluginEntryDisclosure>,
      ),
    )
    expect(container.textContent).toContain('Stops after a restart')
  })
})
