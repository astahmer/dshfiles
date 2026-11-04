import * as React from 'react'
import { animate, motionSafe, prefersReducedMotion, presets, springs, durations, easings, type MotionPreset } from '../../motion/index.js'
import { useFlip } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'

export interface PresenceListItem {
  readonly key: string
  readonly node: React.ReactNode
}

export interface PresenceListProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly items: readonly PresenceListItem[]
  readonly as?: 'div' | 'ul' | 'ol'
  readonly itemAs?: 'div' | 'li'
  readonly itemClassName?: string
  /** Enter preset for new items; `null` disables it. */
  readonly enter?: MotionPreset | null
  /** Exit preset for removed items; `null` removes them at once. */
  readonly exit?: MotionPreset | null
  /** Collapse the removed item's height after its exit so siblings slide up. Default true. */
  readonly collapse?: boolean
}

type Entry = PresenceListItem & { readonly leaving: boolean }

/**
 * A keyed list that animates its own changes: new items enter, removed items play an exit and collapse, and moved
 * items glide to their new place (FLIP). The list primitive behind queues, timelines and feeds.
 */
export function PresenceList({
  items,
  as = 'div',
  itemAs = as === 'div' ? 'div' : 'li',
  itemClassName,
  enter = 'riseIn',
  exit = 'popOut',
  collapse = true,
  className,
  ...props
}: PresenceListProps) {
  const [entries, setEntries] = React.useState<readonly Entry[]>(() => items.map(item => ({ ...item, leaving: false })))
  const containerRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    setEntries(previous => merge(previous, items, exit !== null))
  }, [items, exit])

  useFlip(containerRef, [entries.map(entry => `${entry.key}:${entry.leaving ? 1 : 0}`).join('|')], { enterPreset: enter })

  const finishLeave = React.useCallback((key: string) => setEntries(previous => previous.filter(entry => !(entry.key === key && entry.leaving))), [])

  // SAFETY: `as` is one of 'div' | 'ul' | 'ol'; widening the tag lets one ref type (HTMLElement) serve all three.
  const Container = as as React.ElementType
  return (
    <Container ref={containerRef} className={cn('dshx:relative', className)} {...props}>
      {entries.map(entry => (
        <PresenceItem key={entry.key} as={itemAs} className={itemClassName} entry={entry} exit={exit} collapse={collapse} onLeft={finishLeave} />
      ))}
    </Container>
  )
}

function PresenceItem({
  as,
  className,
  entry,
  exit,
  collapse,
  onLeft,
}: {
  readonly as: 'div' | 'li'
  readonly className: string | undefined
  readonly entry: Entry
  readonly exit: MotionPreset | null
  readonly collapse: boolean
  readonly onLeft: (key: string) => void
}) {
  const ref = React.useRef<HTMLElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!entry.leaving || element == null) return
    if (exit === null || prefersReducedMotion()) {
      onLeft(entry.key)
      return
    }
    let cancelled = false
    const run = async () => {
      await animate(element, presets[exit], motionSafe({ duration: durations.fast, ease: easings.in })).finished
      if (collapse && !cancelled) {
        const height = element.getBoundingClientRect().height
        element.style.overflow = 'hidden'
        await animate(element, { height: [height, 0], marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }, motionSafe(springs.snappy)).finished
      }
      if (!cancelled) onLeft(entry.key)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [entry.leaving, entry.key, exit, collapse, onLeft])
  // SAFETY: `as` is 'div' | 'li'; widening the tag lets one ref type (HTMLElement) serve both.
  const Item = as as React.ElementType
  return (
    <Item ref={ref} data-flip-key={entry.leaving ? undefined : entry.key} aria-hidden={entry.leaving || undefined} className={className}>
      {entry.node}
    </Item>
  )
}

/** Keep the order of `next`, re-inserting leaving items after the item that preceded them. */
function merge(previous: readonly Entry[], next: readonly PresenceListItem[], animateExit: boolean): readonly Entry[] {
  const nextKeys = new Set(next.map(item => item.key))
  const result: Entry[] = next.map(item => ({ ...item, leaving: false }))
  if (!animateExit) return result
  previous.forEach((entry, index) => {
    if (nextKeys.has(entry.key)) return
    const anchor = previous
      .slice(0, index)
      .reverse()
      .find(candidate => nextKeys.has(candidate.key))
    const at = anchor === undefined ? 0 : result.findIndex(item => item.key === anchor.key) + 1
    result.splice(at, 0, { ...entry, leaving: true })
  })
  return result
}
