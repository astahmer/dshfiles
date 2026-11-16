/**
 * The phone thread drawer (Settings › phoneNavigation 'drawer'): the Threads list slides in from the left over a scrim
 * that dims the thread, as in stock DSH and the ChatGPT/Claude apps. A swipe in from the left edge drags it open with
 * the finger, a swipe left on the drawer or its scrim drags it closed, and a release snaps by distance and velocity
 * ({@link DrawerGestureModel}). The scrim, Escape and the parent's own controls close it too.
 *
 * The open state belongs to the parent (the frame's left column "expanded" state); a drag only writes the drawer's own
 * inline style until the release, so a gesture never re-renders the list per frame. Closed, the drawer stays laid out but
 * hidden, so opening is a compositor transform rather than a fresh layout.
 */
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, type ReactNode } from 'react'
import { DrawerGestureModel, type DrawerSample } from './drawer-gesture.js'
import { EdgeSwipeModel, ignoresEdgeSwipe, insideHorizontalScroller, type EdgeSwipeIntent } from './edge-swipe.js'

/** Inside the open drawer these keep their own drags: a thread row's Done/Pin swipe, menus and popovers. */
const OWN_DRAG_SELECTOR = 'article[data-thread-id], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
/** A layer above the drawer that answers Escape itself. */
const ESCAPE_OWNER_SELECTOR = '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [role="dialog"][data-slot="dialog-content"]'

const closedTransform = 'translateX(-100%)'
const transformAt = (progress: number): string => `translateX(${((progress - 1) * 100).toFixed(2)}%)`

interface Drag {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly startedOpen: boolean
  readonly width: number
  intent: EdgeSwipeIntent
  progress: number
  readonly samples: DrawerSample[]
}

