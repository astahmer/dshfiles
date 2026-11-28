// @vitest-environment jsdom
/**
 * Council round 8 A3: an enabled off switch shows its boundary, the field border (3:1 on every surface), so an off
 * toggle reads as a control and not a grey smudge; a disabled one keeps the washed look with no boundary.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Switch } from '../src/components/ui/switch.js'

afterEach(cleanup)

type Compiler = { build(candidates: readonly string[]): string }
type CompileOptions = { readonly base: string; readonly onDependency: (path: string) => void }
let compiler: Compiler
beforeAll(async () => {
  const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
  // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
  const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: CompileOptions): Promise<Compiler> }
  compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
})

const OFF_EDGE = 'dshx:enabled:aria-[checked=false]:border-field-border'
const track = (element: Element | null): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('switch off state (council round 8 A3)', () => {
  it('gives an enabled off track the 1px field border, keyed on :enabled so a disabled one keeps no edge', () => {
    const view = render(<Switch aria-label="Off" />)
    const names = track(view.container.querySelector('[data-slot="switch"]'))
    expect(names).toContain(OFF_EDGE)
    // The border box is already 1px (transparent), so the edge costs no layout.
    expect(names).toEqual(expect.arrayContaining(['dshx:border', 'dshx:border-transparent']))
  })

  it('compiles to an :enabled, unchecked rule in the field border colour', () => {
    const sheet = compiler.build([OFF_EDGE])
    const at = sheet.indexOf(':enabled')
    expect(at).toBeGreaterThan(-1)
    const rule = sheet.slice(sheet.lastIndexOf('.', at), sheet.indexOf('}', at))
    expect(rule).toContain('[aria-checked="false"]')
    expect(rule).toMatch(/border-color: var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\)|border-color: var\(--color-field-border\)/u)
  })
})
