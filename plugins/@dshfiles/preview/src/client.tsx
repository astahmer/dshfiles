import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ProcessViews } from '@dshfiles/background-jobs/process-views'
import { defineClient } from '@dshfiles/dshx/client'
import { MonitorIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import * as Option from 'effect/Option'
import { useSyncExternalStore } from 'react'
import * as Schema from 'effect/Schema'
import { DevServersChip } from './dev-servers-chip.js'
import { DevServerViews } from './dev-servers-view.js'
import { MirrorView } from './mirror-view.js'

const MIRROR_TAB_ID = '@dshfiles/preview/agent-browser'
const MIRROR_TAB_KIND = 'dshfiles-preview-mirror'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dshfiles-preview-mirror': { readonly sessionId: string; readonly pageId: string }
  }
}

const mirrorParamsSchema = Schema.Struct({ sessionId: Schema.String, pageId: Schema.String })

const MirrorGlyph = (props: { readonly size?: number | undefined }): JSX.Element => <MonitorIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

export default defineClient({
  name: '@dshfiles/preview',
  inject: ['slots', 'sidebarRight', 'sidebarRightTabs'],
  setup(ctx, decorate, metadata) {
    // Dev servers are a tab of Observe › Processes and part of the thread panel's Jobs facet (plans/ade-ux §6); the
    // header chip stays the quick view on the thread itself.
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      const Tab = (props: Parameters<typeof DevServerViews.Tab>[0]): JSX.Element => (
        <PluginQueryProvider>
          <DevServerViews.Tab {...props} />
        </PluginQueryProvider>
      )
      const Thread = (props: Parameters<typeof DevServerViews.Thread>[0]): JSX.Element => (
        <PluginQueryProvider>
          <DevServerViews.Thread {...props} />
        </PluginQueryProvider>
      )
      plugin.add(ProcessViews, { id: 'dev-servers', label: 'Dev servers', order: 10, Page: plugin.bind(Tab), Thread: plugin.bind(Thread) })
    }

    // The Agent browser: the headless page the thread's agent drives, mirrored into the thread panel.
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: MIRROR_TAB_ID,
          kind: MIRROR_TAB_KIND,
          title: () => 'Agent browser',
          guide: [
            {
              id: 'agent-browser',
              order: 70,
              title: () => 'Agent browser',
              description: () => 'Watch and use the page this thread’s agent drives in its preview browser.',
              icon: MirrorGlyph,
            },
          ],
        }),
      'preview registers the Agent browser tab type',
    )
    const openMirror = (input: { readonly sessionId: string; readonly pageId: string }): void => {
      ctx.sidebarRight.openTab(MIRROR_TAB_KIND, { params: input })
    }
    const MirrorBody = decorate((props: { readonly useTabInfo: UseSidebarRightTabInfo }) => {
      const info = props.useTabInfo()
      // Opened from a page row it names its page; opened from the guide it follows the thread the panel shows.
      const params = Option.getOrUndefined(Schema.decodeUnknownOption(mirrorParamsSchema)(info.tab.navigation.params))
      const mounted = useSyncExternalStore(ctx.sidebarRight.mounted.subscribe, ctx.sidebarRight.mounted.getSnapshot)
      const sessionId = params?.sessionId ?? (mounted === undefined ? undefined : String(mounted))
      if (sessionId === undefined) return null
      return (
        <PluginQueryProvider>
          <MirrorView sessionId={sessionId} pageId={params?.pageId} visible={info.tab.visible} />
        </PluginQueryProvider>
      )
    })
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: MIRROR_TAB_ID }, MirrorBody))

    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'dshfiles-preview-dev-servers', order: 20 },
        decorate(props => (
          <PluginQueryProvider>
            <DevServersChip sessionId={props.sessionId} onWatch={openMirror} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
