import { describe, expect, it } from 'vitest'
import { SourceSyntax } from '../src/project/syntax.js'

describe('Oxc source analysis', () => {
  it('keeps JavaScript string offsets after astral Unicode characters', () => {
    const source = '// 🪨\nexport default defineHost({ tools: [] })\n'
    const program = SourceSyntax.parse({ file: 'host.ts', source })
    const call = SourceSyntax.defaultCall({ program, name: 'defineHost' })
    expect(call).toBeDefined()
    expect(source.slice(call?.start, call?.end)).toBe('defineHost({ tools: [] })')
  })
  it('finds default calls, named properties, and import insertion offsets', () => {
    const source = "import { defineHost } from 'dshx'\nexport default defineHost({ name: 'sample' })\n"
    const program = SourceSyntax.parse({ file: 'host.ts', source })
    const call = SourceSyntax.defaultCall({ program, name: 'defineHost' })
    if (call === undefined) throw new Error('Expected a default Host call')
    const argument = call.arguments[0]
    if (argument === undefined || argument.type === 'SpreadElement') throw new Error('Expected a Host options object')
    const property = SourceSyntax.objectProperty({ expression: argument, name: 'name' })
    if (property === undefined) throw new Error('Expected a Host name property')

    expect(SourceSyntax.propertyName(property.key)).toBe('name')
    expect(SourceSyntax.stringValue(property.value)).toBe('sample')
    expect(source.slice(0, SourceSyntax.lastImportEnd(program))).toBe("import { defineHost } from 'dshx'")
  })
  it('unwraps TypeScript authoring annotations and static template strings', () => {
    const program = SourceSyntax.parse({ file: 'client.ts', source: 'export default (`locale` as const) satisfies string' })
    const statement = program.body[0]
    if (statement?.type !== 'ExportDefaultDeclaration' || statement.declaration.type !== 'TSSatisfiesExpression')
      throw new Error('Expected annotated expression')
    expect(SourceSyntax.stringValue(SourceSyntax.unwrapExpression(statement.declaration))).toBe('locale')
  })
  it('rejects malformed source before a scaffold can edit it', () => {
    expect(() => SourceSyntax.parse({ file: 'host.ts', source: 'export default defineHost({' })).toThrow()
  })
})
