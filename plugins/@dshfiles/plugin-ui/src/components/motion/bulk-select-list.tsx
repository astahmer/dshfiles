import * as React from 'react'
import { animate, motionSafe, springs, durations, easings, type AnimationPlaybackControls } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { CheckIcon, Trash2Icon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { RollingNumber } from './text.js'

export type BulkSelectTone = 'destructive' | 'violet' | 'info' | 'success' | 'warning' | 'teal' | 'muted'

export interface BulkSelectItem {
  readonly id: string
  readonly title: string
  readonly meta?: string
  /** Short tile text: `PDF`, `TS`, `MD`, a letter. */
  readonly tag: string
  readonly tone?: BulkSelectTone
}

export interface BulkSelectStaged {
  readonly ids: readonly string[]
}

export interface BulkSelectListProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  readonly heading: string
  readonly items: readonly BulkSelectItem[]
  readonly selectedIds: readonly string[]
  readonly onSelectionChange: (ids: readonly string[]) => void
  /** Delete pressed with the current selection. Stage them by passing `staged` back. */
  readonly onDelete?: (ids: readonly string[]) => void
  /** Rows deleted but still undoable: they fold into one stacked toast. `null` deals them back out. */
  readonly staged?: BulkSelectStaged | null
  readonly onUndo?: () => void
  /** The toast's trash button: delete for good now. */
  readonly onConfirm?: () => void
  /** Right side of the idle header ("View all"). */
  readonly headerAction?: React.ReactNode
  /** Plural noun for the toast ("files", "threads", "revisions"). */
  readonly noun?: string
  /** `false` drops the count/Delete header, for a list nested under a header the caller owns. */
  readonly showHeader?: boolean
}

const tileTone = {
  destructive: 'dshx:bg-destructive/10 dshx:text-destructive',
  violet: 'dshx:bg-violet/10 dshx:text-violet',
  info: 'dshx:bg-info/10 dshx:text-info',
  success: 'dshx:bg-success/10 dshx:text-success',
  warning: 'dshx:bg-warning/10 dshx:text-warning',
  teal: 'dshx:bg-teal/10 dshx:text-teal',
  muted: 'dshx:bg-muted dshx:text-muted-foreground',
} as const satisfies Record<BulkSelectTone, string>

/**
 * A selectable list with drag selection and an undoable bulk delete: press a row and drag across others to select
 * the range, Delete folds the chosen rows into one stacked toast ("3 files deleted · Undo"), and Undo deals them back
 * out one after another. Keyboard: Space toggles a row, Escape clears the selection.
 */
