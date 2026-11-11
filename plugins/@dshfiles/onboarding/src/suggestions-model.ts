import * as Schema from 'effect/Schema'
import type { FeatureCatalog } from './catalog-model.js'
import { featureRowSchema, OnboardingOverview } from './overview-model.js'

/** The window the usage owner is asked about; every rule counts within it. */
export const SUGGESTION_DAYS = 30

/**
 * What leaves the usage owner: aggregate counts only. Tool names, the executable of each shell command (never its
 * arguments), and request counts; no prompt, path, title or command line.
 */
export interface UsageSignals {
  /** Tool name (provider prefixes removed) to calls, for the most-used tools. */
  readonly tools: ReadonlyMap<string, number>
  /** Shell executable (`jj`, `gh`) to calls, for the most-used commands. */
  readonly commands: ReadonlyMap<string, number>
  readonly toolErrors: number
  readonly turns: number
  /** Model requests of the longest of the costliest threads. */
  readonly longestThreadRequests: number
  readonly compactionRequests: number
}

export interface SuggestionRule {
  readonly id: string
  /** `<plugin>#<feature>` in the generated catalog; the catalog test fails a rule whose feature is gone. */
  readonly feature: string
  /** What is counted, in words, for the table and the agent. */
  readonly signal: string
  readonly threshold: number
  readonly why: string
  readonly measure: (signals: UsageSignals) => number
  /** The feature is already in use: never suggest it. */
  readonly used: (signals: UsageSignals) => boolean
  readonly evidence: (count: number) => string
}

const callsOf = (signals: UsageSignals, name: string): number => signals.tools.get(name) ?? 0
const usesAny = (signals: UsageSignals, match: (name: string) => boolean): boolean => [...signals.tools].some(([name, calls]) => calls > 0 && match(name))
const JUJUTSU_READS = new Set(['jj_load', 'jj_details', 'jj_graph_page', 'jj_graph_slice', 'jj_revision_files', 'jj_working_diff', 'jj_workspaces'])

/** Ordered by priority: the first matching rule is the one shown first. */
export const SUGGESTION_RULES: readonly SuggestionRule[] = [
  {
    id: 'jj-without-thread-workspaces',
    feature: 'jj-integration#thread-destination',
    signal: 'jj shell commands, with no thread-workspace tool call',
    threshold: 20,
    why: 'You run jj often: a thread workspace gives each thread its own working copy, so parallel threads never edit the same files.',
    measure: signals => signals.commands.get('jj') ?? 0,
    used: signals => usesAny(signals, name => name.startsWith('jj_thread_') || name === 'jj_workspace_setup'),
    evidence: count => `${String(count)} jj commands, no thread workspace yet`,
  },
  {
    id: 'jj-without-revision-graph',
    feature: 'jujutsu#revision-graph',
    signal: 'jj shell commands, with no Jujutsu panel read',
    threshold: 50,
    why: 'The Jujutsu panel shows the revision graph, each diff and every workspace without a jj log in the shell.',
    measure: signals => signals.commands.get('jj') ?? 0,
    used: signals => usesAny(signals, name => JUJUTSU_READS.has(name)),
    evidence: count => `${String(count)} jj commands, no revision graph read`,
  },
  {
    id: 'long-threads-without-compaction',
    feature: 'agent-plan#compaction-meter',
    signal: 'model requests in the longest thread, with no compaction',
    threshold: 150,
    why: 'Long threads fill the context window: the composer meter says how many tokens remain before automatic compaction.',
    measure: signals => signals.longestThreadRequests,
    used: signals => signals.compactionRequests > 0 || callsOf(signals, 'compaction_threshold') > 0,
    evidence: count => `a thread with ${String(count)} model requests and no compaction`,
  },
  {
    id: 'gh-without-pull-requests',
    feature: 'pull-requests#github-pull-request-create',
    signal: 'gh shell commands, with no pull request tool call',
    threshold: 10,
    why: 'Pull requests can be previewed and opened from the thread that made the change, with the title and body drafted for you.',
    measure: signals => signals.commands.get('gh') ?? 0,
    used: signals => usesAny(signals, name => name.startsWith('pull_request')),
    evidence: count => `${String(count)} gh commands, no pull request opened from a thread`,
  },
  {
    id: 'plans-without-backlog',
    feature: 'backlog#capture-and-triage',
    signal: 'todo_write calls, with no backlog tool call',
    threshold: 30,
    why: 'Plans end with the thread; the backlog keeps the next items across threads and projects.',
    measure: signals => callsOf(signals, 'todo_write'),
    used: signals => usesAny(signals, name => name.startsWith('backlog_')),
    evidence: count => `${String(count)} plan updates, no backlog item`,
  },
  {
    id: 'failing-tools-without-traces',
    feature: 'traces#trace-explorer',
    signal: 'failed tool calls, with no traces tool call',
    threshold: 25,
    why: 'Traces show which span of a slow or failing call broke, instead of rereading the transcript.',
    measure: signals => signals.toolErrors,
    used: signals => usesAny(signals, name => name.startsWith('traces_')),
    evidence: count => `${String(count)} failed tool calls, no trace opened`,
  },
  {
    id: 'many-turns-without-memory',
    feature: 'memory#memory-tools',
    signal: 'thread turns, with no memory tool call',
    threshold: 200,
    why: 'Past threads are searchable: memory finds the decision or fix you already made instead of redoing it.',
    measure: signals => signals.turns,
    used: signals => usesAny(signals, name => name.startsWith('memory_') || name === 'find_threads' || name === 'related_threads'),
    evidence: count => `${String(count)} turns, no memory search`,
  },
]

