import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { OverflowGlyph } from './ui/overflow-glyph.js'
import { Spinner } from './ui/spinner.js'
import { SegmentLabel, Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.js'
import { StatusCount, StatusGlyph, WorkStatusModel, type WorkStatus } from './work-status.js'
import { useSlidingIndicator } from '../motion/react.js'

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
  /**
   * The primary action as a menu (`New ▾`: Markdown, HTML): the button opens these choices instead of running
   * `onSelect`. Only the primary action reads it; it never folds into the overflow menu.
   */
  readonly items?: readonly PageAction[]
}

export interface PageTab {
  readonly value: string
  readonly label: string
  readonly count?: number
  /**
   * What the tab's count is made of (`{ 'needs-you': 2, failed: 1 }`). When two or more statuses are present, the phone
   * shell draws them as a tally of `StatusCount`s, attention first (◆ 2 ✕ 1), in place of `count`, so a failure below
   * the fold shows at first glance; elsewhere the tab keeps the plain `count` (the desktop page title already shows the
   * tally). With one status or none, every shell shows `count`.
   */
  readonly statusCounts?: PageStatusCounts
}

export interface PageTabs {
  /** Accessible name of the tab list. */
  readonly label: string
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly items: readonly PageTab[]
  /**
   * `underline` for page sections; `segmented` only for up to four view modes of one list (council round 3 A5). Past
   * four items the tabs are always underline. Default: segmented up to four items, underline beyond.
   */
  readonly variant?: 'underline' | 'segmented'
}

/**
 * How wide a page runs. Two frames (council round 5 A2): `lane` (880px) for lists and forms, `wide` (min(100%, 1200px))
 * for data pages. `page` (1080px) stays for older callers; `full` is the whole pane (a diff, a chart, a table).
 */
export type PageWidth = 'page' | 'lane' | 'form' | 'wide' | 'full'

/** The statuses a page title counts, attention first: one `StatusCount` per status present. */
export type PageStatusCounts = Partial<Readonly<Record<WorkStatus, number>>>

const STATUS_COUNT_ORDER: readonly WorkStatus[] = ['needs-you', 'failed', 'working', 'ready', 'idle', 'done']

/** The statuses present in a count, attention first, zeros dropped. */
const presentStatuses = (statusCounts: PageStatusCounts | undefined): readonly (readonly [WorkStatus, number])[] =>
  STATUS_COUNT_ORDER.flatMap(status => {
    const count = statusCounts?.[status] ?? 0
    return count > 0 ? [[status, count] as const] : []
  })
const SEGMENTED_MAX = 4

/** The rail destinations whose tone a page title mark can take (`--dshx-nav-tone-<id>`, DESIGN.md › Navigation identity). */
export const NAV_TONE_IDS = ['threads', 'inbox', 'land', 'work', 'agents', 'observe', 'knowledge', 'settings'] as const
export type NavToneId = (typeof NAV_TONE_IDS)[number]

/** Each destination's glyph colour as a literal class, so Tailwind sees it (`text-nav-<id>`). */
export const NAV_TONE_TEXT_CLASS = {
  threads: 'dshx:text-nav-threads',
  inbox: 'dshx:text-nav-inbox',
  land: 'dshx:text-nav-land',
  work: 'dshx:text-nav-work',
  agents: 'dshx:text-nav-agents',
  observe: 'dshx:text-nav-observe',
  knowledge: 'dshx:text-nav-knowledge',
  settings: 'dshx:text-nav-settings',
} as const satisfies Record<NavToneId, string>

/** The page's identity mark (council round 7 A2): `mark` and `markTone` on `Page` and `PageHeader`. */
export interface PageTitleMarkProps {
  /** The destination glyph (a lucide icon), drawn at 18px before the h1. Decorative: the h1 names the page. */
  readonly mark?: React.ReactNode
  /** Colours the glyph in that destination's nav tone; without it, the secondary ink. */
  readonly markTone?: NavToneId
}

