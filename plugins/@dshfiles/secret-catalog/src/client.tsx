import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ProjectFolderPicker } from '@dshfiles/project-folder-picker'
import { CatalogNavigation } from './catalog-navigation.js'
import { SECRET_CATALOG_LOCALE_NAMESPACE, secretCatalogLocale } from './locales.js'
import { SecretCatalogPanel } from './secret-catalog-panel.js'
import { JevInlineSetup } from './jev-inline-setup.js'
import { SecretInputOverlay } from './secret-input-overlay.js'
import { createWorkspacePickerPorts } from './workspace-picker-adapter.js'

const PANEL_ID = 'secret-catalog'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/secret-catalog',
  locales: [secretCatalogLocale],
  inject: ['slots', 'conversation', 'remote', 'remote.directoryPicker', 'remote.workspace', 'workspaces', 'layout'],
  setup(ctx, decorate) {
    const pickerPorts = createWorkspacePickerPorts(ctx.remote)
    const translate = ctx.locale.bind(SECRET_CATALOG_LOCALE_NAMESPACE)
    const label = (): string => translate('title')
    const workspaces = (): IWorkspaces => ctx.workspaces
    const workspaceFolders = (): readonly string[] =>
      ctx.workspaces.list
        .getSnapshot()
        .items.map(workspace => workspace.path)
        .filter(path => path.length > 0)
        .slice(0, 16)
    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (panelId: string): panelId is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panelId)
    CatalogNavigation.setOpener(() => {
      if (isMainPanelId(PANEL_ID)) ctx.layout.selectPanel(PANEL_ID)
    })
    ctx.effect(() => () => CatalogNavigation.setOpener(null), 'secret-catalog navigation')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label, locale: SECRET_CATALOG_LOCALE_NAMESPACE }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: SECRET_CATALOG_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <SecretCatalogPanel
              directoryPicker={pickerPorts.directoryPicker}
              workspaces={workspaces()}
              registerWorkspace={pickerPorts.registerWorkspace}
              t={props.t}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('conversation.chat.turnTail', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.turnTail',
          id: 'dshfiles-secret-catalog-jev-setup',
          order: 20,
          locale: SECRET_CATALOG_LOCALE_NAMESPACE,
          inject: sessionId => ({ sessionId }),
        },
        decorate((props: { readonly sessionId: string; readonly turn: TurnLocation }) => (
          <PluginQueryProvider>
            <JevInlineSetup {...props} probeFolders={workspaceFolders()} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )
    const SecretOverlay = (): JSX.Element => (
      <PluginQueryProvider>
        <SecretInputOverlay t={translate} />
      </PluginQueryProvider>
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-secret-input', order: 118, locale: SECRET_CATALOG_LOCALE_NAMESPACE }, decorate(SecretOverlay)),
    )
  },
})

export { ProjectFolderPicker }
