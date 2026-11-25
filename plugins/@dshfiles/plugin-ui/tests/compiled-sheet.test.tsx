/**
 * Classes checked against the compiled kit sheet, not their names (council round 7, lane B follow-ups): Tailwind
 * emits theme variables under the `dshx` prefix and drops unused ones, so an arbitrary `(--text-…)` reference can name
 * a variable the sheet never defines and silently fall back to nothing.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { PageTitleMark } from '../src/components/page.js'

type Compiler = { build(candidates: readonly string[]): string }
let compiler: Compiler

beforeAll(async () => {
  // @tailwindcss/node is the compiler the kit's Vite plugin uses; reach it through that plugin.
  const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
  const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: object): Promise<Compiler> }
  compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
})

const escape = (name: string): string => name.replace(/[^\w-]/gu, match => `\\${match}`)
/** The declarations of one class's rule in the compiled sheet. */
const rule = (sheet: string, name: string): string => {
  const at = sheet.indexOf(`.${escape(name)} {`)
  return at < 0 ? '' : sheet.slice(at, sheet.indexOf('}', at))
}
/** Every `var(--x)` with no fallback in a rule must be a variable the sheet defines. */
const undefinedVariables = (sheet: string, body: string): readonly string[] =>
  [...body.matchAll(/var\((--[\w-]+)\)/gu)].map(match => match[1] ?? '').filter(name => !sheet.includes(`${name}:`))

describe('page title mark in the compiled sheet', () => {
  it('is exactly one title line tall, so the glyph centres on the title (Geist caps centre at 14.2 of 28px)', () => {
    const classes = (/class="([^"]*)"/u.exec(renderToStaticMarkup(<PageTitleMark mark={<svg />} markTone="settings" />))?.[1] ?? '').split(' ')
    const sheet = compiler.build(['dshx:text-title', ...classes])
    const title = /line-height: var\(--tw-leading, (\d+px)\)/u.exec(rule(sheet, 'dshx:text-title'))?.[1]
    expect(title).toBe('28px')
    const height = classes.filter(name => /^dshx:h-/u.test(name))
    expect(height).toHaveLength(1)
    const body = rule(sheet, height[0]!)
    expect(body).toContain(`height: ${title!};`)
    for (const name of classes) expect(undefinedVariables(sheet, rule(sheet, name)), name).toEqual([])
  })
})