/**
 * The glyph before a page's h1 (council round 7 A2): the destination's own icon in its nav tone, 18px, 8px from the
 * title (the row's gap), centred on the title's first line so it sits on the title's baseline band when the title
 * wraps. The box is a literal 28px, the `text-title` line height: the kit sheet emits theme variables under the `dshx`
 * prefix and drops unused ones, so `h-(--text-title--line-height)` resolved to nothing and left the glyph 5px high
 * (Geist's caps centre at 14.2 of the 28px line; tests/compiled-sheet.test.tsx checks the compiled rule). A glyph only: no tile, no tinted header. Nav tones hold 3:1 on bg, panel and raised (tests/nav-tone.test.ts).
 */
export const PageTitleMark = ({ mark, markTone }: PageTitleMarkProps): React.ReactNode =>
  mark === undefined || mark === null || mark === false ? null : (
    <span
      data-slot="page-title-mark"
      aria-hidden="true"
      className={cn(
        'dshx:flex dshx:h-[28px] dshx:shrink-0 dshx:items-center dshx:self-start dshx:[&_svg]:size-[18px] dshx:[&_svg]:shrink-0',
        markTone === undefined ? 'dshx:text-muted-foreground' : NAV_TONE_TEXT_CLASS[markTone],
      )}
    >
      {mark}
    </span>
  )

export interface PageProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'title'>, PageTitleMarkProps {
  readonly heading: React.ReactNode
  readonly description?: React.ReactNode
  /** A count shown after the title in tertiary ink (e.g. how many items the page lists). */
  readonly count?: number | string
  /** Instead of `count`: one `StatusCount` per status present (`{ 'needs-you': 2, failed: 1 }`); zeros draw nothing. */
  readonly statusCounts?: PageStatusCounts
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
  /**
   * `lane` (880px of content, 960px on a pane of 1280px or more: lists), `form` (720px of content: label/control rows,
   * Settings), `wide` (min(100%, 1200px): data), `page` (1080px, the default for older callers) or
   * `full` (a diff, chart or table; `fill` defaults to it). Every frame starts at the same pane inset.
   */
  readonly width?: PageWidth
  readonly bodyClassName?: string
}

/**
 * The frame caps as classes, for a page that owns its layout (Settings with `PageHeader`, a split view): put the header
 * and the body in one start-aligned element with the same `dshx:p-6` inset `Page` uses, so its actions sit on the
 * frame's trailing edge.
 */
export const PAGE_FRAME_CLASS = {
  page: 'dshx:max-w-page',
  // Content-box (council round 6 A3): the cap is the content width, the padding sits outside it.
  lane: 'dshx:box-content dshx:max-w-lane dshx:@min-pane-wide:max-w-lane-wide',
  // The form frame (council round 9 A5): 720px of content on the lane's inset rules, for Settings' header, toolbar and rows.
  form: 'dshx:box-content dshx:max-w-form',
  wide: 'dshx:w-full dshx:max-w-wide',
  full: '',
} as const satisfies Record<PageWidth, string>

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

// Header actions take the one control height (council round 5 A1), so they line up with the page's fields and tabs.
const ActionButton = ({ action, primary }: { readonly action: PageAction; readonly primary: boolean }): React.JSX.Element => (
  <Button
    type="button"
    variant={action.destructive === true ? 'destructive' : primary ? 'default' : 'outline'}
    disabled={action.disabled === true || action.pending === true}
    onClick={action.onSelect}
    data-page-action={action.id}
  >
    <ActionIcon action={action} />
    {action.label}
  </Button>
)

