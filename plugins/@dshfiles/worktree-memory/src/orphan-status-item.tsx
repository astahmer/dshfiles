import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, type PluginContext } from '@dshfiles/dshx/client'
import { StatusItems, type StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { worktreeMemoryApi } from './api.js'
import type { WorktreeMemoryTranslate } from './locales.js'
import { orphanAlertVisible } from './orphan-alert.js'

// Always mounted in the frame, so it samples rarely and costs one `ps` and a directory read, never the cwd probes.
const POLL_MS = 30_000
/**
 * The first read waits out the page load: during it the Host answers session/list and every panel's first read, and
 * this `ps` spawn queued behind them for 1.4–4.1 s although `ps` itself takes 0.1 s. An orphan warning can wait.
 */
export const ORPHAN_FIRST_READ_DELAY_MS = 20_000

const useDelayedStart = (delayMs: number): boolean => {
  const [started, setStarted] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])
  return started
}

const formatMemory = (bytes: number): string => {
  const gigabytes = bytes / 1024 ** 3
  return gigabytes >= 1 ? `${gigabytes.toFixed(1)} GB` : `${String(Math.round(bytes / 1024 ** 2))} MB`
}

const OrphanStatus = (props: StatusItemProps & { readonly t: WorktreeMemoryTranslate }): JSX.Element | null => {
  const api = useApi(worktreeMemoryApi)
  const started = useDelayedStart(ORPHAN_FIRST_READ_DELAY_MS)
  // Without this plugin's Host the item stays hidden and stops asking; any other failure keeps it hidden until a read works.
  const scratch = useQuery({
    queryKey: ['worktree-memory', 'scratch-hosts'],
    enabled: started,
    queryFn: async ({ signal }) => api.scratchHosts({}, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : POLL_MS),
    retry: false,
  })
  const summary = scratch.data
  if (summary === undefined || !orphanAlertVisible(summary)) return null
  const text = `${props.t('orphanStatus', { count: summary.orphanCount })} · ${formatMemory(summary.orphanBytes)} · ${String(Math.round(summary.orphanCpuPercent))}% ${props.t('cpu')}`
  const content = (
    <span
      className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-warning"
      data-testid="status-item-orphans"
      data-orphan-count={String(summary.orphanCount)}
    >
      <TriangleAlertIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      <span className="dshx:truncate dshx:tabular-nums">{text}</span>
    </span>
  )
  if (props.compact) return content
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent className="dshx:max-w-72">{props.t('orphanStatusHint')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** The status strip's orphan warning; frame-layout owns the strip and renders nothing when it is not the frame. */
const register = (input: {
  readonly plugin: Pick<PluginContext, 'add' | 'bind'>
  readonly t: WorktreeMemoryTranslate
  readonly open: () => void
}): (() => void) => {
  const Item = (props: StatusItemProps): JSX.Element => (
    <PluginQueryProvider>
      <OrphanStatus {...props} t={input.t} />
    </PluginQueryProvider>
  )
  return input.plugin.add(StatusItems, {
    id: '@dshfiles/worktree-memory',
    side: 'global',
    order: 30,
    label: 'Orphans',
    component: input.plugin.bind(Item),
    open: input.open,
  })
}

export class OrphanStatusItem {
  static readonly register = register
}
