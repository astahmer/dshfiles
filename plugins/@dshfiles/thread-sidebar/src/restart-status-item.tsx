import type { StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import { useRegistry } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { RestartBridge, type RestartRequest } from './restart-bridge.js'
import { PendingRestartSources, type PendingRestartSource } from './restart-sources.js'

export interface RestartStatusText {
  /** "Restart pending · 3 plugins" style label for the strip. */
  readonly pending: (count: number) => string
  readonly applied: string
  readonly manual: string
  readonly restart: string
  readonly restartWhenIdle: string
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
  const plugins = useMemo(() => RestartBridge.combine([notice.hostPlugins, sourcePackages]), [notice.hostPlugins, sourcePackages])
  const [open, setOpen] = useState(false)
  if (plugins.length === 0 && notice.waitingLabel === null) return null
  const label = notice.waitingLabel ?? props.text.pending(plugins.length)
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
        {notice.available ? (
          <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
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
