/**
 * Capture-phase keyboard shortcuts, in layers.
 *
 * The Host's own shortcut runtime listens for `keydown` in the bubble phase, so a chord the browser also claims —
 * `primary+p` for print — has already done its browser-level work by the time dispatch runs. A capture listener runs
 * before the event reaches the target and can take it back, which is why this exists as a plugin rather than as
 * configuration. The Web registry also refuses `⌥`-letter defaults and has no single-key or sequence layer, so those
 * live here too: one listener, one registry (dshx `Command`), every layer.
 *
 * The layers (`CommandScope`):
 *
 * - **global** chords fire anywhere; a modified chord cannot type, so it also fires from a text field.
 * - **not-typing** keys fire anywhere except a text field or an IME composition.
 * - **list / triage / changes** keys fire only inside an element marked `data-shortcut-scope="<scope>"`: the focused
 *   one, or with nothing focused the region the user last pointed at or focused, else one marked
 *   `data-shortcut-ambient`. Two mounted lists can both bind `J`; the region decides.
 * - **composer** chords fire only from inside `data-shortcut-scope="composer"`.
 *
 * Guards that hold whatever the scope:
 *
 * - A key without the primary modifier (`J`, `Shift+J`, `Alt+J`, `G I`) never fires while typing: in a text field,
 *   during an IME composition, or inside an open menu or dialog that is not its own region. `⌥J` types `∆` on macOS.
 * - Character keys (no modifier but Shift) can be turned off as a whole (WCAG 2.1.4).
 * - A key someone already handled, or an auto-repeat, is left alone, and exactly the asked modifiers must be held.
 * - A chord the terminal reads keeps reaching the shell. `Cmd+J` may toggle the bottom panel everywhere else, but
 *   `Ctrl+J` is a line feed once xterm owns the keyboard, so a command can opt out of the terminal.
 */
import { CommandKeys, type KeyStep, type ParsedKeys } from '@dshfiles/dshx/client'

export type ShortcutScope = 'global' | 'not-typing' | 'list' | 'triage' | 'changes' | 'composer'

/** Which input owner the key event belongs to, named as the Host adapter names them. */
export type ShortcutRegion = 'page' | 'editable' | 'terminal'

/** Region scopes: they apply only inside an element that names them. */
const REGION_SCOPES: ReadonlySet<ShortcutScope> = new Set(['list', 'triage', 'changes', 'composer'])

export interface ShortcutTrigger {
  readonly keys: string
  readonly event: KeyboardEvent
}

export interface ShortcutBinding {
  /** Stable id, so a binding can be referred to by name rather than by chord. */
  readonly id: string
  readonly keys: ParsedKeys
  readonly scope: ShortcutScope
  /** For a region scope: the element whose keys these are; absent means any region of that scope. */
  readonly region?: () => Element | null | undefined
  /**
   * Whether the key still applies while a terminal owns the keyboard. Defaults to `true`: app chords are expected to
   * work from every surface. A chord the shell itself reads (`Ctrl+J` is a line feed) sets `false` so xterm gets it.
   */
  readonly allowInTerminal?: boolean
  /** Human label for menus and help. */
  readonly label: string
  /** Returning false declines the key: the event goes on to its target as if nothing matched. */
  readonly run: (trigger: ShortcutTrigger) => void | false
}

export interface ShortcutLayerOptions {
  /** Read on every key press, so bindings can change without reinstalling the listener. */
  readonly bindings: () => readonly ShortcutBinding[]
  /** Whether character-key shortcuts (`J`, `?`, `G I`) are on; read on every key press. */
  readonly singleKeys?: () => boolean
  readonly now?: () => number
}

const EDITABLE_SELECTOR =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"]'

/** An open menu, listbox or dialog owns plain keys (type-ahead, its own arrows) unless it is a shortcut region. */
const OVERLAY_SELECTOR = '[role="menu"], [role="menubar"], [role="listbox"], [role="dialog"], [role="alertdialog"]'

const REGION_SELECTOR = '[data-shortcut-scope]'
const AMBIENT_SELECTOR = '[data-shortcut-ambient]'

const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Hyper', 'Super'])

/** xterm's root element, the same owner the Host adapter calls a `terminal` region. */
const TERMINAL_SELECTOR = '.xterm'

/** Resolve the Host's logical `primary` to the physical modifier for this platform. */
const isPrimaryHeld = (event: KeyboardEvent, mac: boolean): boolean => (mac ? event.metaKey : event.ctrlKey)

/** The other of Ctrl/⌘, which no binding asks for: holding it means the press is someone else's chord. */
const isSecondaryHeld = (event: KeyboardEvent, mac: boolean): boolean => (mac ? event.ctrlKey : event.metaKey)

