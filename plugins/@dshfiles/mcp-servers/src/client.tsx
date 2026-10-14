import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { rankByName, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { PlugIcon } from '@dshfiles/plugin-ui/icons'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { dshxRegistryApi } from '@dshfiles/dshx/api'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { MCP_LOCALE_NAMESPACE, mcpServersLocale, type McpServersTranslate } from './locales.js'
import { mcpServersApi } from './api.js'
import { ManagerView } from './manager-view.js'
import { createMcpMentionSource, decodeMcpMentionTools } from './mcp-mentions.js'
import { McpQuickPanel } from './mcp-quick-panel.js'
import { createQuickPanelContribution, SessionQuickPanels, type QuickPanelState } from './quick-panel.js'
import './client.css'

const PANEL_ID = 'mcp-servers'

const icon = (size = 18): JSX.Element => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 7h8M8 12h8M8 17h8" />
    <circle cx="5" cy="7" r="1" />
    <circle cx="5" cy="12" r="1" />
    <circle cx="5" cy="17" r="1" />
  </svg>
)

export default defineClientPlugin({
  id: 'dshfiles-mcp-servers',
  name: 'MCP servers',
  uses: ['ui', 'rpc'],
  inject: ['commandUi', 'layout', 'inputTriggers'],
  locales: [mcpServersLocale],
  setup(api) {
    const ctx = api.raw.ctx
    const translate = ctx.locale.bind(MCP_LOCALE_NAMESPACE) as McpServersTranslate
    const panels = new SessionQuickPanels()
    const mcpApi = api.rpc.use(mcpServersApi)
    const registryApi = api.rpc.use(dshxRegistryApi)
    const mentions = createMcpMentionSource({
      rank: rankByName,
      list: async (sessionId, signal) => {
        const [serversResult, registryResult] = await Promise.allSettled([mcpApi.list(undefined, { signal }), registryApi.list({ sessionId }, { signal })])
        const servers =
          serversResult.status === 'fulfilled'
            ? serversResult.value.servers.filter(server => server.enabled).map(server => ({ name: server.name, serverName: server.serverName }))
            : []
        return {
          servers,
          tools: registryResult.status === 'fulfilled' ? decodeMcpMentionTools(registryResult.value) : [],
        }
      },
      serverSection: translate('mentionServersSection'),
      toolSection: translate('mentionToolsSection'),
      serverInstruction: translate('mentionServerInstruction'),
      toolInstruction: translate('mentionToolInstruction'),
      useWhenRelevant: translate('mentionUseWhenRelevant'),
    })
    ctx.on('connection/reset', mentions.clear)
    ctx.effect(() => {
      const unregister = ctx.inputTriggers.registerSource(mentions.source)
      return () => {
        unregister()
        mentions.clear()
      }
    }, 'MCP servers: @ suggestions')

    const RootPanel = (): JSX.Element => (
      <PluginQueryProvider>
        <ManagerView t={translate} />
      </PluginQueryProvider>
    )
    const openManager = (): void => ctx.layout.selectPanel(PANEL_ID as MainPanelId)
    const RootQuickPanel = ({ panel }: { readonly panel: QuickPanelState }): JSX.Element => (
      <PluginQueryProvider>
        <McpQuickPanel onManage={openManager} panel={panel} t={translate} />
      </PluginQueryProvider>
    )

    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: () => translate('title'), locale: MCP_LOCALE_NAMESPACE }, () => icon())
    api.ui.register({ name: 'main', key: PANEL_ID, locale: MCP_LOCALE_NAMESPACE }, RootPanel)
    api.ui.register(
      {
        name: 'conversation.input.overlay',
        id: 'mcp-servers-quick-panel',
        order: 3,
        locale: MCP_LOCALE_NAMESPACE,
        inject: sessionId => ({ panel: panels.forSession(sessionId) }),
      },
      RootQuickPanel,
    )

    const MenuIcon = (props: IconProps): JSX.Element => <PlugIcon aria-hidden className={props.className} size={props.size ?? 16} />
    ctx.effect(() => ctx.commandUi.register(createQuickPanelContribution(panels, translate, MenuIcon)), 'MCP quick panel command')
  },
})
