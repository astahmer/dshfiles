/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * rightbar), the drag handles (pointer capture + rAF throttle), the column
 * solve (columns.ts), and the child-slot render decisions: the sidebar slot
 * receives live parameters from that solve. The root-scoped main slot selects
 * the Conversation or a global panel. Each column occupant owns its Session
 * binding and reports the geometry it needs.
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { BOTTOM_DEFAULT, BOTTOM_MAX_RATIO, BOTTOM_MIN, CENTER_MIN, clampWidth, computeColumns, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_DRAWER_BREAKPOINT } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import { StatusStrip } from './StatusStrip.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { Minimize2Icon } from '@dshfiles/plugin-ui/icons'
import { MainSurfaceRendering } from '../../main-surface.ts'
import { ZenMode } from '../../zen-mode.ts'
import type { MainSurfaceMode, RightPanelMode } from '../../regions.ts'
import type { RightbarOwnerProps } from './index.ts'

/** Browser posture supplied by the root registration. */
export interface AppFrameInjected {
  hooks: { foldedLandscape: HostObservable<boolean>; zen: HostObservable<boolean> }
  /** Local delta (dshfiles): leave zen mode; false when it was already off. */
  leaveZen: () => boolean
}

/** Full composed props: runtime, child slots, store, locale, and injected posture. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.main' | 'shell.beforeMain' | 'shell.dock' | 'shell.bottom' | 'shell.overlay' | 'shell.leading'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>
  & InjectFace<AppFrameInjected>

/**
 * The stable centre column survives mode changes: the `shell.beforeMain` rows
 * (the main-tabs strip) sit above the main surface, which an entry may hide
 * while keeping it mounted.
 */
