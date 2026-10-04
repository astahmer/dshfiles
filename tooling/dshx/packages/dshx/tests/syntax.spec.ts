import { describe, expect, it } from 'vitest'
import { defaultCall, parseSource, stringValue, unwrapExpression } from '../src/project/syntax.js'

describe('Oxc source analysis', () => {
  it('keeps JavaScript string offsets after astral Unicode characters', () => {
    const source = '// 🪨\nexport default defineHost({ tools: [] })\n'
    const program = parseSource({ file: 'host.ts', source })
    const call = defaultCall({ program, name: 'defineHost' })
    expect(call).toBeDefined()
    expect(source.slice(call?.start, call?.end)).toBe('defineHost({ tools: [] })')
  })
  it('unwraps TypeScript authoring annotations and static template strings', () => {
    const program = parseSource({ file: 'client.ts', source: 'export default (`locale` as const) satisfies string' })
    const statement = program.body[0]
    if (statement?.type !== 'ExportDefaultDeclaration' || statement.declaration.type !== 'TSSatisfiesExpression')
      throw new Error('Expected annotated expression')
    expect(stringValue(unwrapExpression(statement.declaration))).toBe('locale')
  })
  it('rejects malformed source before a scaffold can edit it', () => {
    expect(() => parseSource({ file: 'host.ts', source: 'export default defineHost({' })).toThrow()
  })
})
