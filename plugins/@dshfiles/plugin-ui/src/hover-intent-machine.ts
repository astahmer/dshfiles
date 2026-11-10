import { setup } from 'xstate'

export interface HoverIntentOptions {
  readonly openDelayMs: number
  readonly closeDelayMs: number
}

export type HoverIntentState = 'closed' | 'opening' | 'openHover' | 'openPinned' | 'closing'

type HoverIntentEvent =
  | { readonly type: 'hover' }
  | { readonly type: 'leave' }
  | { readonly type: 'pin' }
  | { readonly type: 'dismiss' }
  | { readonly type: 'hide' }

/**
 * Hover-open with a delayed open and a delayed close, plus a click-pinned open that hover-out does not dismiss.
 * `hide` closes from any state without a delay, for a menu whose owner disappears.
 */
export const createHoverIntentMachine = (options: HoverIntentOptions) =>
  setup({
    // SAFETY: XState reads this empty carrier only for inference; nothing dereferences its value.
    types: {} as { events: HoverIntentEvent },
    delays: { open: () => options.openDelayMs, close: () => options.closeDelayMs },
  }).createMachine({
    id: 'hoverIntent',
    initial: 'closed',
    states: {
      closed: {
        on: { hover: { target: 'opening' }, pin: { target: 'openPinned' } },
      },
      opening: {
        after: { open: { target: 'openHover' } },
        on: { leave: { target: 'closed' }, pin: { target: 'openPinned' }, dismiss: { target: 'closed' }, hide: { target: 'closed' } },
      },
      openHover: {
        on: { leave: { target: 'closing' }, pin: { target: 'openPinned' }, dismiss: { target: 'closed' }, hide: { target: 'closed' } },
      },
      openPinned: {
        on: { pin: { target: 'openPinned' }, dismiss: { target: 'closed' }, hide: { target: 'closed' } },
      },
      closing: {
        after: { close: { target: 'closed' } },
        on: { hover: { target: 'openHover' }, pin: { target: 'openPinned' }, dismiss: { target: 'closed' }, hide: { target: 'closed' } },
      },
    },
  })
