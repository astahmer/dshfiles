import type { SidebarPanelMetadata, SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconEllipsisOutlineRegular,
  IconNewChatOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  IconSlidersTwoOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { GripVerticalIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  orderSidebarEntries,
  reorderSidebarEntry,
  SIDEBAR_HEADER_MIN_HEIGHT,
  SIDEBAR_SPLITTER_HEIGHT,
  SIDEBAR_THREAD_MIN_HEIGHT,
  type OrderedSidebarEntry,
} from './organization.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

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
}

type SidebarShellTranslate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
export type SidebarShellBaseProps = Omit<SidebarRootComponentProps, 't'> & {
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

const text = (translate: SidebarShellTranslate, key: Parameters<SidebarShellTranslate>[0]): string => translate(key)

const toggleHidden = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])

const readSidebarSplitBounds = (elements: {
  shell: HTMLDivElement | null
  headerRegion: HTMLDivElement | null
  threadRegion: HTMLDivElement | null
  footer: HTMLElement | null
  splitter: HTMLButtonElement | null
}): SidebarSplitBounds | null => {
  const { shell, headerRegion, threadRegion, footer, splitter } = elements
  if (shell === null || headerRegion === null || threadRegion === null) return null

  const footerHeight = footer?.getBoundingClientRect().height ?? 0
  const splitterHeight = splitter?.getBoundingClientRect().height ?? SIDEBAR_SPLITTER_HEIGHT
  const availableMaximum = shell.clientHeight - footerHeight - splitterHeight - SIDEBAR_THREAD_MIN_HEIGHT
  const maximum = Math.max(SIDEBAR_HEADER_MIN_HEIGHT, Math.floor(availableMaximum))
  const value = headerRegion.getBoundingClientRect().height
  return {
    value: Math.round(Math.min(maximum, Math.max(SIDEBAR_HEADER_MIN_HEIGHT, value))),
    minimum: SIDEBAR_HEADER_MIN_HEIGHT,
    maximum,
  }
}

