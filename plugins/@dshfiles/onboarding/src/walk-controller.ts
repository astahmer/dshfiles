import type { WalkStep } from './reach-model.js'
import { ReachResolver } from './reach-resolver.js'

/**
 * `seeking` looks for the step's target, `found` rings it, `missing` has looked for {@link MISSING_AFTER_MS} without
 * finding it, `waiting-key` waits for a `press`, `unsupported` stopped at a step only the test harness plays, `arrived`
 * found the final `expect`, `ended` released everything.
 */
export type WalkPhase = 'seeking' | 'found' | 'missing' | 'waiting-key' | 'unsupported' | 'arrived' | 'ended'

export interface WalkSnapshot {
  readonly index: number
  readonly phase: WalkPhase
  /** The current step's resolved control. */
  readonly target: Element | null
  /** The last control a step resolved: the ring stays there while a key or an unsupported step has none. */
  readonly lastTarget: Element | null
  /** Bumps on scroll, resize and DOM changes so the ring can re-measure. */
  readonly layout: number
}

export interface WalkResources {
  readonly listeners: number
  readonly observers: number
  readonly timers: number
}

export interface WalkController {
  readonly snapshot: () => WalkSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** Advance without evidence: keyboard-only users are never stuck. */
  readonly next: () => void
  readonly end: () => void
  readonly resources: () => WalkResources
}

export interface CreateWalkInput {
  readonly steps: readonly WalkStep[]
  readonly document: Document
  readonly isVisible?: ((element: Element) => boolean) | undefined
  readonly missingAfterMs?: number | undefined
  readonly onEnd?: (() => void) | undefined
}

export const MISSING_AFTER_MS = 10_000
const RESOLVE_DEBOUNCE_MS = 100
const MODIFIERS = new Set(['meta', 'control', 'controlormeta', 'shift', 'alt'])

/** Playwright key names (`Meta+Shift+P`, `ControlOrMeta+f`, `Escape`) against a real key event. */
const keyMatches = (event: KeyboardEvent, combo: string): boolean => {
  const parts = combo.split('+')
  const key = parts.at(-1)?.toLocaleLowerCase() ?? ''
  const required = new Set(parts.slice(0, -1).map(part => part.toLocaleLowerCase()))
  if ([...required].some(part => !MODIFIERS.has(part))) return false
  const either = required.has('controlormeta')
  if (either ? !(event.metaKey || event.ctrlKey) : event.metaKey !== required.has('meta') || event.ctrlKey !== required.has('control')) return false
  if (event.altKey !== required.has('alt')) return false
  const single = key.length === 1
  if (required.has('shift') ? !event.shiftKey : event.shiftKey && !single) return false
  const pressed = event.key.toLocaleLowerCase()
  if (pressed === key || (key === 'space' && pressed === ' ')) return true
  // Alt and Shift change `key` on some layouts; the physical key still names the letter or digit.
  return single && (event.code.toLocaleLowerCase() === `key${key}` || event.code.toLocaleLowerCase() === `digit${key}`)
}

const isElement = (target: EventTarget | null): target is Element => target instanceof Element

/**
 * One walk over a feature's `reach` steps in the live document. It only watches: it never clicks, types, hovers or
 * presses for the user, and advances on real evidence (or Next). Every listener, observer and timer it adds is counted
 * and released by `end`.
 */
