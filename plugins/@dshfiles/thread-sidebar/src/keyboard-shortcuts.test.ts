import assert from 'node:assert/strict'
import { test } from 'vitest'
import { KeyboardShortcutModel, parseChord, serializeChord } from './keyboard-shortcuts.js'

const key = (code: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  code,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
})

test('chords round-trip, reject unmodified keys, and match exactly', () => {
  const chord = parseChord('shift+primary+KeyP')
  assert.ok(chord)
  assert.equal(serializeChord(chord), 'primary+shift+KeyP')
  assert.equal(parseChord('KeyP'), null)
  assert.equal(parseChord('primary+MetaLeft'), null)
  assert.equal(parseChord('hyper+KeyP'), null)

  assert.equal(KeyboardShortcutModel.chordFromEvent(key('KeyP'), true), null)
  assert.equal(KeyboardShortcutModel.chordFromEvent(key('MetaLeft', { meta: true }), true), null)
  assert.equal(serializeChord(KeyboardShortcutModel.chordFromEvent(key('KeyK', { meta: true }), true) ?? { code: '', modifiers: [] }), 'primary+KeyK')
  assert.equal(serializeChord(KeyboardShortcutModel.chordFromEvent(key('KeyK', { ctrl: true }), false) ?? { code: '', modifiers: [] }), 'primary+KeyK')

  const palette = parseChord('primary+KeyK')
  assert.ok(palette)
  assert.equal(KeyboardShortcutModel.matchesChord(key('KeyK', { meta: true }), palette, true), true)
  assert.equal(KeyboardShortcutModel.matchesChord(key('KeyK', { meta: true, alt: true }), palette, true), false)
  assert.equal(KeyboardShortcutModel.matchesChord(key('KeyK', { ctrl: true }), palette, true), false)
})

test('chords format per platform and detect Host bindings on the same physical keys', () => {
  const chord = parseChord('primary+alt+KeyK')
  assert.ok(chord)
  assert.deepEqual(KeyboardShortcutModel.formatChord(chord, true), ['⌘', '⌥', 'K'])
  assert.deepEqual(KeyboardShortcutModel.formatChord(chord, false), ['Ctrl', 'Alt', 'K'])
  assert.equal(KeyboardShortcutModel.sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['alt', 'meta'] }, true), true)
  assert.equal(KeyboardShortcutModel.sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['meta'] }, true), false)
  assert.equal(KeyboardShortcutModel.sameAsHostBinding(chord, { code: 'KeyK', modifiers: ['alt', 'control'] }, false), true)
  assert.equal(KeyboardShortcutModel.sameAsHostBinding(chord, null, true), false)
})
