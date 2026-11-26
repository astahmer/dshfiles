// @vitest-environment jsdom
/**
 * The selected edge (council round 12 A1): a selected row that leads with a glyph, tile or mark draws no pill (round 11
 * A1), and the wash alone measured 1.10:1 off the dark page. `dshx:selected-edge` adds a neutral 1px inset edge on top
 * of the wash, 3:1 against the wash wherever it is painted: the page, the nav column and a dialog (whose dark wash
 * lifts to L 0.30, surfaces.css).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SELECTED_EDGE } from '../src/components/selection.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

type Compiler = { build(candidates: readonly string[]): string }
type CompileOptions = { readonly base: string; readonly onDependency: (path: string) => void }

const schemes: readonly Scheme[] = ['light', 'dark']
const generated = readFileSync(join(process.cwd(), '../ui-styles/src/theme.generated.css'), 'utf8')

/** The selected wash on each surface it is painted over: opaque, so the page and nav share it; a dark dialog lifts it. */
const washes = (scheme: Scheme, input: Omit<Parameters<typeof PaletteMath.palette>[0], 'scheme'> = WARM_STONE) => {
  const wash = PaletteMath.palette({ ...input, scheme }).selectedWash
  return { page: wash, nav: wash, dialog: scheme === 'dark' ? { ...wash, l: Math.max(wash.l, 0.3) } : wash }
}

describe('selected edge (council round 12 A1)', () => {
  it.each(schemes)('holds 3:1 against the selected wash on the page, the nav column and a dialog (%s)', scheme => {
    const { selectedEdge } = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const [surface, wash] of Object.entries(washes(scheme))) expect(PaletteMath.contrastRatio(selectedEdge, wash), surface).toBeGreaterThanOrEqual(3)
  })

  it.each(schemes)('is a neutral warm grey near the council value, never the accent (%s)', scheme => {
    const { selectedEdge, accent } = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(selectedEdge.c).toBeLessThan(0.02)
    expect(selectedEdge).not.toEqual(accent.fg)
    // Council: #817a73 in dark (kept within one step); light moves from #a39b93 (2.26:1) to the first value at 3:1.
    expect(PaletteMath.toHex(selectedEdge)).toBe(scheme === 'light' ? '#88827d' : '#7f7974')
  })

  it.each(schemes)('keeps 3:1 for other grey presets and contrast settings (%s)', scheme => {
    for (const input of [
      { ...WARM_STONE, contrast: 0.8 },
      { ...WARM_STONE, contrast: 1.3 },
      { hue: 250, chroma: 0, accentHue: 150, contrast: 1 },
    ]) {
      const { selectedEdge } = PaletteMath.palette({ ...input, scheme })
      for (const [surface, wash] of Object.entries(washes(scheme, input))) expect(PaletteMath.contrastRatio(selectedEdge, wash), `${surface} ${JSON.stringify(input)}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('is emitted in both theme blocks and the generated sheet', () => {
    expect(ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')).toContain('--dshx-selected-edge: oklch(0.61 0.01 65);')
    expect(ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')).toContain('--dshx-selected-edge: oklch(0.58 0.01 65);')
    expect(generated).toContain('--dshx-selected-edge: oklch(0.61 0.01 65);')
    expect(generated).toContain('--dshx-selected-edge: oklch(0.58 0.01 65);')
  })

  it('compiles to a 1px inset edge that moves nothing, exported as SELECTED_EDGE', async () => {
    expect(SELECTED_EDGE).toBe('dshx:selected-edge')
    const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
    // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
    const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: CompileOptions): Promise<Compiler> }
    const compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
    const sheet = compiler.build([SELECTED_EDGE])
    const at = sheet.indexOf('.dshx\\:selected-edge {')
    expect(at).toBeGreaterThanOrEqual(0)
    const body = sheet.slice(at, sheet.indexOf('}', at))
    expect(body).toMatch(/box-shadow: inset 0 0 0 1px var\(--dshx-selected-edge, var\(--dshx-field-border/u)
    expect(body).not.toMatch(/^\s*(?:border|padding|margin|outline)[a-z-]*:/mu)
  })
})
