import { describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

type ToolSearchStatus = 'loaded' | 'already_loaded' | 'unavailable'

interface ToolSearchResult {
  readonly query: string
  readonly tools: readonly { readonly name: string; readonly status: ToolSearchStatus }[]
  readonly remainingDeferred: number
}

interface ToolSearchConfig {
  readonly alwaysVisible?: readonly string[]
  readonly maxResults?: number
  readonly maxQueryChars?: number
}

interface AgentEvent {
  readonly agent: TestAgent
}

interface RegisteredTool extends ToolSchema {
  readonly execute?: (
    args: { readonly query: string; readonly limit?: number },
    exec: { readonly agent?: TestAgent; readonly parent?: symbol },
  ) => Promise<ToolSearchResult>
}

interface AgentContext {
  readonly tools: {
    readonly get: (name: string) => RegisteredTool | undefined
    readonly schemas: () => ToolSchema[]
    readonly restrict: (filter: { readonly allow?: readonly string[] }) => () => void
    readonly register: (tool: RegisteredTool) => () => void
  }
}

interface TestAgent {
  readonly id: string
  readonly session: { readonly requestHeader: () => { readonly tools?: ToolSchema[] } | undefined }
  readonly ctx: AgentContext
}

interface TestHostContext {
  readonly tools: {
    readonly schemas: () => ToolSchema[]
    readonly get: (name: string, scope?: TestAgent) => RegisteredTool | undefined
  }
  readonly agents: { readonly list: () => TestAgent[] }
  readonly on: (name: string, listener: (payload?: AgentEvent) => void) => () => void
  readonly effect: (setup: () => () => Promise<undefined> | undefined, label?: string) => void
}

interface BuiltPlugin {
  readonly apply: (ctx: TestHostContext, config?: ToolSearchConfig) => void
}

const builtEntry = new URL('../dist/index.js', import.meta.url).href
const loadPlugin = async (): Promise<BuiltPlugin> => import(builtEntry)

const schema = (name: string, description: string): ToolSchema => ({
  name,
  description,
  parameters: { type: 'object', properties: {} },
})

const harness = (plugin: BuiltPlugin, options: { readonly restored?: readonly string[] } = {}) => {
  const schemas = new Map<string, ToolSchema>([
    ['read_file', schema('read_file', 'Read a workspace file')],
    ['write_file', schema('write_file', 'Write a workspace file')],
    ['search_threads', schema('search_threads', 'Search earlier conversations')],
  ])
  const globalTools = new Map<string, RegisteredTool>([...schemas.values()].map(tool => [tool.name, { ...tool }]))
  const scopedTools = new Map<TestAgent, Map<string, RegisteredTool>>()
  const restrictions = new Map<TestAgent, Set<string>[]>()
  const listeners = new Map<string, Set<(payload?: AgentEvent) => void>>()
  const effects: Array<() => Promise<undefined> | undefined> = []
  const visibleGlobals = (agent: TestAgent): ToolSchema[] => {
    const filters = restrictions.get(agent)
    if (filters === undefined || filters.length === 0) return [...schemas.values()]
    const allowed = filters.slice(1).reduce((intersection, current) => new Set([...intersection].filter(name => current.has(name))), new Set(filters[0]))
    return [...schemas.values()].filter(tool => allowed.has(tool.name))
  }
  const makeAgent = (id: string, restored: readonly string[] = []): TestAgent => {
    let agent: TestAgent
    const context = {
      tools: {
        get: (name: string) => globalTools.get(name),
        schemas: (scope?: TestAgent) => [
          ...visibleGlobals(scope ?? agent),
          ...[...(scope === undefined ? [] : (scopedTools.get(scope)?.values() ?? []))].map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        ],
        restrict: (filter: { readonly allow?: readonly string[] }) => {
          const filters = restrictions.get(agent) ?? []
          const allowed = new Set(filter.allow ?? [])
          filters.push(allowed)
          restrictions.set(agent, filters)
          emit('tools/change')
          return () => {
            const index = filters.indexOf(allowed)
            if (index >= 0) filters.splice(index, 1)
            emit('tools/change')
          }
        },
        register: (tool: RegisteredTool) => {
          const tools = scopedTools.get(agent) ?? new Map<string, RegisteredTool>()
          tools.set(tool.name, tool)
          scopedTools.set(agent, tools)
          emit('tools/change')
          return () => {
            tools.delete(tool.name)
            emit('tools/change')
          }
        },
      },
    }
    agent = {
      id,
      session: {
        requestHeader: () => ({
          tools: [
            ...restored.map(name => schemas.get(name)).filter((tool): tool is ToolSchema => tool !== undefined),
            ...(restored.length === 0 ? [] : [schema('tool_search', 'Search global tools')]),
          ],
        }),
      },
      ctx: context,
    }
    return agent
  }
  const emit = (name: string, payload?: AgentEvent) => {
    for (const listener of listeners.get(name) ?? []) listener(payload)
  }
  const agents = [makeAgent('one', options.restored), makeAgent('two')]
  const root = {
    tools: {
      schemas: (scope?: TestAgent) => (scope === undefined ? [...schemas.values()] : visibleGlobals(scope)),
      get: (name: string, scope?: TestAgent) => {
        const tool = globalTools.get(name)
        if (tool === undefined || scope === undefined) return tool
        const allowed = restrictions.get(scope)?.reduce((intersection, current) => new Set([...intersection].filter(candidate => current.has(candidate))))
        return allowed === undefined || allowed.has(name) ? tool : undefined
      },
    },
    agents: { list: () => agents },
    get: () => undefined,
    once: () => () => undefined,
    emit: () => undefined,
    parallel: () => undefined,
    serial: () => undefined,
    bail: () => undefined,
    waterfall: () => undefined,
    on: (name: string, listener: (payload?: AgentEvent) => void) => {
      const registered = listeners.get(name) ?? new Set()
      registered.add(listener)
      listeners.set(name, registered)
      return () => registered.delete(listener)
    },
    effect: (setup: () => () => Promise<undefined> | undefined) => {
      effects.push(setup())
    },
  }
  plugin.apply(root, { maxResults: 3 })
  const searchTool = (agent: TestAgent): RegisteredTool => {
    const tool = scopedTools.get(agent)?.get('tool_search')
    if (tool === undefined) throw new Error('tool_search was not registered')
    return tool
  }
  return {
    agents,
    createAgent: (id: string) => {
      const agent = makeAgent(id)
      agents.push(agent)
      emit('agent/created', { agent })
      return agent
    },
    disposeAgent: (agent: TestAgent) => emit('agent/disposed', { agent }),
    schemas,
    visibleSchemas: (agent: TestAgent) => [
      ...visibleGlobals(agent),
      ...[...(scopedTools.get(agent)?.values() ?? [])].map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    ],
    restrictions,
    searchTool,
    restrictAgent: (agent: TestAgent, allow: readonly string[]) => {
      const filters = restrictions.get(agent) ?? []
      filters.push(new Set(allow))
      restrictions.set(agent, filters)
      emit('tools/change')
    },
    registerGlobal: (name: string, description: string) => {
      const tool = schema(name, description)
      schemas.set(name, tool)
      globalTools.set(name, { ...tool })
      emit('tools/change')
    },
    dispose: async () => {
      await Promise.all(effects.map(effect => effect?.()))
    },
  }
}

describe('tool-search host integration', () => {
  it('keeps discovery isolated per agent and loads a matching global tool', async () => {
    const runtime = harness(await loadPlugin())
    const first = runtime.agents[0]!
    const second = runtime.agents[1]!
    expect(runtime.visibleSchemas(first).map(tool => tool.name)).toEqual(['tool_search'])
    await expect(runtime.searchTool(first).execute?.({ query: 'write_file' }, { agent: second })).rejects.toThrow('owning live agent')
    const result = await runtime.searchTool(first).execute?.({ query: 'write_file', limit: 1 }, { agent: first })
    expect(result).toMatchObject({ tools: [{ name: 'write_file', status: 'loaded' }] })
    expect(
      runtime
        .visibleSchemas(first)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['tool_search', 'write_file'])
    expect(runtime.visibleSchemas(second).map(tool => tool.name)).toEqual(['tool_search'])
    await runtime.dispose()
  })

  it('leaves deferred tools hidden when a query has no matches', async () => {
    const runtime = harness(await loadPlugin())
    const first = runtime.agents[0]!
    const result = await runtime.searchTool(first).execute?.({ query: 'book flight' }, { agent: first })

    expect(result).toMatchObject({ tools: [], remainingDeferred: 3 })
    expect(runtime.visibleSchemas(first).map(tool => tool.name)).toEqual(['tool_search'])

    const next = await runtime.searchTool(first).execute?.({ query: 'write_file', limit: 1 }, { agent: first })
    expect(next).toMatchObject({ tools: [{ name: 'write_file', status: 'loaded' }] })
    expect(
      runtime
        .visibleSchemas(first)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['tool_search', 'write_file'])
    await runtime.dispose()
  })

  it('retains policy denials after disclosure and reports the tool unavailable', async () => {
    const runtime = harness(await loadPlugin())
    const first = runtime.agents[0]!
    runtime.restrictAgent(first, ['read_file', 'search_threads'])
    const result = await runtime.searchTool(first).execute?.({ query: 'write_file', limit: 1 }, { agent: first })
    expect(result).toMatchObject({ tools: [{ name: 'write_file', status: 'unavailable' }] })
    expect(runtime.visibleSchemas(first).map(tool => tool.name)).toEqual(['tool_search'])
    await runtime.dispose()
  })

  it('restores prior disclosure from the durable request header and tracks late global MCP tools', async () => {
    const runtime = harness(await loadPlugin(), { restored: ['write_file'] })
    const first = runtime.agents[0]!
    expect(
      runtime
        .visibleSchemas(first)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['tool_search', 'write_file'])
    runtime.registerGlobal('mcp__docs__lookup', 'Look up a document in MCP')
    expect(runtime.visibleSchemas(first).map(tool => tool.name)).not.toContain('mcp__docs__lookup')
    await runtime.searchTool(first).execute?.({ query: 'mcp docs lookup' }, { agent: first })
    expect(runtime.visibleSchemas(first).map(tool => tool.name)).toContain('mcp__docs__lookup')
    await runtime.dispose()
  })

  it('attaches new agents and detaches disposed agents', async () => {
    const runtime = harness(await loadPlugin())
    const agent = runtime.createAgent('late')
    expect(runtime.visibleSchemas(agent).map(tool => tool.name)).toEqual(['tool_search'])
    runtime.disposeAgent(agent)
    expect(
      runtime
        .visibleSchemas(agent)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['read_file', 'search_threads', 'write_file'])
    await runtime.dispose()
  })

  it('rejects nested Code Mode search and unload removes only its own scope contributions', async () => {
    const runtime = harness(await loadPlugin())
    const first = runtime.agents[0]!
    await expect(runtime.searchTool(first).execute?.({ query: 'read_file' }, { agent: first, parent: Symbol('run_code') })).rejects.toThrow(
      'Native Tool Mode only',
    )
    await runtime.dispose()
    expect(
      runtime
        .visibleSchemas(first)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['read_file', 'search_threads', 'write_file'])
  })
})
