import { readFileSync } from 'node:fs'
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

  // Runs from the package root (vitest's jsdom URL is not a file URL). The row exists only on a coarse pointer, so its keys take the 44px touch target (a 40px key missed thumbs).
  it('gives every key a 44px touch target', () => {
    const css = readFileSync('src/native/client/terminal.module.css', 'utf8')
    const rule = /^\.keyButton \{([^}]*)\}/mu.exec(css)?.[1] ?? ''
    const value = (property: string): string | undefined => new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, 'u').exec(rule)?.[1]?.trim()
    expect(value('min-width')).toBe('44px')
    expect(value('min-height')).toBe('44px')
    expect(value('height')).toBeUndefined()
  })
})
