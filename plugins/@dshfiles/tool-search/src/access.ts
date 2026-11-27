import type {} from '@deepseek-ai/cordis'
import { Schema } from 'effect'

/**
 * The per-agent tool access contract. `@dshfiles/tool-search` owns tool visibility and declares it here;
 * `@dshfiles/agents` provides it on the Host as the `dshfilesToolAccess` Cordis service. Without a provider every tool
 * is on, as before.
 *
 * Every tool is ON by default, tools that appear later included. Two controls, per tool and per group (one MCP server,
 * one owning plugin, or DSH's own tools): `enabled: false` removes access (not declared, not found by `tool_search`,
 * refused by `tool_call` and by a direct call); `pinned: true` declares the tool from the first request, while an
 * unpinned enabled tool stays deferred behind `tool_search`. A tool entry beats its group entry, which beats the
 * default (enabled, not pinned), field by field.
 */

/** tool-search's own tools: never disabled, whatever an entry says. */
export const TOOL_ACCESS_RESERVED: readonly string[] = ['tool_search', 'tool_call']

const MAX_ENTRIES = 1000
const MAX_TOOL_NAME_CHARS = 128
const MAX_GROUP_KEY_CHARS = 240
const MAX_SUMMARY_CHARS = 240

export const NATIVE_GROUP_KEY = 'native'
const MCP_PREFIX = 'mcp__'

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/u
const GROUP_KEY_PATTERN = /^(?:mcp:[A-Za-z0-9_.-]+|plugin:[@A-Za-z0-9_./-]+|native)$/u

/** A tool name as the registry declares it (`read`, `mcp__github__list_issues`, `agents_list`). */
export const toolNameSchema = Schema.String.check(Schema.isPattern(TOOL_NAME_PATTERN), Schema.isMaxLength(MAX_TOOL_NAME_CHARS))

/** `mcp:<server>`, `plugin:<owning package>` or `native` (DSH's own tools and plugins built without dshx). */
export const toolGroupKeySchema = Schema.String.check(Schema.isPattern(GROUP_KEY_PATTERN), Schema.isMaxLength(MAX_GROUP_KEY_CHARS))

/** One sparse entry: an absent field inherits from the group, then from the default. */
export const toolAccessEntrySchema = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  pinned: Schema.optionalKey(Schema.Boolean),
})

/** A record whose every key must match: a refined Record key would drop a bad key silently instead of refusing it. */
const keysMatching = (what: string, pattern: RegExp, max: number) =>
  Schema.makeFilter((record: Readonly<Record<string, typeof toolAccessEntrySchema.Type>>) => {
    const bad = Object.keys(record).find(key => key.length > max || !pattern.test(key))
    return bad === undefined ? undefined : `${JSON.stringify(bad)} is not a valid ${what}.`
  })

/** An agent's tool access: sparse entries keyed by tool name and by group key. Empty means every tool on, none pinned. */
export const toolAccessSchema = Schema.Struct({
  tools: Schema.Record(Schema.String, toolAccessEntrySchema).check(
    Schema.isMaxProperties(MAX_ENTRIES),
    keysMatching('tool name', TOOL_NAME_PATTERN, MAX_TOOL_NAME_CHARS),
  ),
  groups: Schema.Record(Schema.String, toolAccessEntrySchema).check(
    Schema.isMaxProperties(MAX_ENTRIES),
    keysMatching('tool group (mcp:<server>, plugin:<package> or native)', GROUP_KEY_PATTERN, MAX_GROUP_KEY_CHARS),
  ),
})

export type ToolAccessEntry = typeof toolAccessEntrySchema.Type
export type ToolAccessConfig = typeof toolAccessSchema.Type

/** Every tool on, none pinned: the default and the "all tools" override. */
export const TOOL_ACCESS_ALL: ToolAccessConfig = { tools: {}, groups: {} }

export const toolGroupKindSchema = Schema.Literals(['mcp', 'plugin', 'native'])
export type ToolGroupKind = typeof toolGroupKindSchema.Type

export interface ToolGroup {
  readonly key: string
  readonly kind: ToolGroupKind
  readonly label: string
}

/** Where a tool comes from, as the dshx registry reports it (`toolSources` on the Host, `dshx_registry.list`). */
export interface ToolOrigin {
  readonly name: string
  readonly source?: 'api' | 'mcp' | 'plugin' | 'tool' | undefined
  readonly owner?: string | undefined
}

const mcpServerOf = (name: string): string | undefined => {
  if (!name.startsWith(MCP_PREFIX)) return undefined
  const rest = name.slice(MCP_PREFIX.length)
  const end = rest.indexOf('__')
  const server = end <= 0 ? undefined : rest.slice(0, end)
  return server === undefined || !/^[A-Za-z0-9_.-]+$/u.test(server) ? undefined : server
}

