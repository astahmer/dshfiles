import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

/** The class string of the JSX element that carries `marker` (an attribute or a literal in its opening tag). */
const classesOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  if (at < 0) throw new Error(`no element with ${marker}`)
  const open = text.lastIndexOf('<', at)
  const close = text.indexOf('>\n', at)
  return text.slice(open, close)
}

describe('desktop picker is one bounded surface (council picker S2)', () => {
  const picker = source('model-effort-picker.tsx')

  it('draws one popover card with a 12 px collision padding, not two floating cards', () => {
    const content = classesOf(picker, '<PopoverContent')
    expect(content).toContain('collisionPadding={12}')
    // A container's inline size cannot come from its content: the card is 360 + 1 + 320 px wide, within the viewport.
    expect(content).toMatch(/dshx:@container dshx:w-\[min\(42\.5625rem,calc\(100vw-1\.5rem\)\)\]/u)
    expect(content).toMatch(/dshx:rounded-xl/u)
    expect(content).toMatch(/dshx:border /u)
    expect(content).toMatch(/dshx:bg-popover/u)
    expect(content).not.toMatch(/dshx:bg-transparent|dshx:shadow-none/u)
    // Neither half paints its own card.
    expect(classesOf(picker, 'aria-label="Choose a model"')).not.toMatch(/shadow-lg|rounded-xl|dshx:border /u)
    expect(classesOf(picker, 'data-model-inspector')).not.toMatch(/shadow-lg|rounded-xl/u)
  })

  it('splits a 360 px list from a 320 px inspector with a 1 px divider, at a fixed height so typing never moves the search', () => {
    expect(classesOf(picker, 'data-model-picker-surface')).toMatch(/dshx:h-\[min\(26rem,var\(--radix-popover-content-available-height\)\)\]/u)
    expect(classesOf(picker, 'aria-label="Choose a model"')).toMatch(/dshx:w-90 /u)
    const inspector = classesOf(picker, 'data-model-inspector')
    expect(inspector).toMatch(/dshx:w-80 /u)
    expect(inspector).toMatch(/dshx:border-l /u)
    // No caret pointing from a second card.
    expect(picker).not.toMatch(/rotate-45/u)
    // No width fitted to the longest name: the halves are fixed, so the surface never resizes under the pointer.
    expect(picker).not.toMatch(/nameWidthShortfall|popoverWidth/u)
  })

  it('fades rows 8 px where they pass under the search and the footer', () => {
    expect(classesOf(picker, 'data-model-picker-scroll')).toContain(
      'mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-8px),transparent)',
    )
  })
})
