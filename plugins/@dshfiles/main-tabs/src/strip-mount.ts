/**
 * The frame has no seat above the main panel, so the strip lives in a node placed right before the `main` slot outlet.
 * The slot renderer wraps every outlet in `<div data-slot="<key>" style="display:contents">` (dsh-client-ui-renderer
 * `SlotOutlet`), and only the `root` occupant may render `main`, so this anchor is unique and does not depend on the
 * frame's own markup. React only inserts its nodes relative to its own siblings, so the foreign node survives panel
 * changes.
 */
const MAIN_OUTLET_SELECTOR = '[data-slot="main"]'
const HOST_ATTRIBUTE = 'data-dshfiles-main-tabs'

export const STRIP_MISSING_WARNING =
  'main-tabs: the tab strip cannot mount: there is no [data-slot="main"] outlet in the page. DSH changed how it renders the main view; tabs still follow it and the tab shortcuts still work, but the strip stays hidden. See "Host limits" in the @dshfiles/main-tabs README.'

export const STRIP_MISPLACED_WARNING =
  'main-tabs: the tab strip mounted but does not sit above the main panel. DSH changed the main column layout; see "Host limits" in the @dshfiles/main-tabs README.'

interface StripMountOptions {
  readonly document: Document
  readonly onHost: (host: HTMLElement | null) => void
  /** Called once when no outlet appeared within `missingAfterMs`. */
  readonly onMissing: () => void
  readonly missingAfterMs: number
}

/** Keep a strip host right before the `main` outlet, re-attaching when the frame replaces the outlet or its column. */
export const mountStripHost = (options: StripMountOptions): (() => void) => {
  const { document } = options
  let created: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let missingTimer: ReturnType<typeof setTimeout> | null = null

  const watch = (onChange: () => void, targets: ReadonlyArray<readonly [Node, MutationObserverInit]>): void => {
    observer?.disconnect()
    observer = new MutationObserver(onChange)
    for (const [node, init] of targets) observer.observe(node, init)
  }

  const attach = (): boolean => {
    const outlet = document.querySelector(MAIN_OUTLET_SELECTOR)
    const column = outlet?.parentElement
    if (outlet === null || column === null || column === undefined) return false
    const existing = column.querySelector(`:scope > [${HOST_ATTRIBUTE}]`)
    const host = existing instanceof HTMLElement ? existing : document.createElement('div')
    if (host !== existing) {
      host.setAttribute(HOST_ATTRIBUTE, '')
      host.style.display = 'contents'
      created?.remove()
      created = host
    }
    if (host.nextElementSibling !== outlet) column.insertBefore(host, outlet)
    if (missingTimer !== null) clearTimeout(missingTimer)
    missingTimer = null
    options.onHost(host)
    // Panel switches change the column's children; a replaced column changes its parent's.
    const parent = column.parentElement
    watch(
      () => {
        if (outlet.parentElement === column && host.parentElement === column && host.nextElementSibling === outlet) return
        options.onHost(null)
        if (!attach()) waitForOutlet()
      },
      parent === null
        ? [[column, { childList: true }]]
        : [
            [column, { childList: true }],
            [parent, { childList: true }],
          ],
    )
    return true
  }

  // A whole-document watcher is costly while chat streams, so it only runs while the outlet is missing.
  const waitForOutlet = (): void => watch(() => void attach(), [[document.body, { childList: true, subtree: true }]])

  if (!attach()) {
    waitForOutlet()
    missingTimer = setTimeout(() => {
      missingTimer = null
      options.onMissing()
    }, options.missingAfterMs)
  }

  return () => {
    observer?.disconnect()
    if (missingTimer !== null) clearTimeout(missingTimer)
    created?.remove()
  }
}

/** The first box a `display: contents` chain lays out, or null when there is none. */
const firstLaidOutElement = (element: Element | null): Element | null => {
  let cursor = element
  while (cursor !== null && getComputedStyle(cursor).display === 'contents') cursor = cursor.firstElementChild
  return cursor
}

/** Whether the rendered strip sits on top of the main panel, sharing its column. */
export const stripSitsAbovePanel = (host: HTMLElement): boolean => {
  const strip = firstLaidOutElement(host.firstElementChild)
  const outlet = host.nextElementSibling
  const panel = outlet?.matches(MAIN_OUTLET_SELECTOR) === true ? firstLaidOutElement(outlet.firstElementChild) : null
  if (strip === null || panel === null) return false
  const stripBox = strip.getBoundingClientRect()
  const panelBox = panel.getBoundingClientRect()
  const sharedWidth = Math.min(stripBox.right, panelBox.right) - Math.max(stripBox.left, panelBox.left)
  return stripBox.height > 0 && stripBox.bottom <= panelBox.top + 1 && sharedWidth >= Math.min(stripBox.width, panelBox.width) - 1
}
