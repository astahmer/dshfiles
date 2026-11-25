/** Content-sized model collapse for the composer's two control groups. */

/** A phone's bar (unslop r5 C3): the viewport the mark step serves, the same bound as the dock's Live work row. */
export const PHONE_BAR_QUERY = '(max-width: 27.99rem)'

/**
 * The row's flex items: a `display: contents` group (the new-thread bar dissolves its tool, run and mode groups into the
 * row, visual refresh T3.2) contributes its own children, which are the boxes that actually share the line.
 */
export function flowItems(parent: Element): Element[] {
  return Array.from(parent.children).flatMap(child =>
    getComputedStyle(child).display === 'contents' ? flowItems(child) : [child])
}

/**
 * Whether the row's controls take more than one line, as the browser laid them out. The line's demand is not the sum of
 * its items' widths: every pair costs a gap (empty plugin anchors included) and a control may carry a margin, so a
 * summed estimate read a wrapped bar as fitting. The collapse then disagreed with the layout it reacts to, and the bar
 * swapped between one and two lines on every pass. The tallest item is the single line's height; anything taller is a
 * second line plus the row gap.
 * @param row - Composer control row with its leading and trailing groups.
 * @returns Whether the row's items share more than one line.
 */
const wraps = (row: HTMLElement): boolean => {
  const style = getComputedStyle(row)
  const content = row.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  const tallest = flowItems(row).reduce((height, item) => {
    if (getComputedStyle(item).display === 'none') return height
    return Math.max(height, item.getBoundingClientRect().height)
  }, 0)
  return content > tallest + 1
}

/**
 * Collapse the model text only when the expanded controls cannot share a line.
 * The model seat consumes the row's inherited display variables; wrapping remains
 * available when even the icon cannot fit. Mutations and font loads are measured synchronously; a resize is measured
 * in the next frame, because the two collapse steps change the row's own size (and a wrapping row's height) inside
 * the observer's callback, which the browser reports as a ResizeObserver loop.
 * @param row - Composer control row with its leading and trailing groups.
 * @param options.iconStep - whether the row may take the second, icon-only step (default yes).
 * @param options.markStep - whether the bar is a phone's (unslop r5 C3): then it always takes the compact step and the
 *   mark step (`data-model-mark`), where the model chip is its brand mark with the name beside it (truncated at 96px)
 *   and the mode chip keeps its words; a bar those words would wrap (`data-model-mark-tight`, round five C1) shows the
 *   mark and the mode icon alone. The icon step stays for a model without a mark. Default no.
 * @returns Disconnect the layout observers and font listener.
 */
export function observeControlRow(
  row: HTMLElement,
  options: { readonly iconStep?: () => boolean; readonly markStep?: () => boolean } = {},
): () => void {
  const overflows = (): boolean => {
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    // An item that takes a line of its own (the phone place chip, b:4qjm) never competes for this one, and neither does
    // one positioned out of the line (Send on a narrow card sits against the card, beside the row's box: unslop phone 6).
    const widths = flowItems(row)
      .filter(child => !child.hasAttribute('data-row-break') || getComputedStyle(child).flexBasis !== '100%')
      .filter(child => !/^(absolute|fixed)$/u.test(getComputedStyle(child).position))
      .map(child => child.getBoundingClientRect().width)
      .filter(width => width > 0)
    const needed = widths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, widths.length - 1) * parseFloat(style.columnGap)
    return needed > available
  }
  // Ignore notifications caused by our own collapse. Re-expanding unchanged controls can
  // change a wrapping row's height again and feed its ResizeObserver indefinitely. The
  // row's own width is the only resize that can re-decide the collapse: an item's width
  // moves by a fraction of a pixel as the line re-flows, and re-measuring on that drift
  // re-decided the collapse each frame, which is what made the bar flicker.
  const rowWidth = (): number => row.getBoundingClientRect().width
  let measured = 0
  const measure = (): void => {
    // Always measure expanded demand, including text changed while collapsed.
    row.removeAttribute('data-model-compact')
    row.removeAttribute('data-model-icon')
    row.removeAttribute('data-model-mark')
    row.removeAttribute('data-model-mark-tight')
    if (options.markStep?.() === true) {
      row.setAttribute('data-model-compact', '')
      row.setAttribute('data-model-mark', '')
      // Round five C1 (council round 5): the mark names its model (up to 96px) and the mode chip keeps "Can edit" while
      // the line holds them; a bar they would wrap drops both words to their icons.
      row.toggleAttribute('data-model-mark-tight', wraps(row) || overflows())
      measured = rowWidth()
      return
    }
    // A wrapped row is ground truth; the summed estimate still covers a bar that cannot wrap, where the overflow is
    // what the icon step answers.
    if (!wraps(row) && !overflows()) {
      measured = rowWidth()
      return
    }
    // First step: labels beside icons go (the effort, the mode chip's words).
    row.setAttribute('data-model-compact', '')
    // Second step (composer follow-up b:gyk7): a bar that still overflows, such as a docked pane under ~220px, shows
    // the model as an icon too (its name stays in the accessible name and tooltip) instead of running past Send.
    // The new-thread bar has room below: it wraps instead (its words are choices to read before the first message).
    row.toggleAttribute('data-model-icon', (options.iconStep?.() ?? true) && overflows())
    measured = rowWidth()
  }
  let frame: number | undefined
  const resize = new ResizeObserver(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (Math.abs(rowWidth() - measured) >= 1) measure()
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
