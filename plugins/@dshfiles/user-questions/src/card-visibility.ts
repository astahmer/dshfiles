/** Where one question card stands in the composer seat: published, withdrawn, or gone for good. */
type CardVisibility = { readonly kind: 'published'; readonly withdraw: () => void } | { readonly kind: 'hidden' } | { readonly kind: 'removed' }

/** The card's seat verbs; the registry decides when the card itself leaves. */
export interface CardSeat {
  /** Withdraw the panel from the seat; the request and its countdown stand. */
  hide(): void
  /** Publish the panel last, so it wins the seat against any other pending question. */
  reveal(): void
  /** Drop the card's seat for good: nothing publishes it again. */
  remove(): void
}

/**
 * Own the publication of one card as one state: a card is either in the seat, withdrawn from it, or gone.
 * @param options - the registry publish, and whether the card takes the seat on creation.
 * @returns the seat verbs.
 */
export const createCardSeat = (options: { readonly published: boolean; readonly publish: () => () => void }): CardSeat => {
  let state: CardVisibility = options.published ? { kind: 'published', withdraw: options.publish() } : { kind: 'hidden' }
  const withdraw = (): void => {
    if (state.kind !== 'published') return
    const published = state.withdraw
    published()
    state = { kind: 'hidden' }
  }
  return {
    hide: withdraw,
    reveal: () => {
      if (state.kind === 'removed') return
      withdraw()
      state = { kind: 'published', withdraw: options.publish() }
    },
    remove: () => {
      if (state.kind === 'removed') return
      const published = state.kind === 'published' ? state.withdraw : undefined
      state = { kind: 'removed' }
      published?.()
    },
  }
}
