import { useState } from 'react'

import { BacklogSelection } from './selection.js'
import type { StartThreadItem } from './start-thread.js'

type SelectionState = { readonly ids: ReadonlySet<number>; readonly anchor: number | null }
type Modifiers = { readonly metaKey: boolean; readonly ctrlKey: boolean; readonly shiftKey: boolean }

export const backlogSelectionClick = (input: {
  readonly state: SelectionState
  readonly orderedIds: readonly number[]
  readonly openId: number | null
  readonly id: number
  readonly event: Modifiers
}): SelectionState => {
  const visible = new Set(input.orderedIds)
  const ids = new Set([...input.state.ids].filter(id => visible.has(id)))
  const openId = input.openId !== null && visible.has(input.openId) ? input.openId : null
  const anchor = input.state.anchor !== null && visible.has(input.state.anchor) ? input.state.anchor : openId
  if (input.event.shiftKey)
    return { ids: BacklogSelection.extend(BacklogSelection.seed(ids, openId), input.orderedIds, anchor ?? input.id, input.id), anchor: anchor ?? input.id }
  if (input.event.metaKey || input.event.ctrlKey) return { ids: BacklogSelection.toggle(BacklogSelection.seed(ids, openId), input.id), anchor: input.id }
  return { ids: new Set(), anchor: input.id }
}

export const useBacklogSelection = (input: { readonly items: readonly StartThreadItem[]; readonly openId: number | null; readonly scope: string }) => {
  const orderedIds = input.items.map(item => item.id)
  const visibleKey = JSON.stringify([input.scope, orderedIds])
  const [stored, setStored] = useState<{ key: string; state: SelectionState; scope: string }>({
    key: visibleKey,
    state: { ids: new Set<number>(), anchor: null },
    scope: input.scope,
  })
  const visible = new Set(orderedIds)
  const state: SelectionState =
    stored.scope !== input.scope
      ? { ids: new Set(), anchor: null }
      : {
          ids: new Set([...stored.state.ids].filter(id => visible.has(id))),
          anchor: stored.state.anchor !== null && visible.has(stored.state.anchor) ? stored.state.anchor : null,
        }
  if (stored.key !== visibleKey) setStored({ key: visibleKey, state, scope: input.scope })
  const clear = () => setStored({ key: visibleKey, state: { ids: new Set(), anchor: null }, scope: input.scope })
  return {
    selected: state.ids,
    clear,
    selection: input.items.filter(item => state.ids.has(item.id)),
    click: (id: number, event: Modifiers): boolean => {
      setStored({ key: visibleKey, state: backlogSelectionClick({ state, orderedIds, openId: input.openId, id, event }), scope: input.scope })
      if (event.metaKey || event.ctrlKey || event.shiftKey) return true
      return false
    },
  }
}
