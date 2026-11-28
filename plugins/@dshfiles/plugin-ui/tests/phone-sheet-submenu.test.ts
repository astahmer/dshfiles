import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/**
 * A phone row menu's More submenu opened with its first rows cut off (merge 534773f0, "opens mid-scroll"). It is not a
 * scroll: Radix renders a submenu inside its parent menu, and the parent sheet's entry animation kept filling its
 * `transform` after it ended (`both`). A transform, even an identity one, makes the parent the containing block of the
 * submenu's fixed sheet, so the 72dvh submenu sat in the shorter parent sheet and was clipped by it. The entry keyframes
 * only state `from`, so `backwards` paints the same frames and leaves no transform once the sheet is in.
 */
describe('phone sheet entry animation', () => {
  const entries = [...styles.matchAll(/animation:\s*dshx-sheet-in\b([^;]*);/gu)].map(match => match[1] ?? '')

  it('animates the phone sheets in', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('keeps no transform once a sheet is in, so a submenu sheet is never clipped by its parent', () => {
    for (const entry of entries) {
      expect(entry).toMatch(/\bbackwards\b/u)
      expect(entry).not.toMatch(/\b(?:both|forwards)\b/u)
    }
  })

  it('states only a `from` frame, so the fill mode after the end changes nothing on screen', () => {
    const keyframes = /@keyframes dshx-sheet-in\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/u.exec(styles)?.[1] ?? ''
    expect(keyframes).toMatch(/from\s*\{/u)
    expect(keyframes).not.toMatch(/\bto\s*\{|100%/u)
  })
})