const SidebarRootContent = (props: SidebarShellProps): JSX.Element => {
  const panels = props.usePanels(items => items)
  const activePanelId = props.usePanelInfo(info => info.activePanelId)
  const { preferences, updatePreferences, threadQuery, setThreadQuery } = useSidebarState()
  const [previewHeaderHeight, setPreviewHeaderHeight] = useState<number | null>(null)
  const [splitBounds, setSplitBounds] = useState<SidebarSplitBounds>({
    value: SIDEBAR_HEADER_MIN_HEIGHT,
    minimum: SIDEBAR_HEADER_MIN_HEIGHT,
    maximum: SIDEBAR_HEADER_MIN_HEIGHT,
  })
  const [footerSnapshot, setFooterSnapshot] = useState(props.readFooterSnapshot)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const headerRegionRef = useRef<HTMLDivElement>(null)
  const threadRegionRef = useRef<HTMLDivElement>(null)
  const footerRegionRef = useRef<HTMLElement>(null)
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

  useEffect(() => {
    const measure = (): void => {
      const bounds = readSidebarSplitBounds({
        shell: shellRef.current,
        headerRegion: headerRegionRef.current,
        threadRegion: threadRegionRef.current,
        footer: footerRegionRef.current,
        splitter: splitterRef.current,
      })
      if (bounds === null) return
      setSplitBounds(current => (current.value === bounds.value && current.minimum === bounds.minimum && current.maximum === bounds.maximum ? current : bounds))
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', measure)

    const observer = new ResizeObserver(measure)
    if (shellRef.current !== null) observer.observe(shellRef.current)
    if (headerRegionRef.current !== null) observer.observe(headerRegionRef.current)
    if (threadRegionRef.current !== null) observer.observe(threadRegionRef.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [wide])

  useEffect(() => {
    if (previewHeaderHeight !== null) return
    const bounds = readSidebarSplitBounds({
      shell: shellRef.current,
      headerRegion: headerRegionRef.current,
      threadRegion: threadRegionRef.current,
      footer: footerRegionRef.current,
      splitter: splitterRef.current,
    })
    if (bounds !== null) setSplitBounds(bounds)
  }, [preferences.headerRegionHeight, previewHeaderHeight, wide])

  const resizeHeaderRegion = (height: number): void => {
    const bounds = readSidebarSplitBounds({
      shell: shellRef.current,
      headerRegion: headerRegionRef.current,
      threadRegion: threadRegionRef.current,
      footer: footerRegionRef.current,
      splitter: splitterRef.current,
    })
    if (bounds === null) return
    const nextHeight = Math.round(Math.min(bounds.maximum, Math.max(bounds.minimum, height)))
    setSplitBounds({ ...bounds, value: nextHeight })
    setPreviewHeaderHeight(null)
    updatePreferences({ headerRegionHeight: nextHeight })
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
    const bounds = readSidebarSplitBounds({
      shell: shellRef.current,
      headerRegion: headerRegionRef.current,
      threadRegion: threadRegionRef.current,
      footer: footerRegionRef.current,
      splitter: splitterRef.current,
    })
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

  const resizeSplitterFromKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === '0') {
      event.preventDefault()
      setPreviewHeaderHeight(null)
      updatePreferences({ headerRegionHeight: null })
      return
    }
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextHeight = splitBounds.value - 24
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextHeight = splitBounds.value + 24
    if (event.key === 'Home') nextHeight = splitBounds.minimum
    if (event.key === 'End') nextHeight = splitBounds.maximum
    if (nextHeight === null) return
    event.preventDefault()
    resizeHeaderRegion(nextHeight)
  }

  useEffect(() => {
    const sync = (): void => setFooterSnapshot(props.readFooterSnapshot())
    const unsubscribe = props.subscribeFooterSnapshot(sync)
    sync()
    return unsubscribe
  }, [props.readFooterSnapshot, props.subscribeFooterSnapshot])

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
  const visibleHeaderEntries = orderedHeaderEntries.filter(entry => !preferences.hiddenHeaderIds.includes(entry.id))

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
      if (props.collapsed) props.toggleSidebar()
      setSearchOpen(true)
      return
    }
    if (entry.panelId !== undefined) props.selectPanel(entry.panelId)
  }

  const renderCustomizeRow = (options: {
    entry: { id: string; label: string }
    index: number
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
          'dshx:grid dshx:grid-cols-[14px_20px_minmax(0,1fr)_auto] dshx:items-center dshx:gap-2.5',
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
        {options.control === 'checkbox' ? (
          <Checkbox checked={!options.hidden} aria-label={visibilityLabel} onCheckedChange={options.onToggle} />
        ) : (
          <Switch checked={!options.hidden} aria-label={visibilityLabel} onCheckedChange={options.onToggle} />
        )}
      </div>
    )
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

  const compactHeader = props.collapsed || preferences.headerMode === 'compact'

  return (
    <TooltipProvider delayDuration={500}>
      <div
        ref={shellRef}
        className={cn(
          'dshx-root dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:max-w-full dshx:flex-none dshx:flex-col dshx:overflow-hidden dshx:bg-(--dsw-specific-sidebar-fill) dshx:text-foreground',
          props.collapsed && 'dshx:items-center',
        )}
        style={{ width: props.width }}
      >
        <div
          ref={headerRegionRef}
          className="dshx:min-h-0 dshx:w-full dshx:shrink dshx:overflow-y-auto dshx:overscroll-contain dshx:[scrollbar-width:thin]"
          id={headerRegionId}
          style={wide && effectiveHeaderHeight !== null ? { height: `${effectiveHeaderHeight}px` } : undefined}
        >
          <div className={cn('dshx:flex dshx:h-12 dshx:shrink-0 dshx:items-center dshx:gap-2', props.collapsed ? 'dshx:justify-center' : 'dshx:px-3')}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={text(props.t, props.collapsed ? 'threadSidebarExpand' : 'threadSidebarCollapse')}
              onClick={props.toggleSidebar}
            >
              {props.renderSlot('sidebar.brand.mark', { size: 20 }) ?? <span aria-hidden="true">◈</span>}
            </Button>
            {wide ? (
              <span className="dshx:truncate dshx:text-sm dshx:font-semibold">{props.renderSlot('sidebar.brand.name', {}) ?? 'DSH'}</span>
            ) : null}
            {wide ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="dshx:ml-auto dshx:text-muted-foreground"
                aria-label={text(props.t, 'threadSidebarCustomize')}
                aria-expanded={customizeOpen}
                title={text(props.t, 'threadSidebarCustomize')}
                onClick={() => setCustomizeOpen(value => !value)}
              >
                <IconSlidersTwoOutlineRegular size={16} />
              </Button>
            ) : null}
            {props.collapsed ? props.renderSlot('sidebar.toggle.badge', {}) : null}
          </div>

          <nav
            className={cn(
              'dshx:flex dshx:shrink-0',
              compactHeader ? 'dshx:flex-wrap dshx:gap-0.5 dshx:px-2 dshx:pb-2' : 'dshx:flex-col dshx:gap-0.5 dshx:px-2 dshx:pb-2',
              props.collapsed && 'dshx:flex-col dshx:items-center dshx:px-0',
            )}
            aria-label={text(props.t, 'threadSidebarHeaderNavigation')}
          >
            {visibleHeaderEntries.map(entry => {
              const active = entry.kind === 'panel' && activePanelId === entry.panelId
              const link = (
                <Button
                  variant="ghost"
                  className={cn(
                    'dshx:shrink-0 dshx:text-muted-foreground dshx:hover:text-foreground',
                    compactHeader
                      ? 'dshx:size-8 dshx:p-0'
                      : 'dshx:h-8 dshx:w-full dshx:justify-start dshx:gap-2.5 dshx:px-2.5 dshx:text-base dshx:font-normal',
                    active && 'dshx:bg-accent dshx:text-foreground',
                  )}
                  aria-label={entry.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => activateHeaderEntry(entry)}
                >
                  {headerIconFor(entry, compactHeader ? 18 : 16)}
                  {!compactHeader ? <span className="dshx:truncate">{entry.label}</span> : null}
                </Button>
              )
              if (!compactHeader) return <div key={entry.id}>{link}</div>
              return (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side={props.collapsed ? 'right' : 'bottom'}>{entry.label}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>

          {wide && searchOpen ? (
            <div className="dshx:px-3 dshx:pb-2">
              <InputGroup className="dshx:h-7">
                <InputGroupAddon>
                  <IconSearchOutlineRegular size={14} />
                </InputGroupAddon>
                <InputGroupInput
                  autoFocus
                  type="search"
                  className="dshx:h-7 dshx:text-sm"
                  aria-label={text(props.t, 'threadSidebarSearch')}
                  placeholder={text(props.t, 'threadSidebarSearchPlaceholder')}
                  value={threadQuery}
                  onChange={event => setThreadQuery(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      setThreadQuery('')
                      setSearchOpen(false)
                    }
                  }}
                />
              </InputGroup>
            </div>
          ) : null}
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
                  if (value === 'compact' || value === 'expanded') updatePreferences({ headerMode: value })
                }}
              >
                <ToggleGroupItem value="compact">{text(props.t, 'threadSidebarCompact')}</ToggleGroupItem>
                <ToggleGroupItem value="expanded">{text(props.t, 'threadSidebarExpanded')}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <section className="dshx:flex dshx:flex-col dshx:gap-0.5">
              <h3 className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{text(props.t, 'threadSidebarHeaderLinks')}</h3>
              {orderedHeaderEntries.map((entry, index) =>
                renderCustomizeRow({
                  entry,
                  index,
                  icon: headerIconFor(entry, 16),
                  hidden: preferences.hiddenHeaderIds.includes(entry.id),
                  control: 'checkbox',
                  onReorder: (from, to) =>
                    updatePreferences({
                      headerOrder: reorderSidebarEntry(
                        orderSidebarEntries(headerEntries, preferences.headerOrder).map(item => item.id),
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
                          orderSidebarEntries(footerEntries, preferences.footerOrder).map(item => item.id),
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
            onDoubleClick={() => updatePreferences({ headerRegionHeight: null })}
          />
        ) : null}

        <div
          ref={threadRegionRef}
          className={cn('dshx:flex dshx:w-full dshx:flex-1 dshx:overflow-hidden dshx:*:w-full dshx:*:min-w-0', props.collapsed ? 'dshx:min-h-0' : 'dshx:min-h-[120px]')}
          id={threadRegionId}
        >
          {wide
            ? props.renderSlot('sidebar.workspaces', {
                wide,
                expandSidebar: () => {
                  if (props.collapsed) props.toggleSidebar()
                },
              })
            : null}
        </div>

        <footer
          ref={footerRegionRef}
          className={cn(
            'dshx:relative dshx:flex dshx:w-full dshx:border-t dshx:[scrollbar-width:none]',
            props.collapsed
              ? 'dshx:max-h-1/2 dshx:shrink dshx:flex-col dshx:items-center dshx:gap-1 dshx:overflow-x-hidden dshx:overflow-y-auto dshx:py-1'
              : 'dshx:h-[52px] dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:px-2 dshx:py-1',
          )}
        >
          {visibleFooterEntries.map(entry => (
            <Tooltip key={entry.id}>
              <TooltipTrigger asChild>
                <div className="dshx:inline-flex dshx:h-full dshx:max-h-11 dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:overflow-hidden dshx:[contain:paint]">
                  {renderFooterEntry(entry, wide)}
                </div>
              </TooltipTrigger>
              <TooltipContent side={props.collapsed ? 'right' : 'top'}>{entry.label}</TooltipContent>
            </Tooltip>
          ))}
          {hiddenFooterEntries.length > 0 ? (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size={wide ? 'sm' : 'icon-sm'}
                  className={cn('dshx:shrink-0 dshx:text-muted-foreground', wide && 'dshx:ml-auto')}
                  aria-label={text(props.t, 'threadSidebarMore')}
                >
                  <IconEllipsisOutlineRegular size={16} />
                  {wide ? <span>{text(props.t, 'threadSidebarMore')}</span> : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="dshx-root dshx:flex dshx:w-auto dshx:min-w-48 dshx:flex-col dshx:gap-0.5 dshx:p-1"
                aria-label={text(props.t, 'threadSidebarMore')}
              >
                {hiddenFooterEntries.map(entry => (
                  <div className="dshx:flex dshx:min-h-9 dshx:items-center dshx:*:w-full" key={entry.id}>
                    {renderFooterEntry(entry, true)}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </footer>
      </div>
    </TooltipProvider>
  )
}

export const SidebarRoot = (props: SidebarShellProps): JSX.Element => (
  <SidebarStateProvider>
    <SidebarRootContent {...props} />
  </SidebarStateProvider>
)
