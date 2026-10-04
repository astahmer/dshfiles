// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installShortcuts, isEditableTarget, isMacPlatform, matchesShortcut, type Shortcut } from './keyboard.js'

const searchShortcut = (run: Shortcut['run'] = () => {}): Shortcut => ({ id: 'search', key: 'KeyP', modifier: 'primary', label: 'Search', run })

const press = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, ...init })

const primaryHeld = (): KeyboardEventInit => (isMacPlatform(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true })

describe('isMacPlatform', () => {
  it.each(['MacIntel', 'macOS', 'MacPPC'])('treats %s as macOS', platform => {
    expect(isMacPlatform(platform)).toBe(true)
  })

  it.each(['Win32', 'Linux x86_64', ''])('treats %s as not macOS', platform => {
    expect(isMacPlatform(platform)).toBe(false)
  })
})

describe('matchesShortcut', () => {
  it('resolves primary to Meta on macOS and Control elsewhere', () => {
    expect(matchesShortcut(press({ metaKey: true }), searchShortcut(), true)).toBe(true)
    expect(matchesShortcut(press({ ctrlKey: true }), searchShortcut(), true)).toBe(false)
    expect(matchesShortcut(press({ ctrlKey: true }), searchShortcut(), false)).toBe(true)
  })

  it('refuses a chord carrying an extra modifier', () => {
    expect(matchesShortcut(press({ metaKey: true, altKey: true }), searchShortcut(), true)).toBe(false)
    expect(matchesShortcut(press({ metaKey: true, shiftKey: true }), searchShortcut(), true)).toBe(false)
  })

  it('requires shift exactly when the chord asks for it', () => {
    const shifted = { ...searchShortcut(), alsoShift: true }
    expect(matchesShortcut(press({ metaKey: true, shiftKey: true }), shifted, true)).toBe(true)
    expect(matchesShortcut(press({ metaKey: true }), shifted, true)).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('accepts text fields and editable regions, refuses buttons and checkboxes', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(editable)).toBe(true)
    expect(isEditableTarget(editable.appendChild(document.createElement('span')))).toBe(true)
    expect(isEditableTarget(checkbox)).toBe(false)
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
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
