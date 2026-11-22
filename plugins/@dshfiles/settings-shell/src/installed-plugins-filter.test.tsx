// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyInstalledPluginsFilter, InstalledPluginsFilter } from './installed-plugins-filter.js'
import type { ShellTranslate } from './native/locales.js'

const t: ShellTranslate = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

interface FakePluginPanel {
  readonly panel: HTMLElement
  readonly installedPanel: HTMLElement
}

const mountFakePluginPanel = (): FakePluginPanel => {
  const panel = document.createElement('section')
  panel.setAttribute('data-plugin-panel', 'true')
  panel.innerHTML = `
    <div data-plugin-body="true">
      <div class="installedPanel">
        <section data-plugin-group="basic">
          <h3>Built-in plugin config</h3>
          <ul>
            <li data-plugin-item="web-search"><strong>Web search</strong><p>Search the web with DeepSeek</p></li>
          </ul>
        </section>
        <section data-plugin-group="bundles">
          <h3>Installed plugins</h3>
          <ul>
            <li data-plugin-package="@dshfiles/main-tabs"><strong>Main tabs</strong><p>Tabbed views for chats and settings</p></li>
            <li data-plugin-package="@dshfiles/jj-integration"><strong>Jujutsu</strong><p>Thread workspaces and landing</p></li>
            <li data-plugin-package="@dshfiles/memory"><strong>Memory</strong><p>Persistent thread memory</p></li>
          </ul>
        </section>
      </div>
    </div>
  `
  document.body.appendChild(panel)
  const installedPanel = panel.querySelector<HTMLElement>('.installedPanel')
  if (installedPanel === null) throw new Error('expected installedPanel fixture')
  return { panel, installedPanel }
}

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  document.body.innerHTML = ''
})

describe('installed plugins filter', () => {
  it('filters cards by name, package id or description, hides empty groups, and clears cleanly', () => {
    const { installedPanel } = mountFakePluginPanel()

    act(() => {
      root.render(<InstalledPluginsFilter t={t} />)
    })

    const input = installedPanel.querySelector<HTMLInputElement>('input[role="searchbox"]')
    if (input === null) throw new Error('expected filter searchbox')
    expect(installedPanel.firstElementChild?.hasAttribute('data-dshfiles-plugins-filter-host')).toBe(true)

    act(() => {
      setInputValue(input, 'jj-integration')
    })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/jj-integration"]')?.hidden).toBe(false)
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/main-tabs"]')?.hidden).toBe(true)
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-group="basic"]')?.hidden).toBe(true)
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-group="bundles"]')?.hidden).toBe(false)
    expect(installedPanel.querySelector('[data-installed-plugins-count]')?.textContent).toBe('installedFilter.matches {"matched":1,"total":4}')

    act(() => {
      setInputValue(input, 'nonexistent-plugin-xyz')
    })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-group="bundles"]')?.hidden).toBe(true)
    const emptyState = installedPanel.querySelector('[data-installed-plugins-empty]')
    expect(emptyState?.textContent).toContain('installedFilter.empty')

    const resetButton = emptyState?.querySelector<HTMLButtonElement>('button')
    if (resetButton === null || resetButton === undefined) throw new Error('expected Clear filter button')
    act(() => {
      resetButton.click()
    })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-group="basic"]')?.hidden).toBe(false)
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/main-tabs"]')?.hidden).toBe(false)
  })

  it('clears on Escape and restores all cards when unmounted', () => {
    const { installedPanel } = mountFakePluginPanel()
    act(() => {
      root.render(<InstalledPluginsFilter t={t} />)
    })

    const input = installedPanel.querySelector<HTMLInputElement>('input[role="searchbox"]')
    if (input === null) throw new Error('expected filter searchbox')

    act(() => {
      setInputValue(input, 'memory')
    })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/main-tabs"]')?.hidden).toBe(true)

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/main-tabs"]')?.hidden).toBe(false)

    act(() => {
      setInputValue(input, 'memory')
    })
    act(() => {
      root.unmount()
    })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/main-tabs"]')?.hidden).toBe(false)
    expect(installedPanel.querySelector('[data-dshfiles-plugins-filter-host]')).toBeNull()
  })

  it('matches multi-word queries across package id and text', () => {
    const { installedPanel } = mountFakePluginPanel()
    const count = applyInstalledPluginsFilter(installedPanel, 'dshfiles tabbed')
    expect(count).toEqual({ matched: 1, total: 4 })
    expect(installedPanel.querySelector<HTMLElement>('[data-plugin-package="@dshfiles/main-tabs"]')?.hidden).toBe(false)
  })
})
