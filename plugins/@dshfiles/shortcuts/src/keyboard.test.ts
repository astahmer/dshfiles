// @vitest-environment jsdom
import { CommandKeys } from '@dshfiles/dshx/client'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { ShortcutKeyboardModel, ShortcutLayer, type ShortcutBinding, type ShortcutScope } from './keyboard.js'

const mac = (): boolean => CommandKeys.isMacPlatform(window.navigator.platform)
/** A layout box list for jsdom, which lays nothing out: an array already is a DOMRectList apart from `item`. */
const rectList = (...rects: DOMRect[]): DOMRectList => Object.assign(rects, { item: (index: number): DOMRect | null => rects[index] ?? null })
const primaryHeld = (): KeyboardEventInit => (mac() ? { metaKey: true } : { ctrlKey: true })

const binding = (
  spec: string,
  run: ShortcutBinding['run'] = () => {},
  scope: ShortcutScope = 'global',
  extra: Partial<ShortcutBinding> = {},
): ShortcutBinding => {
  const keys = CommandKeys.parse(spec)
  if (keys === undefined) throw new Error(`unparsable ${spec}`)
  return { id: spec, keys, scope, label: spec, run, ...extra }
}

const codeOf = (key: string): string => (/^[a-z]$/u.test(key) ? `Key${key.toUpperCase()}` : /^\d$/u.test(key) ? `Digit${key}` : key)

const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { code: codeOf(key), key, bubbles: true, cancelable: true, composed: true, ...init })

const stepOf = (spec: string) => {
  const parsed = CommandKeys.parse(spec)
  if (parsed === undefined) throw new Error(spec)
  return parsed.steps[0]
}

describe('isMacPlatform', () => {
  it.each(['MacIntel', 'macOS', 'MacPPC', 'iPhone'])('treats %s as macOS', platform => {
    expect(CommandKeys.isMacPlatform(platform)).toBe(true)
  })

  it.each(['Win32', 'Linux x86_64', ''])('treats %s as not macOS', platform => {
    expect(CommandKeys.isMacPlatform(platform)).toBe(false)
  })
})

describe('matchesStep', () => {
  it('resolves primary to Meta on macOS and Control elsewhere', () => {
    const step = stepOf('Mod+P')
    expect(ShortcutKeyboardModel.matchesStep(press('p', { metaKey: true }), step, true)).toBe(true)
    expect(ShortcutKeyboardModel.matchesStep(press('p', { ctrlKey: true }), step, true)).toBe(false)
    expect(ShortcutKeyboardModel.matchesStep(press('p', { ctrlKey: true }), step, false)).toBe(true)
  })

  it('refuses a chord carrying an extra modifier', () => {
    const step = stepOf('Mod+P')
    expect(ShortcutKeyboardModel.matchesStep(press('p', { metaKey: true, altKey: true }), step, true)).toBe(false)
    expect(ShortcutKeyboardModel.matchesStep(press('p', { metaKey: true, shiftKey: true }), step, true)).toBe(false)
    expect(ShortcutKeyboardModel.matchesStep(press('j', { ctrlKey: true }), stepOf('J'), true)).toBe(false)
  })

  it('matches by physical key and asks for exactly the modifiers it names', () => {
    expect(ShortcutKeyboardModel.matchesStep(press('∆', { code: 'KeyJ', altKey: true }), stepOf('Alt+J'), true)).toBe(true)
    expect(ShortcutKeyboardModel.matchesStep(press('J', { code: 'KeyJ', shiftKey: true }), stepOf('Shift+J'), true)).toBe(true)
    expect(ShortcutKeyboardModel.matchesStep(press('J', { code: 'KeyJ', shiftKey: true }), stepOf('J'), true)).toBe(false)
    expect(ShortcutKeyboardModel.matchesStep(press('?', { code: 'Slash', shiftKey: true }), stepOf('?'), true)).toBe(true)
    expect(ShortcutKeyboardModel.matchesStep(press('Enter', { metaKey: true, altKey: true }), stepOf('Mod+Alt+Enter'), true)).toBe(true)
  })
})

describe('CommandKeys.parse', () => {
  it.each([
    ['Mod+K', false, false],
    ['J', true, true],
    ['Shift+J', true, true],
    ['Alt+J', true, false],
    ['G I', true, true],
    ['?', true, true],
    ['Escape', true, false],
    ['Enter', true, false],
    ['Shift+ArrowDown', true, false],
  ])('reads %s (types text: %s, character key: %s)', (spec, typesText, characterKey) => {
    expect(CommandKeys.parse(spec)).toMatchObject({ typesText, characterKey })
  })

  it.each(['Mod+', 'Hyper+K', 'G Mod+I', 'A B C', ''])('leaves %s unbound', spec => {
    expect(CommandKeys.parse(spec)).toBeUndefined()
  })

  it('presents keycaps per platform and folds digit runs', () => {
    expect(CommandKeys.keycaps('Mod+Shift+K', true)).toEqual([['⌘', '⇧', 'K']])
    expect(CommandKeys.keycaps('Mod+Shift+K', false)).toEqual([['Ctrl', 'Shift', 'K']])
    expect(CommandKeys.keycaps('G I', true)).toEqual([['G'], ['I']])
    expect(CommandKeys.compact(['1', '2', '3', '4', 'Enter'])).toEqual(['1–4', 'Enter'])
  })
})

