import { describe, expect, it } from 'vitest'

import { ContextModel } from './context-model.js'

describe('ContextModel', () => {
  it('estimates four characters per token and never rounds a non-empty source to zero', () => {
    expect(ContextModel.estimate(0)).toBe(0)
    expect(ContextModel.estimate(1)).toBe(1)
    expect(ContextModel.estimate(8)).toBe(2)
    expect(ContextModel.estimate(9)).toBe(3)
  })

  it('lists instruction files by size and counts an unreadable one as unknown', () => {
    const section = ContextModel.instructions([
      { path: 'AGENTS.md', absolutePath: '/repo/AGENTS.md', bytes: 4_000 },
      { path: '~/.agents/AGENTS.md', absolutePath: '/home/u/.agents/AGENTS.md', bytes: null },
    ])
    expect(section.rows.map(row => row.tokens)).toEqual([1_000, null])
    expect(section).toMatchObject({ tokens: 1_000, unknown: 1 })
  })

  it('costs a skill by its catalog line and an MCP server by its tool descriptions', () => {
    expect(ContextModel.skills([{ name: 'dsh', description: 'abcdefgh' }]).tokens).toBe(3)
    const mcp = ContextModel.mcp([
      { name: 'Linear', serverName: 'linear', tools: [{ name: 'list', description: 'List issues.' }] },
      { name: 'Idle', serverName: 'idle', tools: [] },
    ])
    expect(mcp.rows.map(row => [row.detail, row.tokens])).toEqual([
      ['1 tool', 4],
      ['0 tools', null],
    ])
    expect(mcp.unknown).toBe(1)
  })

  it('leaves out an empty memory block and a thread no agent started', () => {
    expect(ContextModel.memory({ project: '/repo', text: '  ' }).rows).toEqual([])
    expect(ContextModel.agent(null).rows).toEqual([])
    expect(ContextModel.agent({ handle: 'luna', name: 'Luna', instructions: 'Be brief.', routine: '' }).rows[0]).toMatchObject({ name: '@luna', tokens: 3 })
  })

  it('totals known estimates and formats them compactly', () => {
    const sections = [
      ContextModel.memory({ project: '/repo', text: 'x'.repeat(48_000) }),
      ContextModel.references([{ name: 'effect', path: '/refs/effect', source: 'https://github.com/Effect-TS/effect', description: null }]),
    ]
    expect(ContextModel.total(sections).tokens).toBe(12_000 + 14)
    expect(ContextModel.formatTokens(980)).toBe('980')
    expect(ContextModel.formatTokens(1_250)).toBe('1.3k')
    expect(ContextModel.formatTokens(2_000)).toBe('2k')
    expect(ContextModel.formatTokens(12_013)).toBe('12k')
  })
})
