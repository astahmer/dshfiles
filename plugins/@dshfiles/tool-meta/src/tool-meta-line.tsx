import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useSettings } from '@dshfiles/dshx/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useRef, useSyncExternalStore, type ReactElement } from 'react'
import type { ToolMetaTranslate } from './locales.js'
import { toolMetaSettings } from './settings.js'
import { ToolTimingModel, type DescribedTiming, type TimeFormat, type ToolTiming, type WaitTimer } from './timing.js'
import { WaitTimerIndicator } from './wait-timer-indicator.js'
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

interface ToolMetaLineView extends DescribedTiming {
  readonly waitTimer: WaitTimer | undefined
}

/** Everything one line shows for a clock reading; the clock wakes a line only when this changes. */
const viewOfOwner = (input: {
  readonly owner: ToolCallOwnerProps
  readonly timing: ToolTiming
  readonly format: TimeFormat
  readonly t: ToolMetaTranslate
  readonly now: number
}): ToolMetaLineView => {
  const { owner, timing, format, t, now } = input
  const described = ToolTimingModel.describeTiming({ timing, now, format, t })
  const waitTimer =
    owner.phase === 'start' && (owner.toolName === 'job_output' || owner.toolName === 'background_jobs_wait')
      ? ToolTimingModel.waitTimerOf({ phase: 'start', toolName: owner.toolName, block: { time: owner.block.time, argsRaw: owner.block.argsRaw } }, now)
      : undefined
  return { ...described, waitTimer }
}

export const ToolMetaLine = ({ owner, t }: ToolMetaLineProps): ReactElement | null => {
  const settings = useSettings(toolMetaSettings)
  const enabled = settings.value?.enabled ?? true
  const format = settings.value?.timeFormat ?? 'absolute'
  const timing = ToolTimingModel.toolTimingOf(owner)
  const live = enabled && timing !== undefined && timing !== null && (timing.kind === 'running' || format === 'relative')
  /** A line whose next reading shows the same thing keeps its previous view, so that tick does not re-render it. */
  const shown = useRef<{ readonly key: string; readonly view: ToolMetaLineView } | undefined>(undefined)
  const read = (): ToolMetaLineView | undefined => {
    if (!enabled || timing === undefined || timing === null) return undefined
    const view = viewOfOwner({ owner, timing, format, t, now: clock.now() })
    const key = ToolTimingModel.lineKey({ described: view, waitTimer: view.waitTimer })
    if (shown.current?.key === key) return shown.current.view
    shown.current = { key, view }
    return view
  }
  const view = useSyncExternalStore(live ? clock.subscribe : subscribeNever, read)
  if (timing === undefined) {
    warnOnce('the tool.call.toolview owner no longer carries phase/block.time; tool timings are hidden')
    return null
  }
  if (timing === null || !enabled || view === undefined) return null
  const { text, label, waitTimer } = view
  return (
    <TooltipProvider delayDuration={500}>
      <span className="dshx:contents">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role={timing.kind === 'running' ? 'timer' : 'note'}
              aria-label={label}
              data-dshfiles-tool-meta={timing.kind}
              className={cn(
                'dshx-root dshx:pointer-events-auto dshx:shrink-0 dshx:bg-background dshx:pl-2 dshx:whitespace-nowrap dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground',
                timing.kind === 'running' && 'dshx:text-foreground',
              )}
            >
              {text}
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        {waitTimer !== undefined && <WaitTimerIndicator timer={waitTimer} t={t} />}
      </span>
    </TooltipProvider>
  )
}
