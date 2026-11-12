/**
 * dshfiles (productivity pass T4.1): land a find hit in the transcript. The hit's Turn may be unloaded (paged in through
 * the rail's navigation), folded under "Worked for…" (a `hidden="until-found"` group body whose rows mount only once it
 * opens, or a finished Turn's process row that mounts its work only when its own toggle opens it), inside a folded long
 * prompt (an `overflow: hidden` body that opens when scrolled) or inside a closed tool
 * row. Every frame this retries: find the row, open what hides it with the same `beforematch` event browser find
 * sends (each fold's own reveal runs), then highlight the matching text with the CSS Custom Highlight API, which
 * styles a Range without touching React's DOM.
 */
import { CHAT_FOCUS_ATTRIBUTE } from '../../chat-focus-reveal.ts'

/** Highlight registry names; ChatView.module.css styles `::highlight()` of both. */
export const FIND_CURRENT_HIGHLIGHT = 'dshfiles-find-current'
export const FIND_MATCH_HIGHLIGHT = 'dshfiles-find-match'

const REVEAL_TIMEOUT_MS = 6_000
/** Frames a visible row may show no matching text before its closed disclosures are tried, then the row is outlined. */
const TEXT_GRACE_FRAMES = 4

interface HighlightRegistry {
  set(name: string, value: unknown): void
  delete(name: string): boolean
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown
}

const highlightApi = (): { readonly registry: HighlightRegistry; readonly Highlight: HighlightConstructor } | null => {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (globalThis as { Highlight?: HighlightConstructor }).Highlight
  return css?.highlights === undefined || Highlight === undefined ? null : { registry: css.highlights, Highlight }
}

const STYLE_ATTRIBUTE = 'data-dshfiles-find-highlight'

/**
 * `::highlight()` names the page-wide registry, which a CSS module cannot address, so the two rules are injected once.
 * The current match is a selection (DESIGN.md: accent marks focus and selection); the other matches are a neutral wash.
 */
const ensureHighlightStyle = (doc: Document): void => {
  if (doc.head.querySelector(`style[${STYLE_ATTRIBUTE}]`) !== null) return
  const style = doc.createElement('style')
  style.setAttribute(STYLE_ATTRIBUTE, '')
  style.textContent = [
    `::highlight(${FIND_CURRENT_HIGHLIGHT}) { background-color: var(--dshx-tone-accent-bg, var(--dsw-alias-interactive-bg-hover-solid)); color: var(--dsw-alias-label-primary); text-decoration: underline 2px var(--dsw-alias-state-business-primary); }`,
    `::highlight(${FIND_MATCH_HIGHLIGHT}) { background-color: var(--dsw-alias-interactive-bg-hover); }`,
  ].join(' ')
  doc.head.append(style)
}

/** Remove the find highlights from the page. */
export const clearFindHighlight = (): void => {
  const api = highlightApi()
  api?.registry.delete(FIND_CURRENT_HIGHLIGHT)
  api?.registry.delete(FIND_MATCH_HIGHLIGHT)
}

const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'])

/**
 * Every occurrence of the terms in an element's text, in document order; the first term that occurs wins, so a
 * phrase is preferred to its words.
 */
export const findTextRanges = (root: Element, terms: readonly string[]): Range[] => {
  const doc = root.ownerDocument
  for (const term of terms) {
    if (term === '') continue
    const ranges: Range[] = []
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (node.parentElement !== null && SKIPPED.has(node.parentElement.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? '').toLowerCase()
      let from = text.indexOf(term)
      while (from !== -1) {
        const range = doc.createRange()
        range.setStart(node, from)
        range.setEnd(node, from + term.length)
        ranges.push(range)
        from = text.indexOf(term, from + term.length)
      }
    }
    if (ranges.length > 0) return ranges
  }
  return []
}

const hiddenAncestor = (element: Element): HTMLElement | null => element.closest<HTMLElement>('[hidden]')

/**
 * Center a box inside every scroller between it and the transcript's own scroller, and no further: `scrollIntoView`
 * also scrolls the app shell (the thread header slid out of view). A capped "Worked for" body scrolls first, then the
 * transcript.
 */
const centerInTranscript = (start: Element, measure: () => DOMRect, list: HTMLElement): void => {
  const stop = list.closest('[data-conversation-scroll]') ?? list
  for (let element = start.parentElement; element !== null; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (/(auto|scroll)/u.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
      const box = element.getBoundingClientRect()
      const rect = measure()
      element.scrollTop += (rect.top + rect.bottom) / 2 - (box.top + element.clientHeight / 2)
    }
    if (element === stop) return
  }
}

