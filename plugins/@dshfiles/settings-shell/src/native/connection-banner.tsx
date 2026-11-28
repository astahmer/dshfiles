/**
 * The connection strip (DESIGN.md Connection): the one drawing of whether DSH can hear this page. A pill at the top
 * centre of the window on a desktop, a full-width line under the top bar on a phone. Nothing is drawn while online,
 * so a healthy page has no layout to shift.
 */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { HealthDot, type Health } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ConnectionStripState } from './connection-strip.js'
import type { ShellTranslate } from './locales.js'
import type { ReachabilityState } from './reachability.js'
import { useObservable } from './use-observable.js'

type Shown = NonNullable<ConnectionStripState>

const SENTENCE = { reconnecting: 'connection.checking', offline: 'connection.offline', connected: 'connection.connected' } as const satisfies Record<Shown, string>
const HEALTH = { reconnecting: 'limited', offline: 'down', connected: 'ok' } as const satisfies Record<Shown, Health>

export const ConnectionBanner = (props: {
  readonly t: ShellTranslate
  readonly strip: ObservableSnapshot<ConnectionStripState>
  readonly reachability: ObservableSnapshot<ReachabilityState>
  readonly retry: () => void
}): JSX.Element => {
  const strip = useObservable(props.strip)
  const probing = useObservable(props.reachability).probing
  const sentence = strip === undefined ? '' : props.t(SENTENCE[strip])
  return (
    <>
      {/* One polite node that holds only the words that change: each state is said once, the strip itself is not a live region. */}
      <span role="status" aria-live="polite" className="dshx-root dshx:sr-only">
        {sentence}
      </span>
      {strip !== undefined && (
        <div
          data-connection-banner={strip}
          className={cn(
            'dshx-root dshx:fixed dshx:top-2 dshx:left-1/2 dshx:z-50 dshx:flex dshx:max-w-[calc(100vw-2rem)] dshx:-translate-x-1/2 dshx:items-center dshx:gap-2',
            'dshx:min-h-8 dshx:rounded-full dshx:border dshx:border-border dshx:bg-popover dshx:px-3 dshx:text-xs dshx:text-foreground dshx:shadow-s2',
            'dshx:phone:inset-x-0 dshx:phone:top-[calc(env(safe-area-inset-top)+var(--dsh-phone-top-height,0px))] dshx:phone:max-w-none dshx:phone:translate-x-0',
            'dshx:phone:rounded-none dshx:phone:border-x-0 dshx:phone:border-t-0 dshx:phone:bg-background dshx:phone:shadow-s0',
          )}
        >
          <HealthDot health={HEALTH[strip]} />
          {/* A phone line is the full width: the sentence wraps there instead of losing its end. */}
          <span aria-hidden className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:phone:py-1.5 dshx:phone:whitespace-normal">
            {sentence}
          </span>
          {strip === 'offline' && (
            <button
              type="button"
              disabled={probing}
              onClick={props.retry}
              className="dshx:-my-2 dshx:min-h-11 dshx:shrink-0 dshx:cursor-pointer dshx:border-none dshx:bg-transparent dshx:px-2 dshx:font-medium dshx:text-inherit dshx:underline dshx:disabled:cursor-default dshx:disabled:opacity-60"
            >
              {props.t('connection.retry')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
