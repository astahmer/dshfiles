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
    // The composer trigger is exempt: the composer row gives its buttons the 44 pt hit area (see the next test).
    const short = controls.filter(({ tag }) => !REAL_44.test(tag) && !/data-touch-row|data-model-trigger/u.test(tag))
    expect(short.map(({ name, tag }) => `${name}: ${tag.replace(/\s+/gu, ' ').slice(0, 140)}`)).toEqual([])
  })

  it("draws the composer trigger at the bar's 32 px chip height on touch, its 44 pt hit area coming from the composer row", () => {
    const trigger = controls.find(({ tag }) => tag.includes('data-model-trigger'))?.tag ?? ''
    expect(trigger).toMatch(/dshx:h-8 /u)
    expect(trigger).not.toMatch(/pointer-coarse:(?:min-)?h-/u)
  })

  it('lets the whole Fast mode row toggle the switch', () => {
    const fast = sources.find(source => source.name === 'fast-mode-section.tsx')?.text ?? ''
    expect(fast).toMatch(/className="dshx:flex dshx:min-h-8 [^"]*dshx:pointer-coarse:min-h-11"\s+data-model-fast-row\s+onClick=/u)
    // The row is the only target: the switch keeps no 34 px hit area of its own beside it, its clicks stay single.
    expect(fast).toContain('event.target.closest(\'[role="switch"]\') !== null')
  })

  it("keeps the rows' details chevrons whole under the list's overlay scrollbar on touch (round 5 U13)", () => {
    const picker = sources.find(source => source.name === 'model-effort-picker.tsx')?.text ?? ''
    const listbox = picker.slice(picker.lastIndexOf('<div', picker.indexOf('aria-label="Models and accounts"')), picker.indexOf('role="listbox"'))
    // Round 6 V4: the list keeps 8 px on the phone, which the chevrons' 44 pt boxes reach into (to Close's edge); the
    // 10 px overlay scrollbar lets taps through instead of taking room.
    expect(listbox).toMatch(/dshx:@max-pane-compact:pr-2/u)
    expect(picker).toContain('dshx:pointer-coarse:[&_[data-slot=scroll-area-scrollbar]]:pointer-events-none')
  })
})
