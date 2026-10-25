/** Radix observes Escape during document capture, before the name editor's React handler. */
export const preserveAccountNameEditOnEscape = (event: KeyboardEvent): void => {
  if (event.target instanceof Element && event.target.closest('[data-account-name-editor]') !== null) event.preventDefault()
}
