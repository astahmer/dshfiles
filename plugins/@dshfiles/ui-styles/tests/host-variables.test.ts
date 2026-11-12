/**
 * Guard for the visual-refresh theme block (visual refresh T0.3): it overrides Host `--dsw-*` variables by
 * name, so a DSH bump that renames one would silently drop that override. Read the installed Host theme sheet and fail
 * when any overridden name, or the selector it is declared under, no longer exists.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ThemeCss } from '@dshfiles/plugin-ui/theme/css'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

// The theme package is a dependency of @deepseek-ai/dsh (a devDependency here), so resolve it through dsh.
const require = createRequire(join(process.cwd(), 'package.json'))
const dsh = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const themeRoot = dirname(dsh.resolve('@deepseek-ai/dsh-client-ui-theme/package.json'))
const sheet = readFileSync(join(themeRoot, 'lib/client.js'), 'utf8')
const { version } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(
  readFileSync(join(themeRoot, 'package.json'), 'utf8'),
)

/** Declarations of one top-level CSS block, for every block whose selector is exactly `selector`. */
function declared(selector: string): Set<string> {
  const names = new Set<string>()
  const pattern = /([^{}"]*)\{([^{}]*)\}/gu
  for (const match of sheet.matchAll(pattern)) {
    if ((match[1] ?? '').trim().replace(/^.*"/u, '') !== selector) continue
    for (const decl of (match[2] ?? '').split(';')) {
      const name = decl.split(':')[0]?.trim()
      if (name?.startsWith('--')) names.add(name)
    }
  }
  return names
}

describe(`Host theme variables (dsh-client-ui-theme ${version})`, () => {
  const root = declared(':root')
  const light = declared('body')
  const dark = declared('body[data-ds-dark-theme]')

  it('still declares every --dsw-* name the theme block overrides', () => {
    const everywhere = new Set([...root, ...light, ...dark])
    const missing = ThemeCss.overriddenHostVariables().filter(name => !everywhere.has(name))
    expect(missing, 'renamed or removed Host variables; update plugin-ui/src/theme/theme-css.ts').toEqual([])
  })

  it('declares radii on :root and colour aliases on body, which our selectors out-rank', () => {
    const names = ThemeCss.overriddenHostVariables()
    for (const name of names.filter(n => n.startsWith('--dsw-radius-'))) expect(root.has(name), name).toBe(true)
    for (const name of names.filter(n => n.startsWith('--dsw-alias-') || n.startsWith('--dsw-specific-'))) {
      expect(light.has(name) || dark.has(name), name).toBe(true)
    }
    expect(dark.size).toBeGreaterThan(50)
  })

  it('keeps the font-family hook the theme block uses, and its size variables', () => {
    expect(sheet).toContain('--dsw-font-family:var(--dsh-font-family-text,var(--dsh-font-family-text-default))')
    expect(sheet).toContain('--ds-font-family-code:var(--dsh-font-family-code,var(--dsh-font-family-code-default))')
    expect(sheet).toContain('--dsh-code-font-size')
    // fonts.css replaces these defaults on :root:root.
    expect(root.has('--dsh-font-family-text-default')).toBe(true)
    expect(root.has('--dsh-font-family-code-default')).toBe(true)
  })

  it('still declares every --dsw-* name the transcript card sheet (P2 T2.4) re-scopes', () => {
    const transcript = readFileSync(join(process.cwd(), 'src/transcript.css'), 'utf8')
    const names = [...new Set([...transcript.matchAll(/(--dsw-[a-z0-9-]+)\s*:/gu)].map(match => match[1] ?? ''))]
    expect(names.length).toBeGreaterThan(0)
    const everywhere = new Set([...root, ...light, ...dark])
    expect(
      names.filter(name => !everywhere.has(name)),
      'renamed Host variables; update ui-styles/src/transcript.css',
    ).toEqual([])
    for (const variable of ['--dsh-code-font-size', '--dsh-code-font-delta']) expect(sheet).toContain(variable)
  })
})
