/**
 * dshfiles (unslop round five C1, council round 4): a phone has no gutter beside the text column, so "Back to bottom"
 * floated over the last lines of prose. The composer (rich-composer's PhoneDockHead) publishes a trailing seat in the
 * dock's head row, `[data-composer-jump-seat]`, only while that row is in use; the control renders there instead.
 * @param from - an element inside the conversation (Chat's frame).
 * @returns the seat of the same conversation scroller, or null when the composer offers none.
 */
export function dockJumpSeat(from: Element | null): HTMLElement | null {
  return from?.closest('[data-conversation-scroll]')?.querySelector<HTMLElement>('[data-composer-jump-seat]') ?? null
}
