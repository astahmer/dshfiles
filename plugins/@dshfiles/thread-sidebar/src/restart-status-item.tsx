import type { StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import { useApi, useRegistry, useResource } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { threadSidebarRestartApi, type AutoRestartStatusWire } from './restart-api.js'
import { RestartBridge, type RestartRequest } from './restart-bridge.js'
import { AUTO_RESTART_READ } from './restart-status-read.js'
import { PendingRestartSources, type PendingRestartSource } from './restart-sources.js'

export interface RestartStatusText {
  /** "Restart pending · 3 plugins" style label for the strip. */
  readonly pending: (count: number) => string
  readonly applied: string
  readonly manual: string
  readonly restart: string
  readonly restartWhenIdle: string
  /** "Restarting to apply updates in 30 s" while the automatic restart counts down. */
  readonly autoCountdown: (seconds: number) => string
  readonly postpone: string
  /** No supervisor can restart DSH: start it with this command. */
  readonly autoUnsupervised: string
  readonly copyCommand: string
  readonly copied: string
  /** Turns `autoRestartWhenIdle` off, the other way out of the unsupervised notice. */
  readonly turnOffAuto: string
}

/** What the strip item reads of the automatic restart. */
interface AutoRestartView {
  /** Undefined on a Host without automatic restarts. */
  readonly status: AutoRestartStatusWire | undefined
  /** Seconds until the counted-down restart; null while nothing counts down. */
  readonly secondsLeft: number | null
  readonly refetch: () => void
}

/**
 * The current time, ticking once a second while `active`; while inactive it holds the time it stopped ticking, so
 * render stays pure.
 */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const tick = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(tick)
  }, [active])
  return now
}

/**
 * The Host's automatic-restart state while the caller is mounted; undefined on a Host without it. The status item and
 * the rail's Restart (sidebar-shell) read it the same way.
 */
export const useAutoRestart = (): AutoRestartView => {
  const resource = useResource(threadSidebarRestartApi, 'autoRestartStatus', {}, AUTO_RESTART_READ)
  const refetch = resource.refetch
  const status = resource.status === 'error' ? undefined : resource.data
  const counting = status?.phase === 'countdown'
  const now = useNow(counting)
  // A page that saw the automatic restart begin reloads once the new Host answers: the Host halves it held back
  // only take effect in the page with their client bundles, and the page would otherwise keep showing the old notice.
  const followed = useRef<{ readonly run: string; readonly restarting: boolean } | null>(null)
  useEffect(() => {
    if (status === undefined) return
    const previous = followed.current
    if (previous !== null && previous.restarting && previous.run !== status.run) {
      window.location.reload()
      return
    }
    const restarting = status.phase === 'countdown' || status.phase === 'restarting' || (previous?.restarting === true && previous.run === status.run)
    followed.current = { run: status.run, restarting }
  }, [status])
  const secondsLeft = counting && status.restartAt !== null ? Math.max(0, Math.ceil((status.restartAt - now) / 1000)) : null
  return { status, secondsLeft, refetch }
}

const NO_PACKAGES: readonly string[] = []

/** One store over every source's packages, so the item re-renders when any of them changes. */
const useSourcePackages = (sources: readonly PendingRestartSource[]): readonly string[] => {
  const store = useMemo(() => {
    let cached: { readonly inputs: readonly (readonly string[])[]; readonly value: readonly string[] } | undefined
    return {
      subscribe: (listener: () => void) => {
        const stops = sources.map(source => source.subscribe(listener))
        return () => {
          for (const stop of stops) stop()
        }
      },
      read: (): readonly string[] => {
        const inputs = sources.map(source => source.packages())
        if (cached !== undefined && cached.inputs.length === inputs.length && cached.inputs.every((list, index) => list === inputs[index])) return cached.value
        cached = { inputs, value: inputs.length === 0 ? NO_PACKAGES : RestartBridge.combine(inputs) }
        return cached.value
      },
    }
  }, [sources])
  return useSyncExternalStore(store.subscribe, store.read, store.read)
}

