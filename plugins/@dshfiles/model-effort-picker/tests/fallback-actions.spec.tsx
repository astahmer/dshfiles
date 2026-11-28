import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/fallbacks-section.tsx', import.meta.url), 'utf8')
const tagOf = (marker: string): string => {
  // The attribute line, not a selector naming it.
  const at = source.search(new RegExp(`\\n\\s+${marker}[\\s>=]`, 'u'))
  return source.slice(source.lastIndexOf('<', at), source.indexOf('>\n', at))
}

describe('fallback order is editable by touch (council picker round 5, U5)', () => {
  it('replaces each route remove button with one 44 pt actions button per rank', () => {
    expect(source).not.toMatch(/aria-label=\{`Remove \$\{row\.model\}/u)
    const trigger = tagOf('data-model-fallback-actions')
    expect(trigger).toContain('aria-label={`Actions for fallback ${String(index + 1)}`}')
    expect(trigger).toMatch(/dshx:pointer-coarse:size-11/u)
  })

  it('offers Move up, Move down and Remove, leaving out the moves the rank cannot make', () => {
    expect(source).toMatch(/\{index === 0 \? null : <DropdownMenuItem onSelect=\{\(\) => moveTo\(index, index - 1\)\}>Move up<\/DropdownMenuItem>\}/u)
    expect(source).toMatch(
      /\{index === count - 1 \? null : <DropdownMenuItem onSelect=\{\(\) => moveTo\(index, index \+ 1\)\}>Move down<\/DropdownMenuItem>\}/u,
    )
    expect(source).toMatch(/onSelect=\{\(\) => removeAt\(index\)\}[^>]*>\s*Remove/u)
  })

  it('announces the new rank for the menu and Alt+Arrow alike, and keeps the account in a fixed slot', () => {
    expect(source).toContain('if (to >= 0 && to < count && !props.disabled) moveTo(index, to)')
    expect(source).toContain('setMoved(`${row.model} on ${row.account} is now fallback ${String(to + 1)}`)')
    expect(source).toMatch(/aria-live="polite"[^>]*data-model-fallback-announcer/u)
    expect(tagOf('data-model-fallback-account')).toMatch(/dshx:w-12 dshx:shrink-0/u)
  })
})
