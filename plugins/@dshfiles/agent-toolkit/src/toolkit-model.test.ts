import { describe, expect, it } from 'vitest'
import { AgentToolkit } from './toolkit-model.js'

const listing = AgentToolkit.listingSchema.parse({
  apis: [
    {
      owner: '@dshfiles/memory',
      id: 'dshfiles-memory',
      version: 1,
      methods: [{ name: 'search', description: 'Search memory.', tool: 'memory_search' }, { name: 'usage' }],
    },
    { owner: '@dshfiles/jj-integration', id: 'threads', version: 1, methods: [{ name: 'status', description: 'Thread status.', tool: 'jj_thread_status' }] },
  ],
  tools: [
    { name: 'read', description: 'Read a file.', source: 'tool', readOnly: true, enabled: true },
    { name: 'memory_search', description: 'Search memory.', source: 'api', owner: '@dshfiles/memory', readOnly: true, enabled: true },
    { name: 'jj_thread_status', description: 'Thread status.', source: 'api', owner: '@dshfiles/jj-integration', readOnly: true, enabled: true },
    { name: 'ask_parent_question', description: 'Ask the parent.', source: 'plugin', owner: '@dshfiles/agent-questions', readOnly: false, enabled: false },
    { name: 'mcp__github__search', description: 'Search GitHub.', source: 'mcp', readOnly: false, enabled: true },
  ],
  skills: [],
})

