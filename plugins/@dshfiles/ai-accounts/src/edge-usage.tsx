import { z } from 'zod'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { ArrowUpRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { aiAccountsApi, type AccountsUsage } from './api.js'
import { QUOTA_TONE_PROGRESS, QUOTA_TONE_TEXT, quotaTone, tightestWindow } from './quota-tone.js'

/**
 * Draggable edge usage overlay.
 *
 * A floating mark pinned to the nearest viewport edge: the tightest window per
 * account, always glanceable, never in the way. Drag it and it snaps back to
 * the closest edge of where it landed; click it and the account cards popover
 * opens. Position persists in localStorage, and the settings toggle turns it off.
 */

export const EDGE_USAGE_STORAGE_KEY = 'ai-accounts-edge-usage-position'

const EDGE_USAGE_INTERVAL = 60_000

type Edge = 'left' | 'right' | 'top' | 'bottom'

interface EdgePosition {
  readonly edge: Edge
  readonly x: number
  readonly y: number
}

/** The tab hugs its edge: no border and square corners on the side touching the viewport. */
const EDGE_SHAPE = {
  left: 'dshx:rounded-r-lg dshx:border-l-0',
  right: 'dshx:rounded-l-lg dshx:border-r-0',
  top: 'dshx:rounded-b-lg dshx:border-t-0',
  bottom: 'dshx:rounded-t-lg dshx:border-b-0',
} satisfies Record<Edge, string>

const POPOVER_SIDE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const satisfies Record<Edge, 'left' | 'right' | 'top' | 'bottom'>

const positionSchema = z.object({ edge: z.enum(['left', 'right', 'top', 'bottom']), x: z.number(), y: z.number() })

const clamp = (position: EdgePosition, viewport: { readonly innerWidth: number; readonly innerHeight: number }): EdgePosition => ({
  edge: position.edge,
  x: Math.min(Math.max(0, position.x), Math.max(0, viewport.innerWidth - 40)),
  y: Math.min(Math.max(0, position.y), Math.max(0, viewport.innerHeight - 40)),
})

const viewport = (): { readonly innerWidth: number; readonly innerHeight: number } => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })

const readPosition = (): EdgePosition => {
  try {
    const raw = localStorage.getItem(EDGE_USAGE_STORAGE_KEY)
    if (raw !== null) return clamp(positionSchema.parse(JSON.parse(raw)), viewport())
  } catch {
    // Corrupt or absent state falls through to the default edge.
  }
  return { edge: 'right', x: window.innerWidth - 40, y: Math.round(window.innerHeight / 2) }
}

const nearestEdge = (rect: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }): Edge => {
  const distances: Array<readonly [Edge, number]> = [
    ['left', rect.left],
    ['right', window.innerWidth - rect.right],
    ['top', rect.top],
    ['bottom', window.innerHeight - rect.bottom],
  ]
  return distances.sort((left, right) => left[1] - right[1])[0]?.[0] ?? 'right'
}

