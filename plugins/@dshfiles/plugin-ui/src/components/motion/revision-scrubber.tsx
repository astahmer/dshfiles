import * as React from 'react'
import { animate, motionSafe, springs, type AnimationPlaybackControls } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'

export interface ScrubberItem {
  readonly id: string
  /** Short tick label shown above the needle ("Oct 26", "k3f2a1"). */
  readonly label: string
  /** Card title (revision description, thread title). */
  readonly title: string
  readonly subtitle?: string
  /** Long tick: a day boundary, a bookmark, a landed revision. */
  readonly major?: boolean
  /** Card tile content: an icon or a letter. Defaults to the title's first letter. */
  readonly glyph?: React.ReactNode
}

export interface RevisionScrubberProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  readonly items: readonly ScrubberItem[]
  /** Selected index. */
  readonly value: number
  readonly onValueChange: (index: number) => void
  /** Show the card strip above the ruler. Default true. */
  readonly cards?: boolean
  /** Accessible name of the slider. */
  readonly label?: string
}

const CARD_WIDTH = 128
const CARD_GAP = 12

/**
 * A wheel-style scrubber over a history: one tick per revision (long ticks for day boundaries or bookmarks), ticks
 * swell and brighten around the pointer like a magnifier, an accent needle springs from tick to tick with a ratchet
 * kick, and the label above it rolls its changed characters. Click to jump, drag to scrub, arrows and Page keys to
 * step. The optional card strip glides to keep the selected revision centred, neighbours fading with distance.
 */