describe('agent toolkit model', () => {
  it('files each tool under native, plugin, MCP or memory and filters by source and text', () => {
    expect(listing.tools.map(tool => [tool.name, AgentToolkit.sourceOf(tool)])).toEqual([
      ['read', 'native'],
      ['memory_search', 'memory'],
      ['jj_thread_status', 'plugin'],
      ['ask_parent_question', 'plugin'],
      ['mcp__github__search', 'mcp'],
    ])
    expect(AgentToolkit.tools({ tools: listing.tools, filter: 'plugin', query: '' }).map(tool => tool.name)).toEqual([
      'jj_thread_status',
      'ask_parent_question',
    ])
    expect(AgentToolkit.tools({ tools: listing.tools, filter: 'all', query: 'github' }).map(tool => tool.name)).toEqual(['mcp__github__search'])
    expect(AgentToolkit.tools({ tools: listing.tools, filter: 'all', query: 'jj-integration' }).map(tool => tool.name)).toEqual(['jj_thread_status'])
  })

  it('lists the API methods plugins serve each other with their agent tool, by owner under the memory filter', () => {
    expect(AgentToolkit.apiMethods({ listing, filter: 'all', query: '' }).map(row => [row.path, row.tool ?? null])).toEqual([
      ['dshfiles-memory.search', 'memory_search'],
      ['dshfiles-memory.usage', null],
      ['threads.status', 'jj_thread_status'],
    ])
    expect(AgentToolkit.apiMethods({ listing, filter: 'memory', query: '' }).map(row => row.owner)).toEqual(['@dshfiles/memory', '@dshfiles/memory'])
    expect(AgentToolkit.apiMethods({ listing, filter: 'all', query: 'jj_thread' }).map(row => row.key)).toEqual(['@dshfiles/jj-integration/threads.status'])
  })

  it('reads a listing from an older registry with every tool enabled and read-only unknown', () => {
    const old = AgentToolkit.listingSchema.parse({
      tools: [{ name: 'bash', description: 'Run.', source: 'tool' }],
      skills: [{ name: 'a', description: 'b', provider: 'fs', modelInvocable: true }],
    })
    expect(old.tools[0]).toEqual({ name: 'bash', description: 'Run.', source: 'tool', enabled: true })
    expect(AgentToolkit.invocation(old.skills[0]!)).toBe('both')
    expect(AgentToolkit.listingSchema.parse({})).toEqual({ apis: [], tools: [], skills: [] })
  })

  it('tells project skills from the user’s own and says who can invoke them', () => {
    const skill = (path: string | undefined, modelInvocable: boolean, userInvocable: boolean) =>
      AgentToolkit.listingSchema.parse({ skills: [{ name: 's', description: '', provider: 'fs', modelInvocable, userInvocable, path }] }).skills[0]!
    const cwd = '/repo/'
    expect(AgentToolkit.skillScope(skill('/repo/.agents/skills/verify/SKILL.md', true, true), cwd)).toBe('project')
    expect(AgentToolkit.skillScope(skill('/home/me/.agents/skills/caveman/SKILL.md', true, true), cwd)).toBe('user')
    expect(AgentToolkit.skillScope(skill(undefined, true, true), cwd)).toBe('other')
    expect([skill(undefined, false, true), skill(undefined, true, false), skill(undefined, false, false)].map(AgentToolkit.invocation)).toEqual([
      'user',
      'model',
      'none',
    ])
  })

  it('groups MCP tools under their server', () => {
    const rows = AgentToolkit.mcpServers({
      servers: [
        { id: '1', name: 'GitHub', serverName: 'github', enabled: true, clientLifecycle: 'loaded' },
        { id: '2', name: 'Figma', serverName: 'figma', enabled: false, clientLifecycle: 'inactive' },
      ],
      tools: listing.tools,
    })
    expect(rows.map(row => [row.name, row.lifecycle, row.tools.map(tool => tool.name)])).toEqual([
      ['GitHub', 'loaded', ['mcp__github__search']],
      ['Figma', 'inactive', []],
    ])
  })

  it('counts memory notes by type, largest first', () => {
    expect(AgentToolkit.noteCounts([{ type: 'project' }, { type: 'feedback' }, { type: 'project' }])).toEqual([
      { type: 'project', count: 2 },
      { type: 'feedback', count: 1 },
    ])
  })

  it('lists our plugins first with their versions, skips Loader internals, and filters native from the rest', () => {
    const rows = AgentToolkit.plugins({
      entries: [
        { entryId: 'tool-fs', moduleName: '@deepseek-ai/dsh-tool-fs', enabled: true, fiberPhase: 'active' },
        { entryId: 'dshfiles-btw', moduleName: '@dshfiles/btw', title: 'btw', enabled: true, fiberPhase: 'active' },
        { entryId: 'dshmarket', moduleName: 'dshmarket/host', enabled: false, fiberPhase: null },
        { entryId: 'include', moduleName: 'cordis:include', enabled: true, fiberPhase: 'active' },
      ],
      versions: { '@dshfiles/btw': '0.1.0', '@deepseek-ai/dsh-tool-fs': '0.2.0-rc.2' },
    })
    expect(rows.map(row => [row.packageName, row.version, row.origin])).toEqual([
      ['@dshfiles/btw', '0.1.0', 'dshfiles'],
      ['dshmarket', null, 'other'],
      ['@deepseek-ai/dsh-tool-fs', '0.2.0-rc.2', 'deepseek'],
    ])
    expect(AgentToolkit.pluginsFor(rows, 'native', '').map(row => row.entryId)).toEqual(['tool-fs'])
    expect(AgentToolkit.pluginsFor(rows, 'plugin', 'market').map(row => row.entryId)).toEqual(['dshmarket'])
    expect(AgentToolkit.pluginPackages(rows)).toEqual(['@deepseek-ai/dsh-tool-fs', '@dshfiles/btw', 'dshmarket'])
  })

  it('shows only the sections a filter is about', () => {
    expect(AgentToolkit.filters.filter(filter => AgentToolkit.shows(filter, 'mcp'))).toEqual(['all', 'mcp'])
    expect(AgentToolkit.filters.filter(filter => AgentToolkit.shows(filter, 'apis'))).toEqual(['all', 'plugin', 'memory'])
    expect(AgentToolkit.filters.filter(filter => AgentToolkit.shows(filter, 'tools'))).toEqual(['all', 'native', 'plugin', 'mcp', 'memory'])
  })
})
