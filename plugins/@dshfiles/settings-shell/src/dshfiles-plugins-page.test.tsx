import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundleCategoryOf } from './bundle-categories.js'
import { bundleDisplayTitle, DshfilesPluginsView, settingsEntryIdForBundle } from './dshfiles-plugins-page.js'
import type { ShellTranslate } from './native/locales.js'
import { SettingsGroups } from './settings-groups.js'
import type { PluginBundle, PluginBundleChange } from './shell-api.js'

const t: ShellTranslate = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)

const sampleBundles: readonly PluginBundle[] = [
  {
    name: '@dshfiles/main-tabs',
    origin: 'dshfiles',
    title: { en: 'Main tabs' },
    description: null,
    packageDescription: 'Browser-like tabs above the main view.',
    version: '0.1.0',
    enabled: true,
    installed: true,
    availability: 'profile',
    readOnlyReason: null,
    pendingRestart: null,
    rowIds: ['dshfiles-main-tabs'],
    activeRowCount: 1,
  },
  {
    name: '@dshfiles/backlog',
    origin: 'dshfiles',
    title: null,
    description: null,
    packageDescription: 'Project backlog board and triage.',
    version: '0.1.0',
    enabled: false,
    installed: true,
    availability: 'profile',
    readOnlyReason: null,
    pendingRestart: 'disable',
    rowIds: ['dshfiles-backlog'],
    activeRowCount: 0,
  },
  {
    name: '@deepseek-ai/dsh-base',
    origin: 'dsh',
    title: 'DSH Base',
    description: null,
    packageDescription: 'Core DSH runtime.',
    version: '0.2.2-rc.2',
    enabled: true,
    installed: true,
    availability: 'installation',
    readOnlyReason: 'management-required',
    pendingRestart: null,
    rowIds: [],
    activeRowCount: 0,
  },
  {
    name: 'dshmarket',
    origin: 'community',
    title: 'Plugin Market',
    description: null,
    packageDescription: 'Community plugin marketplace.',
    version: '1.66.14',
    enabled: true,
    installed: true,
    availability: 'profile',
    readOnlyReason: null,
    pendingRestart: null,
    rowIds: ['market'],
    activeRowCount: 1,
  },
]