/** A long prompt folds with `overflow: hidden`; scrolling its body by a pixel opens it (`usePromptFold`). */
const openPromptFold = (element: Element): boolean => {
  const fold = element.closest('[data-prompt-fold="closed"]')
  const body = fold?.firstElementChild
  if (!(body instanceof HTMLElement)) return false
  body.scrollTop = 1
  return true
}

/** Hand a folded subtree the event browser find sends; its own reveal callback opens it. */
const revealHidden = (element: Element, revealed: WeakSet<Element>): void => {
  if (revealed.has(element)) return
  revealed.add(element)
  element.dispatchEvent(new Event('beforematch'))
}

export interface FindRevealTarget {
  /** The transcript list. */
  readonly list: () => HTMLElement | null
  /** The Turn holding the hit; `null` lands on the first match the mounted rows hold. */
  readonly turn: number | null
  /** The rendered row holding the hit, once its Turn's Nodes are loaded; called every frame. */
  readonly row: () => string | null
  readonly terms: readonly string[]
  /** Which occurrence inside the row, when one row holds several hits (loaded-window search). */
  readonly occurrence?: number
  /**
   * The Chat row kind (`data-chat-flow-kind`) that renders the hit's event, for a hit inside folded work: once the fold
   * opens, the Turn's rows of that kind are searched first.
   */
  readonly prefer?: string
}

export type FindRevealOutcome = { readonly kind: 'text'; readonly range: Range } | { readonly kind: 'row'; readonly element: HTMLElement } | { readonly kind: 'missed' }

/**
 * Retry each frame until the hit's text is visible, then highlight and center it.
 * @returns cancel, which stops retrying (the highlight stays until {@link clearFindHighlight}).
 */
