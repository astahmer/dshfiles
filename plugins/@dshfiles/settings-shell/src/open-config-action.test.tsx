import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsDocumentState } from './native/document-action.js'
import type { ShellTranslate } from './native/locales.js'
import { OpenConfigAction, pathEnd, type ConfigFileOpeners } from './open-config-action.js'

const createController = (onNativeOpen: () => void) => {
  const state: SettingsDocumentState = { status: 'ready', opening: false, error: null }
  const store: ObservableSnapshot<SettingsDocumentState> = {
    getSnapshot: () => state,
    subscribe: () => () => {},
  }
  return {
    store,
    load: async () => {},
    open: async () => onNativeOpen(),
  }
}

const createOpeners = (openDefault: ConfigFileOpeners['openDefault']): ConfigFileOpeners => ({
  documentPath: async () => ({ path: '/profile/cordis.patch.yml', exists: true }),
  canOpenPaths: async () => true,
  applications: async () => [],
  openDefault,
  openWith: async () => true,
  reveal: async () => true,
  openInEditor: undefined,
})

const translate: ShellTranslate = key => (key === 'openDocument' ? 'Open configuration file' : key)

describe('OpenConfigAction', () => {
  it('opens an existing configuration document with the configured default app', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let nativeOpenCount = 0
    const controller = createController(() => {
      nativeOpenCount += 1
    })
    const openDefault = vi.fn(async () => true)

    try {
      await act(async () => {
        root.render(<OpenConfigAction controller={controller} openers={createOpeners(openDefault)} t={translate} />)
      })
      const button = container.querySelector('button')
      expect(button?.textContent).toBe('Open configuration file')
      await act(async () => {
        button?.click()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(openDefault).toHaveBeenCalledWith('/profile/cordis.patch.yml')
      expect(nativeOpenCount).toBe(0)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })

  it('shows the path in a tooltip, never in a native title, and only its end', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(<OpenConfigAction controller={createController(() => {})} openers={createOpeners(async () => true)} t={translate} />)
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(container.querySelectorAll('[title]')).toHaveLength(0)
      expect(pathEnd('/private/var/folders/3k/T/dshx-boot/home/.dsh/profiles/web/cordis.patch.yml')).toBe('…/profiles/web/cordis.patch.yml')
      expect(pathEnd('/profile/cordis.patch.yml')).toBe('/profile/cordis.patch.yml')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
