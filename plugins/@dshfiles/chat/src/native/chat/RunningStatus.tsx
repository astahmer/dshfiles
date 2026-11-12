/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, useEffect, useState } from 'react'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

interface RunningStatusProps {
  readonly startTime: number | undefined
  readonly t: ChatViewSlotProps['t']
}

/**
 * dshfiles (visual refresh T2.2): whether an element is on screen. The clock and the shimmer stop while the live row is
 * scrolled away, so a long transcript read far above a running Turn does not keep repainting it.
 */
const useOnScreen = (element: HTMLElement | null): boolean => {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    if (element === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1)
      if (entry !== undefined) setOnScreen(entry.isIntersecting)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [element])
  return onScreen
}

/**
 * Show live elapsed time after the current Turn's content without announcing ticks: "Working for 12s" with a shimmer
 * (dshfiles: the settled Turn then reads "Worked for 12s" on its fold row; both pause off screen).
 * @param props - Current Turn start time and localized copy.
 * @returns the running indicator; mount only while the Session is running.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const onScreen = useOnScreen(element)
  useEffect(() => {
    if (startTime === undefined || !onScreen) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime, onScreen])
  const label = startTime === undefined ? t('chat.deepDiving') : t('chat.deepDivingFor', {
    duration: formatRunDuration(Math.max(1000, now - startTime), t).map(part => part.text).join(''),
  })
  return (
    <div ref={setElement} className={css.running} data-chat-running data-offscreen={onScreen ? undefined : ''}>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{t('chat.deepDiving')}</span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent}>
        {/* dshfiles (visual refresh T4.3): the kit's Working glyph replaces the animated whale bitmap. */}
        <span className={css.runningIcon} aria-hidden="true">
          <StatusGlyph status="working" decorative className="dshx:size-full" />
        </span>
        <TextShimmer active={onScreen} className={css.runningText}>{label}</TextShimmer>
      </span>
    </div>
  )
})
