import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useCallback, useSyncExternalStore } from 'react'

import { ExplorerPanel } from './explorer-panel.tsx'
import { OptmemSettingsPanel } from './settings-panel.tsx'

const PACKAGE_NAME = '@dshfiles/optmem'
const EXPLORER_ID = 'dshfiles-optmem-explorer'

const SettingsView = (): JSX.Element => (
  <PluginQueryProvider>
    <OptmemSettingsPanel />
  </PluginQueryProvider>
)

/**
 * OptMem's list settings (cheap models, fallbacks) need row editors the generic Plugins-page form renders as raw JSON,
 * so one panel serves both seats: the Settings nav and the bundle's own Plugins page, which skips the generic form once a
 * package registers its own `plugins.bundle.config`.
 */
export default defineClient({
  name: PACKAGE_NAME,
  inject: ['slots', 'sessions', 'sidebarRight', 'uiWorkspace'],
  setup(ctx, decorate) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({ name: 'settings.section', id: 'dshfiles-optmem', order: 45, label: () => 'Memory' }, decorate(SettingsView)),
    )
    ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register(
        { name: 'plugins.bundle.config', key: PACKAGE_NAME },
        decorate((props: { readonly view: 'summary' | 'page' }) => (props.view === 'page' ? <SettingsView /> : null)),
      ),
    )
    const ExplorerView = (): JSX.Element => {
      const subscribeToMounted = useCallback((listener: () => void) => ctx.sidebarRight.mounted.subscribe(listener), [])
      const getMounted = useCallback(() => ctx.sidebarRight.mounted.getSnapshot(), [])
      const sessionId = useSyncExternalStore(subscribeToMounted, getMounted, () => undefined)
      const subscribeToSessions = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [])
      const getCurrentPath = useCallback(() => (sessionId === undefined ? null : (ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd ?? null)), [sessionId])
      const currentPath = useSyncExternalStore(subscribeToSessions, getCurrentPath, () => null)
      return (
        <PluginQueryProvider>
          <ExplorerPanel
            currentPath={currentPath}
            openSession={sourceId => {
              const source = Object.values(ctx.sessions.list.getSnapshot().byId).find(session => session.id === sourceId)
              if (source !== undefined) ctx.uiWorkspace.openSession(source.id)
            }}
          />
        </PluginQueryProvider>
      )
    }
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: EXPLORER_ID, order: 3, label: 'OptMem' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: EXPLORER_ID }, decorate(ExplorerView)))
  },
})

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M6 5.5h12M6 12h8M6 18.5h5" />
    <circle cx="18" cy="12" r="2.5" />
    <circle cx="16" cy="18.5" r="1.5" />
  </svg>
)
