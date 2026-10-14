import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ChevronDownIcon, MessageSquareIcon, PanelsTopLeftIcon, PinIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { MainTabsTranslate } from './locales.js'
import type { TabsEvent } from './tabs-machine.js'

export type TabStatus = 'running' | 'needsYou' | 'unread'

export interface TabView {
  readonly id: string
  readonly kind: 'panel' | 'thread'
  readonly title: string
  readonly active: boolean
  readonly pinned: boolean
  readonly preview: boolean
  readonly available: boolean
  readonly status: TabStatus | null
}

interface TabStripProps {
  readonly tabs: readonly TabView[]
  readonly send: (event: TabsEvent) => void
  readonly t: MainTabsTranslate
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

const TabIcon = (props: { readonly kind: TabView['kind'] }): ReactElement =>
  props.kind === 'thread' ? (
    <MessageSquareIcon aria-hidden size={14} className="dshx:shrink-0" />
  ) : (
    <PanelsTopLeftIcon aria-hidden size={14} className="dshx:shrink-0" />
  )

/**
 * The tab row above the main view. Rendering only: the tabs machine owns order, pins, preview and the active tab;
 * this keeps DOM-only state (drop target, overflow measurement) and sends what the user did.
 */
export const TabStrip = (props: TabStripProps): ReactElement => {
  const { tabs, send, t } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragged = useRef<string | null>(null)
  const activeId = tabs.find(tab => tab.active)?.id

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

  return (
    <div
      className="dshx-root dshx:flex dshx:h-9 dshx:shrink-0 dshx:items-stretch dshx:border-b dshx:border-border dshx:bg-muted/50 dshx:text-sm"
      data-window-drag=""
      style={{ paddingInlineStart: 'var(--dsh-frame-leading-clearance, 0px)' }}
    >
      <div
        ref={scroller}
        role="tablist"
        aria-label={t('stripLabel')}
        aria-orientation="horizontal"
        className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-stretch dshx:overflow-x-auto dshx:overflow-y-hidden dshx:[scrollbar-width:none] dshx:[&::-webkit-scrollbar]:hidden"
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
          return (
            <ContextMenu key={tab.id}>
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
                  draggable
                  className={cn(
                    'dshx:group dshx:relative dshx:flex dshx:min-w-[6.5rem] dshx:cursor-default dshx:items-center dshx:gap-1.5 dshx:border-r dshx:border-t-2 dshx:border-r-border dshx:border-t-transparent dshx:pr-1 dshx:pl-2.5 dshx:text-muted-foreground dshx:outline-none dshx:select-none dshx:hover:bg-background/60 dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset',
                    tab.pinned ? 'dshx:max-w-40 dshx:flex-none' : 'dshx:flex-[0_1_12rem]',
                    tab.active && 'dshx:border-t-primary dshx:bg-background dshx:text-foreground',
                    !tab.available && 'dshx:opacity-50',
                    dropIndex === index &&
                      "dshx:before:absolute dshx:before:inset-y-1 dshx:before:left-0 dshx:before:w-0.5 dshx:before:bg-primary dshx:before:content-['']",
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
                  }}
                >
                  <TabIcon kind={tab.kind} />
                  <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', tab.preview && 'dshx:italic')}>{tab.title}</span>
                  {tab.status === null ? null : <span aria-hidden className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', statusDotClass[tab.status])} />}
                  {tab.pinned ? (
                    <PinIcon aria-label={t('pinned')} size={12} className="dshx:shrink-0 dshx:text-muted-foreground" />
                  ) : (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={t('close', { title: tab.title })}
                      className={cn(
                        'dshx:flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground',
                        tab.active ? 'dshx:opacity-100' : 'dshx:opacity-0 dshx:group-hover:opacity-100 dshx:group-focus-visible:opacity-100',
                      )}
                      onClick={event => {
                        event.stopPropagation()
                        send({ type: 'tab.close', tabId: tab.id })
                      }}
                    >
                      <XIcon aria-hidden size={12} />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="dshx-root">
                <ContextMenuItem onSelect={() => send({ type: 'tab.togglePin', tabId: tab.id })}>{t(tab.pinned ? 'unpin' : 'pin')}</ContextMenuItem>
                {tab.preview ? <ContextMenuItem onSelect={() => send({ type: 'tab.keep', tabId: tab.id })}>{t('keepOpen')}</ContextMenuItem> : null}
                <ContextMenuSeparator />
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
        <div
          aria-hidden
          className={cn(
            'dshx:relative dshx:min-w-6 dshx:flex-1',
            dropIndex === tabs.length &&
              "dshx:before:absolute dshx:before:inset-y-1 dshx:before:left-0 dshx:before:w-0.5 dshx:before:bg-primary dshx:before:content-['']",
          )}
          onDragOver={event => {
            if (dragged.current === null) return
            event.preventDefault()
            setDropIndex(tabs.length)
          }}
          onDrop={event => {
            event.preventDefault()
            const tabId = dragged.current
            if (tabId !== null) send({ type: 'tab.move', tabId, toIndex: tabs.length - 1 })
            setDropIndex(null)
          }}
        />
      </div>
      {overflowing ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('allTabs')}
            title={t('allTabs')}
            className="dshx:flex dshx:w-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:border-l dshx:border-border dshx:text-muted-foreground dshx:hover:bg-background/60 dshx:hover:text-foreground"
          >
            <ChevronDownIcon aria-hidden size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dshx-root dshx:max-h-96 dshx:max-w-80">
            {tabs.map(tab => (
              <DropdownMenuItem key={tab.id} onSelect={() => send({ type: 'tab.select', tabId: tab.id })} className={cn(tab.active && 'dshx:font-semibold')}>
                <TabIcon kind={tab.kind} />
                <span className="dshx:truncate">{tab.title}</span>
                {tab.status === null ? null : (
                  <span aria-hidden className={cn('dshx:ml-auto dshx:size-2 dshx:shrink-0 dshx:rounded-full', statusDotClass[tab.status])} />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