export const suggestionSchema = Schema.Struct({
  rule: Schema.String,
  why: Schema.String,
  /** Counts only, e.g. "84 jj commands, no thread workspace yet". */
  evidence: Schema.String,
  feature: featureRowSchema,
})
export type Suggestion = typeof suggestionSchema.Type

export const suggestionsInputSchema = Schema.Struct({})
export type SuggestionsInput = typeof suggestionsInputSchema.Type

export const suggestionsSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('no-usage'), reason: Schema.String }),
  Schema.Struct({ state: Schema.Literal('unreadable'), reason: Schema.String }),
  Schema.Struct({ state: Schema.Literal('ready'), days: Schema.Number, suggestions: Schema.Array(suggestionSchema) }),
])
export type Suggestions = typeof suggestionsSchema.Type

/** The onboarding `suggestions` setting is off: nothing was read. */
export class SuggestionsOffError extends Schema.TaggedError<SuggestionsOffError>()(
  'SuggestionsOffError',
  { message: Schema.String },
  { dshxWireCode: 'suggestions-off' },
) {}

export const SUGGESTIONS_OFF_MESSAGE =
  'Usage suggestions are off, so no usage was read. The user can turn on Settings › Onboarding › suggestions (off by default); ask them before suggesting it.'

const PROVIDER_PREFIX = /^(?:mcp__[^_]+(?:_[^_]+)*__|functions\.)/u

/** `mcp__dsh__bash` and `functions.bash` count as `bash`. */
const toolName = (raw: string): string => raw.replace(PROVIDER_PREFIX, '')

/** `jj log` counts as `jj`: the arguments never leave the usage owner, and neither does the subcommand here. */
const executable = (command: string): string => command.split(/\s+/u)[0] ?? command

const sumInto = (target: Map<string, number>, key: string, count: number): void => {
  target.set(key, (target.get(key) ?? 0) + count)
}

/** The aggregates the rules read, from the usage owner's activity and chart reports. */
const signalsOf = (input: {
  readonly activity: {
    readonly tools: readonly { readonly name: string; readonly calls: number; readonly errors: number }[]
    readonly commandDistribution: readonly { readonly command: string; readonly calls: number }[]
    readonly totals?: { readonly errors: number } | undefined
  }
  readonly charts: {
    readonly summary: { readonly turns: number }
    readonly breakdown: { readonly purpose?: readonly { readonly key: string; readonly requests: number }[] | undefined }
    readonly topThreads: readonly { readonly requests: number }[]
  }
}): UsageSignals => {
  const tools = new Map<string, number>()
  for (const tool of input.activity.tools) sumInto(tools, toolName(tool.name), tool.calls)
  const commands = new Map<string, number>()
  for (const command of input.activity.commandDistribution) sumInto(commands, executable(command.command), command.calls)
  return {
    tools,
    commands,
    toolErrors: input.activity.totals?.errors ?? input.activity.tools.reduce((sum, tool) => sum + tool.errors, 0),
    turns: input.charts.summary.turns,
    longestThreadRequests: Math.max(0, ...input.charts.topThreads.map(thread => thread.requests)),
    compactionRequests: input.charts.breakdown.purpose?.find(entry => entry.key === 'compaction')?.requests ?? 0,
  }
}

/** Every rule whose signal reaches its threshold for a catalogued feature not in use yet, in rule order. */
const suggest = (input: {
  readonly catalog: FeatureCatalog
  readonly signals: UsageSignals
  readonly rules?: readonly SuggestionRule[]
}): readonly Suggestion[] =>
  (input.rules ?? SUGGESTION_RULES).flatMap(rule => {
    const feature = input.catalog.features.find(candidate => candidate.key === rule.feature)
    if (feature === undefined || rule.used(input.signals)) return []
    const count = rule.measure(input.signals)
    if (count < rule.threshold) return []
    return [{ rule: rule.id, why: rule.why, evidence: rule.evidence(count), feature: OnboardingOverview.rowOf({ feature, catalog: input.catalog }) }]
  })

const render = (value: Suggestions): string => {
  if (value.state !== 'ready') return `Usage suggestions: ${value.reason}`
  if (value.suggestions.length === 0) return `No suggestion: nothing in the last ${String(value.days)} days of local tool use points to a feature not used yet.`
  return [
    `## Suggestions from the last ${String(value.days)} days of local tool use`,
    ...value.suggestions.map(
      suggestion =>
        `- ${suggestion.feature.title} (${suggestion.feature.key}) — ${suggestion.evidence}. ${suggestion.why}${suggestion.feature.walkable ? ' Find it with onboarding_reach.' : ''}`,
    ),
  ].join('\n')
}

export class SuggestionsModel {
  static readonly signalsOf = signalsOf
  static readonly suggest = suggest
  static readonly render = render
}
