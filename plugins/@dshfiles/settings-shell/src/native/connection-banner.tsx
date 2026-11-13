/** The phone's connection line: one slim bar under the top bar while the Host is unreachable. */

import { isMobileDevice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ShellTranslate } from './locales.js'
import { ReachabilityModel, type ReachabilityState } from './reachability.js'
import { useObservable } from './use-observable.js'

const NARROW = '(max-width: 720px)'

/** The desktop keeps its sidebar indicator; a phone, or a window as narrow as one, has no sidebar to show it. */
const narrowLayout = (): boolean => isMobileDevice() || (typeof matchMedia === 'function' && matchMedia(NARROW).matches)

export const ConnectionBanner = (props: {
  readonly t: ShellTranslate
  readonly reachability: ObservableSnapshot<ReachabilityState>
  readonly connectionState: ObservableSnapshot<ConnectionState | undefined>
  readonly retry: () => void
}): JSX.Element | null => {
  const state = useObservable(props.reachability)
  const connection = useObservable(props.connectionState)
  const view = ReachabilityModel.view({ state, connection })
  if (view === 'online' || !narrowLayout()) return null
  const host = typeof location === 'undefined' ? '' : location.host
  return (
    <div
      role="status"
      aria-live="polite"
      data-connection-banner={view}
      className={cn(
        'dshx-root dshx:fixed dshx:inset-x-0 dshx:z-50 dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-b dshx:px-3 dshx:text-xs',
        'dshx:top-[calc(env(safe-area-inset-top)+var(--dsh-phone-top-height,0px))] dshx:min-h-8',
        view === 'offline'
          ? 'dshx:border-(--dsw-alias-state-warn-tertiary) dshx:bg-(--dsw-alias-state-warn-tertiary) dshx:text-(--dsw-alias-state-warn-label)'
          : 'dshx:border-border dshx:bg-background dshx:text-muted-foreground',
      )}
    >
      <span className="dshx:min-w-0 dshx:truncate">{props.t(view === 'offline' ? 'connection.offline' : 'connection.checking', { host })}</span>
      {view === 'offline' && (
        <button
          type="button"
          onClick={props.retry}
          className="dshx:-my-2 dshx:min-h-11 dshx:shrink-0 dshx:cursor-pointer dshx:border-none dshx:bg-transparent dshx:px-2 dshx:font-medium dshx:text-inherit dshx:underline"
        >
          {props.t('connection.retry')}
        </button>
      )}
    </div>
  )
}
