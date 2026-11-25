import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('the Agent CLI threads page', () => {
  it('is a kit Page whose count is plain text and never zero', () => {
    const panel = read('panel.tsx')
    expect(panel).toContain('<Page')
    expect(panel).not.toContain('<PageHeader')
    expect(panel).not.toMatch(/<Badge variant="outline">\{t\('sessionsCount'/u)
  })

  it('says in one sentence that there is nothing yet, with the paths folded under "Where we look"', () => {
    const locales = read('locales.ts')
    expect(locales).toContain("noSources: 'No Claude Code or Codex threads on this machine yet.',")
    expect(locales).toContain("whereWeLook: 'Where we look',")
    expect(read('panel.tsx')).toMatch(/<CollapsibleTrigger[\s\S]{0,400}t\('whereWeLook'\)/u)
  })

  it('hides the filters over an empty list', () => {
    expect(read('panel.tsx')).toMatch(/\{noSources \? null : \(\s*<div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:@max-pane-compact:flex-col/u)
  })
})
