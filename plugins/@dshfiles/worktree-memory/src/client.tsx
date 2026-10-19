import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { MemoryStickIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { WORKTREE_MEMORY_LOCALE_NAMESPACE, worktreeMemoryLocale } from './locales.js'
import { WorktreeMemoryPanel } from './panel.js'

const PANEL_ID = 'dshfiles-worktree-memory'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <MemoryStickIcon aria-hidden size={props.size ?? 18} strokeWidth={1.7} />

export default defineClient({
  name: '@dshfiles/worktree-memory',
  locales: [worktreeMemoryLocale],
  inject: ['slots', 'sessions', 'uiWorkspace'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(WORKTREE_MEMORY_LOCALE_NAMESPACE)
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 7, label: () => translate('title'), locale: WORKTREE_MEMORY_LOCALE_NAMESPACE },
        PanelGlyph,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: WORKTREE_MEMORY_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <TooltipProvider delayDuration={300}>
              <WorktreeMemoryPanel sessions={ctx.sessions} uiWorkspace={ctx.uiWorkspace} t={props.t} />
            </TooltipProvider>
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
