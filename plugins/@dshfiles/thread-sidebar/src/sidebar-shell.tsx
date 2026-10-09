import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarPanelMetadata, SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRenderSlots, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconEllipsisOutlineRegular,
  IconNewChatOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  IconSlidersTwoOutlineRegular,
  rankByName,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CommandIcon,
  EllipsisVerticalIcon,
  GripVerticalIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  TextCursorInputIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  dropIndexAt,
  fitItems,
  orderSidebarEntries,
  reorderSidebarEntry,
  reorderVisibleEntry,
  SIDEBAR_HEADER_MIN_HEIGHT,
  SIDEBAR_ICON_ROW_THRESHOLD,
  SIDEBAR_SPLITTER_HEIGHT,
  SIDEBAR_THREAD_MIN_HEIGHT,
  type NavigationDensity,
  type NavigationOverflow,
  type OrderedSidebarEntry,
  type SidebarPreferences,
} from './organization.js'
import {
  canStep,
  currentLocation,
  emptyNavigationHistory,
  jumpHistory,
  NAVIGATION_EVENT,
  sameLocation,
  visitLocation,
  type NavigationHistory,
  type NavigationLocation,
} from './navigation-history.js'
import { registerPaletteAction, type PaletteAction } from '@dshfiles/command-palette/api'
import { formatChord, isMacPlatform, matchesChord, parseChord, sameAsHostBinding } from './keyboard-shortcuts.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { threadSidebarRestartApi } from './restart-api.js'
import type { sidebarChildren } from './sidebar-contract.js'

interface FooterRegistration {
  id: string
  order: number
  label: string
}

export interface FooterSnapshot {
  settingsId: string | null
  actions: FooterRegistration[]
}

interface SidebarShellExtras {
  readFooterSnapshot: () => FooterSnapshot
  subscribeFooterSnapshot: (listener: () => void) => () => void
  openSession: (sessionId: SessionSummary['id']) => void
  /** Runs a Host shortcut command by id; null when this Host cannot run commands outside a key press. */
  runCommand: ((commandId: string) => void) | null
}

type SidebarLocation = NavigationLocation<SessionSummary['id'], SidebarPanelMetadata['id']>

/** A Back/Forward step waits this long for its own navigation before treating a new location as a fresh visit. */
const NAVIGATION_SETTLE_MS = 1500
/** Holding Back or Forward this long opens the history menu, as browsers do. */
const HISTORY_HOLD_MS = 450
const PLUGIN_UPDATE_CHECK_MS = 60_000
const DRAG_THRESHOLD_PX = 5

const rowFieldKeys = [
  ['threadRowProject', 'threadSidebarRowProject'],
  ['threadRowProjectColor', 'threadSidebarRowProjectColor'],
  ['threadRowTitle', 'threadSidebarRowTitle'],
  ['threadRowMachine', 'threadSidebarRowMachine'],
  ['threadRowPath', 'threadSidebarRowPath'],
  ['threadRowTime', 'threadSidebarRowTime'],
  ['threadRowStatusDot', 'threadSidebarRowStatusDot'],
] as const satisfies readonly (readonly [keyof SidebarPreferences, Parameters<SidebarShellTranslate>[0]])[]

type SidebarShellTranslate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
export type SidebarShellBaseProps = Omit<SidebarRootComponentProps, 't' | 'renderSlot' | '__renders'> &
  PropsRenderSlots<keyof typeof sidebarChildren> & {
    t: SidebarShellTranslate
  }
type SidebarShellProps = SidebarShellBaseProps & SidebarShellExtras

interface HeaderEntry extends OrderedSidebarEntry {
  label: string
  kind: 'new-thread' | 'search' | 'panel'
  panelId?: SidebarPanelMetadata['id']
}

interface FooterEntry extends OrderedSidebarEntry {
  key: string
  label: string
  kind: 'settings' | 'action'
  registrationId: string | null
}

interface SidebarSplitBounds {
  value: number
  minimum: number
  maximum: number
}

const ICON_BUTTON_SIZE = 32
const ICON_GAP = 2
const ICON_ROW_PADDING = 16
const FOOTER_GAP = 8
const FOOTER_MORE_WIDTH = 28

const text = (translate: SidebarShellTranslate, key: Parameters<SidebarShellTranslate>[0]): string => translate(key)

const toggleHidden = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])

/** Commands that only reopen this palette are left out of its command list. */
const SELF_COMMAND_IDS = new Set(['commandPalette.open'])

