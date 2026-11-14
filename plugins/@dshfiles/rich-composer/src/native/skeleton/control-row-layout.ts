/** Content-sized model collapse for the composer's two control groups. */

/**
 * The row's flex items: a `display: contents` group (the new-thread bar dissolves its tool, run and mode groups into the
 * row, visual refresh T3.2) contributes its own children, which are the boxes that actually share the line.
 */
export function flowItems(parent: Element): Element[] {
  return Array.from(parent.children).flatMap(child =>
    getComputedStyle(child).display === 'contents' ? flowItems(child) : [child])
}

/**
 * Collapse the model text only when the expanded controls cannot share a line.
 * The model seat consumes the row's inherited display variables; wrapping remains
 * available when even the icon cannot fit. Mutations and font loads are measured synchronously; a resize is measured
 * in the next frame, because the two collapse steps change the row's own size (and a wrapping row's height) inside
 * the observer's callback, which the browser reports as a ResizeObserver loop.
 * @param row - Composer control row with its leading and trailing groups.
 * @param options.iconStep - whether the row may take the second, icon-only step (default yes).
 * @returns Disconnect the layout observers and font listener.
 */
export function observeControlRow(row: HTMLElement, options: { readonly iconStep?: () => boolean } = {}): () => void {
  const overflows = (): boolean => {
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    // An item that takes a line of its own (the phone place chip, b:4qjm) never competes for this one.
    const widths = flowItems(row)
      .filter(child => !child.hasAttribute('data-row-break') || getComputedStyle(child).flexBasis !== '100%')
      .map(child => child.getBoundingClientRect().width)
      .filter(width => width > 0)
    const needed = widths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, widths.length - 1) * parseFloat(style.columnGap)
    return needed > available
  }
  // Ignore notifications caused by our own collapse. Re-expanding unchanged controls can
  // change a wrapping row's height again and feed its ResizeObserver indefinitely.
  const widths = (): number[] => [row.getBoundingClientRect().width, ...flowItems(row).map(item => item.getBoundingClientRect().width)]
  let measured: number[] = []
  const measure = (): void => {
    // Always measure expanded demand, including text changed while collapsed.
    row.removeAttribute('data-model-compact')
    row.removeAttribute('data-model-icon')
    if (!overflows()) {
      measured = widths()
      return
    }
    // First step: labels beside icons go (the effort, the mode chip's words).
    row.setAttribute('data-model-compact', '')
    // Second step (composer follow-up b:gyk7): a bar that still overflows, such as a docked pane under ~220px, shows
    // the model as an icon too (its name stays in the accessible name and tooltip) instead of running past Send.
    // The new-thread bar has room below: it wraps instead (its words are choices to read before the first message).
    row.toggleAttribute('data-model-icon', (options.iconStep?.() ?? true) && overflows())
    measured = widths()
  }
  let frame: number | undefined
  const resize = new ResizeObserver(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      const current = widths()
      if (current.length !== measured.length || current.some((width, index) => width !== measured[index])) measure()
    })
  })
  resize.observe(row)
  const observeItems = (): void => {
    for (const child of row.children) resize.observe(child)
    for (const item of flowItems(row)) resize.observe(item)
  }
  observeItems()
  const mutation = new MutationObserver(() => {
    observeItems()
    measure()
  })
  mutation.observe(row, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden'],
  })
  const fonts = document.fonts
  fonts.addEventListener('loadingdone', measure)
  measure()
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    resize.disconnect()
    mutation.disconnect()
    fonts.removeEventListener('loadingdone', measure)
  }
}