export function CenterColumn({ mode, renderSlot, children, inert = false }: {
  mode: MainSurfaceMode
  children?: ReactNode
  inert?: boolean
} & PropsRenderSlots<'main' | 'shell.main' | 'shell.beforeMain'>) {
  const renderMain = useMemo(() => MainSurfaceRendering.createRenderer(renderSlot), [renderSlot])
  const [hiddenHolds, setHiddenHolds] = useState(0)
  const holdMainHidden = useCallback(() => MainSurfaceRendering.hold(delta => setHiddenHolds(count => count + delta)), [])
  const beforeMain = useMemo(() => renderSlot('shell.beforeMain', { mode, holdMainHidden }), [renderSlot, mode, holdMainHidden])
  return (
    <div className={css.centerCol} data-main-column {...{ inert: inert ? '' : undefined }}>
      {beforeMain}
      <div className={css.mainSurface} data-slot="main" data-main-surface={mode} style={hiddenHolds > 0 ? { display: 'none' } : undefined}>
        {MainSurfaceRendering.render(mode, renderSlot, renderMain, children)}
      </div>
    </div>
  )
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return <div className={css.mainPanel} data-global-panel={panelId !== null || undefined}>
    {renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })}
  </div>
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
export function RightbarColumn({ mainMode, mode, owner, renderSlot, inert = false }: {
  mainMode: MainSurfaceMode
  mode: RightPanelMode
  owner: RightbarOwnerProps
  inert?: boolean
} & PropsRenderSlots<'rightbar' | 'shell.dock'>) {
  const dock = mode === 'dock'
  const carrier = dock || mainMode === 'workbench'
  return (
    <div className={css.rightbarCol} data-rightbar-col {...{ inert: inert ? '' : undefined }}>
      {/* Keep the dock's live views mounted while closed in Workbench mode. */}
      <div hidden={!dock} style={dock ? { display: 'contents' } : undefined} data-shell-dock-carrier>
        {dock || mainMode === 'workbench' ? renderSlot('shell.dock', { ...owner, shown: dock }) : null}
      </div>
      {/* Workbench always owns visible views, even with its right pane closed.
          Retain the authorized native session owner for resource portals. */}
      <div hidden={carrier} style={carrier ? undefined : { display: 'contents' }} data-native-rightbar-carrier>
        {!dock || mainMode === 'workbench' ? renderSlot('rightbar', owner) : null}
      </div>
    </div>
  )
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: {
  side: 'sidebar' | 'rightbar' | 'bottom'
  axis?: 'x' | 'y'
  left?: number
  onStart: () => void
  onDrag: (delta: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd, axis: props.axis ?? 'x' })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd, axis: props.axis ?? 'x' }
  const at = (event: { readonly clientX: number; readonly clientY: number }): number =>
    callbacks.current.axis === 'y' ? event.clientY : event.clientX

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = at(e)
    latest.current = at(e)
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = at(e)
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(at(e) - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={props.axis === 'y' ? undefined : { left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

/** Zen mode's one on-screen control, where the sidebar's reopen controls sit: the way back for a pointer. */
function ZenExit({ leave }: { leave: () => void }) {
  return (
    <div className={`${css.leadingSeat} dshx-root`} data-zen-exit>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Leave zen mode" onClick={leave}>
              <Minimize2Icon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="dshx-root" side="bottom" keys={ZenMode.keys}>Leave zen mode</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

/** Below this frame width the status strip collapses to one chip (the phone breakpoint of AppFrame.module.css). */
const PHONE_STRIP_WIDTH = 640

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  usePanelInfo,
  useFoldedLandscape,
  useZen,
  leaveZen,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth
  const foldedLandscape = useFoldedLandscape(matches => matches)

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const drawer = viewport < SIDEBAR_DRAWER_BREAKPOINT && !windowsTitlebar
  const centeredSidebar = foldedLandscape && viewport >= SIDEBAR_DRAWER_BREAKPOINT
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const drawerOpen = drawer && !sidebarCollapsed
  // Local delta (dshfiles): zen mode drops the sidebar and right tracks. A drawer frame (phone, small tablet) keeps
  // its navigation: the sidebar is already off-stage there and the right pane is an on-demand sheet.
  const zen = useZen(on => on)
  const zenColumns = zen && !drawer
  // Entering drawer mode from a collapsed rail hides the backing immediately.
  const [sidebarTransition, setSidebarTransition] = useState({ drawer, collapsed: sidebarCollapsed, instant: true })
  if (sidebarTransition.drawer !== drawer || sidebarTransition.collapsed !== sidebarCollapsed) {
    setSidebarTransition({ drawer, collapsed: sidebarCollapsed, instant: drawer && sidebarCollapsed && sidebarTransition.collapsed })
  }
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Desktop reopen controls occupy the frame's shell.leading seat (macOS) or
  // the Windows caption row; neither platform keeps an icon rail.
  const darwin = document.documentElement.dataset.platform === 'darwin'
  const collapsedWidth = drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const normal = computeColumns(
    viewport, !layoutInfo.rightbarShown && narrow ? 0 : sidebarPreference, rightbarPreference, collapsedWidth, centeredSidebar,
  )
  const cols = computeColumns(
    viewport, drawer ? 0 : sidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0, collapsedWidth, centeredSidebar,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  // Track easing is scoped to discrete open/close and fold changes: data-animating
  // goes up when the sidebar presentation or the rightbar track flips and comes down
  // at transition end (timeout as the reduced-motion/covered-frame fallback).
  // Steady-state viewport updates stay instant (AppFrame.module.css), and so
  // does a toggle arriving together with a viewport change — that is the
  // responsive auto-collapse firing mid window-resize, where easing would
  // chase the live window edge. The counter restarts the settle window when a
  // re-toggle interrupts a running transition.
  const [animating, setAnimating] = useState(0)
  const trackToggle = `${sidebarCollapsed}:${layoutInfo.rightbarTrack}:${centeredSidebar}:${zenColumns}`
  const previousToggle = useRef(trackToggle)
  const previousViewport = useRef(viewport)
  // Arm the transition before child layout effects measure the new column widths.
  const animateTracks = previousViewport.current === viewport && (animating > 0 || previousToggle.current !== trackToggle)
  useLayoutEffect(() => {
    const viewportChanged = previousViewport.current !== viewport
    previousViewport.current = viewport
    if (viewportChanged) {
      previousToggle.current = trackToggle
      setAnimating(0)
      return
    }
    if (previousToggle.current === trackToggle) return
    previousToggle.current = trackToggle
    setAnimating(token => token + 1)
  }, [trackToggle, viewport])
  useEffect(() => {
    if (animating === 0) return
    const frame = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (frame === null) return
    const settle = () => { setAnimating(0) }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === frame && event.propertyName === 'grid-template-columns') settle()
    }
    frame.addEventListener('transitionend', onTransitionEnd)
    const timer = setTimeout(settle, 600)
    return () => {
      frame.removeEventListener('transitionend', onTransitionEnd)
      clearTimeout(timer)
    }
  }, [animating])
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const bottomBase = useRef(0)
  const onBottomStart = useCallback(() => {
    bottomBase.current = bottomHeight.current
    setDragging(true)
  }, [])
  const onBottomDrag = useCallback((dy: number) => {
    actions.setBottom(bottomBase.current - dy)
  }, [actions])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  // The rendered template lets the grid solve the squeeze natively: the centre
  // declares its protected minimum and the right column bids up to the clamped
  // preference, so a window resize lands in the same layout pass as the frame
  // edge. The JS solve lags the viewport by a ResizeObserver + rAF frame; when
  // it priced the squeeze itself, the centre column absorbed each width change
  // whole and was corrected two frames later — visible jitter. cols keeps only
  // the discrete decisions (track present, collapse state) and the drag base.
  const rightbarMax = cols.rightbar === 0 ? 0 : clampWidth(rightbarPreference, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO)
  const sidebarWidth = drawer
    ? Math.min(layoutInfo.sidebar || SIDEBAR_DEFAULT, Math.max(0, viewport - 48))
    : cols.sidebar
  const sidebar = useMemo(() => renderSlot('sidebar', {
    collapsed: sidebarCollapsed,
    width: sidebarWidth,
    drawer,
  }), [renderSlot, sidebarCollapsed, sidebarWidth, drawer])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])
  // The bottom row sits below left + centre only; the right pane stays full-height.
  // Clamp its height so a drag can never swallow the conversation.
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const bottomHeight = useRef(0)
  bottomHeight.current = layoutInfo.bottomShown
    ? clampWidth(layoutInfo.bottom ?? BOTTOM_DEFAULT, BOTTOM_MIN, Math.max(BOTTOM_MIN, viewportHeight * BOTTOM_MAX_RATIO))
    : 0
  const bottomRow = useMemo(
    () => (layoutInfo.bottomShown ? renderSlot('shell.bottom', {}) : null),
    [renderSlot, layoutInfo.bottomShown],
  )
  // One owner at a time: the global dock a plugin registered into `shell.dock`,
  // or the native per-session occupant. Both receive the same resolved geometry
  // and report their own presentation back through ctx.layout.
  const rightColumn = useMemo(() => (
    <RightbarColumn
      mainMode={layoutInfo.mainSurfaceMode}
      mode={layoutInfo.rightPanelMode}
      owner={{ width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 }}
      renderSlot={renderSlot}
      inert={drawerOpen || zenColumns}
    />
  ), [renderSlot, layoutInfo.rightPanelMode, layoutInfo.mainSurfaceMode, normal.rightbar, viewport, drawerOpen, zenColumns])
  // The leading seat serves drawers and fully hidden macOS sidebars.
  // Windows native captions keep their controls in the caption row instead.
  // AppFrame.module.css reserves clearance for the seat's rendered controls.
  const leading = useMemo(() => renderSlot('shell.leading', {}), [renderSlot])
  const leadingMounted = !zenColumns && (drawer || darwin && sidebarCollapsed)

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        ...(windowsTitlebar
          ? { '--dsh-windows-sidebar-width': `${cols.sidebar}px` } : {}),
        gridTemplateColumns: zenColumns
          ? '0px minmax(0px, 1fr) 0px'
          : `${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : CENTER_MIN}px, 1fr) minmax(0px, ${rightbarMax}px)`,
        ...(bottomHeight.current > 0
          ? { gridTemplateRows: `minmax(0, 1fr) ${bottomHeight.current}px auto`, '--dsh-bottom-height': `${bottomHeight.current}px` }
          : {}),
      }}
      data-sidebar-collapsed={sidebarCollapsed || zenColumns || undefined}
      data-sidebar-drawer={drawer || undefined}
      data-sidebar-instant={drawer && sidebarCollapsed && sidebarTransition.instant || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || zenColumns || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-dragging={dragging || undefined}
      data-animating={animateTracks || undefined}
      data-zen={zen ? (zenColumns ? 'columns' : 'compact') : undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      {drawer && <div className={css.drawerMask} data-sidebar-mask aria-hidden="true"
        onClick={drawerOpen ? () => { actions.toggleSidebar() } : undefined} />}
      <div className={css.sidebarCol}
        style={drawer ? { width: sidebarWidth } : undefined}
        {...{ inert: drawer && sidebarCollapsed || zenColumns ? '' : undefined }}>
        {sidebar}
      </div>
      <>
        <CenterColumn mode={layoutInfo.mainSurfaceMode} renderSlot={renderSlot} inert={drawerOpen}>{main}</CenterColumn>
        {rightColumn}
      </>
      {bottomHeight.current > 0 && (
        <div className={css.bottomRow} data-shell-bottom {...{ inert: drawerOpen ? '' : undefined }}>
          {bottomRow}
        </div>
      )}
      {/* Local delta (dshfiles): the status strip row; empty until a plugin adds a StatusItems entry. */}
      <StatusStrip narrow={viewport < PHONE_STRIP_WIDTH} useSessions={useSessions} />
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      {leadingMounted && (
        <div className={css.leadingSeat} data-shell-leading {...{ inert: drawerOpen ? '' : undefined }}>
          {leading}
        </div>
      )}
      {zenColumns && <ZenExit leave={() => { leaveZen() }} />}
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!zenColumns && !drawer && !centeredSidebar && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!zenColumns && layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
      {bottomHeight.current > 0 && (
        <DragHandle axis="y" side="bottom" onStart={onBottomStart} onDrag={onBottomDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
