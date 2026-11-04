import * as React from 'react'
import { animate, motionSafe, presets, springs, durations, easings } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { AgentAvatar, agentToneGlow, type AgentTone } from './agent-avatar.js'
import { RollingNumber } from './text.js'

export interface AgentCursor {
  readonly id: string
  readonly name: string
  /** What it is doing right now ("Fixing the date"); changes cross-fade. */
  readonly status: string
  /** Spend so far, in dollars. */
  readonly cost?: number
  /** Position of the pointer tip, in px from the overlay's top-left. */
  readonly x: number
  readonly y: number
  readonly tone?: AgentTone
}

export interface AgentCursorsProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly cursors: readonly AgentCursor[]
  /** The shared surface the agents work on (a document, a table, a diff). */
  readonly children: React.ReactNode
}

const money = (value: number) => `$${value.toFixed(2)}`

/**
 * Multiplayer cursors for agents: each agent's pointer glides to where it works on a soft spring, carrying a dark
 * label with its name, a rolling spend chip and a status line that cross-fades. Watching subagents edit one file,
 * parallel review threads, workflow fan-out over a document.
 */
export function AgentCursors({ cursors, children, className, ...props }: AgentCursorsProps) {
  const [leaving, setLeaving] = React.useState<readonly AgentCursor[]>([])
  const previous = React.useRef<readonly AgentCursor[]>(cursors)
  React.useEffect(() => {
    const ids = new Set(cursors.map(cursor => cursor.id))
    const gone = previous.current.filter(cursor => !ids.has(cursor.id))
    previous.current = cursors
    if (gone.length > 0) setLeaving(list => [...list.filter(cursor => !ids.has(cursor.id)), ...gone])
  }, [cursors])
  const drop = React.useCallback((id: string) => setLeaving(list => list.filter(cursor => cursor.id !== id)), [])
  const overlay = React.useRef<HTMLDivElement>(null)
  const bounds = useSize(overlay)

  return (
    <div className={cn('dshx:relative', className)} {...props}>
      {children}
      <div
        ref={overlay}
        role="group"
        aria-label="Agents at work"
        className="dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:z-10 dshx:overflow-hidden"
      >
        {cursors.map(cursor => (
          <CursorMark key={cursor.id} cursor={cursor} bounds={bounds} />
        ))}
        {leaving.map(cursor => (
          <CursorMark key={`leaving-${cursor.id}`} cursor={cursor} bounds={bounds} leaving onLeft={drop} />
        ))}
      </div>
    </div>
  )
}

interface Size {
  readonly width: number
  readonly height: number
}

function useSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = React.useState<Size>({ width: 0, height: 0 })
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const read = () =>
      setSize(current =>
        current.width === element.clientWidth && current.height === element.clientHeight
          ? current
          : { width: element.clientWidth, height: element.clientHeight },
      )
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** Narrow surfaces (< 28rem) get a slimmer label so it covers less of the document. */
const labelCap = (width: number) => (width > 0 && width < 448 ? 144 : 192)
const POINTER = 16

/**
 * Keep the label inside the overlay: it sits right of and below the pointer, and flips to the left or above when it
 * would leave the box. Written as inline styles so a flip never re-renders the cursor mid-glide.
 */
function placeLabel(label: HTMLElement, cursor: AgentCursor, bounds: Size) {
  const cap = labelCap(bounds.width)
  const roomRight = bounds.width - cursor.x - 12
  const roomLeft = cursor.x + POINTER
  label.style.maxWidth = `${cap}px`
  const width = label.offsetWidth
  const height = label.offsetHeight
  const flipX = bounds.width > 0 && width > roomRight && roomLeft > roomRight
  label.style.maxWidth = `${Math.max(96, Math.min(cap, (flipX ? roomLeft : roomRight) - 4))}px`
  label.style.left = flipX ? 'auto' : '12px'
  label.style.right = flipX ? `${POINTER - 4}px` : 'auto'
  const flipY = bounds.height > 0 && cursor.y + POINTER + height > bounds.height && cursor.y > height
  label.style.top = flipY ? 'auto' : `${POINTER + 2}px`
  label.style.bottom = flipY ? '2px' : 'auto'
}