export const formatReset = (resetsAt: number | null): string | undefined => {
  if (resetsAt === null) return undefined
  const minutes = Math.round((resetsAt - Date.now()) / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export const EdgeUsageWidget = (props: { readonly onOpenUsageHistory: () => void }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<EdgePosition>(readPosition)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{
    readonly pointerId: number
    readonly startX: number
    readonly startY: number
    readonly originX: number
    readonly originY: number
    readonly moved: boolean
  } | null>(null)
  const dragMovedRef = useRef(false)

  useEffect(() => {
    void accounts
      .overlaySettings()
      .then(metadata => setEnabled(metadata.edgeWidget))
      .catch(() => setEnabled(true))
  }, [accounts])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void accounts
        .usage()
        .then(next => {
          if (!cancelled) setUsage(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, EDGE_USAGE_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accounts])

  useEffect(() => {
    try {
      localStorage.setItem(EDGE_USAGE_STORAGE_KEY, JSON.stringify(position))
    } catch {
      // Best-effort persistence; the overlay still works without it.
    }
  }, [position])

  useEffect(() => {
    const resize = () => setPosition(current => clamp(current, viewport()))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const enabledRows = (usage?.cards ?? []).map(card => ({ card, tightest: tightestWindow(card.usage) })).filter(row => row.tightest !== undefined)

  const primary = enabledRows.map(row => ({ percent: row.tightest?.percent ?? 100 })).sort((left, right) => left.percent - right.percent)[0]?.percent

  if (enabled === false) return null

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: rect.left, originY: rect.top, moved: false }
    dragMovedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const moved = drag.moved || Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4
    dragRef.current = { ...drag, moved }
    if (moved) dragMovedRef.current = true
    if (!moved) return
    setPosition(current =>
      clamp({ edge: current.edge, x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }, viewport()),
    )
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (!drag.moved) return
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = nearestEdge(rect)
    setPosition({
      edge,
      x: edge === 'left' ? 0 : edge === 'right' ? window.innerWidth - 40 : Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - 76)),
      y: edge === 'top' ? 0 : edge === 'bottom' ? window.innerHeight - 40 : Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - 64)),
    })
  }

  const handleToggle = () => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    setOpen(current => !current)
  }

  const primaryTone = quotaTone(primary ?? 100)
  const vertical = position.edge === 'left' || position.edge === 'right'

  // Portal to the body: the sidebar foot has transformed ancestors, and a fixed
  // trigger inside one anchors to that ancestor instead of the viewport.
  return createPortal(
    <aside aria-label="AI Accounts usage" className="dshx-root">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverAnchor asChild>
          <button
            aria-expanded={open}
            aria-label={primary === undefined ? 'Open AI Accounts usage' : `${Math.round(primary)}% left on the tightest account`}
            className={cn(
              'dshx-root dshx:fixed dshx:z-[10000] dshx:flex dshx:cursor-grab dshx:touch-none dshx:items-center dshx:justify-center dshx:border dshx:bg-background/90 dshx:text-foreground dshx:shadow-md dshx:backdrop-blur-md dshx:select-none dshx:hover:bg-secondary dshx:active:cursor-grabbing',
              vertical ? 'dshx:min-h-16 dshx:w-10 dshx:flex-col dshx:gap-1 dshx:py-2' : 'dshx:h-10 dshx:w-[76px] dshx:gap-1.5',
              EDGE_SHAPE[position.edge],
              open && 'dshx:bg-secondary',
            )}
            onClick={handleToggle}
            onPointerCancel={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            ref={triggerRef}
            style={{ left: position.x, top: position.y }}
            title="Drag to move · click to view AI accounts usage"
            type="button"
          >
            <span className="dshx:text-[11px] dshx:font-extrabold">AI</span>
            <span className={cn('dshx:text-[11px] dshx:font-bold dshx:tabular-nums', QUOTA_TONE_TEXT[primaryTone])}>
              {primary === undefined ? '·' : String(Math.round(primary))}
            </span>
          </button>
        </PopoverAnchor>
        <PopoverContent
          aria-label="Account quota"
          className="dshx-root dshx:z-[10001] dshx:flex dshx:max-h-[70vh] dshx:w-[min(420px,calc(100vw-16px))] dshx:flex-col dshx:p-0"
          collisionPadding={8}
          onInteractOutside={event => {
            if (event.target instanceof Node && triggerRef.current?.contains(event.target)) event.preventDefault()
          }}
          side={POPOVER_SIDE[position.edge]}
          sideOffset={8}
        >
          <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-b dshx:px-3 dshx:py-2">
            <span className="dshx:text-xs dshx:text-muted-foreground">Tightest window per account</span>
            <Button
              aria-label="Open usage history"
              onClick={() => {
                setOpen(false)
                props.onOpenUsageHistory()
              }}
              size="xs"
              type="button"
              variant="ghost"
            >
              <ArrowUpRightIcon />
              History
            </Button>
          </header>
          {enabledRows.length === 0 ? <p className="dshx:px-3 dshx:py-3 dshx:text-xs dshx:text-muted-foreground">No account reports quota yet.</p> : null}
          <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:p-1.5">
            {enabledRows.map(row => {
              const percent = row.tightest?.percent ?? 100
              const tone = quotaTone(percent)
              return (
                <li className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:py-2 dshx:hover:bg-accent/50" key={row.card.instanceId}>
                  <div className="dshx:flex dshx:items-baseline dshx:gap-2">
                    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">{row.card.instanceId}</span>
                    <span className="dshx:text-xs dshx:text-muted-foreground">{formatReset(row.tightest?.resetsAt ?? null) ?? ''}</span>
                    <span className={cn('dshx:text-sm dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>{String(Math.round(percent))}%</span>
                  </div>
                  <Progress
                    aria-label={`${row.card.instanceId} remaining`}
                    className={cn('dshx:h-1.5 dshx:bg-muted', QUOTA_TONE_PROGRESS[tone])}
                    value={Math.max(0, Math.min(100, percent))}
                  />
                </li>
              )
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </aside>,
    document.body,
  )
}
