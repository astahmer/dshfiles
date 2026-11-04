import * as React from 'react'
import { EllipsisIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { Spinner } from './ui/spinner.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.js'

/** One header action. The page shows at most one `primaryAction`; everything else is an overflow-capable action. */
export interface PageAction {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly onSelect: () => void
  readonly disabled?: boolean
  /** Shows a spinner in place of the icon and disables the action. */
  readonly pending?: boolean
  readonly destructive?: boolean
  /** `inline` (default) shows the action as a button while the page is wide; `overflow` always keeps it in the menu. */
  readonly placement?: 'inline' | 'overflow'
}

export interface PageTab {
  readonly value: string
  readonly label: string
  readonly count?: number
}

export interface PageTabs {
  /** Accessible name of the tab list. */
  readonly label: string
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly items: readonly PageTab[]
}

export interface PageProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> {
  readonly heading: React.ReactNode
  readonly description?: React.ReactNode
  /** A count shown after the title, muted (e.g. how many items the page lists). */
  readonly count?: number | string
  /** Muted chips after the title: counters, a status badge. Keep it to two or three. */
  readonly meta?: React.ReactNode
  readonly primaryAction?: PageAction
  readonly actions?: readonly PageAction[]
  /** Accessible name of the overflow menu button. */
  readonly overflowLabel?: string
  readonly tabs?: PageTabs
  /** The page owns its scroll (`h-full overflow-y-auto`). Leave off when the host pane already scrolls. */
  readonly scroll?: boolean
  /**
   * Master–detail pages: the page fills its pane's height and the body (or the active tab) takes the rest, so
   * its children own their scroll. Exclusive with `scroll`.
   */
  readonly fill?: boolean
  readonly bodyClassName?: string
}

/** Width of the `pane-compact` container tier (42rem): below it, inline header actions fold into the overflow menu. */
const COMPACT_WIDTH_PX = 672

/** Whether the element is narrower than the compact tier; false until measured and where ResizeObserver is absent. */
const useCompact = (ref: React.RefObject<HTMLElement | null>): boolean => {
  const [compact, setCompact] = React.useState(false)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = (width: number): void => setCompact(width > 0 && width < COMPACT_WIDTH_PX)
    measure(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1]
      if (entry !== undefined) measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return compact
}

const ActionIcon = ({ action }: { readonly action: PageAction }): React.ReactNode =>
  action.pending === true ? <Spinner aria-hidden className="dshx:size-3.5" /> : (action.icon ?? null)

const ActionButton = ({ action, primary }: { readonly action: PageAction; readonly primary: boolean }): React.JSX.Element => (
  <Button
    type="button"
    size="sm"
    variant={action.destructive === true ? 'destructive' : primary ? 'default' : 'outline'}
    disabled={action.disabled === true || action.pending === true}
    onClick={action.onSelect}
    data-page-action={action.id}
  >
    <ActionIcon action={action} />
    {action.label}
  </Button>
)

/** The page header: `h1` title, count and meta chips, one-line description; one primary action and an overflow. */
const PageHeaderRow = (props: {
  readonly heading: React.ReactNode
  readonly description?: React.ReactNode | undefined
  readonly count?: number | string | undefined
  readonly meta?: React.ReactNode | undefined
  readonly primaryAction?: PageAction | undefined
  readonly actions?: readonly PageAction[] | undefined
  readonly overflowLabel?: string | undefined
  readonly compact: boolean
}): React.JSX.Element => {
  const actions = props.actions ?? []
  const inline = props.compact ? [] : actions.filter(action => action.placement !== 'overflow')
  const overflow = props.compact ? actions : actions.filter(action => action.placement === 'overflow')
  return (
    <header data-slot="page-header" className="dshx:flex dshx:min-w-0 dshx:items-start dshx:justify-between dshx:gap-3">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1">
          <h1 className="dshx:min-w-0 dshx:text-xl dshx:font-semibold dshx:tracking-[-0.01em] dshx:break-words">{props.heading}</h1>
          {props.count === undefined ? null : (
            <span data-slot="page-count" className="dshx:text-sm dshx:text-muted-foreground dshx:tabular-nums">
              {props.count}
            </span>
          )}
          {props.meta === undefined || props.meta === null ? null : (
            <div data-slot="page-meta" className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1.5">
              {props.meta}
            </div>
          )}
        </div>
        {props.description === undefined || props.description === null ? null : (
          <p className="dshx:max-w-[72ch] dshx:text-sm dshx:text-muted-foreground">{props.description}</p>
        )}
      </div>
      {inline.length === 0 && overflow.length === 0 && props.primaryAction === undefined ? null : (
        <div data-slot="page-actions" className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
          {inline.map(action => (
            <ActionButton key={action.id} action={action} primary={false} />
          ))}
          {overflow.length === 0 ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={props.overflowLabel ?? 'More actions'}>
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dshx-root">
                {overflow.map(action => (
                  <DropdownMenuItem
                    key={action.id}
                    disabled={action.disabled === true || action.pending === true}
                    variant={action.destructive === true ? 'destructive' : 'default'}
                    onSelect={action.onSelect}
                  >
                    <ActionIcon action={action} />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {props.primaryAction === undefined ? null : <ActionButton action={props.primaryAction} primary />}
        </div>
      )}
    </header>
  )
}

/**
 * The one page template for plugin pages (main panels and stage details): header (title, optional description,
 * count/meta, at most one primary action plus overflow actions, optional tabs in the one segmented style) over a
 * body. It is its own container, so children size by the pane with `dshx:@max-pane-*:` and header actions fold
 * into the overflow menu below 42rem.
 */
export const Page = React.forwardRef<HTMLDivElement, PageProps>(function Page(
  {
    heading,
    description,
    count,
    meta,
    primaryAction,
    actions,
    overflowLabel,
    tabs,
    scroll = false,
    fill = false,
    bodyClassName,
    className,
    children,
    ...props
  },
  forwardedRef,
) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef !== null) forwardedRef.current = node
    },
    [forwardedRef],
  )
  const compact = useCompact(rootRef)
  const body = (
    <div data-slot="page-body" className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3', fill && 'dshx:min-h-0 dshx:flex-1', bodyClassName)}>
      {children}
    </div>
  )
  return (
    <div
      ref={setRef}
      data-slot="page"
      data-compact={compact ? '' : undefined}
      className={cn(
        'dshx-root dshx:@container dshx:min-w-0',
        scroll && 'dshx:h-full dshx:min-h-0 dshx:overflow-y-auto',
        fill && 'dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:p-5 dshx:@max-pane-narrow:gap-3 dshx:@max-pane-narrow:p-3',
          fill && 'dshx:min-h-0 dshx:flex-1',
        )}
      >
        <PageHeaderRow
          heading={heading}
          description={description}
          count={count}
          meta={meta}
          actions={actions}
          compact={compact}
          primaryAction={primaryAction}
          overflowLabel={overflowLabel}
        />
        {tabs === undefined ? (
          body
        ) : (
          <Tabs
            value={tabs.value}
            onValueChange={tabs.onValueChange}
            className={cn('dshx:min-w-0 dshx:gap-3', fill && 'dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col')}
          >
            <div className="dshx:min-w-0 dshx:overflow-x-auto dshx:pb-0.5">
              <TabsList aria-label={tabs.label}>
                {tabs.items.map(tab => (
                  <TabsTrigger key={tab.value} value={tab.value} className="dshx:flex-none">
                    {tab.label}
                    {tab.count === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{tab.count}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value={tabs.value} className={cn('dshx:min-w-0', fill && 'dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col')}>
              {body}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
})

export interface PageSectionProps extends Omit<React.ComponentPropsWithoutRef<'section'>, 'title'> {
  readonly heading: React.ReactNode
  readonly description?: React.ReactNode
  /** Muted text at the end of the heading row ("3 enabled"). */
  readonly meta?: React.ReactNode
  /** Section-level controls at the end of the heading row. */
  readonly actions?: React.ReactNode
}

/** A titled region of a page; the `h2` names the region for assistive technology. */
export const PageSection = React.forwardRef<HTMLElement, PageSectionProps>(function PageSection(
  { heading, description, meta, actions, className, children, ...props },
  ref,
) {
  const headingId = React.useId()
  return (
    <section
      ref={ref}
      data-slot="page-section"
      aria-labelledby={headingId}
      className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2', className)}
      {...props}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-x-3 dshx:gap-y-1">
        <div className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2">
          <h2 id={headingId} className="dshx:min-w-0 dshx:text-sm dshx:font-semibold dshx:break-words">
            {heading}
          </h2>
          {meta === undefined || meta === null ? null : <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{meta}</span>}
        </div>
        {actions === undefined || actions === null ? null : (
          <div className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:gap-1">{actions}</div>
        )}
      </div>
      {description === undefined || description === null ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{description}</p>}
      {children}
    </section>
  )
})

export interface EmptyStateProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
  /** One sentence that says what is missing and, where it helps, why. */
  readonly children: React.ReactNode
  readonly action?: { readonly label: string; readonly onSelect: () => void; readonly icon?: React.ReactNode }
}

/** The one empty state: a centred muted sentence and at most one action. It draws no frame; its container does. */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState({ children, action, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="empty-state"
      className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:items-center dshx:gap-3 dshx:px-4 dshx:py-8 dshx:text-center', className)}
      {...props}
    >
      <p className="dshx:max-w-[48ch] dshx:text-sm dshx:text-balance dshx:text-muted-foreground">{children}</p>
      {action === undefined ? null : (
        <Button type="button" size="sm" variant="outline" onClick={action.onSelect}>
          {action.icon ?? null}
          {action.label}
        </Button>
      )}
    </div>
  )
})
