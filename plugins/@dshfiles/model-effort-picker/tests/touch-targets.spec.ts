import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sources = readdirSync(new URL('../src/', import.meta.url))
  .filter(name => name.endsWith('.tsx'))
  .map(name => ({ name, text: readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8') }))

/** Every opening tag of a control the picker draws itself: raw buttons, kit Buttons, switches and options. */
const controls = sources.flatMap(({ name, text }) =>
  [...text.matchAll(/<(?:button|Button|Switch)\b(?:=>|\s>\s|[^>])*>/gu)].map(match => ({ name, tag: match[0] })),
)

/** A real 44 px on a coarse pointer (C6: allocated space, not a hit box that overlaps its neighbours). */
const REAL_44 = /dshx:pointer-coarse:(?:size-11|h-11|min-h-11|hidden)\b/u

describe('every touch target is 44 pt (council picker C6)', () => {
  it('finds the controls it checks', () => {
    expect(controls.length).toBeGreaterThan(10)
  })

  it('gives every control a real 44 px on touch, or hides a hover-only hint there', () => {
    const short = controls.filter(({ tag }) => !REAL_44.test(tag) && !/data-touch-row/u.test(tag))
    expect(short.map(({ name, tag }) => `${name}: ${tag.replace(/\s+/gu, ' ').slice(0, 140)}`)).toEqual([])
  })

  it('lets the whole Fast mode row toggle the switch', () => {
    const fast = sources.find(source => source.name === 'fast-mode-section.tsx')?.text ?? ''
    expect(fast).toMatch(/<label\s+className="[^"]*dshx:min-h-8[^"]*dshx:flex-1[^"]*dshx:pointer-coarse:min-h-11/u)
  })
})
