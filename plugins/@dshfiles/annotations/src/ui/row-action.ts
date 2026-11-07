export type RowAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'dismissing'; readonly id: string; readonly reason: string }
  | { readonly kind: 'replying'; readonly id: string; readonly body: string }

export type RowActionEvent =
  | { readonly type: 'dismiss'; readonly id: string }
  | { readonly type: 'reply'; readonly id: string }
  | { readonly type: 'reason'; readonly reason: string }
  | { readonly type: 'body'; readonly body: string }
  | { readonly type: 'settled' }

export const noRowAction: RowAction = { kind: 'none' }

export const rowActionReducer = (state: RowAction, event: RowActionEvent): RowAction => {
  switch (event.type) {
    case 'dismiss':
      return { kind: 'dismissing', id: event.id, reason: '' }
    case 'reply':
      return { kind: 'replying', id: event.id, body: '' }
    case 'reason':
      return state.kind === 'dismissing' ? { kind: 'dismissing', id: state.id, reason: event.reason } : state
    case 'body':
      return state.kind === 'replying' ? { kind: 'replying', id: state.id, body: event.body } : state
    case 'settled':
      return noRowAction
  }
}
