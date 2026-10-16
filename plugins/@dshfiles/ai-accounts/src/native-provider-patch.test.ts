import { describe, expect, it } from 'vitest'
import { NativeProviderPatch } from './native-provider-patch.js'

const userPatch = `# Your patch layer for this dsh profile
- id: llm-commandcode
  config:
    apiKeyEnv: COMMANDCODE_API_KEY
- id: agent-default-model
  config:
    provider: codex
`

describe('native provider switch in the profile patch', () => {
  it('disables a row by appending a marked patch and leaves everything else byte for byte', () => {
    const next = NativeProviderPatch.withRowDisabled(userPatch, { id: 'llm-commandcode', label: 'Command Code' })
    expect(next.startsWith(userPatch)).toBe(true)
    expect(next.slice(userPatch.length)).toBe('# ai-accounts: native provider switch — Command Code\n- id: llm-commandcode\n  disabled: true\n')
    expect(NativeProviderPatch.managedDisabledRows(next)).toEqual(new Map([['llm-commandcode', 'Command Code']]))
    expect(NativeProviderPatch.withRowDisabled(next, { id: 'llm-commandcode', label: 'Command Code' })).toBe(next)
  })

  it('re-enables by removing only its own block, restoring the original file', () => {
    const disabled = NativeProviderPatch.withRowDisabled(NativeProviderPatch.withRowDisabled(userPatch, { id: 'llm-commandcode', label: 'Command Code' }), {
      id: 'llm-deepseek',
      label: 'DeepSeek',
    })
    const restored = NativeProviderPatch.withRowEnabled(NativeProviderPatch.withRowEnabled(disabled, 'llm-commandcode'), 'llm-deepseek')
    expect(restored).toBe(userPatch)
  })

  it('never removes a disable the user wrote by hand', () => {
    const handWritten = `${userPatch}- id: llm-deepseek\n  disabled: true\n`
    expect(NativeProviderPatch.managedDisabledRows(handWritten).size).toBe(0)
    expect(NativeProviderPatch.withRowEnabled(handWritten, 'llm-deepseek')).toBe(handWritten)
  })

  it('handles an empty or missing patch and refuses shapes it cannot append to safely', () => {
    expect(NativeProviderPatch.withRowDisabled('', { id: 'llm-deepseek', label: 'DeepSeek' })).toBe(
      '# ai-accounts: native provider switch — DeepSeek\n- id: llm-deepseek\n  disabled: true\n',
    )
    expect(NativeProviderPatch.withRowDisabled('[]\n', { id: 'llm-deepseek', label: '' })).toContain('- id: llm-deepseek\n')
    expect(() => NativeProviderPatch.withRowDisabled('[{ id: x }]\n', { id: 'llm-deepseek', label: '' })).toThrow(/not a plain YAML list/)
    expect(() => NativeProviderPatch.withRowDisabled('root:\n  - id: x\n', { id: 'llm-deepseek', label: '' })).toThrow(/not a plain YAML list/)
    expect(() => NativeProviderPatch.withRowDisabled('- id: x\n  config: [unclosed\n', { id: 'llm-deepseek', label: '' })).toThrow(/not a plain YAML list/)
    expect(() => NativeProviderPatch.withRowDisabled('  - id: x\n', { id: 'llm-deepseek', label: '' })).toThrow(/not a plain YAML list/)
    expect(() => NativeProviderPatch.withRowDisabled(userPatch, { id: 'bad id\n- id: x', label: '' })).toThrow(/Refusing/)
  })
})