export const revealFindHit = (target: FindRevealTarget, done: (outcome: FindRevealOutcome) => void): (() => void) => {
  const deadline = performance.now() + REVEAL_TIMEOUT_MS
  const revealed = new WeakSet<Element>()
  let frame = 0
  let textlessFrames = 0
  let missingFrames = 0
  let expanded = false
  let finished = false
  const finish = (outcome: FindRevealOutcome): void => {
    if (finished) return
    finished = true
    done(outcome)
  }
  const land = (list: HTMLElement, ranges: readonly Range[], index: number): void => {
    const range = ranges[Math.min(Math.max(index, 0), ranges.length - 1)]
    if (range === undefined) return
    const api = highlightApi()
    if (api !== null) {
      ensureHighlightStyle(range.startContainer.ownerDocument ?? document)
      api.registry.set(FIND_MATCH_HIGHLIGHT, new api.Highlight(...ranges.filter(candidate => candidate !== range)))
      api.registry.set(FIND_CURRENT_HIGHLIGHT, new api.Highlight(range))
    }
    const start = range.startContainer.parentElement
    if (start !== null) centerInTranscript(start, () => range.getBoundingClientRect(), list)
    finish({ kind: 'text', range })
  }
  const outline = (list: HTMLElement, element: HTMLElement): void => {
    clearFindHighlight()
    centerInTranscript(element, () => element.getBoundingClientRect(), list)
    element.setAttribute(CHAT_FOCUS_ATTRIBUTE, '')
    setTimeout(() => element.removeAttribute(CHAT_FOCUS_ATTRIBUTE), 2_000)
    finish({ kind: 'row', element })
  }
  const expandedTools = new WeakSet<Element>()
  /** The first visible match among a Turn's mounted rows, preferring rows of the hit's kind; opens closed tool rows. */
  const scanTurn = (list: HTMLElement, turn: number, anyRow: boolean): Range[] | null => {
    const scope = `[data-chat-turn="${String(turn)}"]`
    const groups = target.prefer === undefined ? [] : [[...list.querySelectorAll<HTMLElement>(`${scope} [data-chat-flow-kind="${target.prefer}"], ${scope}[data-chat-flow-kind="${target.prefer}"]`)]]
    if (anyRow || target.prefer === undefined) groups.push([...list.querySelectorAll<HTMLElement>(`${scope} [data-chat-node-key], ${scope}[data-chat-node-key]`)])
    for (const rows of groups) {
      for (const row of rows) {
        if (hiddenAncestor(row) !== null) continue
        const ranges = findTextRanges(row, target.terms)
        if (ranges.length > 0) return ranges
        if (row.dataset.chatFlowKind === 'tool-call' && !expandedTools.has(row)) {
          expandedTools.add(row)
          row.querySelector<HTMLElement>('button[aria-expanded="false"]')?.click()
        }
      }
    }
    return null
  }
  const turnRows = (list: HTMLElement): HTMLElement[] =>
    target.turn === null ? [] : [...list.querySelectorAll<HTMLElement>(`[data-chat-turn="${String(target.turn)}"]`)]
  const tick = (): void => {
    if (finished) return
    const list = target.list()
    if (list === null) return finish({ kind: 'missed' })
    const key = target.row()
    const element = key === null ? null : list.querySelector<HTMLElement>(`[data-chat-node-key="${CSS.escape(key)}"]`)
    const late = performance.now() > deadline
    if (element !== null) {
      const hidden = hiddenAncestor(element)
      if (hidden !== null && !late) revealHidden(hidden, revealed)
      else {
        const ranges = findTextRanges(element, target.terms)
        const first = ranges[Math.min(Math.max(target.occurrence ?? 0, 0), Math.max(ranges.length - 1, 0))]
        // A match inside a folded long prompt: open the fold first, land once it has laid out.
        const parent = first?.startContainer.parentElement
        if (parent != null && !late && openPromptFold(parent)) {
          frame = requestAnimationFrame(tick)
          return
        }
        if (ranges.length > 0) return land(list, ranges, target.occurrence ?? 0)
        // The hit is in a finished Turn's folded work, which mounts only once its process row opens. Open it with its
        // own toggle (never closing an open one), then search the Turn's rows, the hit's own row kind first.
        if (element.dataset.chatFlowKind === 'turn-process' && target.turn !== null) {
          element.querySelector<HTMLElement>('button[data-turn-process]:not([data-open])')?.click()
          // The hit's own row kind gets a few frames (an opened tool row lays out its output) before any row will do.
          const scanned = scanTurn(list, target.turn, textlessFrames >= TEXT_GRACE_FRAMES * 3)
          if (scanned !== null) return land(list, scanned, 0)
          if (!late && textlessFrames < TEXT_GRACE_FRAMES * 8) {
            textlessFrames += 1
            frame = requestAnimationFrame(tick)
            return
          }
        }
        textlessFrames += 1
        // The text may sit behind the row's own closed disclosure (a command's output): open it once, then retry.
        if (!expanded && textlessFrames >= TEXT_GRACE_FRAMES) {
          expanded = true
          element.querySelector<HTMLElement>('button[aria-expanded="false"]')?.click()
        } else if (late || textlessFrames >= TEXT_GRACE_FRAMES * 4) return outline(list, element)
      }
    } else {
      // The row is not mounted yet: open the Turn's folds so its group bodies mount their rows.
      missingFrames += 1
      for (const row of turnRows(list)) {
        if (row.hasAttribute('hidden')) revealHidden(row, revealed)
        for (const folded of row.querySelectorAll('[hidden]')) revealHidden(folded, revealed)
        // A finished Turn folds its work under "Worked for…" without mounting it; its own toggle opens it, once.
        if (missingFrames > TEXT_GRACE_FRAMES && row.dataset.chatFlowKind === 'turn-process' && !revealed.has(row)) {
          revealed.add(row)
          row.querySelector<HTMLElement>('button')?.click()
        }
      }
      if (late) {
        const fallback = turnRows(list).find(row => hiddenAncestor(row) === null)
        return fallback === undefined ? finish({ kind: 'missed' }) : outline(list, fallback)
      }
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => {
    finished = true
    cancelAnimationFrame(frame)
  }
}

/**
 * Loaded-window fallback: every mounted row whose text holds a term, oldest first, one entry per occurrence. Rows inside
 * folds are included (they are mounted with `hidden="until-found"`); rows a group never mounted are not.
 */
export const findInLoadedRows = (list: HTMLElement, terms: readonly string[]): { readonly nodeKey: string; readonly occurrence: number; readonly snippet: string }[] => {
  const hits: { nodeKey: string; occurrence: number; snippet: string }[] = []
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-node-key]')) {
    // A row inside another row (a group member) is counted once, by its innermost element.
    if (row.querySelector('[data-chat-node-key]') !== null) continue
    const key = row.dataset.chatNodeKey
    if (key === undefined) continue
    const ranges = findTextRanges(row, terms)
    ranges.forEach((range, occurrence) => {
      hits.push({ nodeKey: key, occurrence, snippet: range.startContainer.textContent?.slice(0, 160) ?? '' })
    })
  }
  return hits
}
