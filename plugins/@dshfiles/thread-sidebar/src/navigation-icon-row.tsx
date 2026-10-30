import { IconSettingsOutlineRegular, rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EllipsisVerticalIcon, SlidersHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SidebarOrganization, type NavigationOverflow } from './organization.js'

const ICON_BUTTON_SIZE = 32
const ICON_GAP = 2
const ICON_ROW_PADDING = 16
const DRAG_THRESHOLD_PX = 5

export interface NavigationItem {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly active: boolean
  readonly run: () => void
}

interface NavigationIconRowProps {
  readonly items: readonly NavigationItem[]
  readonly overflow: NavigationOverflow
  readonly orientation?: 'horizontal' | 'vertical'
  readonly labels: { readonly more: string; readonly filter: string; readonly empty: string; readonly customize: string; readonly navigation: string }
  readonly onCustomize: () => void
  readonly settings: { readonly label: string; readonly open: () => void } | null
  /** Pointer drag within the row; indices are positions among `items`. */
  readonly onReorder: (fromIndex: number, toIndex: number) => void
}

/** BB's collapsed navigation: one scrollable icon row plus a pinned ⋮ destination menu. */
export const NavigationIconRow = (props: NavigationIconRowProps): JSX.Element => {
  const settings = props.settings
  const orientation = props.orientation ?? 'horizontal'
  const vertical = orientation === 'vertical'
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [edges, setEdges] = useState({ start: false, end: false })
  const [menuOpen, setMenuOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dragRef = useRef<{ pointerId: number; index: number; startPosition: number; centers: number[] | null } | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)

  const endDrag = (): void => {
    dragRef.current = null
    setDrag(null)
  }

  const fitting = vertical
    ? props.items.length
    : props.overflow === 'menu'
      ? SidebarOrganization.fitItems({
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
      : SidebarOrganization.reorderSidebarEntry(
          fittingItems.map(item => item.id),
          drag.from,
          drag.to,
        ).flatMap(id => fittingItems.filter(item => item.id === id))
  const menuItems = vertical ? props.items : props.overflow === 'menu' ? props.items.slice(fitting) : props.items
  const showMenu = vertical || props.overflow !== 'scroll'
  const filteredMenuItems = rankByName(
    menuItems.map(item => ({ name: item.label, item })),
    filter.trim(),
  ).map(entry => entry.item)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || vertical) return
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
  }, [props.items.length, vertical])

  const fade = 16
  const maskImage =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'}, black ${fade}px, black calc(100% - ${fade}px), ${edges.end ? 'transparent' : 'black'})`
      : undefined

  return (
    <div
      className={cn(
        'dshx:flex dshx:w-full dshx:min-w-0 dshx:gap-0.5',
        vertical ? 'dshx:max-h-full dshx:flex-col dshx:items-center' : 'dshx:h-11 dshx:items-center dshx:px-2',
      )}
    >
      <div
        ref={scrollRef}
        className={cn(
          'dshx:flex dshx:min-w-0 dshx:gap-0.5 dshx:[scrollbar-width:none] dshx:[&::-webkit-scrollbar]:hidden',
          vertical
            ? 'dshx:max-h-[min(320px,calc(100vh-96px))] dshx:w-full dshx:min-h-0 dshx:flex-col dshx:items-center dshx:overflow-y-auto dshx:overscroll-y-contain'
            : cn(
                'dshx:flex-1 dshx:items-center',
                props.overflow === 'menu' ? 'dshx:overflow-hidden' : 'dshx:overflow-x-auto dshx:overflow-y-hidden dshx:overscroll-x-contain',
              ),
        )}
        style={{ maskImage, WebkitMaskImage: maskImage }}
        role="toolbar"
        aria-label={props.labels.navigation}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        onWheel={event => {
          if (vertical || props.overflow === 'menu' || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
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
                    dragRef.current = {
                      pointerId: event.pointerId,
                      index,
                      startPosition: vertical ? event.clientY : event.clientX,
                      centers: null,
                    }
                  }}
                  onPointerMove={event => {
                    const current = dragRef.current
                    if (current === null || current.pointerId !== event.pointerId) return
                    if (current.centers === null) {
                      if (Math.abs((vertical ? event.clientY : event.clientX) - current.startPosition) < DRAG_THRESHOLD_PX) return
                      current.centers = fittingItems.map((_, position) => {
                        const rect = itemRefs.current[position]?.getBoundingClientRect()
                        return rect === undefined ? Number.POSITIVE_INFINITY : vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2
                      })
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }
                    event.preventDefault()
                    setDrag({
                      from: current.index,
                      to: SidebarOrganization.dropIndexAt({
                        centers: current.centers,
                        fromIndex: current.index,
                        position: vertical ? event.clientY : event.clientX,
                      }),
                    })
                  }}
                  onPointerUp={event => {
                    const current = dragRef.current
                    if (current === null || current.pointerId !== event.pointerId) return
                    if (current.centers !== null) {
                      suppressClick.current = true
                      const to = SidebarOrganization.dropIndexAt({
                        centers: current.centers,
                        fromIndex: current.index,
                        position: vertical ? event.clientY : event.clientX,
                      })
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
              <TooltipContent side={vertical ? 'right' : 'bottom'}>{item.label}</TooltipContent>
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
          <PopoverContent align={vertical ? 'start' : 'end'} side={vertical ? 'right' : 'bottom'} sideOffset={6} className="dshx-root dshx:w-60 dshx:p-0">
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
                {settings === null ? null : (
                  <CommandItem
                    value="open-settings"
                    className="dshx:gap-2.5"
                    onSelect={() => {
                      setMenuOpen(false)
                      settings.open()
                    }}
                  >
                    <IconSettingsOutlineRegular size={16} />
                    <span>{settings.label}</span>
                  </CommandItem>
                )}
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
