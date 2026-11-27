import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { TOOL_ACCESS_ALL, ToolAccess, toolAccessSchema, type ToolAccessConfig } from './access.js'

describe('ToolAccess.groupOf', () => {
  it('groups by MCP server, then by owning plugin, then as DSH', () => {
    expect(ToolAccess.groupOf({ name: 'mcp__github__list_issues', source: 'mcp' })).toEqual({ key: 'mcp:github', kind: 'mcp', label: 'github' })
    expect(ToolAccess.groupOf({ name: 'mcp__chrome_devtools__click' }).key).toBe('mcp:chrome_devtools')
    expect(ToolAccess.groupOf({ name: 'agents_list', source: 'api', owner: '@dshfiles/agents' })).toEqual({
      key: 'plugin:@dshfiles/agents',
      kind: 'plugin',
      label: '@dshfiles/agents',
    })
    expect(ToolAccess.groupOf({ name: 'bash', source: 'tool' })).toEqual({ key: 'native', kind: 'native', label: 'DSH' })
  })
})

describe('ToolAccess.decide', () => {
  const access: ToolAccessConfig = {
    tools: { mcp__github__list_issues: { enabled: true }, read: { pinned: true }, bash: { enabled: false, pinned: true } },
    groups: { 'mcp:github': { enabled: false, pinned: true }, 'mcp:linear': { pinned: true } },
  }
  const decide = (name: string, group: string) => ToolAccess.decide(access, { name, group })

  it('lets a tool entry beat its group entry, field by field, and the group beat the default', () => {
    expect(decide('mcp__github__list_issues', 'mcp:github')).toEqual({ enabled: true, pinned: true, by: 'tool' })
    expect(decide('mcp__github__create_issue', 'mcp:github')).toEqual({ enabled: false, pinned: false, by: 'group' })
    expect(decide('mcp__linear__list_issues', 'mcp:linear')).toEqual({ enabled: true, pinned: true, by: 'default' })
    expect(decide('read', 'native')).toEqual({ enabled: true, pinned: true, by: 'default' })
    expect(decide('bash', 'native')).toEqual({ enabled: false, pinned: false, by: 'tool' })
  })

  it('disables a tool added later to a disabled group, and enables one from a group never configured', () => {
    expect(decide('mcp__github__delete_repo', 'mcp:github').enabled).toBe(false)
    expect(decide('mcp__notion__search', 'mcp:notion')).toEqual({ enabled: true, pinned: false, by: 'default' })
  })

  it('never disables tool-search itself', () => {
    const everything: ToolAccessConfig = { tools: { tool_search: { enabled: false }, tool_call: { enabled: false } }, groups: { native: { enabled: false } } }
    expect(ToolAccess.decide(everything, { name: 'tool_search', group: 'native' }).enabled).toBe(true)
    expect(ToolAccess.decide(everything, { name: 'tool_call', group: 'native' }).enabled).toBe(true)
    expect(ToolAccess.decide(everything, { name: 'read', group: 'native' }).enabled).toBe(false)
  })

  it('reads a prototype key as no entry', () => {
    expect(ToolAccess.decide(TOOL_ACCESS_ALL, { name: 'constructor', group: 'native' })).toEqual({ enabled: true, pinned: false, by: 'default' })
  })
})

describe('toolAccessSchema', () => {
  it('validates names and group keys', () => {
    const decode = Schema.decodeUnknownExit(toolAccessSchema)
    expect(decode({ tools: { read: { pinned: true } }, groups: { 'mcp:github': { enabled: false }, 'plugin:@dshfiles/agents': {}, native: {} } })._tag).toBe(
      'Success',
    )
    expect(decode({ tools: {}, groups: { github: { enabled: false } } })._tag).toBe('Failure')
    expect(decode({ tools: { 'bad name': {} }, groups: {} })._tag).toBe('Failure')
  })
})

describe('ToolAccess.withEntry', () => {
  it('sets, merges away and clears one entry without touching the others', () => {
    const set = ToolAccess.withEntry(TOOL_ACCESS_ALL, { kind: 'group', key: 'mcp:github' }, { enabled: false })
    expect(set).toEqual({ tools: {}, groups: { 'mcp:github': { enabled: false } } })
    const tool = ToolAccess.withEntry(set, { kind: 'tool', key: 'read' }, { pinned: true })
    expect(tool.groups).toEqual(set.groups)
    expect(ToolAccess.withEntry(tool, { kind: 'group', key: 'mcp:github' }, null)).toEqual({ tools: { read: { pinned: true } }, groups: {} })
    expect(ToolAccess.withEntry(tool, { kind: 'tool', key: 'read' }, {})).toEqual({ tools: {}, groups: { 'mcp:github': { enabled: false } } })
  })
})

describe('ToolAccess.summaryOf', () => {
  it('keeps the first sentence', () => {
    expect(ToolAccess.summaryOf('Read a file. Large files are paged.')).toBe('Read a file.')
    expect(ToolAccess.summaryOf('No period here')).toBe('No period here')
  })
})
