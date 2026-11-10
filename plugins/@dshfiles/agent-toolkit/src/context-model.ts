/**
 * What the thread panel's **Context** facet shows (plan `docs/ade-ux` §4.4): every source that puts text into a
 * thread's model context, each with an approximate token cost. The facet is read-only; this module turns the owners'
 * existing answers into rows, so the arithmetic and wording are tested without a browser.
 *
 * Costs are estimates at four characters (or UTF-8 bytes) per token, the usual rule of thumb for English prose and
 * code. They are never billed numbers: the Cost facet and Usage carry those.
 */

/** Characters (or bytes) per estimated token. */
const CHARS_PER_TOKEN = 4

/** One loaded thing, as the facet lists it. */
export interface ContextRow {
  readonly id: string
  readonly name: string
  /** Muted line: a path, a description, a server name. */
  readonly detail?: string | undefined
  /** Estimated tokens, or null when the size is unknown (an MCP tool without a description, an unreadable file). */
  readonly tokens: number | null
}

export type ContextSectionId = 'instructions' | 'agent' | 'memory' | 'skills' | 'mcp' | 'references'

export interface ContextSection {
  readonly id: ContextSectionId
  readonly rows: readonly ContextRow[]
  /** Sum of the known row estimates. */
  readonly tokens: number
  /** Rows whose size is unknown, so the total is a lower bound. */
  readonly unknown: number
}

const estimate = (size: number): number => (size <= 0 ? 0 : Math.max(1, Math.ceil(size / CHARS_PER_TOKEN)))
const textTokens = (...parts: readonly (string | null | undefined)[]): number => estimate(parts.reduce((sum, part) => sum + (part?.length ?? 0), 0))

const section = (id: ContextSectionId, rows: readonly ContextRow[]): ContextSection => ({
  id,
  rows,
  tokens: rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
  unknown: rows.filter(row => row.tokens === null).length,
})

export interface InstructionFileInput {
  readonly path: string
  readonly absolutePath: string
  readonly bytes: number | null
}

const instructions = (files: readonly InstructionFileInput[]): ContextSection =>
  section(
    'instructions',
    files.map(file => ({ id: file.absolutePath, name: file.path, detail: file.absolutePath, tokens: file.bytes === null ? null : estimate(file.bytes) })),
  )

export interface AgentInput {
  readonly handle: string
  readonly name: string
  readonly instructions: string
  readonly routine: string
}

const agent = (input: AgentInput | null): ContextSection =>
  section(
    'agent',
    input === null
      ? []
      : [{ id: input.handle, name: `@${input.handle}`, detail: input.name, tokens: textTokens(input.instructions.trim(), input.routine.trim()) }],
  )

const memory = (input: { readonly project: string; readonly text: string } | null): ContextSection =>
  section(
    'memory',
    input === null || input.text.trim() === ''
      ? []
      : [{ id: 'start-block', name: 'Memory start block', detail: input.project, tokens: textTokens(input.text) }],
  )

export interface SkillInput {
  readonly name: string
  readonly description: string
  readonly provider?: string | undefined
}

/** A skill costs its catalog line (name and description); its full instructions load only when it is used. */
const skills = (input: readonly SkillInput[]): ContextSection =>
  section(
    'skills',
    input.map(skill => ({ id: skill.name, name: skill.name, detail: skill.description, tokens: textTokens(skill.name, skill.description) })),
  )

export interface McpServerInput {
  readonly name: string
  readonly serverName: string
  /** The server's tools as the thread's registry lists them; a description is what the model reads. */
  readonly tools: readonly { readonly name: string; readonly description?: string | undefined }[]
}

/** An MCP server costs its tools' names and descriptions; without any listed tool its size is unknown. */
const mcp = (input: readonly McpServerInput[]): ContextSection =>
  section(
    'mcp',
    input.map(server => ({
      id: server.serverName,
      name: server.name,
      detail: server.tools.length === 1 ? '1 tool' : `${String(server.tools.length)} tools`,
      tokens: server.tools.length === 0 ? null : server.tools.reduce((sum, tool) => sum + textTokens(tool.name, tool.description), 0),
    })),
  )

export interface ReferenceInput {
  readonly name: string
  readonly path: string
  readonly source: string
  readonly description: string | null
}

/** An attached reference costs its runtime-context line (name, path, origin); its files are read only on demand. */
const references = (input: readonly ReferenceInput[]): ContextSection =>
  section(
    'references',
    input.map(reference => ({
      id: reference.name,
      name: reference.name,
      detail: reference.path,
      tokens: textTokens(reference.name, reference.path, reference.source, reference.description),
    })),
  )

/** `12`, `1.2k`, `12k`: the estimate as the facet prints it. */
const formatTokens = (tokens: number): string => {
  if (tokens < 1_000) return String(tokens)
  const thousands = tokens / 1_000
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/u, '') : String(Math.round(thousands))}k`
}

const total = (sections: readonly ContextSection[]): { readonly tokens: number; readonly unknown: number } => ({
  tokens: sections.reduce((sum, item) => sum + item.tokens, 0),
  unknown: sections.reduce((sum, item) => sum + item.unknown, 0),
})

export class ContextModel {
  static readonly charsPerToken = CHARS_PER_TOKEN
  static readonly estimate = estimate
  static readonly instructions = instructions
  static readonly agent = agent
  static readonly memory = memory
  static readonly skills = skills
  static readonly mcp = mcp
  static readonly references = references
  static readonly total = total
  static readonly formatTokens = formatTokens
}