describe('isEditableTarget', () => {
  it('accepts text fields and editable regions, refuses buttons and checkboxes', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(ShortcutKeyboardModel.isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(ShortcutKeyboardModel.isEditableTarget(editable)).toBe(true)
    expect(ShortcutKeyboardModel.isEditableTarget(editable.appendChild(document.createElement('span')))).toBe(true)
    expect(ShortcutKeyboardModel.isEditableTarget(checkbox)).toBe(false)
    expect(ShortcutKeyboardModel.isEditableTarget(document.createElement('button'))).toBe(false)
    expect(ShortcutKeyboardModel.isEditableTarget(null)).toBe(false)
  })
})

/** xterm's own shape: a hidden textarea inside the `.xterm` root the Host names terminal. */
const termInput = (): HTMLTextAreaElement => {
  const terminal = document.createElement('div')
  terminal.className = 'xterm'
  const input = document.createElement('textarea')
  input.className = 'xterm-helper-textarea'
  terminal.append(input)
  document.body.append(terminal)
  onTestFinished(() => terminal.remove())
  return input
}

describe('regionOf', () => {
  it('resolves the terminal before the text field it holds, then editable, then page', () => {
    const input = termInput()
    expect(ShortcutKeyboardModel.regionOf(input)).toBe('terminal')
    // The terminal's own input is still a text field for anything that asks directly.
    expect(ShortcutKeyboardModel.isEditableTarget(input)).toBe(true)
    input.closest('.xterm')?.remove()
    expect(ShortcutKeyboardModel.regionOf(document.createElement('textarea'))).toBe('editable')
    expect(ShortcutKeyboardModel.regionOf(document.createElement('button'))).toBe('page')
    expect(ShortcutKeyboardModel.regionOf(null)).toBe('page')
  })
})