export const createWalk = (input: CreateWalkInput): WalkController => {
  const doc = input.document
  const view = doc.defaultView
  const missingAfterMs = input.missingAfterMs ?? MISSING_AFTER_MS
  const subscribers = new Set<() => void>()
  const disposers = new Map<symbol, { readonly kind: keyof WalkResources; readonly dispose: () => void }>()
  let state: WalkSnapshot = { index: 0, phase: 'seeking', target: null, lastTarget: null, layout: 0 }
  let missingTimer: symbol | null = null
  let resolveTimer: symbol | null = null
  /** The element a pointerdown already advanced on: its trailing click is the same gesture. */
  let consumedPointer: Element | null = null
  let consumedKey: KeyboardEvent | null = null

  const emit = (next: Partial<WalkSnapshot>): void => {
    state = { ...state, ...next }
    for (const subscriber of subscribers) subscriber()
  }

  const track = (kind: keyof WalkResources, dispose: () => void): symbol => {
    const id = Symbol(kind)
    disposers.set(id, { kind, dispose })
    return id
  }
  const release = (id: symbol | null): void => {
    if (id === null) return
    disposers.get(id)?.dispose()
    disposers.delete(id)
  }
  const later = (ms: number, run: () => void): symbol => {
    const id = track('timers', () => clearTimeout(handle))
    const handle = setTimeout(() => {
      disposers.delete(id)
      run()
    }, ms)
    return id
  }
  const listen = (target: Document | Window, type: string, listener: (event: Event) => void, capture: boolean): void => {
    target.addEventListener(type, listener, { capture, passive: true })
    track('listeners', () => target.removeEventListener(type, listener, { capture }))
  }

  const step = (): WalkStep | undefined => input.steps[state.index]

  const locate = (): Element | null => {
    const locator = step()?.locator
    return locator === null || locator === undefined ? null : ReachResolver.resolve({ root: doc, locator, isVisible: input.isVisible })
  }

  const startMissingTimer = (): void => {
    release(missingTimer)
    missingTimer = later(missingAfterMs, () => {
      missingTimer = null
      if (state.phase === 'seeking') emit({ phase: 'missing' })
    })
  }

  const enter = (index: number): void => {
    release(missingTimer)
    missingTimer = null
    const next = input.steps[index]
    const lastTarget = state.target ?? state.lastTarget
    if (next === undefined) return emit({ phase: 'arrived', lastTarget })
    if (next.unsupported !== null) return emit({ index, phase: 'unsupported', target: null, lastTarget })
    if (next.action === 'press') return emit({ index, phase: 'waiting-key', target: null, lastTarget })
    emit({ index, phase: 'seeking', target: null, lastTarget })
    startMissingTimer()
    refresh()
  }

  const advance = (): void => {
    if (state.phase === 'ended' || state.phase === 'arrived' || state.phase === 'unsupported') return
    if (state.index >= input.steps.length - 1) {
      if (state.phase === 'found') return emit({ phase: 'arrived' })
      return end()
    }
    enter(state.index + 1)
  }

  /** Re-resolve the current target; an `expect` passes as soon as its target is on screen. */
  const refresh = (): void => {
    if (state.phase !== 'seeking' && state.phase !== 'missing' && state.phase !== 'found') return
    const target = locate()
    if (target === null) {
      if (state.phase === 'found') {
        emit({ phase: 'seeking', target: null })
        startMissingTimer()
      }
      return
    }
    if (state.phase !== 'found' || target !== state.target) {
      release(missingTimer)
      missingTimer = null
      emit({ phase: 'found', target })
    }
    if (step()?.action === 'expect') advance()
  }

  const scheduleRefresh = (): void => {
    if (resolveTimer !== null) return
    resolveTimer = later(RESOLVE_DEBOUNCE_MS, () => {
      resolveTimer = null
      refresh()
      emit({ layout: state.layout + 1 })
    })
  }

  /**
   * The ring follows its control once per frame through scrolls, resizes and animations: a menu that slides in with the
   * Web Animations API fires no event to re-measure on. It re-renders only when the box moved.
   */
  const followFrames = (): void => {
    if (view === null || !('requestAnimationFrame' in view)) return
    let measured = ''
    const tick = (): void => {
      const ringed = state.target ?? state.lastTarget
      const box = ringed?.isConnected === true ? ringed.getBoundingClientRect() : null
      const key = box === null ? '' : `${String(box.x)},${String(box.y)},${String(box.width)},${String(box.height)}`
      if (key !== measured) {
        measured = key
        emit({ layout: state.layout + 1 })
      }
      handle = view.requestAnimationFrame(tick)
    }
    let handle = view.requestAnimationFrame(tick)
    track('timers', () => view.cancelAnimationFrame(handle))
  }

  /** The event hit the current step's control (re-resolved when the DOM moved faster than the observer). */
  const hitsTarget = (event: Event): boolean => {
    const hit = event.target
    if (!isElement(hit) || ReachResolver.isInsideOverlay(hit)) return false
    const target = state.target?.isConnected === true ? state.target : locate()
    return target !== null && target.contains(hit)
  }

  const onEvidence = (action: WalkStep['action'], event: Event): void => {
    const current = step()
    if (current?.action !== action || (state.phase !== 'found' && state.phase !== 'seeking' && state.phase !== 'missing')) return
    if (hitsTarget(event)) advance()
  }

  const end = (): void => {
    if (state.phase === 'ended') return
    for (const entry of disposers.values()) entry.dispose()
    disposers.clear()
    missingTimer = null
    resolveTimer = null
    emit({ phase: 'ended' })
    subscribers.clear()
    input.onEnd?.()
  }

  listen(
    doc,
    'pointerdown',
    event => {
      consumedPointer = null
      if (!(event instanceof MouseEvent) || event.button !== 0) return
      const before = state.index
      onEvidence('click', event)
      if (state.index !== before && isElement(event.target)) consumedPointer = event.target
    },
    true,
  )
  listen(
    doc,
    'click',
    event => {
      if (consumedPointer !== null && event.target === consumedPointer) {
        consumedPointer = null
        return
      }
      onEvidence('click', event)
    },
    true,
  )
  listen(doc, 'pointerover', event => onEvidence('hover', event), true)
  listen(doc, 'input', event => onEvidence('fill', event), true)
  listen(
    doc,
    'keydown',
    event => {
      const current = step()
      if (!(event instanceof KeyboardEvent)) return
      if (state.phase !== 'waiting-key' || current?.action !== 'press' || current.value === null || !keyMatches(event, current.value)) return
      consumedKey = event
      advance()
    },
    true,
  )
  if (view !== null) {
    listen(
      view,
      'keydown',
      event => {
        // A menu or dialog that closed on this Escape called preventDefault: the walk outlives it.
        if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.defaultPrevented || event === consumedKey) return
        end()
      },
      false,
    )
  }
  followFrames()
  const observer = new MutationObserver(scheduleRefresh)
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label', 'aria-labelledby', 'aria-hidden', 'hidden', 'class', 'style', 'open', 'data-state', 'title'],
    characterData: true,
  })
  track('observers', () => observer.disconnect())

  enter(0)

  return {
    snapshot: () => state,
    subscribe: listener => {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    next: advance,
    end,
    resources: () => {
      const counts = { listeners: 0, observers: 0, timers: 0 }
      for (const entry of disposers.values()) counts[entry.kind] += 1
      return counts
    },
  }
}

export const WalkKeys = { keyMatches }
