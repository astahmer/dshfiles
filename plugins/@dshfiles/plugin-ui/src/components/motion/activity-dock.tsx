import * as React from 'react'
import { animate, motionSafe, springs, durations, easings } from '../../motion/index.js'
import { useEnter, usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { CheckIcon, GitBranchIcon, ArrowUpRightIcon } from '../../icons.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js'

export interface ActivityDockTab {
  readonly id: string
  /** Accessible name and tooltip of the dock button. */
  readonly label: string
  readonly icon: React.ReactNode
  /** Count bubble on the button (unread, pending); hidden at 0. */
  readonly badge?: number
  /** Panel heading; defaults to `label`. */
  readonly title?: string
  /** Right side of the panel heading ("2 of 4", "+91 −9"). */
  readonly meta?: React.ReactNode
  readonly content: React.ReactNode
  /** Optional footer row (a "See all" link). */
  readonly footer?: React.ReactNode
}

export interface ActivityDockProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly tabs: readonly ActivityDockTab[]
  /** Open tab id, or null for the collapsed icon row. */
  readonly value: string | null
  readonly onValueChange: (value: string | null) => void
  /** Width of the open panel in px (clamped to the parent's width). */
  readonly panelWidth?: number
  readonly 'aria-label'?: string
}

/**
 * A floating dock of icon buttons that grows into a panel for the chosen one: width and height spring open from the
 * icon row, the selection pill glides between icons, the panel content blurs in, count badges pop. A thread's plan,
 * changes, subagents and workspace in one corner.
 */