/** The group a tool belongs to: its MCP server from `mcp__<server>__<tool>`, else its owning plugin, else DSH's own. */
const groupOf = (tool: ToolOrigin): ToolGroup => {
  const server = mcpServerOf(tool.name)
  if (server !== undefined) return { key: `mcp:${server}`, kind: 'mcp', label: server }
  if (tool.owner !== undefined && /^[@A-Za-z0-9_./-]+$/u.test(tool.owner))
    return { key: `plugin:${tool.owner}`.slice(0, MAX_GROUP_KEY_CHARS), kind: 'plugin', label: tool.owner }
  return { key: NATIVE_GROUP_KEY, kind: 'native', label: 'DSH' }
}

/** The first sentence of a tool description, bounded, for a catalog row. */
const summaryOf = (description: string): string => {
  const flat = description.replace(/\s+/gu, ' ').trim()
  const match = /^(.+?[.!?])(?:\s|$)/u.exec(flat)
  const sentence = match?.[1] ?? flat
  return sentence.length <= MAX_SUMMARY_CHARS ? sentence : `${sentence.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`
}

export interface ToolAccessDecision {
  readonly enabled: boolean
  readonly pinned: boolean
  /** Where `enabled` came from. */
  readonly by: 'tool' | 'group' | 'default' | 'reserved'
}

const RESERVED: ReadonlySet<string> = new Set(TOOL_ACCESS_RESERVED)

/** A tool entry beats its group entry beats the default, per field; a reserved tool is always enabled. */
const decide = (access: ToolAccessConfig, tool: { readonly name: string; readonly group: string }): ToolAccessDecision => {
  const own = Object.hasOwn(access.tools, tool.name) ? access.tools[tool.name] : undefined
  const group = Object.hasOwn(access.groups, tool.group) ? access.groups[tool.group] : undefined
  const pinned = own?.pinned ?? group?.pinned ?? false
  if (RESERVED.has(tool.name)) return { enabled: true, pinned, by: 'reserved' }
  if (own?.enabled !== undefined) return { enabled: own.enabled, pinned: own.enabled && pinned, by: 'tool' }
  if (group?.enabled !== undefined) return { enabled: group.enabled, pinned: group.enabled && pinned, by: 'group' }
  return { enabled: true, pinned, by: 'default' }
}

/** Set one entry (or clear it with `null`), keeping the others; an entry with no field left is removed. */
const withEntry = (
  access: ToolAccessConfig,
  target: { readonly kind: 'tool' | 'group'; readonly key: string },
  entry: ToolAccessEntry | null,
): ToolAccessConfig => {
  const field = target.kind === 'tool' ? 'tools' : 'groups'
  const kept = Object.entries(access[field]).filter(([key]) => key !== target.key)
  const cleared = entry === null || (entry.enabled === undefined && entry.pinned === undefined)
  return { ...access, [field]: Object.fromEntries(cleared ? kept : [...kept, [target.key, entry]]) }
}

/** Pure rules of the contract: groups, catalog summaries and the precedence of entries. */
export class ToolAccess {
  static readonly groupOf = groupOf
  static readonly summaryOf = summaryOf
  static readonly decide = decide
  static readonly withEntry = withEntry
  static readonly isReserved = (name: string): boolean => RESERVED.has(name)
}

/**
 * Why a thread has the tool set it has. `agent`: the thread's own agent (dispatched or mentioned, or inherited from a
 * subagent's parent); `override`: a per-thread override; `project-default`: the project's default agent; `default`:
 * no agent decided, so the built-in `@dsh`.
 */
export const toolAccessSourceSchema = Schema.Literals(['agent', 'override', 'project-default', 'default'])
export type ToolAccessSource = typeof toolAccessSourceSchema.Type

/** The resolved policy of one Session, as the provider hands it to tool-search. */
export const toolAccessPolicySchema = Schema.Struct({
  /** The thread's agent handle, without `@`. */
  agent: Schema.String,
  source: toolAccessSourceSchema,
  /** Whose tool set applies: the thread's agent, another agent an override names, or null for an "all tools" override. */
  toolsFrom: Schema.NullOr(Schema.String),
  access: toolAccessSchema,
  /** One sentence telling the user how to change this thread's access; refusals quote it. */
  change: Schema.String,
})
export type ToolAccessPolicy = typeof toolAccessPolicySchema.Type

/** What the provider resolves from: a live agent's Session header. */
export interface ToolAccessSubject {
  readonly sessionId: string
  readonly cwd: string | undefined
  /** The creating Session of a subagent (`origin: 'subagent'`), else undefined. */
  readonly parentSessionId: string | undefined
}

/**
 * The Host provider. `resolve` is synchronous because tool-search attaches while the agent is created, before its first
 * request; it decides the thread's agent once and records it, so later calls return the same agent. `subscribe`
 * reports a Session whose policy changed (a per-thread override set or cleared); tool-search resolves it again and
 * applies it from that thread's next model request.
 */
export interface ToolAccessProvider {
  readonly resolve: (subject: ToolAccessSubject) => ToolAccessPolicy
  readonly subscribe: (listener: (sessionId: string) => void) => () => void
}

/** The Cordis service name the provider registers with `ctx.provide`. */
export const TOOL_ACCESS_SERVICE = 'dshfilesToolAccess'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshfilesToolAccess?: ToolAccessProvider
  }
}