export function BulkSelectList({
  heading,
  items,
  selectedIds,
  onSelectionChange,
  onDelete,
  staged = null,
  onUndo,
  onConfirm,
  headerAction,
  noun = 'files',
  showHeader = true,
  className,
  ...props
}: BulkSelectListProps) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const stagedSet = React.useMemo(() => new Set(staged?.ids ?? []), [staged])
  const visible = items.filter(item => !stagedSet.has(item.id))
  const selectedVisible = visible.filter(item => selected.has(item.id)).map(item => item.id)
  const count = selectedVisible.length

  // Drag selection: the range between the pressed row and the row under the pointer takes the pressed row's new state.
  const drag = React.useRef<{ readonly start: number; readonly mode: boolean; readonly base: ReadonlySet<string>; pointer: number } | null>(null)
  const applyRange = (to: number) => {
    const d = drag.current
    if (d === null) return
    const [lo, hi] = d.start <= to ? [d.start, to] : [to, d.start]
    const next = new Set(d.base)
    visible.forEach((item, index) => {
      if (index < lo || index > hi) return
      if (d.mode) next.add(item.id)
      else next.delete(item.id)
    })
    onSelectionChange(Array.from(next))
  }
  const indexAt = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-index]')
    if (row == null || !listRef.current?.contains(row)) return -1
    return Number(row.dataset.rowIndex)
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const index = indexAt(event.clientX, event.clientY)
    const item = visible[index]
    if (item === undefined) return
    event.preventDefault()
    ;(event.currentTarget.querySelector<HTMLElement>(`[data-row-index="${index}"]`) ?? event.currentTarget).focus({ preventScroll: true })
    drag.current = { start: index, mode: !selected.has(item.id), base: selected, pointer: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    applyRange(index)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current === null || drag.current.pointer !== event.pointerId) return
    const index = indexAt(event.clientX, event.clientY)
    if (index >= 0) applyRange(index)
  }
  const endDrag = () => {
    drag.current = null
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(Array.from(next))
  }

  // Fold staged rows into the toast; deal restored rows back out.
  const previousStaged = React.useRef<ReadonlySet<string>>(stagedSet)
  const firstRun = React.useRef(true)
  React.useLayoutEffect(() => {
    const list = listRef.current
    if (list == null) return
    const before = previousStaged.current
    previousStaged.current = stagedSet
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-row-id]'))
    const controls: AnimationPlaybackControls[] = []
    if (firstRun.current) {
      firstRun.current = false
      for (const row of rows) if (stagedSet.has(row.dataset.rowId ?? '')) row.style.display = 'none'
      return
    }
    const anchor = list.querySelector<HTMLElement>('[data-stack-anchor]')
    const folding = rows.filter(row => stagedSet.has(row.dataset.rowId ?? '') && !before.has(row.dataset.rowId ?? ''))
    const dealing = rows.filter(row => !stagedSet.has(row.dataset.rowId ?? '') && before.has(row.dataset.rowId ?? ''))
    folding.forEach((row, i) => {
      const dy = anchor == null ? 0 : anchor.offsetTop - row.offsetTop
      const height = row.offsetHeight
      row.style.overflow = 'hidden'
      const c = animate(
        row,
        { transform: ['translateY(0px) scale(1)', `translateY(${dy * 0.6}px) scale(0.94)`], opacity: [1, 0], height: [height, 0] },
        motionSafe({ ...springs.snappy, delay: i * 0.045 }),
      )
      void c.finished.then(() => {
        row.style.display = 'none'
        row.style.height = ''
        row.style.transform = ''
        row.style.opacity = ''
      })
      controls.push(c)
    })
    dealing.forEach((row, i) => {
      row.style.display = ''
      row.style.height = ''
      const height = row.offsetHeight
      row.style.overflow = 'hidden'
      const c = animate(
        row,
        { height: [0, height], opacity: [0, 1], transform: ['translateY(-14px) scale(0.96)', 'translateY(0px) scale(1)'] },
        motionSafe({ ...springs.smooth, delay: 0.06 + i * 0.07 }),
      )
      void c.finished.then(() => {
        row.style.height = ''
        row.style.overflow = ''
        row.style.transform = ''
      })
      controls.push(c)
    })
    return () => {
      for (const c of controls) c.complete()
    }
  }, [stagedSet])

  // The toast lingers while it plays its exit after Undo.
  const [toast, setToast] = React.useState<{ readonly ids: readonly string[]; readonly leaving: boolean } | null>(
    staged && staged.ids.length > 0 ? { ids: staged.ids, leaving: false } : null,
  )
  React.useEffect(() => {
    if (staged && staged.ids.length > 0) setToast({ ids: staged.ids, leaving: false })
    else setToast(current => (current === null ? null : { ...current, leaving: true }))
  }, [staged])
  const found = toast === null ? -1 : items.findIndex(item => toast.ids.includes(item.id))
  const firstStagedIndex = toast !== null && found === -1 ? 0 : found
  const clearToast = React.useCallback(() => setToast(null), [])
  const toastNode =
    toast === null ? null : (
      <StackToast key="stack-toast" count={toast.ids.length} noun={noun} leaving={toast.leaving} onUndo={onUndo} onConfirm={onConfirm} onLeft={clearToast} />
    )

  const rowNodes: React.ReactNode[] = []
  if (toastNode !== null && items.length === 0) rowNodes.push(toastNode)
  let visibleIndex = 0
  items.forEach((item, index) => {
    if (index === firstStagedIndex && toastNode !== null) rowNodes.push(toastNode)
    const isStaged = stagedSet.has(item.id)
    const rowIndex = isStaged ? -1 : visibleIndex++
    rowNodes.push(
      <Row key={item.id} item={item} index={rowIndex} selected={!isStaged && selected.has(item.id)} staged={isStaged} onToggle={() => toggle(item.id)} />,
    )
  })

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx:@container dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-3xl dshx:border dshx:border-border dshx:bg-card dshx:p-2 dshx:text-card-foreground dshx:shadow-sm',
        className,
      )}
      onKeyDown={event => {
        if (event.key === 'Escape' && count > 0) onSelectionChange([])
      }}
      {...props}
    >
      {showHeader ? (
        <header className="dshx:flex dshx:h-11 dshx:items-center dshx:gap-2 dshx:px-3">
          <HeaderSwap swapKey={count > 0 ? 'selected' : 'idle'}>
            {count > 0 ? (
              <>
                <span className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-sm dshx:font-medium" aria-live="polite">
                  <RollingNumber value={count} /> selected
                </span>
                {onDelete === undefined ? null : (
                  <button
                    type="button"
                    onClick={() => onDelete(selectedVisible)}
                    className="dshx:ml-auto dshx:inline-flex dshx:h-8 dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:bg-destructive/10 dshx:px-3 dshx:text-sm dshx:font-medium dshx:text-destructive dshx:outline-none dshx:hover:bg-destructive/15 dshx:focus-visible:ring-2 dshx:focus-visible:ring-destructive/40"
                  >
                    <Trash2Icon aria-hidden className="dshx:size-4" />
                    Delete
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="dshx:inline-flex dshx:min-w-0 dshx:items-baseline dshx:gap-1.5 dshx:text-sm dshx:font-medium">
                  <span className="dshx:truncate">{heading}</span>
                  <RollingNumber value={visible.length} className="dshx:font-normal dshx:text-muted-foreground" />
                </span>
                {headerAction ? <span className="dshx:ml-auto dshx:shrink-0 dshx:text-sm dshx:text-muted-foreground">{headerAction}</span> : null}
              </>
            )}
          </HeaderSwap>
        </header>
      ) : null}
      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable
        aria-label={`${heading}, drag to select`}
        className="dshx:relative dshx:flex dshx:touch-pan-y dshx:flex-col dshx:select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {rowNodes}
      </div>
    </section>
  )
}

