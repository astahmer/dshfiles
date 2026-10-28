/** DOM focus follows renderer reveal, not React mount (Dockview initially attaches hidden overlays). */
export const watchStartSearchFocus = (input: HTMLInputElement): (() => void) => {
  const document = input.ownerDocument
  const view = document.defaultView
  if (view === null) return () => undefined
  let attached = false
  let revealed = false
  const sync = (): void => {
    let visible = input.isConnected && input.closest('[hidden],[inert],[aria-hidden="true"]') === null
    for (let ancestor: Element | null = input; visible && ancestor !== null; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') visible = false
    }
    // Metadata/resize changes in an already visible panel must never steal focus back from the user.
    if (visible && !revealed) input.focus({ preventScroll: true })
    revealed = visible
  }
  const observer = new view.MutationObserver(() => {
    if (!attached && input.isConnected) watch()
    sync()
  })
  const watch = (): void => {
    observer.disconnect()
    attached = input.isConnected
    if (!attached) {
      // Only while the renderer is detached: stop this broad attachment watch as soon as it joins the document.
      observer.observe(document.documentElement, { childList: true, subtree: true })
      return
    }
    for (let ancestor: Element | null = input; ancestor !== null; ancestor = ancestor.parentElement)
      observer.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'inert', 'aria-hidden'] })
  }
  watch()
  sync()
  return () => observer.disconnect()
}
