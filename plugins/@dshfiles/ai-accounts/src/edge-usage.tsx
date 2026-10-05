import { z } from 'zod'
import { useApi } from '@dshfiles/dshx/client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { aiAccountsApi, type AccountsUsage, type UsageCard } from './api.js'
import styles from './accounts.module.css'

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
  return { edge: 'right', x: window.innerWidth - 44, y: Math.round(window.innerHeight / 2) }
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

/** Tightest window (the smallest percent) an account currently reports. */
const tightestWindow = (card: UsageCard): { readonly percent: number; readonly label: string; readonly resetsAt: number | null } | undefined => {
  if (card.status !== 'ok' || card.windows.length === 0) return undefined
  return card.windows.reduce<{ readonly percent: number; readonly label: string; readonly resetsAt: number | null } | undefined>((current, window) => {
    if (current !== undefined && current.percent <= window.percentRemaining) return current
    return { percent: window.percentRemaining, label: window.label, resetsAt: window.resetsAt }
  }, undefined)
}

export const formatReset = (resetsAt: number | null): string | undefined => {
  if (resetsAt === null) return undefined
  const minutes = Math.round((resetsAt - Date.now()) / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

const toneFor = (percent: number): string => (percent <= 10 ? String(styles.stateCritical) : percent <= 30 ? String(styles.stateWarn) : String(styles.stateOk))

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

  const overlayStyle = (() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    const triggerWidth = rect?.width ?? 40
    const triggerHeight = rect?.height ?? 40
    const width = Math.min(420, window.innerWidth - 16)
    const height = Math.min(560, window.innerHeight * 0.7)
    const centeredLeft = Math.min(Math.max(8, position.x + triggerWidth / 2 - width / 2), Math.max(8, window.innerWidth - width - 8))
    const centeredTop = Math.min(Math.max(8, position.y + triggerHeight / 2), Math.max(8, window.innerHeight - height - 8))
    if (position.edge === 'left') return { left: position.x + triggerWidth + 8, top: centeredTop, transform: 'translateY(-50%)' }
    if (position.edge === 'right') return { right: window.innerWidth - position.x + 8, top: centeredTop, transform: 'translateY(-50%)' }
    if (position.edge === 'top') return { left: centeredLeft, top: position.y + triggerHeight + 8 }
    return { left: centeredLeft, bottom: window.innerHeight - position.y + 8 }
  })()

  // Portal to the body: the sidebar foot has transformed ancestors, and a fixed
  // backdrop inside one anchors to that ancestor instead of the viewport.
  return createPortal(
    <aside className={styles.edgeOverlay} aria-label="AI Accounts usage">
      <button
        ref={triggerRef}
        type="button"
        className={styles.edgeTrigger}
        aria-expanded={open}
        aria-label={primary === undefined ? 'Open AI Accounts usage' : `${Math.round(primary)}% left on the tightest account`}
        title="Drag to move · click to view AI accounts usage"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleToggle}
      >
        <span className={styles.edgeTriggerMark}>AI</span>
        <span className={toneFor(primary ?? 100)}>{primary === undefined ? '·' : String(Math.round(primary))}</span>
      </button>
      {open ? (
        <div className={styles.edgePopover} style={overlayStyle} role="dialog" aria-label="Account quota">
          <header className={styles.edgePopoverHead}>
            <span className={styles.footerName}>Tightest window per account</span>
            <button
              type="button"
              className={styles.quiet}
              aria-label="Open usage history"
              onClick={() => {
                setOpen(false)
                props.onOpenUsageHistory()
              }}
            >
              ↗ history
            </button>
          </header>
          {enabledRows.length === 0 ? <p className={styles.edgeEmpty}>No account reports quota yet.</p> : null}
          <ul className={styles.edgeRows}>
            {enabledRows.map(row => (
              <li className={styles.edgeRow} key={row.card.instanceId}>
                <span className={styles.footerName}>{row.card.instanceId}</span>
                <span className={styles.edgeReset}>{formatReset(row.tightest?.resetsAt ?? null) ?? ''}</span>
                <span className={`${styles.footerPercent} ${toneFor(row.tightest?.percent ?? 100)}`}>{String(Math.round(row.tightest?.percent ?? 100))}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>,
    document.body,
  )
}