function HeaderSwap({ swapKey, children }: { readonly swapKey: string; readonly children: React.ReactNode }) {
  return <HeaderSwapInner key={swapKey}>{children}</HeaderSwapInner>
}

function HeaderSwapInner({ children }: { readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const c = animate(
      ref.current,
      { opacity: [0, 1], transform: ['translateY(4px)', 'translateY(0px)'] },
      motionSafe({ duration: durations.base, ease: easings.out }),
    )
    return () => c.complete()
  }, [])
  return (
    <div ref={ref} className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2">
      {children}
    </div>
  )
}

function Row({
  item,
  index,
  selected,
  staged,
  onToggle,
}: {
  readonly item: BulkSelectItem
  readonly index: number
  readonly selected: boolean
  readonly staged: boolean
  readonly onToggle: () => void
}) {
  const box = React.useRef<HTMLSpanElement>(null)
  const was = React.useRef(selected)
  React.useLayoutEffect(() => {
    if (was.current === selected || box.current == null) return
    was.current = selected
    const c = animate(box.current, { transform: ['scale(0.8)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => c.complete()
  }, [selected])
  return (
    <div
      data-row-id={item.id}
      data-row-index={staged ? undefined : index}
      role="option"
      aria-selected={selected}
      aria-hidden={staged || undefined}
      tabIndex={staged ? -1 : 0}
      onKeyDown={event => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onToggle()
        }
      }}
      className={cn(
        'dshx:flex dshx:cursor-default dshx:items-center dshx:gap-4 dshx:rounded-2xl dshx:px-3 dshx:py-2.5 dshx:outline-none dshx:transition-colors dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:@max-pane-narrow:gap-3',
        selected ? 'dshx:bg-muted' : 'dshx:hover:bg-muted/50',
      )}
    >
      <span
        ref={box}
        aria-hidden
        className={cn(
          'dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:border-2 dshx:transition-colors',
          selected ? 'dshx:border-foreground dshx:bg-foreground dshx:text-background' : 'dshx:border-border dshx:bg-card',
        )}
      >
        {selected ? <CheckIcon className="dshx:size-3.5" strokeWidth={3} /> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'dshx:inline-flex dshx:size-10 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:text-[11px] dshx:font-semibold dshx:tracking-wide',
          tileTone[item.tone ?? 'muted'],
        )}
      >
        {item.tag}
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <span className="dshx:truncate dshx:text-sm dshx:font-medium">{item.title}</span>
        {item.meta ? <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{item.meta}</span> : null}
      </span>
    </div>
  )
}

