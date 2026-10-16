import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useSettings } from '@dshfiles/dshx/client'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useSyncExternalStore, type ReactElement } from 'react'
import type { ToolMetaTranslate } from './locales.js'
import { toolMetaSettings } from './settings.js'
import { ToolTimingModel } from './timing.js'
import { warnOnce } from './warn-once.js'

/** One shared one-second clock for every live line, running only while one is mounted. */
const clock = (() => {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  let now = Date.now()
  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      now = Date.now()
      timer ??= setInterval(() => {
        now = Date.now()
        for (const notify of listeners) notify()
      }, 1_000)
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0 || timer === undefined) return
        clearInterval(timer)
        timer = undefined
      }
    },
    now: (): number => now,
  }
})()

/** A settled line in clock format only needs today's date: the clock's last reading is close enough. */
const subscribeNever = (): (() => void) => () => {}

export interface ToolMetaLineProps {
  /** The native `tool.call.toolview` owner of this call. */
  readonly owner: ToolCallOwnerProps
  readonly t: ToolMetaTranslate
}

export const ToolMetaLine = ({ owner, t }: ToolMetaLineProps): ReactElement | null => {
  const settings = useSettings(toolMetaSettings)
  const enabled = settings.value?.enabled ?? true
  const format = settings.value?.timeFormat ?? 'absolute'
  const timing = ToolTimingModel.toolTimingOf(owner)
  const live = enabled && (timing?.kind === 'running' || (timing !== null && timing !== undefined && format === 'relative'))
  const now = useSyncExternalStore(live ? clock.subscribe : subscribeNever, clock.now)
  if (timing === undefined) {
    warnOnce('the tool.call.toolview owner no longer carries phase/block.time; tool timings are hidden')
    return null
  }
  if (timing === null || !enabled) return null
  const { text, label } = ToolTimingModel.describeTiming({ timing, now, format, t })
  return (
    <span
      role={timing.kind === 'running' ? 'timer' : 'note'}
      aria-label={label}
      title={label}
      data-dshfiles-tool-meta={timing.kind}
      className={cn(
        'dshx-root dshx:pointer-events-auto dshx:shrink-0 dshx:bg-background dshx:pl-2 dshx:whitespace-nowrap dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground',
        timing.kind === 'running' && 'dshx:text-foreground',
      )}
    >
      {text}
    </span>
  )
}
