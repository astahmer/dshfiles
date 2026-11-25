import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const strip = readFileSync(resolve(here, 'native/client/StatusStrip.tsx'), 'utf8')
const css = readFileSync(resolve(here, 'native/client/AppFrame.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'
/** The body of the phone-shell media block (the last one: the frame's phone navigation rules). */
const phoneBlock = (): string => {
  const start = css.lastIndexOf(PHONE)
  return start === -1 ? '' : css.slice(start)
}
/** The declarations of the first rule whose selector is exactly `selector` inside `source`. */
const rule = (source: string, selector: string): string => {
  const at = source.indexOf(`${selector} {`)
  return at === -1 ? '' : source.slice(at, source.indexOf('}', at))
}

describe('the status strip (round four item 19)', () => {
  it('is a labelled group, never a live region: a screen reader does not hear it change during a turn', () => {
    expect(strip).not.toMatch(/role="status"/u)
    expect([...strip.matchAll(/data-status-strip=[^>]*role="group" aria-label="Status"/gu)]).toHaveLength(3)
  })

  it('gives the phone pill a 44px hit area inside a 44px row, so it never reaches into the tab bar', () => {
    expect(strip).toMatch(/className=\{`\$\{css\.statusChip\} dshx-hit-44`\}/u)
    expect(rule(phoneBlock(), ":global([data-shell-phone-nav]) .statusStrip[data-status-strip='compact']")).toMatch(/height:\s*calc\(44px \+ max\(0px, /u)
  })

  it('pads the phone frame by the left and right safe areas', () => {
    const frame = rule(phoneBlock(), ':global([data-shell-phone-nav]) .frame')
    expect(frame).toMatch(/padding-left:\s*env\(safe-area-inset-left/u)
    expect(frame).toMatch(/padding-right:\s*env\(safe-area-inset-right/u)
  })

  it('draws hover styles only where something can hover', () => {
    const hovers = [...css.matchAll(/:hover/gu)].map(match => css.lastIndexOf('@media', match.index))
    expect(hovers.length).toBeGreaterThan(0)
    for (const mediaAt of hovers) expect(css.slice(mediaAt, mediaAt + 40)).toMatch(/^@media \(hover: hover\)/u)
  })
})