export function RevisionScrubber({ items, value, onValueChange, cards = true, label = 'Revision', className, ...props }: RevisionScrubberProps) {
  const count = items.length
  const index = Math.max(0, Math.min(count - 1, value))
  const current = items[index]
  const ruler = React.useRef<HTMLDivElement>(null)
  const needle = React.useRef<HTMLDivElement>(null)
  const bar = React.useRef<HTMLSpanElement>(null)
  const tag = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  const [tagWidth, setTagWidth] = React.useState(0)
  const [pointer, setPointer] = React.useState<number | null>(null)
  const dragging = React.useRef(false)
  const previous = React.useRef(index)
  const direction = index >= previous.current ? 1 : -1

  React.useLayoutEffect(() => {
    const element = ruler.current
    if (element == null) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  React.useLayoutEffect(() => {
    const element = tag.current
    if (element == null) return
    setTagWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => entry && setTagWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const step = count > 0 ? width / count : 0
  const xOf = (i: number) => (i + 0.5) * step
  const needleX = xOf(index)
  // Centre the label on the needle, but keep it inside the ruler at either end.
  const tagOffset = Math.max(-needleX, Math.min(width - needleX - tagWidth, -tagWidth / 2))

  // Needle springs to the selected tick and kicks like a ratchet when it lands.
  const placed = React.useRef(false)
  React.useLayoutEffect(() => {
    const element = needle.current
    if (element == null || width === 0) return
    if (!placed.current) {
      element.style.transform = `translateX(${needleX}px)`
      placed.current = true
      return
    }
    const running: AnimationPlaybackControls[] = [animate(element, { transform: `translateX(${needleX}px)` }, motionSafe(springs.snappy))]
    if (bar.current && previous.current !== index) running.push(animate(bar.current, { transform: ['scaleY(1.45)', 'scaleY(1)'] }, motionSafe(springs.bouncy)))
    previous.current = index
    return () => {
      for (const controls of running) controls.stop()
    }
  }, [needleX, width, index])

  const select = React.useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(count - 1, next))
      if (clamped !== index) onValueChange(clamped)
    },
    [count, index, onValueChange],
  )
  const indexAt = (clientX: number) => {
    const box = ruler.current?.getBoundingClientRect()
    if (box == null || step === 0) return index
    return Math.floor((clientX - box.left) / step)
  }
  const localX = (clientX: number) => clientX - (ruler.current?.getBoundingClientRect().left ?? 0)

  const onKeyDown = (event: React.KeyboardEvent) => {
    const majors = items.flatMap((item, i) => (item.major ? [i] : []))
    const keys = new Map<string, () => number>([
      ['ArrowLeft', () => index - 1],
      ['ArrowDown', () => index - 1],
      ['ArrowRight', () => index + 1],
      ['ArrowUp', () => index + 1],
      ['Home', () => 0],
      ['End', () => count - 1],
      ['PageDown', () => majors.find(i => i > index) ?? count - 1],
      ['PageUp', () => [...majors].reverse().find(i => i < index) ?? 0],
    ])
    const move = keys.get(event.key)
    if (move === undefined) return
    event.preventDefault()
    select(move())
  }

  const focus = pointer ?? needleX
  const boost = pointer === null ? 0.45 : 1

  return (
    <div className={cn('dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-2', className)} {...props}>
      {cards ? <CardStrip items={items} index={index} onSelect={select} /> : null}
      <div
        ref={ruler}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={index}
        aria-valuetext={current ? `${current.label}: ${current.title}` : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={event => {
          dragging.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          setPointer(localX(event.clientX))
          select(indexAt(event.clientX))
        }}
        onPointerMove={event => {
          setPointer(localX(event.clientX))
          if (dragging.current) select(indexAt(event.clientX))
        }}
        onPointerUp={event => {
          dragging.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (event.pointerType !== 'mouse') setPointer(null)
        }}
        onPointerLeave={() => {
          if (!dragging.current) setPointer(null)
        }}
        className="dshx:relative dshx:mt-6 dshx:h-8 dshx:cursor-ew-resize dshx:touch-none dshx:rounded-md dshx:outline-none dshx:select-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
      >
        {items.map((item, i) => {
          const x = xOf(i)
          const g = Math.exp(-(((x - focus) / 34) ** 2)) * boost
          const base = item.major ? 14 : 8
          return (
            <span
              key={item.id}
              aria-hidden
              className="dshx:absolute dshx:top-1/2 dshx:w-[2px] dshx:-translate-x-1/2 dshx:-translate-y-1/2 dshx:rounded-full dshx:bg-foreground dshx:motion-safe:transition-[height,opacity] dshx:motion-safe:duration-150"
              style={{ left: x, height: base * (1 + 0.9 * g), opacity: Math.min(1, (item.major ? 0.45 : 0.22) + 0.75 * g) }}
            />
          )
        })}
        <div ref={needle} aria-hidden className="dshx:pointer-events-none dshx:absolute dshx:top-0 dshx:left-0 dshx:h-full">
          <div
            ref={tag}
            className="dshx:absolute dshx:bottom-full dshx:mb-0.5 dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:text-foreground"
            style={{ left: tagOffset }}
          >
            <RollingLabel text={current?.label ?? ''} direction={direction} />
          </div>
          <span
            ref={bar}
            className="dshx:absolute dshx:top-1/2 dshx:left-0 dshx:-mt-[13px] dshx:-ml-[1.5px] dshx:block dshx:h-[26px] dshx:w-[3px] dshx:rounded-full dshx:bg-warning"
          />
        </div>
      </div>
    </div>
  )
}

function CardStrip({
  items,
  index,
  onSelect,
}: {
  readonly items: readonly ScrubberItem[]
  readonly index: number
  readonly onSelect: (index: number) => void
}) {
  const strip = React.useRef<HTMLDivElement>(null)
  const track = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const element = strip.current
    if (element == null) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const offset = width / 2 - (index * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2)
  const placed = React.useRef(false)
  React.useLayoutEffect(() => {
    const element = track.current
    if (element == null || width === 0) return
    if (!placed.current) {
      element.style.transform = `translateX(${offset}px)`
      placed.current = true
      return
    }
    const controls = animate(element, { transform: `translateX(${offset}px)` }, motionSafe(springs.smooth))
    return () => controls.stop()
  }, [offset, width])
  return (
    <div
      ref={strip}
      className="dshx:relative dshx:overflow-hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, black 18%, black 82%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, black 18%, black 82%, transparent)',
      }}
    >
      <div ref={track} className="dshx:flex dshx:w-max" style={{ gap: CARD_GAP }}>
        {items.map((item, i) => {
          const distance = Math.abs(i - index)
          const selected = distance === 0
          return (
            <button
              key={item.id}
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => onSelect(i)}
              className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:py-1 dshx:text-center dshx:outline-none dshx:motion-safe:transition-[opacity,transform] dshx:motion-safe:duration-300"
              style={{ width: CARD_WIDTH, opacity: Math.max(0.2, 1 - distance * 0.3), transform: `scale(${Math.max(0.86, 1 - distance * 0.05)})` }}
            >
              <span className="dshx:text-xs dshx:text-muted-foreground">{item.label}</span>
              <span
                className={cn(
                  'dshx:flex dshx:size-14 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:border dshx:text-lg dshx:font-semibold dshx:transition-colors dshx:duration-300',
                  selected ? 'dshx:border-warning/50 dshx:bg-warning/12 dshx:text-warning' : 'dshx:border-border dshx:bg-muted dshx:text-muted-foreground',
                )}
              >
                {item.glyph ?? item.title.slice(0, 1).toUpperCase()}
              </span>
              <span className="dshx:w-full dshx:min-w-0 dshx:truncate dshx:px-1 dshx:text-sm dshx:text-foreground">{item.title}</span>
              {item.subtitle ? (
                <span className="dshx:w-full dshx:min-w-0 dshx:truncate dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{item.subtitle}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A label whose changed characters roll vertically with a blur, like a mechanical counter. */
function RollingLabel({ text, direction }: { readonly text: string; readonly direction: 1 | -1 }) {
  const previous = React.useRef(text)
  const before = previous.current
  React.useEffect(() => {
    previous.current = text
  }, [text])
  return (
    <span className="dshx:inline-flex dshx:tabular-nums">
      {Array.from(text).map((char, i) => (
        <RollChar key={i} char={char} from={before[i] ?? ''} direction={direction} />
      ))}
    </span>
  )
}

function RollChar({ char, from, direction }: { readonly char: string; readonly from: string; readonly direction: 1 | -1 }) {
  const inRef = React.useRef<HTMLSpanElement>(null)
  const outRef = React.useRef<HTMLSpanElement>(null)
  const reduced = usePrefersReducedMotion()
  const changed = char !== from && from !== '' && !reduced
  React.useLayoutEffect(() => {
    if (!changed || inRef.current == null || outRef.current == null) return
    const enterFrom = direction === 1 ? '70%' : '-70%'
    const leaveTo = direction === 1 ? '-70%' : '70%'
    const a = animate(
      inRef.current,
      { transform: [`translateY(${enterFrom})`, 'translateY(0%)'], opacity: [0, 1], filter: ['blur(3px)', 'blur(0px)'] },
      motionSafe(springs.snappy),
    )
    const b = animate(
      outRef.current,
      { transform: ['translateY(0%)', `translateY(${leaveTo})`], opacity: [1, 0], filter: ['blur(0px)', 'blur(3px)'] },
      motionSafe(springs.snappy),
    )
    return () => {
      a.complete()
      b.complete()
    }
  }, [char, changed, direction])
  return (
    <span className="dshx:relative dshx:inline-block">
      <span ref={inRef} className="dshx:inline-block dshx:whitespace-pre">
        {char}
      </span>
      {changed ? (
        <span ref={outRef} className="dshx:absolute dshx:inset-0 dshx:inline-block dshx:whitespace-pre dshx:opacity-0">
          {from}
        </span>
      ) : null}
    </span>
  )
}
