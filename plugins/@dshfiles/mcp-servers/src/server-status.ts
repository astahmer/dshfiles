import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import type { ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'

type LocalProcessState = Exclude<ServerView['localProcess'], 'not-configured'>
type LifecycleTextInput = { readonly server: ServerView; readonly t: McpServersTranslate }
type LocalProcessTextInput = { readonly server: ServerView; readonly t: McpServersTranslate }
type ServerSearchInput = { readonly server: ServerView; readonly search: string }

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

  /** The shared status vocabulary: a connected server is quiet, one that is starting works, only a failed start is coloured. */
  private static readonly lifecycleGlyphs = {
    loaded: 'idle',
    starting: 'working',
    'start-failed': 'failed',
    'manually-disconnected': 'stopped',
    inactive: 'stopped',
  } as const satisfies Record<ServerView['clientLifecycle'], StatusGlyphState>

  static readonly lifecycleText = ({ server, t }: LifecycleTextInput): string => t(McpServerStatusModel.lifecycleCopy[server.clientLifecycle])

  static readonly lifecycleGlyph = (server: ServerView): StatusGlyphState => McpServerStatusModel.lifecycleGlyphs[server.clientLifecycle]

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
