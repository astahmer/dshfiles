import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
import { ChevronDownIcon, CopyIcon, PanelRightOpenIcon, PinIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { requestThreadMentionInsertion, ThreadMentionDrag } from '@dshfiles/thread-sidebar/thread-mention'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { MainTabsTranslate } from './locales.js'
import { ASIDE_DROP_ATTRIBUTE, asideDropColumn } from './aside-drop.js'
import { requestPanelAside } from './panel-aside.js'
import { requestThreadAside } from './thread-aside.js'
import { requestThreadSettle } from './settle-request.js'
import { buildThreadTabLink } from './thread-link.js'
import { CompassGlyph } from './start-page.js'
import type { TabsEvent } from './tabs-machine.js'

export type TabStatus = 'running' | 'needsYou' | 'unread'

interface TabViewBase {
  readonly id: string
  readonly title: string
  readonly active: boolean
  readonly pinned: boolean
  readonly preview: boolean
  readonly available: boolean
  readonly status: TabStatus | null
}

export type TabView =
  | (TabViewBase & { readonly kind: 'thread'; readonly sessionId: string; readonly workspaceId?: string })
  | (TabViewBase & { readonly kind: 'panel'; readonly panelId: string })
  | (TabViewBase & { readonly kind: 'start' })

/** What one dragged tab can move into: a thread's aside, or a panel with both a main tab and a right-sidebar tab. */
type DraggedMove =
  | { readonly kind: 'thread'; readonly tabId: string; readonly sessionId: string }
  | { readonly kind: 'panel'; readonly tabId: string; readonly panelId: string }

interface TabStripProps {
  readonly tabs: readonly TabView[]
  readonly send: (event: TabsEvent) => void
  readonly t: MainTabsTranslate
  /** The new-tab command's keys, shown in the "+" tooltip. */
  readonly newTabKeys: string
  /** Rename one thread's explicit title; rejects when the Host refuses it. */
  readonly renameThread: (sessionId: string, title: string) => Promise<void>
}

/** One dot per thread tab, most urgent first: a question or approval waits, then work in progress, then an unseen finish. */
export const threadTabStatus = (facts: { readonly needsYou: boolean; readonly running: boolean; readonly unread: boolean }): TabStatus | null => {
  if (facts.needsYou) return 'needsYou'
  if (facts.running) return 'running'
  if (facts.unread) return 'unread'
  return null
}

const statusDotClass = {
  running: 'dshx:animate-pulse dshx:bg-info',
  needsYou: 'dshx:bg-warning',
  unread: 'dshx:bg-primary',
} satisfies Record<TabStatus, string>

const statusLabel = { running: 'running', needsYou: 'needsYou', unread: 'unread' } as const satisfies Record<TabStatus, string>

/** DSH's dock-kit strip glyphs (`dsh-client-ui-dockkit`): a 1px cross and plus on a 16px grid, drawn at 14px. */
const CloseGlyph = (): ReactElement => (
  <svg aria-hidden width={14} height={14} viewBox="0 0 16 16" fill="none" strokeWidth={1}>
    <path d="M3.5 3.5L12.5 12.5" stroke="currentColor" />
    <path d="M12.5 3.5L3.5 12.5" stroke="currentColor" />
  </svg>
)

const PlusGlyph = (): ReactElement => (
  <svg aria-hidden width={14} height={14} viewBox="0 0 16 16" fill="none" strokeWidth={1}>
    <path d="M8 2V14" stroke="currentColor" />
    <path d="M2 8H14" stroke="currentColor" />
  </svg>
)

/** The 2px caret the dock-kit strip draws where a dragged tab will land. */
const DROP_CARET =
  "dshx:before:absolute dshx:before:top-1 dshx:before:-left-1.5 dshx:before:h-5 dshx:before:w-0.5 dshx:before:bg-(--dsw-alias-brand-primary-new-colorprimary-new-color) dshx:before:content-['']"

/** Square 28px strip buttons, as the dock-kit `addTab` and `iconButton`. */
const STRIP_BUTTON =
  'dshx:flex dshx:size-7 dshx:flex-none dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-(--dsw-radius-sm) dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring'

/**
 * The tab row above the main view, styled after DSH's own dock-kit strip (the right panel's tabs): 28px pills on the
 * panel background, a hairline between inactive neighbours, the close cross over a faded title end, and "+" after the
 * last tab. Rendering only: the tabs machine owns order, pins, preview and the active tab; this keeps DOM-only state
 * (drop target, overflow measurement) and sends what the user did.
 */
export const TabStrip = (props: TabStripProps): ReactElement => {
  const { tabs, send, t } = props
  const registry = workbenchPanels()
  useSyncExternalStore(registry.subscribe, registry.list, registry.list)
  const pluginPanels = registry.listContextMenuPanels()
  const scroller = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [asideDrop, setAsideDrop] = useState(false)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const dragged = useRef<string | null>(null)
  const asideColumn = useRef<HTMLElement | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeId = tabs.find(tab => tab.active)?.id
  const copy = async (value: string, copiedKey: 'threadIdCopied' | 'threadLinkCopied'): Promise<void> => {
    try {
      setStatus(t((await writeClipboard(value)) ? copiedKey : 'clipboardFailure'))
    } catch {
      setStatus(t('clipboardFailure'))
    }
  }
  const openAside = (sessionId: string): void => {
    if (!requestThreadAside(sessionId)) setStatus(t('sidePanelUnavailable'))
  }
  const renameTab = async (tab: TabView, title: string): Promise<void> => {
    if (tab.kind !== 'thread') return
    try {
      await props.renameThread(tab.sessionId, title)
      setRenamingTabId(null)
      setStatus('')
    } catch {
      setStatus(t('renameFailed'))
    }
  }
  /** The dragged tab's move target, or null when this tab stays in the strip (reorder or start tab). */
  const draggedMove = (): DraggedMove | null => {
    const view = tabsRef.current.find(tab => tab.id === dragged.current)
    if (view === undefined) return null
    if (view.kind === 'thread') return { kind: 'thread', tabId: view.id, sessionId: view.sessionId }
    return view.kind === 'panel' ? { kind: 'panel', tabId: view.id, panelId: view.panelId } : null
  }
  const clearAsideTarget = useCallback((): void => {
    asideColumn.current?.removeAttribute(ASIDE_DROP_ATTRIBUTE)
    asideColumn.current = null
    setAsideDrop(false)
  }, [])

  useEffect(() => {
    const columnUnder = (event: DragEvent): HTMLElement | null => asideDropColumn(window.document, { x: event.clientX, y: event.clientY })
    /** A drop on the right sidebar moves the tab there: the side panel takes it, then the main tab goes away. */
    const moveDraggedToAside = (): void => {
      const target = draggedMove()
      if (target === null) return
      const taken = target.kind === 'thread' ? requestThreadAside(target.sessionId) : requestPanelAside(target.panelId)
      if (!taken) {
        setStatus(t(target.kind === 'thread' ? 'sidePanelUnavailable' : 'panelAsideUnavailable'))
        return
      }
      send({ type: 'tab.close', tabId: target.tabId })
    }
    const onDragOver = (event: DragEvent): void => {
      if (draggedMove() === null) {
        clearAsideTarget()
        return
      }
      const column = columnUnder(event)
      if (column !== asideColumn.current) {
        asideColumn.current?.removeAttribute(ASIDE_DROP_ATTRIBUTE)
        column?.setAttribute(ASIDE_DROP_ATTRIBUTE, '')
        asideColumn.current = column
        setAsideDrop(column !== null)
      }
      if (column === null) return
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const onDrop = (event: DragEvent): void => {
      if (columnUnder(event) === null || draggedMove() === null) return
      event.preventDefault()
      moveDraggedToAside()
      clearAsideTarget()
    }
    const onDragEnd = (): void => clearAsideTarget()
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd, true)
      asideColumn.current?.removeAttribute(ASIDE_DROP_ATTRIBUTE)
      asideColumn.current = null
    }
  }, [clearAsideTarget, send, t])

  useEffect(() => {
    const element = scroller.current
    if (element === null) return
    const measure = (): void => {
      setOverflowing(element.scrollWidth > element.clientWidth + 1)
      element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of Array.from(element.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [tabs.length])

  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const focusTab = (index: number): void => {
    const nodes = scroller.current?.querySelectorAll<HTMLElement>('[role="tab"]')
    if (nodes === undefined || nodes.length === 0) return
    nodes[(index + nodes.length) % nodes.length]?.focus()
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tab: TabView, index: number): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      send({ type: 'tab.select', tabId: tab.id })
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      send({ type: 'tab.close', tabId: tab.id })
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab(index + (event.key === 'ArrowRight' ? 1 : -1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusTab(event.key === 'Home' ? 0 : tabs.length - 1)
    }
  }

  const dropAtEnd = (): void => {
    const tabId = dragged.current
    if (tabId !== null) send({ type: 'tab.move', tabId, toIndex: tabs.length - 1 })
    setDropIndex(null)
  }

  return (
    <div
      className="dshx-root dshx:flex dshx:h-[38px] dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:bg-background dshx:pt-2.5 dshx:pr-1.5 dshx:text-[length:var(--dsh-content-font-size-secondary,13px)]"
      data-window-drag=""
      style={{ paddingInlineStart: 'calc(var(--dsh-frame-leading-clearance, 0px) + 10px)' }}
    >
      <div
        ref={scroller}
        role="tablist"
        aria-label={t('stripLabel')}
        aria-orientation="horizontal"
        className="dshx:flex dshx:min-w-0 dshx:flex-[0_1_auto] dshx:items-center dshx:overflow-x-auto dshx:overflow-y-hidden dshx:[scrollbar-width:none] dshx:[&::-webkit-scrollbar]:hidden"
        onWheel={event => {
          if (event.deltaY === 0 || scroller.current === null) return
          scroller.current.scrollLeft += event.deltaY
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) setDropIndex(null)
        }}
      >
        {tabs.map((tab, index) => {
          const label = tab.status === null ? tab.title : `${tab.title}, ${t(statusLabel[tab.status])}`
          const previous = tabs[index - 1]
          return (
            <ContextMenu key={tab.id}>
              {previous === undefined ? null : (
                <span
                  aria-hidden
                  className={cn(
                    'dshx:flex dshx:h-7 dshx:w-2.5 dshx:flex-none dshx:items-center dshx:justify-center dshx:before:h-3.5 dshx:before:w-[0.5px] dshx:before:content-[""]',
                    previous.active || tab.active ? 'dshx:before:bg-transparent' : 'dshx:before:bg-(--dsw-alias-border-l4)',
                  )}
                />
              )}
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={tab.active}
                  aria-label={label}
                  title={tab.available ? tab.title : `${tab.title} — ${t('unavailable')}`}
                  data-tab-id={tab.id}
                  data-pinned={tab.pinned || undefined}
                  data-preview={tab.preview || undefined}
                  tabIndex={tab.active || (activeId === undefined && index === 0) ? 0 : -1}
                  draggable={renamingTabId !== tab.id}
                  className={cn(
                    'dshx:group dshx:relative dshx:flex dshx:h-7 dshx:max-w-[190px] dshx:flex-[0_1_auto] dshx:cursor-pointer dshx:items-center dshx:rounded-(--dsw-radius-sm) dshx:px-2.5 dshx:leading-none dshx:whitespace-nowrap dshx:text-muted-foreground dshx:outline-none dshx:select-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset',
                    tab.pinned ? 'dshx:min-w-0' : 'dshx:min-w-[100px]',
                    tab.active && 'dshx:bg-(--dsw-alias-markdown-tag) dshx:text-foreground dshx:hover:bg-(--dsw-alias-markdown-tag)',
                    !tab.available && 'dshx:opacity-50',
                    dropIndex === index && DROP_CARET,
                  )}
                  onClick={() => send({ type: 'tab.select', tabId: tab.id })}
                  onDoubleClick={() => send({ type: 'tab.keep', tabId: tab.id })}
                  onMouseDown={event => {
                    if (event.button === 1) event.preventDefault()
                  }}
                  onAuxClick={event => {
                    if (event.button !== 1) return
                    event.preventDefault()
                    send({ type: 'tab.close', tabId: tab.id })
                  }}
                  onKeyDown={event => onTabKeyDown(event, tab, index)}
                  onDragStart={event => {
                    dragged.current = tab.id
                    setAsideDrop(false)
                    if (tab.kind === 'thread') {
                      ThreadMentionDrag.write(event.dataTransfer, tab.sessionId)
                      return
                    }
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', tab.title)
                  }}
                  onDragOver={event => {
                    if (dragged.current === null) return
                    event.preventDefault()
                    const box = event.currentTarget.getBoundingClientRect()
                    setDropIndex(event.clientX > box.left + box.width / 2 ? index + 1 : index)
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    const tabId = dragged.current
                    if (tabId === null || dropIndex === null) return
                    const from = tabs.findIndex(candidate => candidate.id === tabId)
                    send({ type: 'tab.move', tabId, toIndex: from < dropIndex ? dropIndex - 1 : dropIndex })
                    setDropIndex(null)
                  }}
                  onDragEnd={() => {
                    dragged.current = null
                    setDropIndex(null)
                    clearAsideTarget()
                  }}
                >
                  <span
                    className={cn(
                      'dshx:flex dshx:min-w-0 dshx:flex-auto dshx:items-center dshx:gap-[5px] dshx:overflow-hidden dshx:leading-[1.4]',
                      !tab.pinned &&
                        'dshx:group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-30px),transparent_calc(100%-14px))] dshx:group-focus-within:[mask-image:linear-gradient(to_right,black_calc(100%-30px),transparent_calc(100%-14px))]',
                      !tab.pinned && tab.active && 'dshx:[mask-image:linear-gradient(to_right,black_calc(100%-30px),transparent_calc(100%-14px))]',
                    )}
                  >
                    {tab.kind === 'start' ? <CompassGlyph size={16} className="dshx:flex-none dshx:text-(--dsw-alias-label-tertiary)" /> : null}
                    {tab.status === null ? null : (
                      <span aria-hidden className={cn('dshx:size-1.5 dshx:flex-none dshx:rounded-full', statusDotClass[tab.status])} />
                    )}
                    {tab.kind === 'thread' && renamingTabId === tab.id ? (
                      <InlineTitleEditor
                        value={tab.title}
                        label={t('renameThread')}
                        className="dshx:h-5 dshx:min-w-20 dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:shadow-none dshx:text-inherit dshx:focus-visible:ring-0"
                        onCancel={() => setRenamingTabId(null)}
                        onCommit={title => void renameTab(tab, title)}
                      />
                    ) : (
                      <span className={cn('dshx:truncate', tab.preview && 'dshx:italic')}>{tab.title}</span>
                    )}
                    {tab.pinned ? <PinIcon aria-label={t('pinned')} size={12} className="dshx:flex-none dshx:text-(--dsw-alias-label-tertiary)" /> : null}
                  </span>
                  {tab.pinned ? null : (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={t('close', { title: tab.title })}
                      className={cn(
                        'dshx:absolute dshx:top-1 dshx:right-1 dshx:flex dshx:size-5 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-(--dsw-radius-sm) dshx:text-(--dsw-alias-label-tertiary) dshx:hover:bg-accent dshx:hover:text-foreground',
                        tab.active
                          ? 'dshx:opacity-100'
                          : 'dshx:pointer-events-none dshx:opacity-0 dshx:group-focus-within:pointer-events-auto dshx:group-focus-within:opacity-100 dshx:group-hover:pointer-events-auto dshx:group-hover:opacity-100',
                      )}
                      onClick={event => {
                        event.stopPropagation()
                        send({ type: 'tab.close', tabId: tab.id })
                      }}
                    >
                      <CloseGlyph />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="dshx-root">
                {tab.kind === 'start' ? null : (
                  <ContextMenuItem onSelect={() => send({ type: 'tab.togglePin', tabId: tab.id })}>{t(tab.pinned ? 'unpin' : 'pin')}</ContextMenuItem>
                )}
                {tab.preview ? <ContextMenuItem onSelect={() => send({ type: 'tab.keep', tabId: tab.id })}>{t('keepOpen')}</ContextMenuItem> : null}
                {tab.kind === 'thread' ? <ContextMenuItem onSelect={() => setRenamingTabId(tab.id)}>{t('renameThread')}</ContextMenuItem> : null}
                {tab.kind === 'start' && !tab.preview ? null : <ContextMenuSeparator />}
                {tab.kind === 'panel' ? (
                  <>
                    <ContextMenuItem onSelect={() => requestPanelAside(tab.panelId)}>
                      <PanelRightOpenIcon aria-hidden="true" />
                      {t('openInSidePanel')}
                    </ContextMenuItem>
                    {pluginPanels.length > 0 ? (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>{t('openPluginInSidePanel')}</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="dshx-root dshx:min-w-44">
                          {pluginPanels.map(definition => (
                            <ContextMenuItem key={definition.id} onSelect={() => requestPanelAside(definition.id)}>
                              {definition.title}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ) : null}
                  </>
                ) : null}
                {tab.kind === 'thread' ? (
                  <>
                    {pluginPanels.length > 0 ? (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>{t('openPluginInSidePanel')}</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="dshx-root dshx:min-w-44">
                          {pluginPanels.map(definition => (
                            <ContextMenuItem key={definition.id} onSelect={() => requestPanelAside(definition.id)}>
                              {definition.title}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ) : null}
                    <ContextMenuItem onSelect={() => requestThreadMentionInsertion(tab.sessionId, ThreadMentionDrag.activeComposerSessionId())}>
                      {t('mentionThread')}
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>{t('threadStatus')}</ContextMenuSubTrigger>
                      <ContextMenuSubContent className="dshx-root dshx:min-w-44">
                        <ContextMenuItem disabled={tab.status === 'running'} onSelect={() => requestThreadSettle(tab.sessionId)}>
                          {t('settleThread')}
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onSelect={() => openAside(tab.sessionId)}>
                      <PanelRightOpenIcon aria-hidden="true" />
                      {t('openInSidePanel')}
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>{t('copy')}</ContextMenuSubTrigger>
                      <ContextMenuSubContent className="dshx-root dshx:min-w-44">
                        <ContextMenuItem onSelect={() => void copy(tab.sessionId, 'threadIdCopied')}>
                          <CopyIcon aria-hidden="true" />
                          {t('copyThreadId')}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            void copy(
                              buildThreadTabLink({
                                currentUrl: window.location.href,
                                sessionId: tab.sessionId,
                                workspaceId: tab.workspaceId,
                              }),
                              'threadLinkCopied',
                            )
                          }
                        >
                          <CopyIcon aria-hidden="true" />
                          {t('copyThreadLink')}
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSeparator />
                  </>
                ) : null}
                <ContextMenuItem onSelect={() => send({ type: 'tab.close', tabId: tab.id })}>{t('closeTab')}</ContextMenuItem>
                <ContextMenuItem disabled={tabs.length < 2} onSelect={() => send({ type: 'tab.closeOthers', tabId: tab.id })}>
                  {t('closeOthers')}
                </ContextMenuItem>
                <ContextMenuItem disabled={index === tabs.length - 1} onSelect={() => send({ type: 'tab.closeToRight', tabId: tab.id })}>
                  {t('closeToRight')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <button
        type="button"
        aria-label={t('newTab')}
        title={props.newTabKeys === '' ? t('newTab') : `${t('newTab')} (${props.newTabKeys})`}
        className={cn(STRIP_BUTTON, 'dshx:relative', dropIndex === tabs.length && DROP_CARET)}
        onClick={() => send({ type: 'tab.new' })}
        onDragOver={event => {
          if (dragged.current === null) return
          event.preventDefault()
          setDropIndex(tabs.length)
        }}
        onDrop={event => {
          event.preventDefault()
          dropAtEnd()
        }}
      >
        <PlusGlyph />
      </button>
      <div
        aria-hidden
        className="dshx:h-7 dshx:min-w-6 dshx:flex-1"
        onDragOver={event => {
          if (dragged.current === null) return
          event.preventDefault()
          setDropIndex(tabs.length)
        }}
        onDrop={event => {
          event.preventDefault()
          dropAtEnd()
        }}
      />
      {overflowing ? (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={t('allTabs')} title={t('allTabs')} className={STRIP_BUTTON}>
            <ChevronDownIcon aria-hidden size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dshx-root dshx:max-h-96 dshx:max-w-80">
            {tabs.map(tab => (
              <DropdownMenuItem key={tab.id} onSelect={() => send({ type: 'tab.select', tabId: tab.id })} className={cn(tab.active && 'dshx:font-semibold')}>
                <span className="dshx:truncate">{tab.title}</span>
                {tab.status === null ? null : (
                  <span aria-hidden className={cn('dshx:ml-auto dshx:size-2 dshx:shrink-0 dshx:rounded-full', statusDotClass[tab.status])} />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {status ? (
        <span className="dshx:sr-only" role="status">
          {status}
        </span>
      ) : null}
      {asideDrop
        ? createPortal(
            <div
              role="status"
              data-dshfiles-aside-drop-hint=""
              className="dshx-root dshx:pointer-events-none dshx:fixed dshx:top-1/2 dshx:right-4 dshx:z-[80] dshx:-translate-y-1/2 dshx:rounded-(--dsw-radius-md) dshx:border dshx:border-(--dsw-alias-border-l3) dshx:bg-(--dsw-alias-bg-layer-1) dshx:px-3 dshx:py-1.5 dshx:text-[length:var(--dsh-content-font-size-secondary,13px)] dshx:text-(--dsw-alias-label-primary) dshx:shadow-lg"
            >
              {t('moveToSidePanel')}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