/**
 * The status strip's one restart item (docs/ade-ux §4.1 R5): every update only a Host restart applies, from the Host
 * files thread-sidebar watches and from other plugins' sources, with the restart verbs. It hides while nothing waits.
 * The verbs run in the sidebar shell, which keeps the confirmation dialog and its guards.
 */
export const RestartStatusItem = (props: StatusItemProps & { readonly text: RestartStatusText }): JSX.Element | null => {
  const notice = useSyncExternalStore(RestartBridge.subscribe, RestartBridge.read, RestartBridge.read)
  const sources = useRegistry(PendingRestartSources)
  const sourcePackages = useSourcePackages(sources)
  const auto = useAutoRestart()
  const autoUpdates = auto.status?.updates ?? NO_PACKAGES
  const plugins = useMemo(() => RestartBridge.combine([notice.hostPlugins, sourcePackages, autoUpdates]), [notice.hostPlugins, sourcePackages, autoUpdates])
  const [open, setOpen] = useState(false)
  const restartApi = useApi(threadSidebarRestartApi)
  const commandCopy = useCopyFeedback()
  // The rail's Restart carries the same countdown, Postpone and verbs: one restart control (b:kgcc).
  if (notice.onRail) return null
  if (plugins.length === 0 && notice.waitingLabel === null && auto.secondsLeft === null) return null
  const label = auto.secondsLeft === null ? (notice.waitingLabel ?? props.text.pending(plugins.length)) : props.text.autoCountdown(auto.secondsLeft)
  const postpone = (): void => {
    setOpen(false)
    void restartApi.safe.postponeAutoRestart({}).then(() => auto.refetch())
  }
  const run = (request: RestartRequest): void => {
    setOpen(false)
    RestartBridge.request(request)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="dshx-root dshx:inline-flex dshx:h-5 dshx:min-w-0 dshx:items-center dshx:rounded-sm dshx:px-1 dshx:text-warning dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
          data-testid="status-item-restart"
          aria-label={label}
        >
          <span className="dshx:truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="dshx-root dshx:flex dshx:w-72 dshx:max-w-[calc(100vw-16px)] dshx:flex-col dshx:gap-3">
        {plugins.length === 0 ? null : (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:text-sm dshx:font-medium">{props.text.applied}</p>
            <ul className="dshx:max-h-40 dshx:overflow-y-auto dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
              {plugins.map(plugin => (
                <li key={plugin}>{plugin}</li>
              ))}
            </ul>
          </div>
        )}
        {auto.status?.phase === 'unsupervised' && auto.status.command !== null ? (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.text.autoUnsupervised}</p>
            <code className="dshx:break-all dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:py-0.5 dshx:font-mono dshx:text-xs" data-testid="auto-restart-command">
              {auto.status.command}
            </code>
            <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => run('turn-off-auto-restart')}>
                {props.text.turnOffAuto}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void commandCopy.copy(auto.status?.command ?? '')}>
                {commandCopy.copied ? props.text.copied : props.text.copyCommand}
              </Button>
            </div>
          </div>
        ) : null}
        {notice.available ? (
          <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
            {auto.secondsLeft === null ? null : (
              <Button type="button" variant="outline" size="sm" onClick={postpone}>
                {props.text.postpone}
              </Button>
            )}
            {notice.waitingLabel === null ? (
              <Button type="button" variant="outline" size="sm" onClick={() => run('restart-when-idle')}>
                {props.text.restartWhenIdle}
              </Button>
            ) : null}
            <Button type="button" variant="destructive" size="sm" onClick={() => run('restart')}>
              {props.text.restart}
            </Button>
          </div>
        ) : (
          <p className="dshx:text-xs dshx:text-muted-foreground">{props.text.manual}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
