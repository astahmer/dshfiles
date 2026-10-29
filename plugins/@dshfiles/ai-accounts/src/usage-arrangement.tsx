import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, TagIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'
import { useApi } from '@dshfiles/dshx/client'
import { errorMessage, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { usePreferences } from './use-preferences.js'
import type { UsageLayout } from './usage-overview-model.js'
import { aiAccountsApi, type AccountReorder } from './api.js'
import { acceptAccountOrder, aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { AccountOrderModel } from './account-order-model.js'

const DRAG_TYPE = 'application/x-dshfiles-ai-accounts-usage'

/** The page, sidebar and edge share the Host store order. Legacy cosmetic settings never become routing priority. */
export const useUsageLayout = () => {
  const { settings, hiddenUsageAccounts } = usePreferences()
  const api = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const fileQuery = useQuery(aiAccountsQueries.file(api))
  const accounts = fileQuery.data?.accounts ?? []
  const layout: UsageLayout = { order: accounts.map(account => account.instanceId), hidden: hiddenUsageAccounts }
  const pending = useIsMutating({ mutationKey: aiAccountsKeys.orderMutation }) > 0
  const reorder = useMutation({
    mutationKey: aiAccountsKeys.orderMutation,
    scope: { id: 'ai-accounts-order' },
    mutationFn: (input: AccountReorder) => api.reorderAccount(input),
    onSuccess: next => acceptAccountOrder(queryClient, next),
    onError: () => queryClient.invalidateQueries({ queryKey: aiAccountsKeys.file }),
  })
  const preference = useMutation({
    mutationFn: async (input: { readonly hidden: string[] } | { readonly shortNames: boolean }) => {
      const saved = 'hidden' in input ? await settings.set('hiddenUsageAccounts', input.hidden) : await settings.set('usageShortNames', input.shortNames)
      if (!saved) throw new Error('The Host refused to save this display preference.')
    },
  })
  const saveHidden = (ids: string[]): void => preference.mutate({ hidden: ids })
  const arrangementError = (): string | null => {
    if (reorder.isError) return `Could not change account priority: ${errorMessage(reorder.error, 'The Host may need updating. Retry after it is updated.')}`
    if (preference.isError) return errorMessage(preference.error, 'Could not save display preference.')
    if (fileQuery.isError) return 'Account priority is unavailable. Retry when the account Host is available.'
    return null
  }
  return {
    layout,
    pending,
    ready: fileQuery.data !== undefined && !fileQuery.isError,
    error: arrangementError(),
    movingId: reorder.variables?.instanceId ?? null,
    neighborIndex: (shownIds: readonly string[], id: string, direction: -1 | 1): number => AccountOrderModel.neighborIndex(accounts, shownIds, id, direction),
    hide: (id: string): void => saveHidden([...hiddenUsageAccounts.filter(hidden => hidden !== id), id]),
    show: (id: string): void => saveHidden(hiddenUsageAccounts.filter(hidden => hidden !== id)),
    showAll: (): void => saveHidden([]),
    setShortNamesShown: (shown: boolean): void => preference.mutate({ shortNames: shown }),
    move: (input: { readonly shownIds: readonly string[]; readonly id: string; readonly toIndex: number }): void => {
      if (pending || fileQuery.isError) return
      const target = AccountOrderModel.moveTarget(accounts, input)
      if (target !== null) reorder.mutate(target)
    },
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
  readonly threadAction?: { readonly disabled: boolean; readonly onSelect: () => void }
}): JSX.Element => {
  const [dropTarget, setDropTarget] = useState(false)
  const index = props.shownIds.indexOf(props.id)
  const move = (toIndex: number): void => props.arrangement.move({ shownIds: props.shownIds, id: props.id, toIndex })
  const previousIndex = props.arrangement.neighborIndex(props.shownIds, props.id, -1)
  const nextIndex = props.arrangement.neighborIndex(props.shownIds, props.id, 1)
  const disabled = props.arrangement.pending || !props.arrangement.ready
  const statusId = props.arrangement.movingId !== null && props.shownIds.includes(props.arrangement.movingId) ? props.arrangement.movingId : props.shownIds[0]
  const showStatus = statusId === props.id
  const hiddenCount = props.arrangement.layout.hidden.length
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(props.className, dropTarget && 'dshx:rounded-md dshx:ring-2 dshx:ring-ring/60')}
          aria-label={props.focusable === true ? `${props.name}: drag to reorder, or open the context menu to move or hide` : undefined}
          aria-busy={props.arrangement.pending && showStatus}
          draggable={!disabled}
          tabIndex={props.focusable === true ? 0 : undefined}
          onDragEnd={() => setDropTarget(false)}
          onDragLeave={() => setDropTarget(false)}
          onDragOver={event => {
            if (disabled || !event.dataTransfer.types.includes(DRAG_TYPE)) return
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
            if (disabled || dragged === '' || dragged === props.id || !props.shownIds.includes(dragged)) return
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
          {showStatus && props.arrangement.pending ? <span role="status">Saving account priority…</span> : null}
          {showStatus && props.arrangement.error !== null ? <span role="alert">{props.arrangement.error}</span> : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root">
        {props.threadAction === undefined ? null : (
          <>
            <ContextMenuItem disabled={props.threadAction.disabled} onSelect={props.threadAction.onSelect}>
              Use this account for this thread
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={disabled || previousIndex === -1} onSelect={() => move(previousIndex)}>
          {props.direction === 'row' ? <ArrowLeftIcon /> : <ArrowUpIcon />}
          {props.direction === 'row' ? 'Move left' : 'Move up'}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled || nextIndex === -1} onSelect={() => move(nextIndex)}>
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
