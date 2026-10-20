export interface ListSelection<Id> {
  /** Selected ids in the order they were selected; never duplicated. */
  readonly ids: readonly Id[]
  /** Row a Shift range starts from: the last row selected or toggled. */
  readonly anchorId: Id | undefined
}

const stateOf = <Id>(ids: readonly Id[], anchorId: Id | undefined): ListSelection<Id> => ({ ids, anchorId })

export class ListSelectionModel {
  static empty<Id>(): ListSelection<Id> {
    return stateOf([], undefined)
  }

  static selectOnly<Id>(input: { readonly id: Id }): ListSelection<Id> {
    return stateOf([input.id], input.id)
  }

  static toggle<Id>(input: { readonly state: ListSelection<Id>; readonly id: Id }): ListSelection<Id> {
    const ids = input.state.ids.includes(input.id) ? input.state.ids.filter(id => id !== input.id) : [...input.state.ids, input.id]
    return stateOf(ids, input.id)
  }

  static extend<Id>(input: { readonly state: ListSelection<Id>; readonly orderedIds: readonly Id[]; readonly id: Id }): ListSelection<Id> {
    const targetIndex = input.orderedIds.indexOf(input.id)
    if (targetIndex < 0) return input.state
    const anchorId = input.state.anchorId ?? input.id
    const anchorIndex = input.orderedIds.indexOf(anchorId)
    if (anchorIndex < 0) return ListSelectionModel.selectOnly({ id: input.id })
    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    return stateOf(input.orderedIds.slice(start, end + 1), anchorId)
  }

  static selectAllVisible<Id>(input: { readonly orderedIds: readonly Id[] }): ListSelection<Id> {
    const ids = [...new Set(input.orderedIds)]
    return stateOf(ids, ids[0])
  }

  static isComplete<Id>(input: { readonly state: ListSelection<Id>; readonly orderedIds: readonly Id[] }): boolean {
    return input.orderedIds.length > 0 && input.orderedIds.every(id => input.state.ids.includes(id))
  }

  static toggleAllVisible<Id>(input: { readonly state: ListSelection<Id>; readonly orderedIds: readonly Id[] }): ListSelection<Id> {
    return ListSelectionModel.isComplete(input) ? ListSelectionModel.empty() : ListSelectionModel.selectAllVisible({ orderedIds: input.orderedIds })
  }

  static prune<Id>(input: { readonly state: ListSelection<Id>; readonly visibleIds: readonly Id[] }): ListSelection<Id> {
    const visible = new Set(input.visibleIds)
    const ids = input.state.ids.filter(id => visible.has(id))
    const anchorId = input.state.anchorId !== undefined && visible.has(input.state.anchorId) ? input.state.anchorId : undefined
    return stateOf(ids, anchorId)
  }
}
