import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { LayersIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { resourcePacksApi } from './api.js'
import { ResourcesPanel } from './panel.js'
import type { ResourceRef } from './model.js'

const PANEL_ID = 'dshfiles-resources'

export default defineClient({
  name: '@dshfiles/resource-packs',
  inject: ['slots', 'sessions', 'workspaces', 'uiWorkspace'],
  setup(ctx, decorate) {
    const api = createApiClient(ctx, resourcePacksApi)
    const openConversation = (ref: ResourceRef): string | null => {
      if (ref.provider !== 'dsh' || ref.kind !== 'conversation') return 'This source has no native opener. Its reference is shown as text.'
      const workspaces = ctx.workspaces.list.getSnapshot()
      if (workspaces.phase !== 'ready' || workspaces.archivedSessionIds.some(id => id === ref.id))
        return 'This conversation is unavailable or archived. It was not opened or restored.'
      const sessions = ctx.sessions.list.getSnapshot()
      const id = sessions.ids.find(candidate => candidate === ref.id)
      const session = id === undefined ? undefined : sessions.byId[id]
      if (session === undefined) return 'This conversation is not available in the current session list. Its reference has been preserved.'
      try {
        ctx.uiWorkspace.openSession(session.id)
        return null
      } catch {
        return 'This conversation could not be opened. Its reference has been preserved.'
      }
    }
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => 'Resource Packs: Resources' }, () => (
        <PluginQueryProvider>
          <LayersIcon aria-hidden size={18} />
        </PluginQueryProvider>
      )),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <ResourcesPanel api={api} openConversation={openConversation} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