export const PhoneDrawer = (props: {
  readonly id: string
  readonly label: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** A swipe in from the left edge may open it (off while another layer owns the screen). */
  readonly edgeSwipe: boolean
  /** The first sign the drawer is about to show (an edge touch): mount its content before it slides in. */
  readonly onPrepare: () => void
  /** Called after it closed while focus was inside it: return focus to the control that opened it. */
  readonly restoreFocus: () => void
  readonly children: ReactNode
}): JSX.Element => {
  const panelRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const { open, edgeSwipe } = props

  /** Follow the finger: the drawer and scrim leave their transitions and track `progress` directly. */
  const follow = (progress: number): void => {
    const panel = panelRef.current
    const scrim = scrimRef.current
    if (panel === null || scrim === null) return
    panel.setAttribute('data-phone-drawer-dragging', '')
    for (const element of [panel, scrim]) {
      element.style.transition = 'none'
      element.style.visibility = 'visible'
    }
    panel.style.transform = transformAt(progress)
    scrim.style.opacity = String(progress)
  }
  /**
   * Release: transitions back on, heading for the settled side. These are the very values React's `style` holds for
   * that side, so its next commit (or none, when the drawer stays put) leaves them as they are.
   */
  const release = (settledOpen: boolean): void => {
    const panel = panelRef.current
    const scrim = scrimRef.current
    if (panel === null || scrim === null) return
    panel.removeAttribute('data-phone-drawer-dragging')
    for (const element of [panel, scrim]) {
      element.style.transition = ''
      element.style.visibility = settledOpen ? 'visible' : 'hidden'
    }
    panel.style.transform = settledOpen ? 'translateX(0)' : closedTransform
    scrim.style.opacity = settledOpen ? '1' : '0'
  }

  useEffect(() => {
    let drag: Drag | undefined
    const find = (list: TouchList, id: number): Touch | undefined => Array.from(list).find(touch => touch.identifier === id)
    const start = (event: TouchEvent): void => {
      drag = undefined
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (touch === undefined) return
      const target = event.target instanceof Element ? event.target : null
      const width = DrawerGestureModel.width(window.innerWidth)
      if (open) {
        const inside = target !== null && (panelRef.current?.contains(target) === true || scrimRef.current?.contains(target) === true)
        if (!inside || target.closest(OWN_DRAG_SELECTOR) !== null || insideHorizontalScroller(target)) return
        drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, startedOpen: true, width, intent: 'undecided', progress: 1, samples: [] }
        return
      }
      if (!edgeSwipe || !EdgeSwipeModel.starts({ side: 'left', x: touch.clientX, width: window.innerWidth }) || ignoresEdgeSwipe(target)) return
      drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, startedOpen: false, width, intent: 'undecided', progress: 0, samples: [] }
      latest.current.onPrepare()
    }
    const move = (event: TouchEvent): void => {
      if (drag === undefined) return
      const touch = find(event.changedTouches, drag.id)
      if (touch === undefined) return
      const dx = touch.clientX - drag.x
      drag.intent = DrawerGestureModel.intent({ startedOpen: drag.startedOpen, current: drag.intent, dx, dy: touch.clientY - drag.y })
      if (drag.intent === 'other') {
        drag = undefined
        return
      }
      if (drag.intent !== 'swipe') return
      drag.samples.push({ x: touch.clientX, t: event.timeStamp })
      if (drag.samples.length > 8) drag.samples.shift()
      drag.progress = DrawerGestureModel.progress({ startedOpen: drag.startedOpen, dx, width: drag.width })
      follow(drag.progress)
    }
    const end = (event: TouchEvent): void => {
      if (drag === undefined) return
      // oxlint-disable-next-line antislop/no-passthrough-variable -- a snapshot: `drag` is cleared on the next line.
      const current = drag
      drag = undefined
      if (current.intent !== 'swipe') return
      const touch = find(event.changedTouches, current.id)
      if (touch !== undefined) current.samples.push({ x: touch.clientX, t: event.timeStamp })
      const progress =
        touch === undefined
          ? current.progress
          : DrawerGestureModel.progress({ startedOpen: current.startedOpen, dx: touch.clientX - current.x, width: current.width })
      const settledOpen = DrawerGestureModel.settlesOpen({ progress, velocity: DrawerGestureModel.velocity(current.samples) })
      release(settledOpen)
      if (settledOpen !== current.startedOpen) latest.current.onOpenChange(settledOpen)
    }
    const cancel = (): void => {
      if (drag?.intent === 'swipe') release(drag.startedOpen)
      drag = undefined
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    document.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [open, edgeSwipe])

  const wasOpen = useRef(open)
  useEffect(() => {
    const panel = panelRef.current
    if (open && !wasOpen.current) panel?.focus({ preventScroll: true })
    if (!open && wasOpen.current && panel !== null && panel.contains(document.activeElement)) latest.current.restoreFocus()
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector(ESCAPE_OWNER_SELECTOR) !== null) return
      event.preventDefault()
      latest.current.onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div
        ref={scrimRef}
        aria-hidden="true"
        data-phone-drawer-scrim=""
        onClick={() => props.onOpenChange(false)}
        className="dshx:fixed dshx:inset-0 dshx:z-50 dshx:bg-black/45 dshx:transition-[opacity,visibility] dshx:duration-300 dshx:ease-out dshx:motion-reduce:transition-none"
        style={{ opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden' }}
      />
      <div
        ref={panelRef}
        id={props.id}
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-label={props.label}
        tabIndex={-1}
        data-phone-drawer={open ? 'open' : 'closed'}
        className={cn(
          'dshx:fixed dshx:inset-y-0 dshx:left-0 dshx:z-50 dshx:flex dshx:w-[min(85vw,360px)] dshx:flex-col dshx:bg-(--dsw-specific-sidebar-fill) dshx:text-foreground dshx:shadow-2xl dshx:outline-none',
          'dshx:pt-[env(safe-area-inset-top,0px)] dshx:pb-[env(safe-area-inset-bottom,0px)] dshx:pl-[env(safe-area-inset-left,0px)]',
          'dshx:transition-[transform,visibility] dshx:duration-300 dshx:ease-[cubic-bezier(0.32,0.72,0,1)] dshx:will-change-transform dshx:motion-reduce:transition-none',
        )}
        style={{ transform: open ? 'translateX(0)' : closedTransform, visibility: open ? 'visible' : 'hidden' }}
      >
        {props.children}
      </div>
    </>
  )
}
