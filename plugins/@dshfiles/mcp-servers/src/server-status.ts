import type { Health } from '@dshfiles/plugin-ui/components/ui/status-dot'
import type { ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'

type LocalProcessState = Exclude<ServerView['localProcess'], 'not-configured'>
type LifecycleTextInput = { readonly server: ServerView; readonly t: McpServersTranslate }
type LocalProcessTextInput = { readonly server: ServerView; readonly t: McpServersTranslate }
type ServerSearchInput = { readonly server: ServerView; readonly search: string }
/** A server's health (DESIGN.md › Colour roles 4), or `working` while it starts. */
export type ServerMark = Health | 'working'

export class McpServerStatusModel {
  private static readonly localProcessCopy = {
    starting: 'localStarting',
    running: 'localRunning',
    exited: 'localExited',
    stopping: 'localStopping',
    stopped: 'localStopped',
    'stop-unconfirmed': 'localStopUnconfirmed',
  } as const satisfies Record<LocalProcessState, string>

  private static readonly lifecycleCopy = {
    loaded: 'clientLoaded',
    starting: 'clientStarting',
    'start-failed': 'clientFailed',
    'manually-disconnected': 'manuallyDisconnected',
    inactive: 'clientStopped',
  } as const satisfies Record<ServerView['clientLifecycle'], string>

  /** One health dot: green running, red failed to start, a faint ring stopped or disabled; the working ring while starting. */
  private static readonly lifecycleMarks = {
    loaded: 'ok',
    starting: 'working',
    'start-failed': 'down',
    'manually-disconnected': 'off',
    inactive: 'off',
  } as const satisfies Record<ServerView['clientLifecycle'], ServerMark>

  static readonly lifecycleText = ({ server, t }: LifecycleTextInput): string => t(McpServerStatusModel.lifecycleCopy[server.clientLifecycle])

  /** An enabled server that is not running because it needs a sign-in or credentials is limited (amber), not off. */
  static readonly lifecycleMark = (server: ServerView): ServerMark => {
    const mark = McpServerStatusModel.lifecycleMarks[server.clientLifecycle]
    if (mark !== 'working' && mark !== 'down' && server.enabled && (server.oauth === 'needs-sign-in' || server.configuration !== 'ready')) return 'limited'
    return mark
  }

  static readonly localProcessText = ({ server, t }: LocalProcessTextInput): string | undefined =>
    server.localProcess === 'not-configured' ? undefined : `${t('localProcess')}: ${t(McpServerStatusModel.localProcessCopy[server.localProcess])}`

  static readonly isClientActive = (server: ServerView): boolean => server.clientLifecycle === 'loaded' || server.clientLifecycle === 'starting'

  static readonly isConnectionToggleBlocked = (server: ServerView): boolean =>
    (!server.enabled && server.clientLifecycle !== 'loaded') || (server.configuration !== 'ready' && !McpServerStatusModel.isClientActive(server))

  static readonly credentialReferenceSummary = (server: ServerView): string =>
    server.credentialReferences.map(reference => `${reference.target} → ${reference.reference} (${reference.configured ? 'set' : 'missing'})`).join(', ')

  static readonly matchesServerSearch = ({ server, search }: ServerSearchInput): boolean => {
    const needle = search.trim().toLocaleLowerCase()
    return needle === '' || `${server.name} ${server.serverName}`.toLocaleLowerCase().includes(needle)
  }
}
