/** Placement for the run row's model seat: the row keeps it only while it fits. */

/**
 * Report whether the run row holds its own segments and the model seat on one line.
 * The row never shrinks its segments, so a model seat added to a row that cannot
 * take it wraps to a second line and its trailing auto margin strands it there —
 * the bar reads this and keeps the seat in the tool row instead.
 * @param options.row - The run row element.
 * @param options.model - The seat's current box, in the row or in the tool row.
 * @param options.onChange - Called with whether the seat fits beside the row's segments.
 * @returns Disconnect the observers and font listener.
 */
export function observeRunRowPlacement(options: {
  readonly row: HTMLElement
  readonly model: () => HTMLElement | null
  readonly onChange: (fitsInRow: boolean) => void
}): () => void {
  const { row, model, onChange } = options
  const measure = (): void => {
    const seat = model()
    if (seat === null) {
      onChange(true)
      return
    }
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width
      - (Number.parseFloat(style.paddingLeft) || 0)
      - (Number.parseFloat(style.paddingRight) || 0)
    const gap = Number.parseFloat(style.columnGap) || 0
    let segments = 0
    let count = 0
    const visit = (element: Element): void => {
      if (element === seat) return
      if (getComputedStyle(element).display === 'contents') {
        for (const child of element.children) visit(child)
        return
      }
      const width = element.getBoundingClientRect().width
      if (width === 0) return
      segments += width
      count += 1
    }
    for (const child of row.children) visit(child)
    const needed = segments + seat.getBoundingClientRect().width + Math.max(0, count) * gap
    onChange(needed <= available)
  }
  const resize = new ResizeObserver(measure)
  resize.observe(row)
  const mutation = new MutationObserver(measure)
  mutation.observe(row, { subtree: true, childList: true, characterData: true, attributes: true })
  const seat = model()
  const seatMutations = new MutationObserver(measure)
  if (seat !== null) {
    resize.observe(seat)
    seatMutations.observe(seat, { subtree: true, childList: true, characterData: true, attributes: true })
  }
  const fonts = document.fonts
  fonts.addEventListener('loadingdone', measure)
  measure()
  return () => {
    resize.disconnect()
    mutation.disconnect()
    seatMutations.disconnect()
    fonts.removeEventListener('loadingdone', measure)
  }
}
