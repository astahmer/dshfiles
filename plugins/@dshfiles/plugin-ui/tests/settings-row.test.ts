/**
 * The Settings row grammar (council round 8 A5): a hairline between rows, a full-row hover wash, and three type steps
 * (section heading 15/600 with 32px above, row label 14/500, description 13/400 muted). Checked in the compiled kit
 * sheet, so a utility that never reaches the sheet fails here.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

type Compiler = { build(candidates: readonly string[]): string }
type CompileOptions = { readonly base: string; readonly onDependency: (path: string) => void }
let sheet = ''

beforeAll(async () => {
  const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
  // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
  const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: CompileOptions): Promise<Compiler> }
  const compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
  sheet = compiler.build(['dshx:settings-row', 'dshx:settings-heading', 'dshx:settings-label', 'dshx:settings-description'])
})

/** Everything the sheet emits for one class, nested rules included. */
const rules = (name: string): string => {
  const selector = `.${name.replace(/[^\w-]/gu, match => `\\${match}`)}`
  return sheet
    .split(/\n(?=\S|\s{2}\.|\s{2}@)/u)
    .filter(block => block.includes(selector))
    .join('\n')
}
const schemes: readonly Scheme[] = ['light', 'dark']

describe('settings row (council round 8 A5)', () => {
  it('draws an inset hairline at the bottom and bleeds its wash past the text without moving it', () => {
    const row = rules('dshx:settings-row')
    expect(row).toContain('--dshx-row-bleed: 8px;')
    expect(row).toContain('margin-inline: calc(-1 * var(--dshx-row-bleed));')
    expect(row).toContain('padding-inline: var(--dshx-row-bleed);')
    // The hairline is a 1px background stripe inset by the bleed, so it lines up with the text, not the wash.
    expect(row).toContain('background-image: linear-gradient(var(--dsw-alias-border-l2), var(--dsw-alias-border-l2));')
    expect(row).toContain('background-size: calc(100% - 2 * var(--dshx-row-bleed)) 1px;')
    expect(row).toContain('background-position: bottom center;')
    expect(row).toContain('border-bottom-width: 0')
  })

  it('washes the whole row on hover (pointer devices only) and when a control inside has keyboard focus', () => {
    const row = rules('dshx:settings-row')
    expect(row).toMatch(/@media \(hover: hover\)[\s\S]*:hover[\s\S]*background-color: var\(--dsw-alias-interactive-bg-hover\)/u)
    expect(row).toMatch(/:has\(:focus-visible\)[\s\S]*background-color: var\(--dsw-alias-interactive-bg-hover\)/u)
  })

  it('sets the three type steps', () => {
    expect(rules('dshx:settings-heading')).toMatch(/margin-block-start: 32px;[\s\S]*font-size: 15px;[\s\S]*line-height: 20px;[\s\S]*font-weight: 600;/u)
    expect(rules('dshx:settings-label')).toMatch(/font-size: 14px;[\s\S]*line-height: 20px;[\s\S]*font-weight: 500;[\s\S]*color: var\(--dsw-alias-label-primary\);/u)
    expect(rules('dshx:settings-description')).toMatch(/font-size: 13px;[\s\S]*line-height: 18px;[\s\S]*font-weight: 400;[\s\S]*color: var\(--dsw-alias-label-secondary\);/u)
  })

  it.each(schemes)('keeps the label and the description AA on the hover wash (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // `--dsw-alias-interactive-bg-hover` is ink at 6% (light) / 7% (dark) over the stage (theme-css.ts), composited in sRGB.
    const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
      const channels = (color: Oklch) => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
      const [u, o] = [channels(under), channels(over)]
      return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
    }
    const wash = composite(p.neutral[0]!, p.neutral[10]!, scheme === 'light' ? 0.06 : 0.07)
    expect(PaletteMath.contrastRatio(p.neutral[10]!, wash)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[9]!, wash)).toBeGreaterThanOrEqual(4.5)
    // The hairline stays visible on the wash and on the page.
    expect(PaletteMath.contrastRatio(p.neutral[4]!, p.neutral[0]!)).toBeGreaterThan(1.1)
  })
})