function CursorMark({
  cursor,
  bounds,
  leaving = false,
  onLeft,
}: {
  readonly cursor: AgentCursor
  readonly bounds: Size
  readonly leaving?: boolean
  readonly onLeft?: (id: string) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const body = React.useRef<HTMLDivElement>(null)
  const label = React.useRef<HTMLDivElement>(null)
  const placed = React.useRef(false)
  const tone = cursor.tone ?? 'violet'

  React.useLayoutEffect(() => {
    if (label.current != null) placeLabel(label.current, cursor, bounds)
  }, [cursor, bounds])

  // Glide to the new spot; the very first placement jumps there and pops in.
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const to = `translate(${cursor.x}px, ${cursor.y}px)`
    if (!placed.current) {
      placed.current = true
      element.style.transform = to
      return
    }
    const controls = animate(element, { transform: to }, motionSafe({ type: 'spring', stiffness: 120, damping: 20, mass: 1 }))
    return () => controls.stop()
  }, [cursor.x, cursor.y])

  React.useLayoutEffect(() => {
    const element = body.current
    if (element == null) return
    if (leaving) {
      const controls = animate(element, presets.popOut, motionSafe({ duration: durations.base, ease: easings.in }))
      void controls.finished.then(() => onLeft?.(cursor.id))
      return () => controls.stop()
    }
    const controls = animate(element, { opacity: [0, 1], transform: ['scale(0.6)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [leaving, onLeft, cursor.id])

  return (
    <div ref={ref} className="dshx:absolute dshx:top-0 dshx:left-0 dshx:will-change-transform" aria-hidden={leaving || undefined}>
      <div ref={body} className="dshx:relative dshx:origin-top-left">
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="dshx:-mt-px dshx:-ml-px dshx:block dshx:size-4 dshx:fill-foreground dshx:stroke-background dshx:drop-shadow-sm"
          strokeWidth={1.2}
        >
          <path d="M1.5 1.5 L13.5 6.8 L8 8.2 L6.2 13.8 Z" strokeLinejoin="round" />
        </svg>
        <div
          ref={label}
          className={cn(
            'dshx:absolute dshx:top-[18px] dshx:left-3 dshx:flex dshx:w-max dshx:max-w-48 dshx:flex-col dshx:gap-0.5 dshx:rounded-lg dshx:bg-foreground dshx:px-2 dshx:py-1 dshx:text-background dshx:shadow-md',
            agentToneGlow[tone],
          )}
        >
          <div className="dshx:flex dshx:items-center dshx:gap-3 dshx:text-xs dshx:font-medium">
            <span className="dshx:min-w-0 dshx:truncate">{cursor.name}</span>
            {cursor.cost !== undefined ? (
              <span className="dshx:ml-auto dshx:rounded dshx:bg-background/15 dshx:px-1 dshx:text-[11px] dshx:font-normal">
                <RollingNumber value={cursor.cost} format={money} />
              </span>
            ) : null}
          </div>
          <CursorStatus text={cursor.status} />
        </div>
      </div>
    </div>
  )
}

function CursorStatus({ text }: { readonly text: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'blurIn', { duration: 0.35 }, text)
  return (
    <span ref={ref} className="dshx:min-w-0 dshx:truncate dshx:text-[11px] dshx:opacity-80">
      {text}
    </span>
  )
}

export interface AgentPresenceBarProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly agents: readonly { readonly id: string; readonly name: string; readonly tone?: AgentTone; readonly active?: boolean }[]
  readonly suggestions: number
  /** Total spend in dollars. */
  readonly cost: number
  readonly onAcceptAll?: () => void
}

/** The header strip that goes with AgentCursors: who is here (active ones ringed), open suggestions, spend, Accept all. */
export function AgentPresenceBar({ agents, suggestions, cost, onAcceptAll, className, ...props }: AgentPresenceBarProps) {
  const active = agents.filter(agent => agent.active !== false).length
  return (
    <div className={cn('dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm', className)} {...props}>
      <div className="dshx:flex dshx:items-center dshx:-space-x-1">
        {agents.map(agent => (
          <PresenceAvatar key={agent.id} name={agent.name} tone={agent.tone ?? 'violet'} active={agent.active !== false} />
        ))}
      </div>
      <span className="dshx:flex dshx:gap-1 dshx:whitespace-nowrap dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
        {suggestions > 0 ? (
          <>
            <RollingNumber value={suggestions} /> {suggestions === 1 ? 'suggestion' : 'suggestions'}
          </>
        ) : (
          <>
            <RollingNumber value={active} /> here
          </>
        )}
      </span>
      <RollingNumber value={cost} format={money} className="dshx:font-medium" />
      <Button size="sm" disabled={suggestions === 0} onClick={onAcceptAll}>
        Accept all
      </Button>
    </div>
  )
}

function PresenceAvatar({ name, tone, active }: { readonly name: string; readonly tone: AgentTone; readonly active: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!active || ref.current == null) return
    const controls = animate(ref.current, { transform: ['scale(1)', 'scale(1.18)', 'scale(1)'] }, motionSafe({ duration: 0.4, ease: easings.out }))
    return () => controls.complete()
  }, [active])
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AgentAvatar
          ref={ref}
          name={name}
          tone={tone}
          round
          tabIndex={0}
          className={cn(
            'dshx:ring-2 dshx:ring-background dshx:transition-opacity dshx:motion-reduce:transition-none',
            active ? 'dshx:opacity-100' : 'dshx:opacity-40',
          )}
        />
      </TooltipTrigger>
      <TooltipContent>
        {name}
        {active ? ' · working' : ' · idle'}
      </TooltipContent>
    </Tooltip>
  )
}
