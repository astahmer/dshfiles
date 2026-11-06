/**
 * Stage of the add-workspace pick flow: the menu, the directory flow it hands
 * off to, the adoption of a picked path, or the adoption error dialog. One
 * union keeps the flow's open/busy pair and the error dialog from drifting
 * apart, and the auto-open and occupant-lost rules stay single transitions.
 */

export type PickFlowState =
  | { readonly kind: 'menu' }
  | { readonly kind: 'flow' }
  | { readonly kind: 'adopting' }
  | { readonly kind: 'error'; readonly message: string }

export type PickFlowEvent =
  | { readonly type: 'add.select' }
  | { readonly type: 'owner.auto-open' }
  | { readonly type: 'flow.cancel' }
  | { readonly type: 'flow.picked' }
  | { readonly type: 'flow.adopted' }
  | { readonly type: 'flow.failed'; readonly message: string }
  | { readonly type: 'error.close' }
  | { readonly type: 'occupant.lost' }

export const PICK_FLOW_MENU: PickFlowState = { kind: 'menu' }

/** Whether the directory flow (native chooser or browse dialog) holds the surface. */
export const pickFlowOpen = (state: PickFlowState): boolean => state.kind === 'flow' || state.kind === 'adopting'

/** Whether the flow owns the interaction: open, or adopting a pick the Host has not answered yet. */
export const pickFlowBusy = (state: PickFlowState): boolean => pickFlowOpen(state)

/** Whether a picked path is being adopted, which keeps the owner's flow busy. */
export const pickFlowPicking = (state: PickFlowState): boolean => state.kind === 'adopting'

export const pickFlowError = (state: PickFlowState): string | null => (state.kind === 'error' ? state.message : null)

/**
 * Move the flow one event on. An adoption that is cancelled or loses its
 * occupant snaps back to the menu; its late outcome is then ignored, while the
 * owner still receives the picked path from the promise it started.
 */
export const pickFlowReduce = (state: PickFlowState, event: PickFlowEvent): PickFlowState => {
  switch (event.type) {
    case 'add.select':
    case 'owner.auto-open':
      return state.kind === 'menu' || state.kind === 'error' ? { kind: 'flow' } : state
    case 'flow.picked':
      return state.kind === 'flow' ? { kind: 'adopting' } : state
    case 'flow.adopted':
      return state.kind === 'adopting' ? PICK_FLOW_MENU : state
    case 'flow.failed':
      return state.kind === 'flow' || state.kind === 'adopting' ? { kind: 'error', message: event.message } : state
    case 'flow.cancel':
      return state.kind === 'flow' || state.kind === 'adopting' ? PICK_FLOW_MENU : state
    case 'error.close':
      return state.kind === 'error' ? PICK_FLOW_MENU : state
    case 'occupant.lost':
      return state.kind === 'flow' || state.kind === 'adopting' ? PICK_FLOW_MENU : state
  }
}
