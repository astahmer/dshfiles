import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AgentToolkit } from './toolkit-model.js'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('the Capabilities page', () => {
  // DESIGN.md › Colour roles: a source is a category, not a status, so its badge takes no status hue.
  it('draws source badges muted, never with a status hue', () => {
    const source = /const SOURCE_VARIANT = \{([^}]*)\}/u.exec(read('toolkit-panel.tsx'))?.[1] ?? ''
    expect(source).not.toMatch(/'(?:info|warning|success|destructive)'/u)
  })

  it('is titled Capabilities, as the rail names it', () => {
    expect(read('locales.ts')).toMatch(/^ {2}title: 'Capabilities',$/mu)
  })

  it('names the owning feature, not its package', () => {
    expect(AgentToolkit.featureName('@dshfiles/agent-communication')).toBe('Agent communication')
    expect(AgentToolkit.featureName('@dshfiles/memory')).toBe('Memory')
    expect(AgentToolkit.featureName('dsh-native')).toBe('Dsh native')
    expect(read('toolkit-panel.tsx')).not.toMatch(/break-all">\{(?:tool|row)\.owner\}/u)
  })
})
