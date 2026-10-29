import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition, ToolRuntime } from '@deepseek-ai/dsh-tools'

/**
 * One edit of the tools agents see. Edits apply per agent, in that agent's own tool scope, so they end with the agent
 * or the plugin and never touch another plugin's registration. They reach global tools (every plugin's
 * `defineHost({ tools })` and API tools); tools an agent preset registers in the agent's own scope cannot be edited.
 */
export interface ToolEdit {
  /** Tool name, or a pattern over names. Omit with `codeMode` alone. */
  readonly tools?: string | RegExp
  /** Agents the edit applies to; every agent when omitted. */
  readonly agents?: (agent: Agent) => boolean
  /** Hide the tool from the agent. */
  readonly remove?: true
  /** Show the tool under another name (a namespace), e.g. `name => \`vcs_${name}\``; the old name disappears. */
  readonly rename?: (name: string) => string
  /** Change the definition the agent sees and runs: description, parameters, or a wrapped `execute`. */
  readonly update?: (tool: ToolDefinition) => ToolDefinition
  /** Present the agent's tools as code (DSH's `ptc` mode: one `run_code` tool calling the others from a script). */
  readonly codeMode?: true
}

const matches = (pattern: string | RegExp, name: string): boolean => (typeof pattern === 'string' ? pattern === name : pattern.test(name))

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** The edits one agent gets; returns the disposers of what it registered. */
const editAgent = (input: {
  readonly tools: ToolRuntime
  readonly agent: Agent
  readonly edits: readonly ToolEdit[]
  readonly warn: (message: string) => void
}) => {
  const agentTools = input.agent.ctx.get('tools')
  if (agentTools === undefined) return []
  const disposers: Array<() => void> = []
  const attempt = (what: string, run: () => () => void): void => {
    try {
      disposers.push(run())
    } catch (cause) {
      input.warn(`${what} for agent ${input.agent.id}: ${describe(cause)}`)
    }
  }
  const global = new Set(input.tools.schemas().map(schema => schema.name))
  for (const edit of input.edits) {
    if (edit.agents !== undefined && !edit.agents(input.agent)) continue
    if (edit.codeMode === true) attempt('code mode', () => agentTools.presentAs('ptc'))
    const pattern = edit.tools
    if (pattern === undefined) continue
    const names = input.tools
      .schemas(input.agent)
      .map(schema => schema.name)
      .filter(name => global.has(name) && matches(pattern, name))
    if (names.length === 0) input.warn(`no global tool matches ${String(pattern)} for agent ${input.agent.id}`)
    for (const name of names) {
      const tool = input.tools.get(name, input.agent)
      if (tool === undefined) continue
      if (edit.remove === true) {
        attempt(`removing ${name}`, () => agentTools.restrict({ deny: [name] }))
        continue
      }
      const updated = edit.update === undefined ? tool : edit.update(tool)
      const renamed = edit.rename === undefined ? name : edit.rename(name)
      if (renamed !== name) attempt(`hiding ${name} behind ${renamed}`, () => agentTools.restrict({ deny: [name] }))
      // A registration in the agent's own scope shadows the global tool of the same name.
      if (renamed !== name || updated !== tool) attempt(`editing ${name}`, () => agentTools.register({ ...updated, name: renamed }))
    }
  }
  return disposers
}

/** Apply `defineHost({ toolEdits })` to every live agent and each one created later, until the plugin ends. */
const installToolEdits = (ctx: Context, packageId: string, edits: readonly ToolEdit[]): void => {
  ctx.effect(() => {
    const tools = ctx.get('tools')
    const agents = ctx.get('agents')
    if (tools === undefined || agents === undefined) return () => undefined
    const warn = (message: string): void => ctx.logger('dshx:tool-edits').warn(`${packageId}: ${message}`)
    const applied = new Map<Agent, Array<() => void>>()
    const install = (agent: Agent): void => {
      if (applied.has(agent)) return
      applied.set(agent, editAgent({ tools, agent, edits, warn }))
    }
    const release = (agent: Agent): void => {
      for (const dispose of (applied.get(agent) ?? []).reverse()) {
        try {
          dispose()
        } catch {
          // Released with the agent's scope already.
        }
      }
      applied.delete(agent)
    }
    for (const agent of agents.list()) install(agent)
    const stopCreated = ctx.on('agent/created', ({ agent }) => void install(agent))
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => void applied.delete(agent))
    return () => {
      stopCreated()
      stopDisposed()
      for (const agent of [...applied.keys()]) release(agent)
    }
  }, `${packageId}: tool edits`)
}

export class ToolEditsModel {
  static readonly install = installToolEdits
}