function StackToast({
  count,
  noun,
  leaving,
  onUndo,
  onConfirm,
  onLeft,
}: {
  readonly count: number
  readonly noun: string
  readonly leaving: boolean
  readonly onUndo: (() => void) | undefined
  readonly onConfirm: (() => void) | undefined
  readonly onLeft: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const layers = Math.min(2, Math.max(0, count - 1))
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const card = element.querySelector<HTMLElement>('[data-toast-card]')
    const sheets = Array.from(element.querySelectorAll<HTMLElement>('[data-toast-layer]'))
    if (!leaving) {
      const height = element.offsetHeight
      element.style.overflow = 'visible'
      const grow = animate(element, { height: [0, height] }, motionSafe(springs.snappy))
      const pop = card ? animate(card, { opacity: [0, 1], transform: ['scale(0.94)', 'scale(1)'] }, motionSafe({ ...springs.bouncy, delay: 0.08 })) : null
      const deal = sheets.length
        ? animate(
            sheets,
            { opacity: [0, 1], transform: ['translateY(-10px)', 'translateY(0px)'] },
            motionSafe({ ...springs.smooth, delay: (i: number) => 0.22 + i * 0.07 }),
          )
        : null
      void grow.finished.then(() => (element.style.height = ''))
      return () => {
        grow.complete()
        pop?.complete()
        deal?.complete()
      }
    }
    let cancelled = false
    const run = async () => {
      if (sheets.length)
        await animate(sheets, { opacity: 0, transform: 'translateY(-10px)' }, motionSafe({ duration: durations.fast, ease: easings.in })).finished
      if (card) await animate(card, { opacity: 0, transform: 'scale(0.96)' }, motionSafe({ duration: durations.fast, ease: easings.in })).finished
      const height = element.offsetHeight
      element.style.overflow = 'hidden'
      await animate(element, { height: [height, 0], marginBottom: 0 }, motionSafe(springs.snappy)).finished
      if (!cancelled) onLeft()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [leaving, onLeft])
  return (
    <div ref={ref} data-stack-anchor className={cn('dshx:relative', layers > 0 ? 'dshx:mb-3.5' : 'dshx:mb-1')} role="status" aria-live="polite">
      {layers > 1 ? (
        <span data-toast-layer aria-hidden className="dshx:absolute dshx:inset-x-9 dshx:-bottom-3 dshx:h-6 dshx:rounded-b-2xl dshx:bg-foreground/25" />
      ) : null}
      {layers > 0 ? (
        <span data-toast-layer aria-hidden className="dshx:absolute dshx:inset-x-5 dshx:-bottom-1.5 dshx:h-6 dshx:rounded-b-2xl dshx:bg-foreground/50" />
      ) : null}
      <div
        data-toast-card
        className="dshx:relative dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-2xl dshx:bg-foreground dshx:py-2.5 dshx:pr-2.5 dshx:pl-4 dshx:text-background dshx:shadow-lg"
      >
        <span className="dshx:inline-flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5 dshx:text-sm">
          <span className="dshx:inline-flex dshx:gap-1 dshx:font-medium">
            <RollingNumber value={count} /> {count === 1 ? noun.replace(/s$/, '') : noun}
          </span>
          <span className="dshx:truncate dshx:opacity-60">deleted</span>
        </span>
        <button
          type="button"
          onClick={onUndo}
          disabled={leaving}
          className="dshx:inline-flex dshx:h-8 dshx:items-center dshx:rounded-lg dshx:bg-background dshx:px-3.5 dshx:text-sm dshx:font-medium dshx:text-foreground dshx:outline-none dshx:hover:bg-background/90 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        >
          Undo
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete now"
              onClick={onConfirm}
              disabled={leaving || onConfirm === undefined}
              className="dshx:rounded-lg dshx:bg-destructive/20 dshx:text-destructive dshx:hover:bg-destructive/30 dshx:hover:text-destructive"
            >
              <Trash2Icon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete now</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
