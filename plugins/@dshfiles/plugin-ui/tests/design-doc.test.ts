import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root; DESIGN.md sits at the repository root.
const design = readFileSync(join(process.cwd(), '../../../DESIGN.md'), 'utf8')
const manifest = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
const exports = (subpath: string): boolean => manifest.includes(`"./${subpath}": {`)

describe('DESIGN.md and the kit agree (round four R8-R15)', () => {
  it('names only kit modules the package exports', () => {
    const named = [...design.matchAll(/@dshfiles\/plugin-ui\/((?:lib|components)\/[\w-]+)/gu)].map(match => match[1] ?? '')
    expect(named).toEqual(expect.arrayContaining(['lib/host-connection', 'lib/error-copy']))
    for (const path of named) {
      const exported = exports(path) || (path.startsWith('components/') && exports('components/*'))
      expect(exported, path).toBe(true)
    }
  })

  it('carries the connection, focus ring, phone hit area and error copy rules', () => {
    for (const text of [
      '## Connection, loading and errors',
      '**Focus ring.**',
      '**Announcements.**',
      '**Waiting on you is Needs you, whatever asks.**',
      '`dshx-hit-44`',
      'a faint\nfocus ring (`ring-ring/50`)',
      'a transport failure or an error code echoed to the user',
    ])
      expect(design).toContain(text)
  })

  it('records the round-five tint rung, project mark, data ramp, surface steps, spacing and compound focus rules', () => {
    for (const text of [
      '**Tint rung.**',
      '`variant="attention"`',
      '`bg-selected-wash`',
      '`ProjectMark`',
      'The data ramp never starts with the accent',
      '**Surface steps.**',
      "  stack: '16px'\n  section: '20px'\n  page: '24px'",
      'padding 24px, 12px below 28rem',
      '**Compound fields.**',
      '`bg-scrim`',
    ])
      expect(design, text).toContain(text)
  })
})
