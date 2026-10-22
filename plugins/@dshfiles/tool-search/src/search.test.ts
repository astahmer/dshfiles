import { describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { ToolSearchModel } from './search.js'

const catalog: ToolSchema[] = [
  { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: {} } },
  { name: 'write_file', description: 'Create or replace a workspace file', parameters: { type: 'object', properties: {} } },
  { name: 'search_threads', description: 'Find earlier conversations by their contents', parameters: { type: 'object', properties: {} } },
  { name: 'thread_status', description: 'Inspect a thread state', parameters: { type: 'object', properties: {} } },
]

describe('rankTools', () => {
  it('ranks exact names first and uses deterministic name order for ties', () => {
    expect(ToolSearchModel.rank('read_file', catalog)[0]?.name).toBe('read_file')
    expect(ToolSearchModel.rank('thread', catalog).map(tool => tool.name)).toEqual(['thread_status', 'search_threads'])
  })

  it('matches descriptions and normalizes Unicode compatibility characters', () => {
    expect(ToolSearchModel.rank('ＦＩＬＥ workspace', catalog).map(tool => tool.name)).toContain('read_file')
    expect(ToolSearchModel.rank('earlier conversations', catalog).map(tool => tool.name)).toContain('search_threads')
  })

  it('returns no candidates for an unrelated query in a broad catalog', () => {
    const decoys = Array.from({ length: 599 }, (_, index): ToolSchema => ({
      name: `inspect_catalog_${String(index + 1).padStart(3, '0')}`,
      description: 'Inspect synthetic catalog metadata to identify diagnostic signals.',
      parameters: { type: 'object', properties: {} },
    }))
    const broadCatalog = [...catalog, ...decoys]

    expect(broadCatalog).toHaveLength(603)
    expect(ToolSearchModel.rank('book flight', broadCatalog)).toEqual([])
  })

  it('rejects blank and overlong queries and limits outside the configured ceiling', () => {
    const limits = { maxResults: 2, maxQueryChars: 8 }
    expect(() => ToolSearchModel.validate('  ', undefined, limits)).toThrow('must not be blank')
    expect(() => ToolSearchModel.validate('123456789', undefined, limits)).toThrow('exceeds maxQueryChars')
    expect(() => ToolSearchModel.validate('file', 0, limits)).toThrow('from 1 to 2')
    expect(() => ToolSearchModel.validate('file', 3, limits)).toThrow('from 1 to 2')
    expect(() => ToolSearchModel.validate('file', 1.5, limits)).toThrow('from 1 to 2')
    expect(ToolSearchModel.validate(' file ', undefined, limits)).toEqual({ query: 'file', limit: 2 })
  })

  it('supports literal-safe wildcard patterns and rejects ambiguous configuration', () => {
    const patterns = ToolSearchModel.compileAlwaysVisible(['todo_*', 'safe+tool'])
    expect(patterns[0]?.test('todo_write')).toBe(true)
    expect(patterns[1]?.test('safe+tool')).toBe(true)
    expect(patterns[1]?.test('safeXtool')).toBe(false)
    expect(() => ToolSearchModel.compileAlwaysVisible([''])).toThrow('non-empty')
    expect(() => ToolSearchModel.compileAlwaysVisible([' file'])).toThrow('trimmed')
    expect(() => ToolSearchModel.compileAlwaysVisible(['x', 'x'])).toThrow('repeats')
  })
})