const groups = SettingsGroups.group({
  sections: [{ id: 'market', order: 10, label: 'Plugin Market' }],
  pages: [
    {
      pageId: 'plugin:dshfiles-main-tabs',
      ns: 'dshfiles-main-tabs',
      title: 'Main tabs',
      description: '',
      group: 'plugins',
      origin: 'plugin',
      bundleName: '@dshfiles/main-tabs',
      fields: [],
      modifiedPaths: [],
    },
  ],
  panels: new Set(),
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

describe('dshfiles plugins page', () => {
  it('categorizes, titles, and links bundles to their Settings entries', () => {
    expect(bundleCategoryOf({ name: '@dshfiles/main-tabs', origin: 'dshfiles' })).toBe('workspace')
    expect(bundleCategoryOf({ name: '@dshfiles/backlog', origin: 'dshfiles' })).toBe('projects')
    expect(bundleCategoryOf({ name: '@deepseek-ai/dsh-base', origin: 'dsh' })).toBe('core')
    expect(bundleDisplayTitle(sampleBundles[1]!, value => (typeof value === 'string' ? value : value.en))).toBe('Backlog')
    expect(settingsEntryIdForBundle(groups, sampleBundles[0]!)).toBe('plugin:dshfiles-main-tabs')
    expect(settingsEntryIdForBundle(groups, sampleBundles[3]!)).toBe('market')
  })

  it('defaults to dshfiles plugins, filters by status and scope, toggles enablement, and jumps to Settings', async () => {
    const toggled: Array<readonly [string, boolean]> = []
    const opened: string[] = []
    const onToggle = async (name: string, enabled: boolean): Promise<PluginBundleChange> => {
      toggled.push([name, enabled])
      return { name, changed: true, enabled, application: 'applied', restartReason: null, error: null, warnings: [] }
    }
    await act(async () => {
      root.render(
        <DshfilesPluginsView
          bundles={sampleBundles}
          error={undefined}
          groups={groups}
          loading={false}
          onOpenSettings={id => opened.push(id)}
          onRefresh={() => {}}
          onToggle={onToggle}
          refreshing={false}
          resolveLocaleText={value => (typeof value === 'string' ? value : value.en)}
          t={t}
        />,
      )
    })

    const shownBundles = () => [...container.querySelectorAll('[data-dshfiles-bundle]')].map(el => el.getAttribute('data-dshfiles-bundle'))
    expect(shownBundles()).toEqual(['@dshfiles/main-tabs', '@dshfiles/backlog'])

    const disabledFilter = container.querySelector<HTMLButtonElement>('[data-plugins-status="disabled"]')
    await act(async () => disabledFilter?.click())
    expect(shownBundles()).toEqual(['@dshfiles/backlog'])

    const allStatus = container.querySelector<HTMLButtonElement>('[data-plugins-status="all"]')
    await act(async () => allStatus?.click())

    const allScope = container.querySelector<HTMLButtonElement>('[data-plugins-scope="all"]')
    await act(async () => allScope?.click())
    expect(shownBundles()).toEqual(['@dshfiles/main-tabs', '@dshfiles/backlog', '@deepseek-ai/dsh-base', 'dshmarket'])

    const search = container.querySelector<HTMLInputElement>('input[aria-label="pluginsPage.searchPlaceholder"]')
    await act(async () => {
      if (search === null) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'backlog')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(shownBundles()).toEqual(['@dshfiles/backlog'])
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="search.clear"]')?.click())
    expect(shownBundles()).toHaveLength(4)

    const mainTabsRow = container.querySelector('[data-dshfiles-bundle="@dshfiles/main-tabs"]')
    const settingsBtn = [...(mainTabsRow?.querySelectorAll('button') ?? [])].find(btn => btn.textContent?.includes('pluginsPage.configure'))
    await act(async () => settingsBtn?.click())
    expect(opened).toEqual(['plugin:dshfiles-main-tabs'])

    const switchBtn = mainTabsRow?.querySelector<HTMLButtonElement>('[role="switch"]')
    await act(async () => switchBtn?.click())
    expect(toggled).toEqual([['@dshfiles/main-tabs', false]])
  })

  it('marks protected, restart-pending and missing bundles and announces a failed toggle', async () => {
    const bundles: readonly PluginBundle[] = sampleBundles.map(bundle =>
      bundle.name === '@dshfiles/backlog' ? { ...bundle, pendingRestart: 'enable', installed: false, availability: 'missing' } : bundle,
    )
    const onToggle = async (name: string, enabled: boolean): Promise<PluginBundleChange> => ({
      name,
      changed: false,
      enabled,
      application: 'failed',
      restartReason: null,
      error: 'profile locked',
      warnings: [],
    })
    await act(async () => {
      root.render(
        <DshfilesPluginsView
          bundles={bundles}
          error={undefined}
          groups={groups}
          loading={false}
          onOpenSettings={() => {}}
          onRefresh={() => {}}
          onToggle={onToggle}
          refreshing={false}
          resolveLocaleText={value => (typeof value === 'string' ? value : value.en)}
          t={t}
        />,
      )
    })
    const backlogRow = container.querySelector('[data-dshfiles-bundle="@dshfiles/backlog"]')
    expect(backlogRow?.querySelector('[data-pending-restart="enable"]')?.textContent).toBe('entryCard.startsAfterRestart')
    expect(backlogRow?.textContent).toContain('pluginsPage.notInstalled')
    expect(container.querySelector('[data-plugins-pending-restart]')?.textContent).toBe('pluginsPage.pendingRestart {"count":1}')
    expect(container.querySelector('[data-plugins-category="projects"]')?.getAttribute('aria-label')).toBe('pluginsPage.cat.projects')

    await act(async () => backlogRow?.querySelector<HTMLButtonElement>('[role="switch"]')?.click())
    expect(backlogRow?.querySelector('[role="alert"]')?.textContent).toBe('entryCard.failed {"reason":"profile locked"}')
  })

  it('shows the load error as an alert', async () => {
    await act(async () => {
      root.render(
        <DshfilesPluginsView
          bundles={[]}
          error="Host unreachable"
          groups={groups}
          loading={false}
          onOpenSettings={() => {}}
          onRefresh={() => {}}
          onToggle={async () => {
            throw new Error('unused')
          }}
          refreshing={false}
          resolveLocaleText={value => (typeof value === 'string' ? value : value.en)}
          t={t}
        />,
      )
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Host unreachable')
  })
})
