import { useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { ReasoningBlockTiming } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import css from './ReasoningRow.module.css'

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

const subscribeNever = (): (() => void) => () => {}
const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export const ReasoningTiming = ({ timing, t }: {
  readonly timing: ReasoningBlockTiming | undefined
  readonly t: ChatViewSlotProps['t']
}): ReactElement | null => {
  const running = timing !== undefined && timing.endedAt === undefined
  const now = useSyncExternalStore(running ? clock.subscribe : subscribeNever, clock.now)
  if (timing === undefined) return null
  const duration = formatRunDuration((timing.endedAt ?? now) - timing.startedAt, t)
    .map(part => part.text).join('')
  const started = new Date(timing.startedAt)
  const today = new Date(now)
  const time = clockFormat.format(started)
  const timestamp = started.getFullYear() === today.getFullYear()
    && started.getMonth() === today.getMonth()
    && started.getDate() === today.getDate()
    ? time
    : `${dayFormat.format(started)} ${time}`
  const text = `${duration} · ${timestamp}`
  return (
    <span
      role={running ? 'timer' : 'note'}
      aria-label={text}
      title={text}
      className={css.timing}
      data-reasoning-timing={running ? 'running' : 'finished'}
    >
      {text}
    </span>
  )
}