const focusComposer = (): void => {
  const composer = document.querySelector<HTMLElement>('[role="textbox"]:not([aria-disabled="true"]), textarea:not([disabled])')
  if (composer === null) return
  composer.focus()
  if (composer instanceof HTMLTextAreaElement) {
    composer.setSelectionRange(composer.value.length, composer.value.length)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(composer)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const readSidebarSplitBounds = (elements: {
  shell: HTMLDivElement | null
  brand: HTMLDivElement | null
  headerRegion: HTMLDivElement | null
  footerAbove: HTMLDivElement | null
  footer: HTMLElement | null
  splitter: HTMLButtonElement | null
}): SidebarSplitBounds | null => {
  const { shell, brand, headerRegion, footerAbove, footer, splitter } = elements
  if (shell === null || headerRegion === null) return null

  const fixedHeight = [brand, footerAbove, footer].reduce((total, element) => total + (element?.getBoundingClientRect().height ?? 0), 0)
  const splitterHeight = splitter?.getBoundingClientRect().height ?? SIDEBAR_SPLITTER_HEIGHT
  const availableMaximum = shell.clientHeight - fixedHeight - splitterHeight - SIDEBAR_THREAD_MIN_HEIGHT
  const maximum = Math.max(SIDEBAR_HEADER_MIN_HEIGHT, Math.floor(availableMaximum))
  const value = headerRegion.getBoundingClientRect().height
  return {
    value: Math.round(Math.min(maximum, Math.max(SIDEBAR_HEADER_MIN_HEIGHT, value))),
    minimum: SIDEBAR_HEADER_MIN_HEIGHT,
    maximum,
  }
}

interface NavigationItem {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly active: boolean
  readonly run: () => void
}

interface NavigationIconRowProps {
  readonly items: readonly NavigationItem[]
  readonly overflow: NavigationOverflow
  readonly labels: { readonly more: string; readonly filter: string; readonly empty: string; readonly customize: string; readonly navigation: string }
  readonly onCustomize: () => void
  /** Pointer drag within the row; indices are positions among `items`. */
  readonly onReorder: (fromIndex: number, toIndex: number) => void
  readonly dragHint: string
}

/** BB's collapsed navigation: one scrollable icon row plus a pinned ⋮ destination menu. */
const NavigationIconRow = (props: NavigationIconRowProps): JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [edges, setEdges] = useState({ start: false, end: false })
  const [menuOpen, setMenuOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dragRef = useRef<{ pointerId: number; index: number; startX: number; centers: number[] | null } | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)

  const endDrag = (): void => {
    dragRef.current = null
    setDrag(null)
  }

  const fitting =
    props.overflow === 'menu'
      ? fitItems({
          widths: props.items.map(() => ICON_BUTTON_SIZE),
          available: width,
          gap: ICON_GAP,
          reserve: ICON_BUTTON_SIZE + ICON_GAP,
        }).filter(Boolean).length
      : props.items.length
  const fittingItems = props.items.slice(0, fitting)
  const rowItems =
    drag === null
      ? fittingItems
      : reorderSidebarEntry(
          fittingItems.map(item => item.id),
          drag.from,
          drag.to,
        ).flatMap(id => fittingItems.filter(item => item.id === id))
  const menuItems = props.overflow === 'menu' ? props.items.slice(fitting) : props.items
  const showMenu = props.overflow === 'scroll-menu' || (props.overflow === 'menu' && menuItems.length > 0)
  const filteredMenuItems = rankByName(
    menuItems.map(item => ({ name: item.label, item })),
    filter.trim(),
  ).map(entry => entry.item)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const measure = (): void => {
      setWidth((scroller.parentElement?.clientWidth ?? scroller.clientWidth) - ICON_ROW_PADDING)
      const start = scroller.scrollLeft > 1
      const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
      setEdges(current => (current.start === start && current.end === end ? current : { start, end }))
    }
    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    if (typeof ResizeObserver === 'undefined') return () => scroller.removeEventListener('scroll', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    if (scroller.parentElement !== null) observer.observe(scroller.parentElement)
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', measure)
    }
  }, [props.items.length])

  const fade = 16
  const maskImage =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'}, black ${fade}px, black calc(100% - ${fade}px), ${edges.end ? 'transparent' : 'black'})`
      : undefined

  return (
    <div className="dshx:flex dshx:h-11 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-0.5 dshx:px-2">
      <div
        ref={scrollRef}
        className={cn(
          'dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-0.5 dshx:[scrollbar-width:none] dshx:[&::-webkit-scrollbar]:hidden',
          props.overflow === 'menu' ? 'dshx:overflow-hidden' : 'dshx:overflow-x-auto dshx:overflow-y-hidden dshx:overscroll-x-contain',
        )}
        style={{ maskImage, WebkitMaskImage: maskImage }}
        role="toolbar"
        aria-label={props.labels.navigation}
        onWheel={event => {
          if (props.overflow === 'menu' || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        {rowItems.map(item => {
          const index = fittingItems.indexOf(item)
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  ref={element => {
                    itemRefs.current[index] = element
                  }}
                  variant="ghost"
                  className={cn(
                    'dshx:size-8 dshx:shrink-0 dshx:p-0 dshx:text-muted-foreground dshx:hover:text-foreground',
                    item.active && 'dshx:bg-accent dshx:text-foreground',
                    drag?.from === index && 'dshx:cursor-grabbing dshx:bg-accent dshx:opacity-70',
                  )}
                  aria-label={item.label}
                  aria-current={item.active ? 'page' : undefined}
                  onPointerDown={event => {
                    if (event.button !== 0) return
                    dragRef.current = { pointerId: event.pointerId, index, startX: event.clientX, centers: null }
                  }}
                  onPointerMove={event => {
                    const current = dragRef.current
                    if (current === null || current.pointerId !== event.pointerId) return
                    if (current.centers === null) {
                      if (Math.abs(event.clientX - current.startX) < DRAG_THRESHOLD_PX) return
                      current.centers = fittingItems.map((_, position) => {
                        const rect = itemRefs.current[position]?.getBoundingClientRect()
                        return rect === undefined ? Number.POSITIVE_INFINITY : rect.left + rect.width / 2
                      })
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }
                    event.preventDefault()
                    setDrag({ from: current.index, to: dropIndexAt({ centers: current.centers, fromIndex: current.index, position: event.clientX }) })
                  }}
                  onPointerUp={event => {
                    const current = dragRef.current
                    if (current === null || current.pointerId !== event.pointerId) return
                    if (current.centers !== null) {
                      suppressClick.current = true
                      const to = dropIndexAt({ centers: current.centers, fromIndex: current.index, position: event.clientX })
                      if (to !== current.index) props.onReorder(current.index, to)
                    }
                    endDrag()
                  }}
                  onPointerCancel={endDrag}
                  onLostPointerCapture={() => {
                    if (dragRef.current?.centers !== null) endDrag()
                  }}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    item.run()
                  }}
                >
                  {item.icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {item.label}
                <span className="dshx:block dshx:text-xs dshx:opacity-70">{props.dragHint}</span>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      {showMenu ? (
        <Popover
          open={menuOpen}
          onOpenChange={open => {
            setMenuOpen(open)
            if (!open) setFilter('')
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="dshx:size-8 dshx:shrink-0 dshx:p-0 dshx:text-muted-foreground dshx:hover:text-foreground"
              aria-label={props.labels.more}
              title={props.labels.more}
            >
              <EllipsisVerticalIcon className="dshx:size-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="dshx-root dshx:w-60 dshx:p-0">
            <Command shouldFilter={false} loop>
              <CommandInput autoFocus value={filter} onValueChange={setFilter} placeholder={props.labels.filter} aria-label={props.labels.filter} />
              <CommandList className="dshx:max-h-[min(360px,calc(100vh-120px))]">
                <CommandEmpty className="dshx:py-3 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{props.labels.empty}</CommandEmpty>
                {filteredMenuItems.length > 0 ? (
                  <CommandGroup>
                    {filteredMenuItems.map(item => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        className={cn('dshx:gap-2.5', item.active && 'dshx:font-medium')}
                        onSelect={() => {
                          setMenuOpen(false)
                          setFilter('')
                          item.run()
                        }}
                      >
                        <span
                          className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
                          aria-hidden="true"
                        >
                          {item.icon}
                        </span>
                        <span className="dshx:truncate">{item.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
              <CommandSeparator />
              <CommandList className="dshx:p-1">
                <CommandItem
                  value="customize-sidebar"
                  className="dshx:gap-2.5"
                  onSelect={() => {
                    setMenuOpen(false)
                    props.onCustomize()
                  }}
                >
                  <SlidersHorizontalIcon className="dshx:size-4" aria-hidden="true" />
                  <span>{props.labels.customize}</span>
                </CommandItem>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

const expandedRowClass: Record<NavigationDensity, string> = {
  compact: 'dshx:h-[30px] dshx:gap-1.5 dshx:px-1.5',
  comfortable: 'dshx:h-[34px] dshx:gap-2 dshx:px-2',
}

const SidebarRootContent = (props: SidebarShellProps): JSX.Element => {
  const panels = props.usePanels(items => items)
  const activePanelId = props.usePanelInfo(info => info.activePanelId)
  const hostShortcuts = props.useShortcuts(entries => entries)
  const { preferences, updatePreferences, openPalette, selectedThreadId, threadTitle } = useSidebarState()
  const [history, setHistory] = useState<NavigationHistory<SidebarLocation>>(emptyNavigationHistory)
  const pendingStep = useRef<{ target: SidebarLocation; until: number } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyGroupRef = useRef<HTMLDivElement>(null)
  const historyHold = useRef<{ timer: number | undefined; opened: boolean }>({ timer: undefined, opened: false })
  const restartApi = useApi(threadSidebarRestartApi)
  const restartAvailability = useApiQuery(threadSidebarRestartApi, 'availability')
  const restartAvailable = restartAvailability.data?.available === true
  const pluginUpdates = useApiQuery(threadSidebarPluginUpdatesApi, 'pending')
  const pendingPlugins = pluginUpdates.data?.plugins ?? []
  const pluginUpdatesSupported = pluginUpdates.status !== 'error'
  const refetchPluginUpdates = pluginUpdates.refetch
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)
  const [restartRequestPending, setRestartRequestPending] = useState(false)
  const [restartRequestFailed, setRestartRequestFailed] = useState(false)
  const [previewHeaderHeight, setPreviewHeaderHeight] = useState<number | null>(null)
  const [splitBounds, setSplitBounds] = useState<SidebarSplitBounds>({
    value: SIDEBAR_HEADER_MIN_HEIGHT,
    minimum: SIDEBAR_HEADER_MIN_HEIGHT,
    maximum: SIDEBAR_HEADER_MIN_HEIGHT,
  })
  const [footerSnapshot, setFooterSnapshot] = useState(props.readFooterSnapshot)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [footerFit, setFooterFit] = useState<readonly boolean[] | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const headerRegionRef = useRef<HTMLDivElement>(null)
  const footerAboveRef = useRef<HTMLDivElement>(null)
  const footerRegionRef = useRef<HTMLElement>(null)
  const footerItemRefs = useRef(new Map<string, HTMLDivElement>())
  const splitterRef = useRef<HTMLButtonElement>(null)
  const resizeDragRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    currentHeight: number
    minimum: number
    maximum: number
  } | null>(null)
  const headerRegionId = `thread-sidebar-header-${useId()}`
  const threadRegionId = `thread-sidebar-threads-${useId()}`
  const wide = !props.collapsed
  const effectiveHeaderHeight = previewHeaderHeight ?? preferences.headerRegionHeight
  const iconRow = wide && (preferences.headerMode === 'compact' || (effectiveHeaderHeight !== null && effectiveHeaderHeight <= SIDEBAR_ICON_ROW_THRESHOLD))
  const mac = isMacPlatform(navigator.platform)

  const measureElements = () => ({
    shell: shellRef.current,
    brand: brandRef.current,
    headerRegion: headerRegionRef.current,
    footerAbove: footerAboveRef.current,
    footer: footerRegionRef.current,
    splitter: splitterRef.current,
  })

  useEffect(() => {
    const measure = (): void => {
      const bounds = readSidebarSplitBounds(measureElements())
      if (bounds === null) return
      setSplitBounds(current => (current.value === bounds.value && current.minimum === bounds.minimum && current.maximum === bounds.maximum ? current : bounds))
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', measure)

    const observer = new ResizeObserver(measure)
    if (shellRef.current !== null) observer.observe(shellRef.current)
    if (headerRegionRef.current !== null) observer.observe(headerRegionRef.current)
    if (footerAboveRef.current !== null) observer.observe(footerAboveRef.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [wide, iconRow])

  const resizeHeaderRegion = (height: number): void => {
    const bounds = readSidebarSplitBounds(measureElements())
    if (bounds === null) return
    const nextHeight = Math.round(Math.min(bounds.maximum, Math.max(bounds.minimum, height)))
    setSplitBounds({ ...bounds, value: nextHeight })
    setPreviewHeaderHeight(null)
    updatePreferences({
      headerRegionHeight: nextHeight,
      headerMode: nextHeight > SIDEBAR_ICON_ROW_THRESHOLD ? 'expanded' : preferences.headerMode,
    })
  }

  const pointerHeightAt = (clientY: number): number | null => {
    const drag = resizeDragRef.current
    if (drag === null) return null
    return Math.min(drag.maximum, Math.max(drag.minimum, drag.startHeight + clientY - drag.startY))
  }

  const moveSplitter = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const height = pointerHeightAt(event.clientY)
    if (height === null) return
    drag.currentHeight = height
    setPreviewHeaderHeight(height)
  }

  const startSplitterDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const bounds = readSidebarSplitBounds(measureElements())
    if (bounds === null) return
    event.preventDefault()
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: bounds.value,
      currentHeight: bounds.value,
      minimum: bounds.minimum,
      maximum: bounds.maximum,
    }
    setPreviewHeaderHeight(bounds.value)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const finishSplitterDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const height = pointerHeightAt(event.clientY) ?? drag.currentHeight
    drag.currentHeight = height
    resizeDragRef.current = null
    resizeHeaderRegion(height)
  }

  const cancelSplitterDrag = (): void => {
    if (resizeDragRef.current === null) return
    resizeDragRef.current = null
    setPreviewHeaderHeight(null)
  }

  const resetSplit = (): void => {
    setPreviewHeaderHeight(null)
    updatePreferences({ headerRegionHeight: null })
  }

  const resizeSplitterFromKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === '0') {
      event.preventDefault()
      resetSplit()
      return
    }
    const step = event.shiftKey ? 64 : 24
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextHeight = splitBounds.value - step
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextHeight = splitBounds.value + step
    if (event.key === 'Home') nextHeight = splitBounds.minimum
    if (event.key === 'End') nextHeight = splitBounds.maximum
    if (nextHeight === null) return
    event.preventDefault()
    resizeHeaderRegion(nextHeight)
  }

  // Rebuilds happen in another window, so check on return to this one and now and then while it stays visible.
  useEffect(() => {
    if (!pluginUpdatesSupported) return
    const check = (): void => {
      if (!document.hidden) refetchPluginUpdates()
    }
    const timer = window.setInterval(check, PLUGIN_UPDATE_CHECK_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [pluginUpdatesSupported, refetchPluginUpdates])

  useEffect(() => {
    const sync = (): void => setFooterSnapshot(props.readFooterSnapshot())
    const unsubscribe = props.subscribeFooterSnapshot(sync)
    sync()
    return unsubscribe
  }, [props.readFooterSnapshot, props.subscribeFooterSnapshot])

  useEffect(() => {
    const location = currentLocation({ panelId: activePanelId, threadId: selectedThreadId })
    if (location === null) return
    const pending = pendingStep.current
    if (pending !== null) {
      if (sameLocation(pending.target, location)) {
        pendingStep.current = null
        return
      }
      // Opening a thread from a panel passes through the old thread first; that is not a visit.
      if (Date.now() < pending.until) return
      pendingStep.current = null
    }
    setHistory(current => visitLocation(current, location))
  }, [activePanelId, selectedThreadId])

  const goToHistoryEntry = (index: number): void => {
    const step = jumpHistory(history, index)
    if (step === null) return
    pendingStep.current = { target: step.target, until: Date.now() + NAVIGATION_SETTLE_MS }
    setHistory(step.history)
    if (step.target.kind === 'thread') {
      props.openSession(step.target.id)
      return
    }
    const panelId = step.target.id
    if (panels.some(panel => panel.id === panelId)) props.selectPanel(panelId)
  }
  const stepNavigation = (direction: -1 | 1): void => goToHistoryEntry(history.index + direction)
  const latestStepNavigation = useRef(stepNavigation)
  latestStepNavigation.current = stepNavigation

  useEffect(() => {
    const onNavigate = (event: Event): void => {
      const direction: unknown =
        event instanceof CustomEvent && typeof event.detail === 'object' && event.detail !== null ? Reflect.get(event.detail, 'direction') : undefined
      if (direction === -1 || direction === 1) latestStepNavigation.current(direction)
    }
    window.addEventListener(NAVIGATION_EVENT, onNavigate)
    return () => window.removeEventListener(NAVIGATION_EVENT, onNavigate)
  }, [])

  useEffect(() => {
    const ownedByHost = (chord: NonNullable<ReturnType<typeof parseChord>>): boolean =>
      hostShortcuts.some(entry => sameAsHostBinding(chord, entry.binding, mac))
    // ⌘[ / ⌘] are browser-reserved for Host web shortcuts, so on the web they are claimed here before the browser.
    const chords = [
      { chord: parseChord(preferences.paletteChord), run: () => openPalette('all') },
      { chord: parseChord(preferences.fileSearchChord), run: () => openPalette('files') },
      { chord: parseChord(preferences.threadSearchChord), run: () => openPalette('threads') },
      { chord: parseChord(preferences.backChord), run: () => latestStepNavigation.current(-1) },
      { chord: parseChord(preferences.forwardChord), run: () => latestStepNavigation.current(1) },
    ].flatMap(({ chord, run }) => (chord === null || ownedByHost(chord) ? [] : [{ chord, run }]))

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      const match = chords.find(({ chord }) => matchesChord(event, chord, mac))
      if (match === undefined) return
      event.preventDefault()
      event.stopPropagation()
      match.run()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    hostShortcuts,
    mac,
    openPalette,
    preferences.backChord,
    preferences.fileSearchChord,
    preferences.forwardChord,
    preferences.paletteChord,
    preferences.threadSearchChord,
  ])

  const headerEntries = useMemo<HeaderEntry[]>(
    () => [
      { id: 'new-thread', label: text(props.t, 'threadSidebarNewThread'), kind: 'new-thread', order: -2 },
      { id: 'search', label: text(props.t, 'threadSidebarSearch'), kind: 'search', order: -1 },
      ...panels.map(panel => ({
        id: 'panel:' + panel.id,
        label: panel.label,
        kind: 'panel' as const,
        panelId: panel.id,
        order: panel.order,
      })),
    ],
    [panels, props.t],
  )

  const orderedHeaderEntries = useMemo(() => orderSidebarEntries(headerEntries, preferences.headerOrder), [headerEntries, preferences.headerOrder])
  const visibleHeaderEntries = useMemo(
    () => orderedHeaderEntries.filter(entry => !preferences.hiddenHeaderIds.includes(entry.id)),
    [orderedHeaderEntries, preferences.hiddenHeaderIds],
  )

  const footerEntries = useMemo<FooterEntry[]>(
    () => [
      ...(footerSnapshot.settingsId === null
        ? []
        : [
            {
              key: 'settings',
              id: 'settings',
              label: text(props.t, 'threadSidebarHostSettings'),
              kind: 'settings' as const,
              registrationId: null,
              order: -1,
            },
          ]),
      ...footerSnapshot.actions.map(action => ({
        key: 'footer:' + action.id,
        id: 'footer:' + action.id,
        label: action.label,
        kind: 'action' as const,
        registrationId: action.id,
        order: action.order,
      })),
    ],
    [footerSnapshot, props.t],
  )

  const orderedFooterEntries = useMemo(() => orderSidebarEntries(footerEntries, preferences.footerOrder), [footerEntries, preferences.footerOrder])
  const visibleFooterEntries = orderedFooterEntries.filter(entry => !preferences.hiddenFooterIds.includes(entry.id))
  const hiddenFooterEntries = orderedFooterEntries.filter(entry => preferences.hiddenFooterIds.includes(entry.id))
  const footerEntryFits = (index: number): boolean => !wide || footerFit === null || footerFit[index] !== false
  const overflowFooterEntries = [...visibleFooterEntries.filter((_, index) => !footerEntryFits(index)), ...hiddenFooterEntries]
  const visibleFooterKey = visibleFooterEntries.map(entry => entry.id).join('|')

  useLayoutEffect(() => {
    const footer = footerRegionRef.current
    if (!wide || footer === null) {
      setFooterFit(null)
      return
    }
    const measure = (): void => {
      const widths = visibleFooterKey
        .split('|')
        .filter(Boolean)
        .map(id => footerItemRefs.current.get(id)?.getBoundingClientRect().width ?? 0)
      const style = window.getComputedStyle(footer)
      const available = footer.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      const moreAlwaysShown = hiddenFooterEntries.length > 0
      setFooterFit(
        fitItems({
          widths,
          available: moreAlwaysShown ? available - FOOTER_MORE_WIDTH - FOOTER_GAP : available,
          gap: FOOTER_GAP,
          reserve: moreAlwaysShown ? 0 : FOOTER_MORE_WIDTH + FOOTER_GAP,
        }),
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(footer)
    footerItemRefs.current.forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [wide, visibleFooterKey, hiddenFooterEntries.length])

  const renderFooterEntry = (entry: FooterEntry, renderWide: boolean): ReactNode => {
    if (entry.kind === 'settings') {
      return props.renderSlot('sidebar.settings', { wide: renderWide })
    }
    if (entry.registrationId === null) return null
    return props.renderSlot('sidebar.footer.action', { wide: renderWide }, { only: entry.registrationId })
  }

  const activateHeaderEntry = (entry: HeaderEntry): void => {
    if (entry.kind === 'new-thread') {
      props.startSession()
      return
    }
    if (entry.kind === 'search') {
      openPalette('threads')
      return
    }
    if (entry.panelId !== undefined) props.selectPanel(entry.panelId)
  }

  const headerIconFor = (entry: HeaderEntry, size: number): ReactNode => {
    if (entry.kind === 'new-thread')
      return (
        <span className="dshx:inline-flex" aria-hidden="true">
          <IconNewChatOutlineRegular size={size} />
        </span>
      )
    if (entry.kind === 'search')
      return (
        <span className="dshx:inline-flex" aria-hidden="true">
          <IconSearchOutlineRegular size={size} />
        </span>
      )
    if (entry.panelId === undefined) return null
    return props.renderSlot('sidebar.panellist', { size, active: activePanelId === entry.panelId }, { only: entry.panelId })
  }

  const openCustomize = (): void => {
    if (props.collapsed) props.toggleSidebar()
    setCustomizeOpen(true)
  }

  const navigationItems: NavigationItem[] = visibleHeaderEntries.map(entry => ({
    id: entry.id,
    label: entry.label,
    icon: headerIconFor(entry, 16),
    active: entry.kind === 'panel' && activePanelId === entry.panelId,
    run: () => activateHeaderEntry(entry),
  }))

  const requestDshRestart = (): void => {
    if (restartRequestPending) return
    setRestartRequestPending(true)
    setRestartRequestFailed(false)
    void restartApi
      .requestRestart(undefined)
      .then(
        () => setRestartDialogOpen(false),
        () => setRestartRequestFailed(true),
      )
      .finally(() => setRestartRequestPending(false))
  }

  const openRestartDialog = (): void => {
    if (!restartAvailable) return
    setRestartRequestFailed(false)
    setRestartDialogOpen(true)
  }
  const pendingUpdatesLabel =
    pendingPlugins.length === 0
      ? null
      : `${text(props.t, 'threadSidebarUpdatesPending')} (${String(pendingPlugins.length)} ${text(props.t, pendingPlugins.length === 1 ? 'threadSidebarUpdatesPlugin' : 'threadSidebarUpdatesPlugins')})`
  const pendingUpdatesTitle =
    pendingUpdatesLabel === null
      ? undefined
      : [text(props.t, 'threadSidebarUpdatesHint'), ...pendingPlugins, ...(restartAvailable ? [] : [text(props.t, 'threadSidebarUpdatesManual')])].join('\n')

  const runCommand = props.runCommand
  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      ...orderedHeaderEntries
        .filter(entry => entry.kind !== 'search')
        .map((entry): PaletteAction => ({
          id: `@dshfiles/thread-sidebar/header/${entry.id}`,
          group: 'destination',
          label: entry.label,
          icon: headerIconFor(entry, 16),
          run: () => activateHeaderEntry(entry),
        })),
      {
        id: '@dshfiles/thread-sidebar/action/toggle-sidebar',
        group: 'destination',
        label: text(props.t, 'threadSidebarToggleSidebar'),
        icon: <PanelLeftIcon className="dshx:size-4" />,
        run: props.toggleSidebar,
      },
      {
        id: '@dshfiles/thread-sidebar/action/focus-composer',
        group: 'destination',
        label: text(props.t, 'threadSidebarFocusComposer'),
        icon: <TextCursorInputIcon className="dshx:size-4" />,
        run: () => window.setTimeout(focusComposer, 0),
      },
      {
        id: '@dshfiles/thread-sidebar/action/customize-sidebar',
        group: 'destination',
        label: text(props.t, 'threadSidebarCustomize'),
        icon: <SlidersHorizontalIcon className="dshx:size-4" />,
        run: openCustomize,
      },
      {
        id: '@dshfiles/thread-sidebar/navigation/back',
        group: 'action',
        label: text(props.t, 'threadSidebarBack'),
        aliases: ['history', 'previous'],
        icon: <ArrowLeftIcon className="dshx:size-4" />,
        isAvailable: () => canStep(history, -1),
        run: () => latestStepNavigation.current(-1),
      },
      {
        id: '@dshfiles/thread-sidebar/navigation/forward',
        group: 'action',
        label: text(props.t, 'threadSidebarForward'),
        aliases: ['history', 'next'],
        icon: <ArrowRightIcon className="dshx:size-4" />,
        isAvailable: () => canStep(history, 1),
        run: () => latestStepNavigation.current(1),
      },
      ...(restartAvailable
        ? [
            {
              id: '@dshfiles/thread-sidebar/action/restart-dsh',
              group: 'destination' as const,
              label: pendingUpdatesLabel ?? text(props.t, 'threadSidebarRestart'),
              aliases: ['restart', 'reload host', 'apply updates'],
              icon: <RefreshCwIcon className="dshx:size-4" />,
              run: openRestartDialog,
            },
          ]
        : []),
      ...(runCommand === null
        ? []
        : hostShortcuts
            .filter(entry => !SELF_COMMAND_IDS.has(entry.id))
            .map((entry): PaletteAction => ({
              id: `@dshfiles/thread-sidebar/command/${entry.id}`,
              group: 'command',
              label: entry.label,
              aliases: entry.aliases,
              keys: entry.binding === null ? [] : entry.keys,
              icon: <CommandIcon className="dshx:size-4" />,
              run: () => {
                window.setTimeout(() => runCommand(entry.id), 0)
              },
            }))),
    ],
    [
      orderedHeaderEntries,
      props.t,
      props.toggleSidebar,
      restartAvailable,
      pendingUpdatesLabel,
      hostShortcuts,
      runCommand,
      history,
      activateHeaderEntry,
      openCustomize,
      openRestartDialog,
    ],
  )

  useEffect(() => {
    const disposers = paletteActions.map(action => registerPaletteAction(action))
    return () => disposers.forEach(dispose => dispose())
  }, [paletteActions])

  const renderCustomizeRow = (options: {
    entry: { id: string; label: string }
    index: number
    count: number
    icon: ReactNode
    hidden: boolean
    control: 'checkbox' | 'switch'
    onReorder: (from: number, to: number) => void
    onToggle: () => void
  }): JSX.Element => {
    const visibilityLabel = `${text(props.t, 'threadSidebarVisibility')}: ${options.entry.label}`
    return (
      <div
        className={cn(
          'dshx:grid dshx:grid-cols-[14px_20px_minmax(0,1fr)_auto_auto] dshx:items-center dshx:gap-2.5',
          options.control === 'checkbox' ? 'dshx:h-8 dshx:rounded-md dshx:px-2 dshx:hover:bg-accent' : 'dshx:h-11 dshx:px-3',
        )}
        key={options.entry.id}
        draggable
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(options.index))
        }}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault()
          const from = Number(event.dataTransfer.getData('text/plain'))
          if (Number.isInteger(from)) options.onReorder(from, options.index)
        }}
      >
        <GripVerticalIcon className="dshx:size-3.5 dshx:cursor-grab dshx:text-muted-foreground dshx:active:cursor-grabbing" aria-hidden="true" />
        <span
          className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:text-muted-foreground dshx:*:max-h-5 dshx:*:max-w-5 dshx:*:overflow-hidden"
          aria-hidden="true"
        >
          {options.icon}
        </span>
        <span className="dshx:truncate dshx:text-sm">{options.entry.label}</span>
        <span className="dshx:flex dshx:items-center">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${text(props.t, 'threadSidebarMoveUp')}: ${options.entry.label}`}
            disabled={options.index === 0}
            onClick={() => options.onReorder(options.index, options.index - 1)}
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${text(props.t, 'threadSidebarMoveDown')}: ${options.entry.label}`}
            disabled={options.index === options.count - 1}
            onClick={() => options.onReorder(options.index, options.index + 1)}
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </span>
        {options.control === 'checkbox' ? (
          <Checkbox checked={!options.hidden} aria-label={visibilityLabel} onCheckedChange={options.onToggle} />
        ) : (
          <Switch checked={!options.hidden} aria-label={visibilityLabel} onCheckedChange={options.onToggle} />
        )}
      </div>
    )
  }

  const paletteHint = parseChord(preferences.paletteChord)
  const withChordHint = (label: string, chordValue: string | null): string => {
    const chord = parseChord(chordValue)
    return chord === null ? label : `${label} (${formatChord(chord, mac).join('')})`
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div
        ref={shellRef}
        className={cn(
          'dshx-root dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:max-w-full dshx:flex-none dshx:flex-col dshx:overflow-hidden dshx:bg-(--dsw-specific-sidebar-fill) dshx:text-foreground',
          props.collapsed && 'dshx:items-center',
        )}
        style={{ width: props.width }}
      >
        <div
          ref={brandRef}
          className={cn('dshx:flex dshx:h-12 dshx:w-full dshx:shrink-0 dshx:items-center dshx:gap-2', props.collapsed ? 'dshx:justify-center' : 'dshx:px-3')}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={text(props.t, props.collapsed ? 'threadSidebarExpand' : 'threadSidebarCollapse')}
            onClick={props.toggleSidebar}
          >
            {preferences.hideBrandLogo ? (
              <PanelLeftIcon className="dshx:size-4 dshx:text-muted-foreground" aria-hidden="true" />
            ) : (
              (props.renderSlot('sidebar.brand.mark', { size: 20 }) ?? <span aria-hidden="true">◈</span>)
            )}
          </Button>
          {wide && !preferences.hideBrandLogo ? (
            <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">{props.renderSlot('sidebar.brand.name', {}) ?? 'DSH'}</span>
          ) : null}
          {wide ? (
            <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-0.5">
              <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverAnchor asChild>
                  <div ref={historyGroupRef} className="dshx:flex dshx:items-center">
                    {([-1, 1] as const).map(direction => {
                      const label = text(props.t, direction === -1 ? 'threadSidebarBack' : 'threadSidebarForward')
                      return (
                        <Button
                          key={direction}
                          variant="ghost"
                          size="icon-xs"
                          className="dshx:text-muted-foreground"
                          aria-label={label}
                          title={`${withChordHint(label, direction === -1 ? preferences.backChord : preferences.forwardChord)}\n${text(props.t, 'threadSidebarHistoryHint')}`}
                          disabled={!canStep(history, direction)}
                          onPointerDown={event => {
                            if (event.button !== 0) return
                            window.clearTimeout(historyHold.current.timer)
                            historyHold.current = {
                              opened: false,
                              timer: window.setTimeout(() => {
                                historyHold.current.opened = true
                                setHistoryOpen(true)
                              }, HISTORY_HOLD_MS),
                            }
                          }}
                          onPointerUp={() => window.clearTimeout(historyHold.current.timer)}
                          onPointerLeave={() => window.clearTimeout(historyHold.current.timer)}
                          onContextMenu={event => {
                            event.preventDefault()
                            setHistoryOpen(true)
                          }}
                          onClick={() => {
                            if (historyHold.current.opened) {
                              historyHold.current.opened = false
                              return
                            }
                            stepNavigation(direction)
                          }}
                        >
                          {direction === -1 ? (
                            <ArrowLeftIcon className="dshx:size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowRightIcon className="dshx:size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      )
                    })}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="dshx:w-4 dshx:text-muted-foreground"
                      aria-label={text(props.t, 'threadSidebarHistory')}
                      aria-expanded={historyOpen}
                      title={text(props.t, 'threadSidebarHistory')}
                      disabled={history.entries.length < 2}
                      onClick={() => setHistoryOpen(open => !open)}
                    >
                      <ChevronDownIcon className="dshx:size-3" aria-hidden="true" />
                    </Button>
                  </div>
                </PopoverAnchor>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="dshx-root dshx:flex dshx:max-h-[min(420px,calc(100vh-96px))] dshx:w-64 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:p-1"
                  aria-label={text(props.t, 'threadSidebarHistory')}
                  onInteractOutside={event => {
                    if (event.target instanceof Node && historyGroupRef.current?.contains(event.target) === true) event.preventDefault()
                  }}
                >
                  {history.entries
                    .map((entry, index) => ({ entry, index }))
                    .reverse()
                    .map(({ entry, index }) => {
                      const current = index === history.index
                      const label =
                        entry.kind === 'thread'
                          ? (threadTitle.current(entry.id) ?? text(props.t, 'threadSidebarHistoryThread'))
                          : (panels.find(panel => panel.id === entry.id)?.label ?? entry.id)
                      return (
                        <Button
                          key={`${String(index)}:${entry.kind}:${entry.id}`}
                          variant="ghost"
                          size="sm"
                          className={cn('dshx:w-full dshx:justify-start dshx:gap-2 dshx:font-normal', current && 'dshx:bg-accent dshx:font-medium')}
                          aria-current={current ? 'page' : undefined}
                          onClick={() => {
                            setHistoryOpen(false)
                            goToHistoryEntry(index)
                          }}
                        >
                          <span
                            className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
                            aria-hidden="true"
                          >
                            {entry.kind === 'thread' ? (
                              <MessageSquareIcon className="dshx:size-3.5" />
                            ) : (
                              props.renderSlot('sidebar.panellist', { size: 14, active: false }, { only: entry.id })
                            )}
                          </span>
                          <span className="dshx:truncate">{label}</span>
                        </Button>
                      )
                    })}
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon-sm"
                className="dshx:text-muted-foreground"
                aria-label={text(props.t, 'threadSidebarCommandPalette')}
                title={
                  paletteHint === null
                    ? text(props.t, 'threadSidebarCommandPalette')
                    : `${text(props.t, 'threadSidebarCommandPalette')} (${formatChord(paletteHint, mac).join('')})`
                }
                onClick={() => openPalette('all')}
              >
                <CommandIcon className="dshx:size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="dshx:text-muted-foreground"
                aria-label={text(props.t, 'threadSidebarCustomize')}
                aria-expanded={customizeOpen}
                title={text(props.t, 'threadSidebarCustomize')}
                onClick={() => setCustomizeOpen(value => !value)}
              >
                <IconSlidersTwoOutlineRegular size={16} />
              </Button>
            </div>
          ) : null}
          {props.collapsed ? props.renderSlot('sidebar.toggle.badge', {}) : null}
        </div>

        <div
          ref={headerRegionRef}
          className={cn(
            'dshx:w-full dshx:min-h-0',
            props.collapsed
              ? 'dshx:shrink dshx:overflow-y-auto dshx:[scrollbar-width:none]'
              : iconRow
                ? 'dshx:shrink-0'
                : 'dshx:shrink dshx:overflow-y-auto dshx:overscroll-contain dshx:[scrollbar-width:thin]',
          )}
          id={headerRegionId}
          style={
            wide && !iconRow && effectiveHeaderHeight !== null ? { height: `${effectiveHeaderHeight}px`, flex: `0 0 ${effectiveHeaderHeight}px` } : undefined
          }
        >
          {props.collapsed ? (
            <nav className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:pb-2" aria-label={text(props.t, 'threadSidebarHeaderNavigation')}>
              {navigationItems.map(item => (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        'dshx:size-8 dshx:shrink-0 dshx:p-0 dshx:text-muted-foreground dshx:hover:text-foreground',
                        item.active && 'dshx:bg-accent dshx:text-foreground',
                      )}
                      aria-label={item.label}
                      aria-current={item.active ? 'page' : undefined}
                      onClick={item.run}
                    >
                      {item.icon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ))}
            </nav>
          ) : iconRow ? (
            <nav aria-label={text(props.t, 'threadSidebarHeaderNavigation')}>
              <NavigationIconRow
                items={navigationItems}
                overflow={preferences.navigationOverflow}
                onCustomize={openCustomize}
                dragHint={text(props.t, 'threadSidebarDragToReorder')}
                onReorder={(fromIndex, toIndex) =>
                  updatePreferences({
                    headerOrder: reorderVisibleEntry({
                      orderedIds: orderedHeaderEntries.map(entry => entry.id),
                      visibleIds: visibleHeaderEntries.map(entry => entry.id),
                      fromVisible: fromIndex,
                      toVisible: toIndex,
                    }),
                  })
                }
                labels={{
                  more: text(props.t, 'threadSidebarMoreDestinations'),
                  filter: text(props.t, 'threadSidebarFilterDestinations'),
                  empty: text(props.t, 'threadSidebarNoDestinations'),
                  customize: text(props.t, 'threadSidebarCustomize'),
                  navigation: text(props.t, 'threadSidebarHeaderNavigation'),
                }}
              />
            </nav>
          ) : (
            <nav
              className={cn('dshx:flex dshx:flex-col dshx:px-2 dshx:pb-2', preferences.navigationDensity === 'compact' ? 'dshx:gap-0.5' : 'dshx:gap-1')}
              aria-label={text(props.t, 'threadSidebarHeaderNavigation')}
            >
              {navigationItems.map(item => (
                <Button
                  key={item.id}
                  variant="ghost"
                  className={cn(
                    'dshx:w-full dshx:shrink-0 dshx:justify-start dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground',
                    expandedRowClass[preferences.navigationDensity],
                    preferences.navigationDensity === 'compact' ? 'dshx:text-sm' : 'dshx:text-base',
                    item.active && 'dshx:bg-accent dshx:text-foreground',
                  )}
                  aria-label={item.label}
                  aria-current={item.active ? 'page' : undefined}
                  onClick={item.run}
                >
                  {item.icon}
                  <span className="dshx:truncate">{item.label}</span>
                </Button>
              ))}
              <Button
                variant="ghost"
                className={cn(
                  'dshx:w-full dshx:shrink-0 dshx:justify-start dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground',
                  expandedRowClass[preferences.navigationDensity],
                )}
                onClick={openCustomize}
              >
                <SlidersHorizontalIcon className="dshx:size-4" aria-hidden="true" />
                {text(props.t, 'threadSidebarCustomize')}
              </Button>
            </nav>
          )}
        </div>

        {customizeOpen && wide ? (
          <section
            className="dshx:absolute dshx:inset-x-2 dshx:top-12 dshx:bottom-14 dshx:z-20 dshx:flex dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:rounded-lg dshx:border dshx:bg-card dshx:p-2 dshx:shadow-lg"
            aria-label={text(props.t, 'threadSidebarCustomize')}
          >
            <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:justify-between dshx:pl-2">
              <h2 className="dshx:text-sm dshx:font-medium dshx:text-muted-foreground">{text(props.t, 'threadSidebarCustomize')}</h2>
              <Button variant="ghost" size="sm" className="dshx:font-semibold" onClick={() => setCustomizeOpen(false)}>
                {text(props.t, 'threadSidebarDone')}
              </Button>
            </div>
            <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-2">
              <span id={`${headerRegionId}-mode`} className="dshx:text-xs dshx:text-muted-foreground">
                {text(props.t, 'threadSidebarHeaderStyle')}
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-labelledby={`${headerRegionId}-mode`}
                value={preferences.headerMode}
                onValueChange={value => {
                  if (value === 'compact' || value === 'expanded') updatePreferences({ headerMode: value, headerRegionHeight: null })
                }}
              >
                <ToggleGroupItem value="compact">{text(props.t, 'threadSidebarCompact')}</ToggleGroupItem>
                <ToggleGroupItem value="expanded">{text(props.t, 'threadSidebarExpanded')}</ToggleGroupItem>
              </ToggleGroup>
              <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:pt-1 dshx:text-sm">
                <Checkbox checked={!preferences.hideBrandLogo} onCheckedChange={checked => updatePreferences({ hideBrandLogo: checked !== true })} />
                {text(props.t, 'threadSidebarShowBrandLogo')}
              </label>
            </div>
            <section className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-2" aria-labelledby={`${headerRegionId}-rows`}>
              <h3 id={`${headerRegionId}-rows`} className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
                {text(props.t, 'threadSidebarThreadRows')}
              </h3>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-labelledby={`${headerRegionId}-rows`}
                value={preferences.threadRowDensity}
                onValueChange={value => {
                  if (value === 'compact' || value === 'comfortable') updatePreferences({ threadRowDensity: value })
                }}
              >
                <ToggleGroupItem value="compact">{text(props.t, 'threadSidebarRowCompact')}</ToggleGroupItem>
                <ToggleGroupItem value="comfortable">{text(props.t, 'threadSidebarRowComfortable')}</ToggleGroupItem>
              </ToggleGroup>
              <div className="dshx:grid dshx:grid-cols-2 dshx:gap-x-3 dshx:gap-y-1.5 dshx:pt-1">
                {rowFieldKeys.map(([key, label]) => (
                  <label key={key} className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
                    <Checkbox checked={preferences[key]} onCheckedChange={checked => updatePreferences({ [key]: checked === true })} />
                    {text(props.t, label)}
                  </label>
                ))}
              </div>
            </section>
            <section className="dshx:flex dshx:flex-col dshx:gap-0.5">
              <h3 className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{text(props.t, 'threadSidebarHeaderLinks')}</h3>
              {orderedHeaderEntries.map((entry, index) =>
                renderCustomizeRow({
                  entry,
                  index,
                  count: orderedHeaderEntries.length,
                  icon: headerIconFor(entry, 16),
                  hidden: preferences.hiddenHeaderIds.includes(entry.id),
                  control: 'checkbox',
                  onReorder: (from, to) =>
                    updatePreferences({
                      headerOrder: reorderSidebarEntry(
                        orderedHeaderEntries.map(item => item.id),
                        from,
                        to,
                      ),
                    }),
                  onToggle: () => updatePreferences({ hiddenHeaderIds: toggleHidden(preferences.hiddenHeaderIds, entry.id) }),
                }),
              )}
            </section>
            <section className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-2">
              <h3 className="dshx:text-sm dshx:font-medium">{text(props.t, 'threadSidebarFooterLinks')}</h3>
              <p className="dshx:text-xs dshx:text-muted-foreground">{text(props.t, 'threadSidebarFooterHint')}</p>
              <div className="dshx:mt-1 dshx:divide-y dshx:rounded-lg dshx:border">
                {orderedFooterEntries.map((entry, index) =>
                  renderCustomizeRow({
                    entry,
                    index,
                    count: orderedFooterEntries.length,
                    icon:
                      entry.kind === 'settings' ? (
                        <IconSettingsOutlineRegular size={16} />
                      ) : (
                        props.renderSlot('sidebar.footer.action', { wide: false }, { only: entry.registrationId ?? undefined })
                      ),
                    hidden: preferences.hiddenFooterIds.includes(entry.id),
                    control: 'switch',
                    onReorder: (from, to) =>
                      updatePreferences({
                        footerOrder: reorderSidebarEntry(
                          orderedFooterEntries.map(item => item.id),
                          from,
                          to,
                        ),
                      }),
                    onToggle: () => updatePreferences({ hiddenFooterIds: toggleHidden(preferences.hiddenFooterIds, entry.id) }),
                  }),
                )}
              </div>
            </section>
          </section>
        ) : null}

        {wide ? (
          <button
            ref={splitterRef}
            type="button"
            className="dshx:relative dshx:h-3 dshx:w-full dshx:shrink-0 dshx:cursor-row-resize dshx:touch-none dshx:select-none dshx:outline-none dshx:before:absolute dshx:before:top-1/2 dshx:before:left-1/2 dshx:before:h-0.5 dshx:before:w-7 dshx:before:-translate-x-1/2 dshx:before:-translate-y-1/2 dshx:before:rounded-full dshx:before:bg-muted-foreground/50 dshx:hover:before:bg-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset dshx:focus-visible:before:bg-foreground"
            role="separator"
            aria-label={text(props.t, 'threadSidebarResize')}
            aria-orientation="horizontal"
            aria-controls={`${headerRegionId} ${threadRegionId}`}
            aria-valuemin={splitBounds.minimum}
            aria-valuemax={splitBounds.maximum}
            aria-valuenow={previewHeaderHeight === null ? splitBounds.value : Math.round(previewHeaderHeight)}
            title={text(props.t, 'threadSidebarResizeHint')}
            onPointerDown={startSplitterDrag}
            onPointerMove={moveSplitter}
            onPointerUp={finishSplitterDrag}
            onPointerCancel={cancelSplitterDrag}
            onLostPointerCapture={cancelSplitterDrag}
            onKeyDown={resizeSplitterFromKeyboard}
            onDoubleClick={resetSplit}
          />
        ) : null}

        <div
          className={cn(
            'dshx:w-full dshx:min-h-[120px] dshx:flex-1 dshx:overflow-hidden dshx:*:w-full dshx:*:min-w-0',
            props.collapsed ? 'dshx:hidden' : 'dshx:flex',
          )}
          id={threadRegionId}
        >
          {props.renderSlot('sidebar.workspaces', {
            wide,
            expandSidebar: () => {
              if (props.collapsed) props.toggleSidebar()
            },
          })}
        </div>

        {wide ? (
          <div ref={footerAboveRef} className="dshx:flex dshx:w-full dshx:min-w-0 dshx:shrink-0 dshx:flex-col dshx:empty:hidden">
            {pendingUpdatesLabel === null ? null : (
              <button
                type="button"
                className="dshx:flex dshx:h-7 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:border-t dshx:px-3 dshx:text-left dshx:text-xs dshx:text-warning dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset dshx:aria-disabled:cursor-default dshx:aria-disabled:hover:bg-transparent"
                title={pendingUpdatesTitle}
                aria-label={pendingUpdatesLabel}
                aria-disabled={!restartAvailable}
                onClick={openRestartDialog}
              >
                <RefreshCwIcon className="dshx:size-3.5 dshx:shrink-0" aria-hidden="true" />
                <span className="dshx:truncate">{pendingUpdatesLabel}</span>
              </button>
            )}
            {props.renderSlot('sidebar.footer.above', {})}
          </div>
        ) : null}

        <footer
          ref={footerRegionRef}
          className={cn(
            'dshx:relative dshx:flex dshx:w-full dshx:border-t',
            props.collapsed
              ? 'dshx:mt-auto dshx:max-h-1/2 dshx:shrink dshx:flex-col dshx:items-center dshx:gap-1 dshx:overflow-x-hidden dshx:overflow-y-auto dshx:py-1 dshx:[scrollbar-width:none]'
              : 'dshx:h-[52px] dshx:shrink-0 dshx:flex-nowrap dshx:items-center dshx:gap-2 dshx:overflow-hidden dshx:px-2',
          )}
        >
          {props.collapsed && pendingUpdatesLabel !== null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="dshx:shrink-0 dshx:text-warning"
                  aria-label={pendingUpdatesLabel}
                  aria-disabled={!restartAvailable}
                  onClick={openRestartDialog}
                >
                  <RefreshCwIcon className="dshx:size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="dshx:whitespace-pre-line">
                {`${pendingUpdatesLabel}\n${pendingUpdatesTitle ?? ''}`}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {visibleFooterEntries.map((entry, index) => {
            const overflowed = !footerEntryFits(index)
            const item = (
              <div
                key={entry.id}
                ref={element => {
                  if (element === null) footerItemRefs.current.delete(entry.id)
                  else {
                    footerItemRefs.current.set(entry.id, element)
                    element.inert = overflowed
                  }
                }}
                aria-hidden={overflowed ? true : undefined}
                data-overflowed={overflowed ? 'true' : undefined}
                className={cn(
                  'dshx:flex dshx:w-max dshx:max-h-11 dshx:shrink-0 dshx:items-center dshx:whitespace-nowrap dshx:*:shrink-0',
                  overflowed && 'dshx:pointer-events-none dshx:invisible dshx:absolute dshx:top-0 dshx:left-0',
                )}
              >
                {renderFooterEntry(entry, wide)}
              </div>
            )
            if (wide) return item
            return (
              <Tooltip key={entry.id}>
                <TooltipTrigger asChild>{item}</TooltipTrigger>
                <TooltipContent side="right">{entry.label}</TooltipContent>
              </Tooltip>
            )
          })}
          {overflowFooterEntries.length > 0 ? (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn('dshx:shrink-0 dshx:text-muted-foreground', wide && 'dshx:ml-auto')}
                  aria-label={text(props.t, 'threadSidebarMore')}
                  title={text(props.t, 'threadSidebarMore')}
                >
                  <IconEllipsisOutlineRegular size={16} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="dshx-root dshx:flex dshx:max-h-[min(480px,calc(100vh-96px))] dshx:w-auto dshx:min-w-56 dshx:max-w-[min(360px,calc(100vw-16px))] dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:p-1"
                aria-label={text(props.t, 'threadSidebarMore')}
              >
                {overflowFooterEntries.map(entry => (
                  <div className="dshx:flex dshx:min-h-9 dshx:items-center dshx:whitespace-nowrap dshx:*:w-full" key={entry.id}>
                    {renderFooterEntry(entry, true)}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </footer>
      </div>
      <AlertDialog
        open={restartDialogOpen}
        onOpenChange={open => {
          if (restartRequestPending && !open) return
          setRestartDialogOpen(open)
          if (!open) setRestartRequestFailed(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{text(props.t, 'threadSidebarRestartTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{text(props.t, 'threadSidebarRestartDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          {pendingPlugins.length === 0 ? null : (
            <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-6 dshx:text-sm">
              <p className="dshx:text-muted-foreground">{text(props.t, 'threadSidebarUpdatesApplied')}</p>
              <ul className="dshx:flex dshx:max-h-40 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:font-mono dshx:text-xs">
                {pendingPlugins.map(plugin => (
                  <li key={plugin}>{plugin}</li>
                ))}
              </ul>
            </div>
          )}
          {restartRequestFailed ? (
            <p role="alert" className="dshx:px-6 dshx:text-sm dshx:text-destructive">
              {text(props.t, 'threadSidebarRestartFailure')}
            </p>
          ) : null}
          <AlertDialogFooter>
            <Button type="button" variant="outline" disabled={restartRequestPending} onClick={() => setRestartDialogOpen(false)}>
              {text(props.t, 'threadSidebarRestartCancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={restartRequestPending} onClick={requestDshRestart}>
              {text(props.t, restartRequestPending ? 'threadSidebarRestartPending' : 'threadSidebarRestartConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}

export const SidebarRoot = (props: SidebarShellProps): JSX.Element => (
  <SidebarStateProvider>
    <SidebarRootContent {...props} />
  </SidebarStateProvider>
)