describe('ShortcutLayer', () => {
  const disposers: Array<() => void> = []
  let bindings: ShortcutBinding[] = []
  let singleKeys = true
  let clock = 0
  const install = (): void => {
    disposers.push(ShortcutLayer.install(window, { bindings: () => bindings, singleKeys: () => singleKeys, now: () => clock }))
  }
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Record<string, string> = {},
    parent: Element = document.body,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    parent.appendChild(node)
    return node
  }

  beforeEach(() => {
    bindings = []
    singleKeys = true
    clock = 0
    document.body.replaceChildren()
  })
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })

  it('claims a matching chord before bubble listeners see it', () => {
    const run = vi.fn()
    const bubbled = vi.fn()
    bindings = [binding('Mod+P', run)]
    install()
    window.addEventListener('keydown', bubbled)
    disposers.push(() => window.removeEventListener('keydown', bubbled))
    const chord = press('p', primaryHeld())
    document.body.dispatchEvent(chord)
    expect(run).toHaveBeenCalledOnce()
    expect(chord.defaultPrevented).toBe(true)
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('leaves events alone that someone else already handled or that repeat', () => {
    const run = vi.fn()
    bindings = [binding('Mod+P', run)]
    install()
    document.body.dispatchEvent(press('p', { ...primaryHeld(), repeat: true }))
    const handled = press('p', primaryHeld())
    handled.preventDefault()
    document.body.dispatchEvent(handled)
    expect(run).not.toHaveBeenCalled()
  })

  it('lets a run that returns false decline the key', () => {
    bindings = [binding('Mod+P', () => false)]
    install()
    const chord = press('p', primaryHeld())
    document.body.dispatchEvent(chord)
    expect(chord.defaultPrevented).toBe(false)
  })

  it('leaves the key to the shell when the chord opts out of the terminal', () => {
    const run = vi.fn()
    bindings = [{ ...binding('Mod+K', run), allowInTerminal: false }]
    install()
    const input = termInput()
    const chord = press('k', primaryHeld())
    input.dispatchEvent(chord)
    expect(run).not.toHaveBeenCalled()
    expect(chord.defaultPrevented).toBe(false)
  })

  it('keeps claiming the chord in the terminal when it does not opt out', () => {
    const run = vi.fn()
    bindings = [binding('Mod+K', run)]
    install()
    const input = termInput()
    const chord = press('k', primaryHeld())
    input.dispatchEvent(chord)
    expect(run).toHaveBeenCalledOnce()
    expect(chord.defaultPrevented).toBe(true)
  })

  it('stops listening once disposed', () => {
    const run = vi.fn()
    bindings = [binding('Mod+P', run)]
    ShortcutLayer.install(window, { bindings: () => bindings })()
    document.body.dispatchEvent(press('p', primaryHeld()))
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps single keys, Shift keys and ⌥ letters out of text fields, and lets the characters through', () => {
    const run = vi.fn()
    bindings = [binding('J', run, 'not-typing'), binding('E', run, 'global'), binding('Alt+J', run, 'global'), binding('Shift+K', run, 'not-typing')]
    install()
    const composer = element('textarea')
    const editable = element('div', { contenteditable: 'true' })
    for (const target of [composer, editable]) {
      for (const event of [press('j'), press('e'), press('∆', { code: 'KeyJ', altKey: true }), press('K', { code: 'KeyK', shiftKey: true })]) {
        target.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('never fires a single key during an IME composition', () => {
    const run = vi.fn()
    bindings = [binding('J', run, 'not-typing')]
    install()
    document.body.dispatchEvent(press('j', { isComposing: true }))
    document.body.dispatchEvent(press('Process', { code: 'KeyJ', keyCode: 229 }))
    expect(run).not.toHaveBeenCalled()
  })

  it('still claims a modified global chord from a text field', () => {
    const run = vi.fn()
    bindings = [binding('Mod+/', run)]
    install()
    element('textarea').dispatchEvent(press('/', { ...primaryHeld(), code: 'Slash' }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('turns every character key off with the setting, and keeps chords and ⌥ letters on', () => {
    const run = vi.fn()
    bindings = [binding('J', run, 'not-typing'), binding('?', run), binding('G I', run, 'not-typing'), binding('Mod+K', run), binding('Alt+J', run)]
    singleKeys = false
    install()
    document.body.dispatchEvent(press('j'))
    document.body.dispatchEvent(press('?', { code: 'Slash', shiftKey: true }))
    document.body.dispatchEvent(press('g'))
    document.body.dispatchEvent(press('i'))
    expect(run).not.toHaveBeenCalled()
    document.body.dispatchEvent(press('k', primaryHeld()))
    document.body.dispatchEvent(press('∆', { code: 'KeyJ', altKey: true }))
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs a sequence when the second key comes within 1.2 s, and drops it after', () => {
    const go = vi.fn()
    bindings = [binding('G I', go, 'not-typing')]
    install()
    const first = press('g')
    document.body.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    clock = 1_000
    document.body.dispatchEvent(press('i'))
    expect(go).toHaveBeenCalledOnce()
    document.body.dispatchEvent(press('g'))
    clock = 2_300
    const late = press('i')
    document.body.dispatchEvent(late)
    expect(go).toHaveBeenCalledOnce()
    expect(late.defaultPrevented).toBe(false)
  })

  it('judges an unknown second key on its own after a sequence prefix', () => {
    const go = vi.fn()
    const next = vi.fn()
    bindings = [binding('G I', go, 'not-typing'), binding('J', next, 'not-typing')]
    install()
    document.body.dispatchEvent(press('g'))
    document.body.dispatchEvent(press('j'))
    expect(go).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  it('fires list keys only inside a list region, and lets the innermost owner win', () => {
    const inbox = vi.fn()
    const threads = vi.fn()
    const sidebar = element('nav', { 'data-shortcut-scope': 'list' })
    const panel = element('main', { 'data-shortcut-scope': 'list' })
    const sidebarRow = element('button', {}, sidebar)
    const panelRow = element('button', {}, panel)
    bindings = [binding('J', threads, 'list', { region: () => sidebar }), binding('J', inbox, 'list', { region: () => panel })]
    install()
    panelRow.dispatchEvent(press('j'))
    expect(inbox).toHaveBeenCalledOnce()
    expect(threads).not.toHaveBeenCalled()
    sidebarRow.dispatchEvent(press('j'))
    expect(threads).toHaveBeenCalledOnce()
    const outside = element('button')
    const unscoped = press('j')
    outside.dispatchEvent(unscoped)
    expect(unscoped.defaultPrevented).toBe(false)
  })

  it('sends keys from the page to the region last used, else to an ambient one', () => {
    const run = vi.fn()
    const triage = element('section', { 'data-shortcut-scope': 'triage', 'data-shortcut-ambient': '' })
    // jsdom lays nothing out; give the region a box so it counts as shown.
    triage.getClientRects = () => rectList(new DOMRect(0, 0, 10, 10))
    bindings = [binding('E', run, 'triage', { region: () => triage })]
    install()
    document.body.dispatchEvent(press('e'))
    expect(run).toHaveBeenCalledOnce()
  })

  it('leaves plain keys to an open menu or dialog that is not a region', () => {
    const run = vi.fn()
    bindings = [binding('J', run, 'not-typing'), binding('?', run)]
    install()
    const menu = element('div', { role: 'menu' })
    const item = element('div', { role: 'menuitem', tabindex: '-1' }, menu)
    item.dispatchEvent(press('j'))
    item.dispatchEvent(press('?', { code: 'Slash', shiftKey: true }))
    expect(run).not.toHaveBeenCalled()
  })

  it('fires composer chords only from inside the composer, and passes the trigger', () => {
    const send = vi.fn()
    const composer = element('div', { 'data-shortcut-scope': 'composer' })
    const field = element('textarea', {}, composer)
    bindings = [binding('Mod+Enter', send, 'composer')]
    install()
    element('textarea').dispatchEvent(press('Enter', primaryHeld()))
    expect(send).not.toHaveBeenCalled()
    field.dispatchEvent(press('Enter', primaryHeld()))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ keys: 'Mod+Enter' }))
  })
})