/**
 * Whether this event is exactly this step.
 *
 * "Exactly" matters: a keydown reports every modifier that is down, so a step that only checked for its own would
 * also fire on `alt+cmd+p` and quietly steal a sequence the Host might own.
 */
const matchesStep = (event: KeyboardEvent, step: KeyStep, mac: boolean): boolean => {
  const keyMatches = event.code === step.code || (step.char !== undefined && event.key === step.char)
  if (!keyMatches) return false
  if (isSecondaryHeld(event, mac)) return false
  if (isPrimaryHeld(event, mac) !== step.primary) return false
  if (event.altKey !== step.alt) return false
  // A typed symbol (`?`) answers to its character whatever Shift took to type it on this layout.
  if (step.char !== undefined && event.key === step.char) return true
  return event.shiftKey === step.shift
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false
  return target.closest(EDITABLE_SELECTOR) !== null
}

interface Region {
  readonly scopes: readonly string[]
  readonly element: Element
}

const regionOf = (element: Element): Region => ({ element, scopes: (element.getAttribute('data-shortcut-scope') ?? '').split(/\s+/u).filter(Boolean) })

/** Every shortcut region around an element, innermost first, stopping at an overlay that is not one. */
const regionsAround = (target: Element, stopAt: Element | null): Region[] => {
  const regions: Region[] = []
  let cursor: Element | null = target.closest(REGION_SELECTOR)
  while (cursor !== null) {
    if (stopAt !== null && !stopAt.contains(cursor)) break
    regions.push(regionOf(cursor))
    cursor = cursor.parentElement?.closest(REGION_SELECTOR) ?? null
  }
  return regions
}

const isShown = (element: Element): boolean => element.isConnected && (!(element instanceof HTMLElement) || element.getClientRects().length > 0)

export interface KeyContext {
  readonly target: Element | null
  readonly typing: boolean
  /** The key landed in xterm (its hidden textarea is also a text field, so `typing` is true there too). */
  readonly terminal: boolean
  /** An open menu or dialog the key landed in, which plain keys belong to unless it is a region. */
  readonly overlay: Element | null
  readonly regions: readonly Region[]
}

/** Where a key press landed, read once per event. */
const resolveContext = (event: KeyboardEvent, ambient: () => Element | null): KeyContext => {
  const fromPath = event.composedPath().find((node): node is Element => node instanceof Element)
  const doc = event.target instanceof Node ? (event.target.ownerDocument ?? (event.target instanceof Document ? event.target : null)) : null
  const target = fromPath ?? (doc?.activeElement instanceof Element ? doc.activeElement : null)
  // keyCode 229 is the IME's placeholder key in browsers that end a composition before `isComposing` is set.
  const typing = event.isComposing || event.keyCode === 229 || isEditableTarget(target)
  const overlay = target?.closest(OVERLAY_SELECTOR) ?? null
  const terminal = (target?.closest(TERMINAL_SELECTOR) ?? null) !== null
  const isDocumentLevel = target === null || target === doc?.body || target === doc?.documentElement
  if (isDocumentLevel) {
    const fallback = ambient()
    return { target, typing, terminal, overlay, regions: fallback === null ? [] : regionsAround(fallback, null) }
  }
  return { target, typing, terminal, overlay, regions: regionsAround(target, overlay) }
}

/** Lower is more specific: the innermost region first, then not-typing, then global. */
const rankOf = (binding: ShortcutBinding, context: KeyContext): number | undefined => {
  if (REGION_SCOPES.has(binding.scope)) {
    if (binding.scope !== 'composer' && context.typing) return undefined
    const index = context.regions.findIndex(region => {
      if (!region.scopes.includes(binding.scope)) return false
      const owner = binding.region?.()
      if (binding.region === undefined) return true
      return owner !== null && owner !== undefined && (owner === region.element || owner.contains(region.element))
    })
    return index === -1 ? undefined : index
  }
  if (binding.keys.typesText && context.overlay !== null) return undefined
  if (binding.scope === 'not-typing') return context.typing ? undefined : 1_000
  return 2_000
}

const eligible = (binding: ShortcutBinding, context: KeyContext, singleKeys: boolean): number | undefined => {
  if (binding.keys.characterKey && !singleKeys) return undefined
  if (context.terminal && binding.allowInTerminal === false) return undefined
  if (binding.keys.typesText && context.typing) return undefined
  // Composer chords are chords: a plain key there is the user's text.
  if (binding.scope === 'composer' && binding.keys.typesText) return undefined
  return rankOf(binding, context)
}

const byRank = (context: KeyContext, singleKeys: boolean, bindings: readonly ShortcutBinding[]): ShortcutBinding[] =>
  bindings
    .flatMap((binding, order) => {
      const rank = eligible(binding, context, singleKeys)
      return rank === undefined ? [] : [{ binding, rank, order }]
    })
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .map(entry => entry.binding)

