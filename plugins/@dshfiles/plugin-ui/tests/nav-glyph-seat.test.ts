/**
 * A nav glyph seat's tone reaches a panel glyph with its own root (council round 17 A3): the Inbox glyph sits in its own
 * `.dshx-root`, whose ink overrode the rail seat's secondary tone and the phone tab seat's tertiary ink.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE } from '../src/theme/palette.ts'

type Compiler = { build(candidates: readonly string[]): string }
type CompileOptions = { readonly base: string; readonly onDependency: (path: string) => void }
let sheet = ''

beforeAll(async () => {
  const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
  // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
  const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: CompileOptions): Promise<Compiler> }
  const compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
  sheet = compiler.build([])
})

const SEAT_RULE = ":where([role='tab']:not([aria-selected='true']) > [data-rail-icon], [data-phone-tab-seat]) .dshx-root {"

describe('nav glyph seats (council round 17 A3)', () => {
  it("lets a root inside a resting rail seat or any phone tab seat take the seat's colour", () => {
    const at = sheet.indexOf(SEAT_RULE)
    expect(at, 'the seat rule is in the compiled sheet').toBeGreaterThan(-1)
    expect(sheet.slice(at, sheet.indexOf('}', at))).toMatch(/color:\s*inherit;/u)
  })

  it("comes after the root's own ink at the same specificity, in the same layer, so it wins", () => {
    const base = sheet.indexOf('@layer base')
    const root = sheet.indexOf('.dshx-root {\n', base)
    const seat = sheet.indexOf(SEAT_RULE)
    expect(sheet.slice(root, sheet.indexOf('}', root))).toMatch(/color:\s*var\(--dsw-alias-label-primary\)/u)
    expect(seat).toBeGreaterThan(root)
    // No layer boundary between them: both sit in the one `@layer base` block.
    expect(sheet.slice(root, seat)).not.toContain('@layer')
  })

  it.each(['light', 'dark'] as const)('keeps the resting glyph inks at 3:1 on the nav column (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // Secondary on the rail, tertiary (faint) on a resting phone tab.
    expect(PaletteMath.contrastRatio(p.neutral[9]!, p.navSurface)).toBeGreaterThanOrEqual(3)
    expect(PaletteMath.contrastRatio(p.neutral[8]!, p.navSurface)).toBeGreaterThanOrEqual(3)
  })
})
