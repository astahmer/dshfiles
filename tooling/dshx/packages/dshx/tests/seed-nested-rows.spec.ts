import { describe, expect, it } from 'vitest'
import { seedRowsComposingNestedBundles } from '../src/project/seed-nested-rows.js'

const seed = [
  '# comment',
  '- id: preset-standard',
  "  name: '@deepseek-ai/dsh-agent-preset'",
  '  config:',
  '    plugins:',
  '      - id: tool-bash',
  "        name: '@deepseek-ai/dsh-tool-bash'",
  "        disabled: !!js process.platform === 'win32'",
  '      - id: tool-ask-user',
  "        name: '@dshfiles/tool-ask-user'",
  '        config:',
  '          mode: timed',
  '- id: dshfiles-jujutsu',
  "  name: '@dshfiles/jujutsu'",
  '  config:',
  '    fileView: flat',
  '# BEGIN',
  '- id: hmr',
  '  disabled: true',
].join('\n')

describe('seedRowsComposingNestedBundles', () => {
  it('copies the whole preset row, custom tags included, when a bundle under test is one of its children', () => {
    const rows = seedRowsComposingNestedBundles(seed, ['@dshfiles/tool-ask-user'])
    expect(rows.startsWith('- id: preset-standard\n')).toBe(true)
    expect(rows).toContain("disabled: !!js process.platform === 'win32'")
    expect(rows.trimEnd().endsWith('mode: timed')).toBe(true)
    expect(rows).not.toContain('dshfiles-jujutsu')
  })

  it("leaves a bundle's own top-level row to its bundle patch", () => {
    expect(seedRowsComposingNestedBundles(seed, ['@dshfiles/jujutsu'])).toBe('')
    expect(seedRowsComposingNestedBundles(seed, [])).toBe('')
  })
})
