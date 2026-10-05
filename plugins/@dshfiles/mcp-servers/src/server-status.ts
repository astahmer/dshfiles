import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'

type LocalProcessState = Exclude<ServerView['localProcess'], 'not-configured'>

const localProcessCopy = {
  starting: 'localStarting',
  running: 'localRunning',
  exited: 'localExited',
  stopping: 'localStopping',
  stopped: 'localStopped',
  'stop-unconfirmed': 'localStopUnconfirmed',
} as const satisfies Record<LocalProcessState, string>

const lifecycleCopy = {
  loaded: 'clientLoaded',
  starting: 'clientStarting',
  'start-failed': 'clientFailed',
  'manually-disconnected': 'manuallyDisconnected',
  inactive: 'clientStopped',
} as const satisfies Record<ServerView['clientLifecycle'], string>

const lifecycleDotStates = {
  loaded: 'done',
  starting: 'ongoing',
  'start-failed': 'error',
  'manually-disconnected': 'idle',
  inactive: 'idle',
} as const satisfies Record<ServerView['clientLifecycle'], StateDotState>

export const lifecycleText = (server: ServerView, t: McpServersTranslate): string => t(lifecycleCopy[server.clientLifecycle])

export const lifecycleDotState = (server: ServerView): StateDotState => lifecycleDotStates[server.clientLifecycle]

export const localProcessText = (server: ServerView, t: McpServersTranslate): string | undefined =>
  server.localProcess === 'not-configured' ? undefined : `${t('localProcess')}: ${t(localProcessCopy[server.localProcess])}`

export const isClientActive = (server: ServerView): boolean => server.clientLifecycle === 'loaded' || server.clientLifecycle === 'starting'

export const isConnectionToggleBlocked = (server: ServerView): boolean =>
  (!server.enabled && server.clientLifecycle !== 'loaded') || (server.configuration !== 'ready' && !isClientActive(server))

export const credentialReferenceSummary = (server: ServerView): string =>
  server.credentialReferences.map(reference => `${reference.target} → ${reference.reference} (${reference.configured ? 'set' : 'missing'})`).join(', ')

export const matchesServerSearch = (server: ServerView, search: string): boolean => {
  const needle = search.trim().toLocaleLowerCase()
  return needle === '' || `${server.name} ${server.serverName}`.toLocaleLowerCase().includes(needle)
}
