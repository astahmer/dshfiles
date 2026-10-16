import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, TagIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'
import { usePreferences } from './use-preferences.js'
import { UsageOverviewModel, type UsageLayout } from './usage-overview-model.js'

const DRAG_TYPE = 'application/x-dshfiles-ai-accounts-usage'

/** The shared order and hidden list behind the usage strip and popover; a write the Host refuses leaves them as they were. */
export const useUsageLayout = () => {
  const { settings, usageOrder, hiddenUsageAccounts } = usePreferences()
  const layout: UsageLayout = { order: usageOrder, hidden: hiddenUsageAccounts }
  const saveHidden = (ids: string[]): void => void settings.set('hiddenUsageAccounts', ids).catch(() => false)
  return {
    layout,
    hide: (id: string): void => saveHidden([...hiddenUsageAccounts.filter(hidden => hidden !== id), id]),
    show: (id: string): void => saveHidden(hiddenUsageAccounts.filter(hidden => hidden !== id)),
    showAll: (): void => saveHidden([]),
    setShortNamesShown: (shown: boolean): void => void settings.set('usageShortNames', shown).catch(() => false),
    move: (input: { readonly shownIds: readonly string[]; readonly id: string; readonly toIndex: number }): void =>
      void settings.set('usageOrder', UsageOverviewModel.moveAccount({ order: usageOrder, ...input })).catch(() => false),
  }
}

export type UsageArrangement = ReturnType<typeof useUsageLayout>

/**
 * One account on a usage surface: dragged onto another account to take its
 * place, and right-clicked (or Shift+F10 / the menu key) for move, hide and
 * show-all.
 */
export const ArrangeableAccount = (props: {
  readonly arrangement: UsageArrangement
  readonly shownIds: readonly string[]
  readonly id: string
  readonly name: string
  readonly direction: 'row' | 'column'
  /** Set on the strip, where short names show: offers hiding or showing them. */
  readonly shortNames?: boolean
  /** Give the wrapper a tab stop when its child is not focusable itself. */
  readonly focusable?: boolean
  readonly className?: string
  readonly children: ReactNode
}): JSX.Element => {
  const [dropTarget, setDropTarget] = useState(false)
  const index = props.shownIds.indexOf(props.id)
  const move = (toIndex: number): void => props.arrangement.move({ shownIds: props.shownIds, id: props.id, toIndex })
  const hiddenCount = props.arrangement.layout.hidden.length
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(props.className, dropTarget && 'dshx:rounded-md dshx:ring-2 dshx:ring-ring/60')}
          aria-label={props.focusable === true ? `${props.name}: drag to reorder, or open the context menu to move or hide` : undefined}
          draggable
          tabIndex={props.focusable === true ? 0 : undefined}
          onDragEnd={() => setDropTarget(false)}
          onDragLeave={() => setDropTarget(false)}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropTarget(true)
          }}
          onDragStart={event => {
            event.dataTransfer.setData(DRAG_TYPE, props.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDrop={event => {
            event.preventDefault()
            setDropTarget(false)
            const dragged = event.dataTransfer.getData(DRAG_TYPE)
            if (dragged === '' || dragged === props.id || !props.shownIds.includes(dragged)) return
            props.arrangement.move({ shownIds: props.shownIds, id: dragged, toIndex: index })
          }}
          onKeyDown={event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }))
          }}
        >
          {props.children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root">
        <ContextMenuItem disabled={index <= 0} onSelect={() => move(index - 1)}>
          {props.direction === 'row' ? <ArrowLeftIcon /> : <ArrowUpIcon />}
          {props.direction === 'row' ? 'Move left' : 'Move up'}
        </ContextMenuItem>
        <ContextMenuItem disabled={index === -1 || index >= props.shownIds.length - 1} onSelect={() => move(index + 1)}>
          {props.direction === 'row' ? <ArrowRightIcon /> : <ArrowDownIcon />}
          {props.direction === 'row' ? 'Move right' : 'Move down'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => props.arrangement.hide(props.id)}>
          <EyeOffIcon />
          Hide {props.name}
        </ContextMenuItem>
        <ContextMenuItem disabled={hiddenCount === 0} onSelect={props.arrangement.showAll}>
          <EyeIcon />
          {hiddenCount === 0 ? 'Show all hidden' : `Show all hidden (${String(hiddenCount)})`}
        </ContextMenuItem>
        {props.shortNames === undefined ? null : (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => props.arrangement.setShortNamesShown(props.shortNames !== true)}>
              <TagIcon />
              {props.shortNames ? 'Hide short names' : 'Show short names'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
