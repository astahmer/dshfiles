// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installShortcuts, ShortcutKeyboardModel, type Shortcut } from './keyboard.js'

const searchShortcut = (run: Shortcut['run'] = () => {}): Shortcut => ({ id: 'search', key: 'KeyP', modifier: 'primary', label: 'Search', run })

const press = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, ...init })

const primaryHeld = (): KeyboardEventInit => (ShortcutKeyboardModel.isMacPlatform(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true })

describe('isMacPlatform', () => {
  it.each(['MacIntel', 'macOS', 'MacPPC'])('treats %s as macOS', platform => {
    expect(ShortcutKeyboardModel.isMacPlatform(platform)).toBe(true)
  })

  it.each(['Win32', 'Linux x86_64', ''])('treats %s as not macOS', platform => {
    expect(ShortcutKeyboardModel.isMacPlatform(platform)).toBe(false)
  })
})

describe('matchesShortcut', () => {
  it('resolves primary to Meta on macOS and Control elsewhere', () => {
    expect(ShortcutKeyboardModel.matchesShortcut(press({ metaKey: true }), searchShortcut(), true)).toBe(true)
    expect(ShortcutKeyboardModel.matchesShortcut(press({ ctrlKey: true }), searchShortcut(), true)).toBe(false)
    expect(ShortcutKeyboardModel.matchesShortcut(press({ ctrlKey: true }), searchShortcut(), false)).toBe(true)
  })

  it('refuses a chord carrying an extra modifier', () => {
    expect(ShortcutKeyboardModel.matchesShortcut(press({ metaKey: true, altKey: true }), searchShortcut(), true)).toBe(false)
    expect(ShortcutKeyboardModel.matchesShortcut(press({ metaKey: true, shiftKey: true }), searchShortcut(), true)).toBe(false)
  })

  it('requires shift exactly when the chord asks for it', () => {
    const shifted = { ...searchShortcut(), alsoShift: true }
    expect(ShortcutKeyboardModel.matchesShortcut(press({ metaKey: true, shiftKey: true }), shifted, true)).toBe(true)
    expect(ShortcutKeyboardModel.matchesShortcut(press({ metaKey: true }), shifted, true)).toBe(false)
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

describe('installShortcuts', () => {
  const disposers: Array<() => void> = []
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })

  it('claims a matching chord before bubble listeners see it', () => {
    const run = vi.fn()
    const bubbled = vi.fn()
    disposers.push(installShortcuts(window, [searchShortcut(run)]))
    window.addEventListener('keydown', bubbled)
    disposers.push(() => window.removeEventListener('keydown', bubbled))
    const chord = press(primaryHeld())
    document.body.dispatchEvent(chord)
    expect(run).toHaveBeenCalledOnce()
    expect(chord.defaultPrevented).toBe(true)
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('leaves events alone that someone else already handled or that repeat', () => {
    const run = vi.fn()
    disposers.push(installShortcuts(window, [searchShortcut(run)]))
    document.body.dispatchEvent(press({ ...primaryHeld(), repeat: true }))
    const handled = press(primaryHeld())
    handled.preventDefault()
    document.body.dispatchEvent(handled)
    expect(run).not.toHaveBeenCalled()
  })

  it('stops listening once disposed', () => {
    const run = vi.fn()
    installShortcuts(window, [searchShortcut(run)])()
    document.body.dispatchEvent(press(primaryHeld()))
    expect(run).not.toHaveBeenCalled()
  })
})
