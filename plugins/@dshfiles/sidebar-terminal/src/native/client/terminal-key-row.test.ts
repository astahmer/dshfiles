import { describe, expect, it } from 'vitest'
import { TERMINAL_KEY_ROW_KEYS } from './terminal-key-row.js'

describe('terminal key row', () => {
  it('sends the sequences a software keyboard cannot type', () => {
    const sequence = (id: string): string | undefined => TERMINAL_KEY_ROW_KEYS.find(key => key.id === id)?.sequence
    expect(sequence('esc')).toBe('\x1b')
    expect(sequence('tab')).toBe('\t')
    expect(sequence('ctrl-c')).toBe('\x03')
    expect(sequence('up')).toBe('\x1b[A')
    expect(sequence('down')).toBe('\x1b[B')
    expect(sequence('left')).toBe('\x1b[D')
    expect(sequence('right')).toBe('\x1b[C')
  })

  it('gives every key a unique id and a non-empty cap', () => {
    const ids = TERMINAL_KEY_ROW_KEYS.map(key => key.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TERMINAL_KEY_ROW_KEYS.every(key => key.label !== '')).toBe(true)
  })
})