/** A primary action that offers a few kinds (`New ▾`): one black button, its choices in a menu. */
const PrimaryMenu = ({ action, items }: { readonly action: PageAction; readonly items: readonly PageAction[] }): React.JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" disabled={action.disabled === true || action.pending === true} data-page-action={action.id}>
        <ActionIcon action={action} />
        {action.label}
        <ChevronDownIcon aria-hidden className="dshx:-mr-0.5 dshx:opacity-70" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="dshx-root">
      {items.map(item => (
        <DropdownMenuItem key={item.id} disabled={item.disabled === true || item.pending === true} onSelect={item.onSelect} data-page-action={item.id}>
          <ActionIcon action={item} />
          {item.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

/**
 * What a page title counts (council round 3 A5): one `StatusCount` per status present, attention first, or else a plain
 * count in tertiary ink. Shared by `Page` and the standalone `PageHeader`.
 */
export const PageTitleCount = (props: {
  readonly count?: number | string | undefined
  readonly statusCounts?: PageStatusCounts | undefined
}): React.ReactNode => {
  const statusCounts = presentStatuses(props.statusCounts)
  if (statusCounts.length > 0)
    return (
      <span data-slot="page-status-counts" className="dshx:flex dshx:items-center dshx:gap-1.5">
        {statusCounts.map(([status, count]) => (
          <StatusCount key={status} status={status} count={count} />
        ))}
      </span>
    )
  return props.count === undefined ? null : (
    <span data-slot="page-count" className="dshx:text-sm dshx:text-faint-foreground dshx:tabular-nums">
      {props.count}
    </span>
  )
}

/** The page header: `h1` title, count and meta chips, one-line description; one primary action and an overflow. */
const PageHeaderRow = (props: {
  readonly heading: React.ReactNode
  readonly mark?: React.ReactNode
  readonly markTone?: NavToneId | undefined
  readonly description?: React.ReactNode | undefined
  readonly count?: number | string | undefined
  readonly statusCounts?: PageStatusCounts | undefined
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
          <PageTitleMark mark={props.mark} {...(props.markTone === undefined ? {} : { markTone: props.markTone })} />
          <h1 className="dshx:min-w-0 dshx:text-title dshx:font-title dshx:break-words">{props.heading}</h1>
          <PageTitleCount count={props.count} statusCounts={props.statusCounts} />
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
                <Button type="button" size="icon" variant="ghost" aria-label={props.overflowLabel ?? 'More actions'}>
                  <OverflowGlyph />
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
          {props.primaryAction === undefined ? null : props.primaryAction.items === undefined ? (
            <ActionButton action={props.primaryAction} primary />
          ) : (
            <PrimaryMenu action={props.primaryAction} items={props.primaryAction.items} />
          )}
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
    mark,
    markTone,
    description,
    count,
    meta,
    primaryAction,
    actions,
    overflowLabel,
    tabs,
    scroll = false,
    fill = false,
    width,
    statusCounts,
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
    <div
      data-slot="page-body"
      className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:@max-pane-narrow:gap-3', fill && 'dshx:min-h-0 dshx:flex-1', bodyClassName)}
    >
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
        data-slot="page-container"
        className={cn(
          // Spacing scale (round five K9): page padding 24, 20 between the header and the sections, a 16px body stack;
          // narrow panes and phones keep 12. Width (council round 3 A5): header and body share one capped,
          // start-aligned container, so the header actions sit on the content's trailing edge, not the window's.
          'dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-5 dshx:p-6 dshx:@max-pane-narrow:gap-3 dshx:@max-pane-narrow:p-3',
          PAGE_FRAME_CLASS[width ?? (fill ? 'full' : 'page')],
          fill && 'dshx:min-h-0 dshx:flex-1',
        )}
      >
        <PageHeaderRow
          heading={heading}
          mark={mark}
          markTone={markTone}
          description={description}
          count={count}
          statusCounts={statusCounts}
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
            {/* Sideways only: overflow-x alone makes overflow-y auto, and the triggers' touch hit areas overflow it, so
                WebKit drew a vertical scrollbar beside every page's tabs. The tab ring draws inward, so nothing is cut. */}
            <div data-slot="page-tab-strip" className="dshx:min-w-0 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:pb-0.5">
              <PageTabList tabs={tabs} />
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

/**
 * The page's segmented tabs. The selected segment (council round 10 A3: `segment-thumb`, paper in light and a raised
 * #302C28 in dark) is one element that springs to the selected tab instead of each tab painting its own background, so
 * switching views reads as one motion. It sits in a positioned wrapper before the
 * list: the list's grey track paints under it and the (positioned) triggers over it.
 */
function PageTabList({ tabs }: { readonly tabs: PageTabs }) {
  const segmented = tabs.items.length <= SEGMENTED_MAX && tabs.variant !== 'underline'
  return segmented ? <SegmentedTabList tabs={tabs} /> : <UnderlineTabList tabs={tabs} />
}

/**
 * A tab's count. With two or more statuses in `statusCounts`, the phone shell (`html[data-shell-phone-nav]`) shows
 * their tally (council round 10, Inbox "Needs you": ◆ 2 · ✕ 1) and hides the plain count; every other shell keeps the
 * plain count. Compact inside a segment: each status glyph and its tabular number 4px apart with no pill fill or
 * padding, a muted "·" between pairs (the page title keeps its `StatusCount` pills). Both sit inside the tab's own
 * height, so the segment's height and hit area do not change.
 */
const TabCount = ({ count, statusCounts }: { readonly count: number | undefined; readonly statusCounts?: PageStatusCounts | undefined }): React.ReactNode => {
  const tally = presentStatuses(statusCounts)
  const plain = count === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{count}</span>
  if (tally.length < 2) return plain
  return (
    <>
      {count === undefined ? null : (
        <span data-slot="page-tab-count" className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums dshx:in-data-shell-phone-nav:hidden">
          {count}
        </span>
      )}
      <span data-slot="page-tab-status-counts" className="dshx:hidden dshx:items-center dshx:gap-1 dshx:text-xs dshx:tabular-nums dshx:in-data-shell-phone-nav:inline-flex">
        {tally.map(([status, value], index) => (
          <React.Fragment key={status}>
            {index === 0 ? null : (
              <span aria-hidden="true" className="dshx:text-muted-foreground">
                ·
              </span>
            )}
            <span data-slot="page-tab-status" data-status={status} className="dshx:inline-flex dshx:items-center dshx:gap-1">
              <StatusGlyph status={status} size="small" decorative />
              {value}
              <span className="dshx:sr-only"> {WorkStatusModel.label(status)}</span>
            </span>
          </React.Fragment>
        ))}
      </span>
    </>
  )
}

/**
 * Page sections as underline tabs (council round 3 A5): ink labels on a hairline, the active one in ink with a 2px
 * ink bar on the hairline, like the window tab strip (council round 7 A1: indigo means attention, focus and links).
 */
function UnderlineTabList({ tabs }: { readonly tabs: PageTabs }) {
  return (
    <TabsList variant="line" aria-label={tabs.label} className="dshx:h-9 dshx:w-full dshx:min-w-max dshx:justify-start dshx:gap-5 dshx:border-b dshx:border-border dshx:p-0">
      {tabs.items.map(tab => (
        <TabsTrigger
          key={tab.value}
          value={tab.value}
          className="dshx:h-full dshx:flex-none dshx:rounded-none dshx:border-0 dshx:px-0 dshx:after:bg-foreground dshx:data-[state=active]:text-foreground dshx:group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]"
        >
          {tab.label}
          <TabCount count={tab.count} statusCounts={tab.statusCounts} />
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

/** Up to four view modes of one list as the segmented control. */
function SegmentedTabList({ tabs }: { readonly tabs: PageTabs }) {
  const { ref, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(tabs.value)
  return (
    <div ref={ref} className="dshx:relative dshx:w-fit">
      <span
        aria-hidden
        ref={indicatorRef}
        className="dshx:pointer-events-none dshx:absolute dshx:border dshx:segment-thumb dshx:opacity-0"
      />
      <TabsList aria-label={tabs.label}>
        {tabs.items.map(tab => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            data-indicator-key={tab.value}
            className="dshx:flex-none dshx:data-[state=active]:border-transparent! dshx:data-[state=active]:bg-transparent! dshx:data-[state=active]:shadow-none!"
          >
            <SegmentLabel label={tab.label} />
            <TabCount count={tab.count} statusCounts={tab.statusCounts} />
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}

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