export function ActivityDock({ tabs, value, onValueChange, panelWidth = 340, className, 'aria-label': ariaLabel = 'Activity', ...props }: ActivityDockProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const iconsRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)
  const pillRef = React.useRef<HTMLSpanElement>(null)
  const buttons = React.useRef(new Map<string, HTMLButtonElement>())
  const id = React.useId()
  const [openWidth, setOpenWidth] = React.useState(panelWidth)
  // Keep the last tab rendered while the panel collapses.
  const [shown, setShown] = React.useState<string | null>(value)
  if (value !== null && value !== shown) setShown(value)
  const open = value !== null
  const active = tabs.find(tab => tab.id === shown)
  const contentRef = React.useRef<HTMLDivElement>(null)
  useEnter(contentRef, 'blurIn', { duration: durations.base, ease: easings.out }, shown)

  React.useEffect(() => {
    const parent = rootRef.current?.parentElement
    if (parent == null || typeof ResizeObserver === 'undefined') return
    const update = () => setOpenWidth(Math.min(panelWidth, parent.clientWidth))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [panelWidth])

  // Width and height spring between the icon row and the open panel.
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    const root = rootRef.current
    const icons = iconsRef.current
    const body = bodyRef.current
    const inner = innerRef.current
    if (root == null || icons == null || body == null || inner == null) return
    const width = open ? openWidth : icons.offsetWidth + 2
    const height = open ? inner.offsetHeight : 0
    if (first.current) {
      first.current = false
      root.style.width = `${width}px`
      body.style.height = `${height}px`
      return
    }
    const a = animate(root, { width: `${width}px` }, motionSafe(springs.smooth))
    const b = animate(body, { height: `${height}px` }, motionSafe(springs.smooth))
    return () => {
      a.stop()
      b.stop()
    }
  }, [open, openWidth, shown])

  // Content that grows or shrinks inside an open panel (a plan step lands) eases the height along.
  React.useEffect(() => {
    const inner = innerRef.current
    const body = bodyRef.current
    if (inner == null || body == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (value === null) return
      animate(body, { height: `${inner.offsetHeight}px` }, motionSafe(springs.smooth))
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [value])

  // Selection pill glides between icons, fades when the dock closes.
  React.useLayoutEffect(() => {
    const pill = pillRef.current
    if (pill == null) return
    const button = value === null ? undefined : buttons.current.get(value)
    if (button === undefined) {
      const controls = animate(pill, { opacity: 0, transform: 'scale(0.85)' }, motionSafe({ duration: durations.fast }))
      return () => controls.stop()
    }
    const wasHidden = pill.style.opacity === '' || pill.style.opacity === '0'
    if (wasHidden) pill.style.left = `${button.offsetLeft}px`
    const controls = animate(pill, { left: `${button.offsetLeft}px`, opacity: 1, transform: 'scale(1)' }, motionSafe(springs.snappy))
    return () => controls.stop()
  }, [value])

  const select = (tabId: string) => onValueChange(value === tabId ? null : tabId)

  return (
    <TooltipProvider>
      <section
        ref={rootRef}
        aria-label={ariaLabel}
        onKeyDown={event => {
          if (event.key === 'Escape' && value !== null) {
            event.stopPropagation()
            onValueChange(null)
          }
        }}
        className={cn(
          'dshx:ml-auto dshx:flex dshx:max-w-full dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:shadow-lg dshx:shadow-foreground/5',
          className,
        )}
        {...props}
      >
        <div className={cn('dshx:flex dshx:justify-end dshx:transition-colors', open && 'dshx:border-b dshx:border-border')}>
          <div
            ref={iconsRef}
            role="tablist"
            aria-label="Dock"
            className="dshx:relative dshx:flex dshx:w-max dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:p-1"
          >
            <span
              ref={pillRef}
              aria-hidden
              style={{ opacity: 0 }}
              className="dshx:absolute dshx:top-1 dshx:left-0 dshx:size-8 dshx:rounded-lg dshx:bg-accent"
            />
            {tabs.map(tab => (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    ref={element => {
                      if (element) buttons.current.set(tab.id, element)
                      else buttons.current.delete(tab.id)
                    }}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${tab.id}`}
                    aria-selected={value === tab.id}
                    aria-controls={`${id}-panel`}
                    aria-label={tab.badge ? `${tab.label}, ${tab.badge} new` : tab.label}
                    onClick={() => select(tab.id)}
                    className="dshx:relative dshx:z-10 dshx:grid dshx:size-8 dshx:place-items-center dshx:rounded-lg dshx:text-muted-foreground dshx:outline-none dshx:transition-colors dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:aria-selected:text-foreground dshx:[&_svg]:size-4"
                  >
                    {tab.icon}
                    <DockBadge count={tab.badge ?? 0} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tab.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
        <div ref={bodyRef} className="dshx:overflow-hidden" style={{ height: 0 }}>
          <div
            ref={innerRef}
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={shown === null ? undefined : `${id}-tab-${shown}`}
            hidden={!open && active === undefined}
            style={{ width: openWidth }}
            className="dshx:max-w-full"
          >
            {active ? (
              <div ref={contentRef} key={active.id}>
                <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
                  <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold dshx:text-foreground">{active.title ?? active.label}</span>
                  {active.meta ? <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{active.meta}</span> : null}
                </div>
                <div className="dshx:px-4 dshx:py-3">{active.content}</div>
                {active.footer ? <div className="dshx:border-t dshx:border-border dshx:px-4 dshx:py-2.5">{active.footer}</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </TooltipProvider>
  )
}

function DockBadge({ count }: { readonly count: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'popIn', springs.bouncy, count)
  if (count <= 0) return null
  return (
    <span
      ref={ref}
      aria-hidden
      className="dshx:absolute dshx:-top-0.5 dshx:-right-0.5 dshx:grid dshx:h-4 dshx:min-w-4 dshx:place-items-center dshx:rounded-full dshx:bg-destructive dshx:px-1 dshx:text-[10px] dshx:leading-none dshx:font-semibold dshx:text-white dshx:ring-2 dshx:ring-card"
    >
      {count}
    </span>
  )
}

export interface DockChecklistItem {
  readonly id: string
  readonly label: string
  readonly state: 'pending' | 'active' | 'done'
}

/** A plan checklist for a dock panel: the active step shows a turning dotted ring, done steps get a check that pops. */
export function DockChecklist({ items, className }: { readonly items: readonly DockChecklistItem[]; readonly className?: string }) {
  return (
    <ol className={cn('dshx:flex dshx:flex-col dshx:gap-2', className)}>
      {items.map(item => (
        <li key={item.id} className="dshx:flex dshx:items-center dshx:gap-2.5 dshx:text-sm">
          <ChecklistMark state={item.state} />
          <span
            className={cn(
              'dshx:min-w-0 dshx:truncate dshx:transition-colors dshx:duration-300',
              item.state === 'active' ? 'dshx:font-medium dshx:text-foreground' : 'dshx:text-muted-foreground',
              item.state === 'done' && 'dshx:line-through dshx:decoration-muted-foreground/50',
            )}
          >
            {item.label}
          </span>
          <span className="dshx:sr-only">{item.state === 'done' ? 'done' : item.state === 'active' ? 'in progress' : 'pending'}</span>
        </li>
      ))}
    </ol>
  )
}

function ChecklistMark({ state }: { readonly state: DockChecklistItem['state'] }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const ringRef = React.useRef<SVGSVGElement>(null)
  const reduced = usePrefersReducedMotion()
  useEnter(ref, 'popIn', springs.bouncy, state)
  React.useEffect(() => {
    if (state !== 'active' || reduced || ringRef.current == null) return
    const controls = animate(ringRef.current, { rotate: [0, 360] }, { duration: 3.2, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [state, reduced])
  return (
    <span ref={ref} aria-hidden className="dshx:grid dshx:size-4 dshx:shrink-0 dshx:place-items-center">
      {state === 'done' ? (
        <span className="dshx:grid dshx:size-4 dshx:place-items-center dshx:rounded-full dshx:bg-foreground dshx:text-background">
          <CheckIcon className="dshx:size-2.5" strokeWidth={3} />
        </span>
      ) : state === 'active' ? (
        <span className="dshx:relative dshx:grid dshx:size-4 dshx:place-items-center dshx:text-destructive">
          <svg ref={ringRef} viewBox="0 0 16 16" className="dshx:absolute dshx:inset-0 dshx:size-4">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="0.1 3.3" />
          </svg>
          <span className="dshx:size-1 dshx:rounded-full dshx:bg-current" />
        </span>
      ) : (
        <span className="dshx:size-4 dshx:rounded-full dshx:border-[1.5px] dshx:border-muted-foreground/60" />
      )}
    </span>
  )
}

export interface DockFileChange {
  readonly path: string
  readonly added: number
  readonly removed: number
}

export interface DockChangeGroup {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly hint?: string
  readonly name?: string
  readonly branch?: string
  readonly files: readonly DockFileChange[]
  /** Files not listed ("+1 more in this source"). */
  readonly more?: number
  readonly onOpenBranch?: () => void
}

/** Changed files grouped by destination for a dock panel; rows rise in with a stagger. */
export function DockChanges({ groups, className }: { readonly groups: readonly DockChangeGroup[]; readonly className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useEnter(ref, 'riseIn', { children: true, stagger: 0.05 })
  return (
    <div ref={ref} className={cn('dshx:flex dshx:flex-col dshx:gap-4', className)}>
      {groups.map(group => (
        <div key={group.id} className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-sm">
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground dshx:[&_svg]:size-3.5">
            {group.icon}
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium">{group.label}</span>
            <span className="dshx:shrink-0 dshx:text-xs">{fileCount(group.files.length + (group.more ?? 0))}</span>
          </div>
          {group.hint ? <p className="dshx:text-xs dshx:text-muted-foreground">{group.hint}</p> : null}
          {group.name ? <span className="dshx:mt-1 dshx:truncate dshx:font-semibold dshx:text-foreground">{group.name}</span> : null}
          {group.branch ? (
            <button
              type="button"
              onClick={group.onOpenBranch}
              className="dshx:flex dshx:w-fit dshx:max-w-full dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:[&_svg]:size-3"
            >
              <GitBranchIcon aria-hidden />
              <span className="dshx:min-w-0 dshx:truncate">{group.branch}</span>
              <ArrowUpRightIcon aria-hidden />
            </button>
          ) : null}
          <ul className="dshx:mt-1 dshx:flex dshx:flex-col dshx:gap-1">
            {group.files.map(file => (
              <li key={file.path} className="dshx:flex dshx:items-center dshx:gap-2">
                <span
                  aria-hidden
                  className="dshx:grid dshx:h-4 dshx:shrink-0 dshx:place-items-center dshx:rounded-[3px] dshx:bg-info/15 dshx:px-0.5 dshx:font-mono dshx:text-[9px] dshx:font-semibold dshx:text-info"
                >
                  {extension(file.path)}
                </span>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-foreground">{file.path}</span>
                <span className="dshx:shrink-0 dshx:font-mono dshx:text-xs dshx:tabular-nums">
                  {file.added > 0 ? <span className="dshx:text-success">+{file.added}</span> : null}
                  {file.added > 0 && file.removed > 0 ? ' ' : null}
                  {file.removed > 0 ? <span className="dshx:text-destructive">−{file.removed}</span> : null}
                </span>
              </li>
            ))}
            {group.more ? <li className="dshx:pl-6 dshx:text-xs dshx:text-muted-foreground">+{group.more} more in this source</li> : null}
          </ul>
        </div>
      ))}
    </div>
  )
}

const fileCount = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

const extension = (path: string) => (path.split('.').pop() ?? '').slice(0, 3).toUpperCase()
