import { describe, expect, it } from 'vitest'
import { JsonDocumentModel } from '../src/project/json-document.js'
import { packageTargets } from '../src/project/package-targets.js'

describe('package JSON document boundary', () => {
  it('retains arbitrary nested metadata and invalid field values for diagnostics and repair', () => {
    const source = '{"name":false,"custom":{"nested":[null,3,true,{"value":"kept"}]},"dsh":{"client":{"inject":["provider",null],"immediately":"not-boolean"}}}'
    expect(JsonDocumentModel.parse(source)).toEqual(JSON.parse(source))
    expect(JsonDocumentModel.isObject(JsonDocumentModel.parse(source))).toBe(true)
    expect(JsonDocumentModel.isObject(JsonDocumentModel.parse('null'))).toBe(false)
    expect(JsonDocumentModel.isObject(JsonDocumentModel.parse('[]'))).toBe(false)
    expect(() => JsonDocumentModel.parse('{')).toThrow()
  })

  it('preserves own prototype-named metadata keys without polluting object prototypes', () => {
    const source = '{"__proto__":{"kept":true},"constructor":{"kept":true},"nested":{"__proto__":"kept"}}'
    const document = JsonDocumentModel.parse(source)
    expect(JSON.stringify(document)).toBe(source)
    expect(Object.keys(document ?? {})).toContain('__proto__')
    expect(Object.getPrototypeOf(document)).toBe(Object.prototype)
    expect(Object.getPrototypeOf({})).not.toHaveProperty('kept')
  })

  it('narrows strings without coercion or silently dropping invalid array entries', () => {
    expect(JsonDocumentModel.string('')).toBe('')
    expect(JsonDocumentModel.string(1)).toBeUndefined()
    expect(JsonDocumentModel.string(null)).toBeUndefined()
    expect(JsonDocumentModel.stringArray(['provider', ''])).toEqual(['provider', ''])
    expect(JsonDocumentModel.stringArray(['provider', false])).toBeUndefined()
    expect(JsonDocumentModel.stringArray(undefined)).toBeUndefined()
  })

  it('collects conditional and array package targets while ignoring JSON non-targets', () => {
    expect(
      packageTargets({
        main: './dist/index.js',
        exports: { '.': { types: './src/index.ts', default: ['./dist/index.js', null, false] }, './disabled': null },
        ignored: () => 'not a publish field',
      }),
    ).toEqual([
      { field: 'main', target: './dist/index.js' },
      { field: 'exports...types', target: './src/index.ts' },
      { field: 'exports...default[0]', target: './dist/index.js' },
    ])
  })
})