interface Pending {
  readonly step: KeyStep
  readonly at: number
  readonly context: KeyContext
}

/**
 * Install one capture-phase listener for every layer.
 *
 * Capture is the whole point: it runs before the target's own handlers. The listener is passive about anything it does
 * not own and calls nothing when no binding matches.
 */
const install = (target: Window, options: ShortcutLayerOptions): (() => void) => {
  const mac = CommandKeys.isMacPlatform(target.navigator.platform)
  const now = options.now ?? (() => Date.now())
  const singleKeys = options.singleKeys ?? (() => true)
  let pending: Pending | undefined
  let lastRegion: Element | null = null

  const ambient = (): Element | null => {
    if (lastRegion !== null && isShown(lastRegion)) return lastRegion
    const marked = Array.from(target.document.querySelectorAll(AMBIENT_SELECTOR)).filter(isShown)
    return marked.at(-1) ?? null
  }

  /** The region the user last worked in, so J still reaches the list after focus fell back to the page. */
  const remember = (event: Event): void => {
    const element = event.target instanceof Element ? event.target : null
    lastRegion = element?.closest(REGION_SELECTOR) ?? null
  }

  const claim = (event: KeyboardEvent): void => {
    // Both calls are needed: preventDefault stops the browser's own binding, stopPropagation keeps the Host's runtime
    // (and the target's handlers) from also acting on it.
    event.preventDefault()
    event.stopPropagation()
  }

  const runFirst = (candidates: readonly ShortcutBinding[], event: KeyboardEvent): boolean => {
    for (const binding of candidates) {
      if (binding.run({ keys: binding.keys.spec, event }) === false) continue
      claim(event)
      return true
    }
    return false
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat) return
    if (MODIFIER_KEYS.has(event.key)) return
    const bindings = options.bindings()
    const singleKeysOn = singleKeys()

    // oxlint-disable-next-line antislop/no-passthrough-variable -- a snapshot: `pending` is cleared on the next line.
    const waiting = pending
    pending = undefined
    if (waiting !== undefined && now() - waiting.at <= CommandKeys.SEQUENCE_MS) {
      const seconds = byRank(waiting.context, singleKeysOn, bindings).filter(binding => {
        const [first, second] = binding.keys.steps
        return second !== undefined && first.code === waiting.step.code && first.shift === waiting.step.shift && matchesStep(event, second, mac)
      })
      if (runFirst(seconds, event)) return
      // Not a known second key: the sequence ends and this key is judged on its own.
    }

    const context = resolveContext(event, ambient)
    const ranked = byRank(context, singleKeysOn, bindings)
    const starts = ranked.filter(binding => binding.keys.steps.length === 2 && matchesStep(event, binding.keys.steps[0], mac))
    const first = starts[0]?.keys.steps[0]
    if (first !== undefined) {
      pending = { step: first, at: now(), context }
      claim(event)
      return
    }
    runFirst(
      ranked.filter(binding => binding.keys.steps.length === 1 && matchesStep(event, binding.keys.steps[0], mac)),
      event,
    )
  }

  // Any click ends a half-typed sequence, as it does in the Host's own registry.
  const onPointerDown = (event: Event): void => {
    pending = undefined
    remember(event)
  }

  target.addEventListener('keydown', onKeyDown, true)
  target.addEventListener('pointerdown', onPointerDown, true)
  target.addEventListener('focusin', remember, true)
  return () => {
    target.removeEventListener('keydown', onKeyDown, true)
    target.removeEventListener('pointerdown', onPointerDown, true)
    target.removeEventListener('focusin', remember, true)
  }
}

/** Read a scope as the matcher understands it: `page` is the older name of `not-typing`. */
const normalizeScope = (scope: string | undefined): ShortcutScope => {
  switch (scope) {
    case 'page':
    case 'not-typing':
      return 'not-typing'
    case 'list':
    case 'triage':
    case 'changes':
    case 'composer':
      return scope
    default:
      return 'global'
  }
}

export class ShortcutKeyboardModel {
  /** Whether the event landed somewhere that consumes plain character keys. */
  static readonly isEditableTarget = isEditableTarget

  /** Which input owner the event lands in, in the order the Host resolves it: terminal, then editable, then page. */
  static readonly regionOf = (target: EventTarget | null): ShortcutRegion => {
    if (!(target instanceof Element)) return 'page'
    if (target.closest(TERMINAL_SELECTOR) !== null) return 'terminal'
    return isEditableTarget(target) ? 'editable' : 'page'
  }
  static readonly matchesStep = matchesStep
  static readonly resolveContext = resolveContext
  static readonly normalizeScope = normalizeScope
}

export class ShortcutLayer {
  static readonly install = install
}
