import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import {
  SESSION_COST_PROJECTION_KEY,
  CostEstimateModel,
  costGroupSchema,
  sessionCostViewSchema,
  type CostGroup,
  type SessionCostView,
  type TokenBuckets,
} from './cost-estimate.js'

/**
 * Per-session token usage grouped by route and context band, folded from the
 * session log the way DSH's own `tokenUsage` unit folds it: each settled
 * assistant attempt contributes its last usage sample, a later sample for the
 * same turn/step replaces the earlier one, and `llm/retry-started` makes the
 * retry add instead. The route comes from the newest `request/header` or
 * `request/context`, so an account switch mid-session prices each request
 * with the model that served it.
 */

const selectionSchema = z.object({ provider: z.string(), model: z.string() }).nullable()

const stateSchema = z.object({
  selection: selectionSchema,
  last: z.object({ turn: z.number().int().min(0), step: z.number().int().min(0), group: costGroupSchema }).nullable(),
  view: sessionCostViewSchema,
})

type CostState = z.infer<typeof stateSchema>

interface ProjectionEvent {
  readonly type: string
  readonly data?: unknown
}

const usageSampleSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0).optional(),
  cacheWriteTokens: z.number().int().min(0).optional(),
})

const streamUsageSchema = z.object({ type: z.literal('chunk'), chunk: z.object({ type: z.literal('usage'), usage: usageSampleSchema }) })

const settlementSchema = z.object({
  turn: z.number().int().min(0),
  step: z.number().int().min(0),
  usage: usageSampleSchema.optional(),
  stream: z.array(z.unknown()).optional(),
})

const headerSchema = z.object({ header: z.object({ config: z.object({ provider: z.string(), model: z.string() }) }) })
const contextSchema = z.object({ provider: z.string(), model: z.string() })
const retrySchema = z.object({ turn: z.number().int().min(0), step: z.number().int().min(0) })

const usageOf = (settlement: z.infer<typeof settlementSchema>): TokenBuckets | undefined => {
  let sample = settlement.usage
  if (sample === undefined) {
    for (const record of [...(settlement.stream ?? [])].reverse()) {
      const parsed = streamUsageSchema.safeParse(record)
      if (parsed.success) {
        sample = parsed.data.chunk.usage
        break
      }
    }
  }
  if (sample === undefined) return undefined
  return {
    uncachedInputTokens: sample.inputTokens,
    outputTokens: sample.outputTokens,
    cacheReadTokens: sample.cacheReadTokens ?? 0,
    cacheWriteTokens: sample.cacheWriteTokens ?? 0,
  }
}

const sameGroup = (left: CostGroup, right: { readonly provider: string; readonly model: string; readonly band: number }): boolean =>
  left.provider === right.provider && left.model === right.model && left.band === right.band

const applyDelta = (groups: readonly CostGroup[], group: CostGroup, sign: 1 | -1): CostGroup[] => {
  const next = groups.map(existing =>
    sameGroup(existing, group)
      ? {
          ...existing,
          requests: existing.requests + sign * group.requests,
          tokens: {
            uncachedInputTokens: existing.tokens.uncachedInputTokens + sign * group.tokens.uncachedInputTokens,
            outputTokens: existing.tokens.outputTokens + sign * group.tokens.outputTokens,
            cacheReadTokens: existing.tokens.cacheReadTokens + sign * group.tokens.cacheReadTokens,
            cacheWriteTokens: existing.tokens.cacheWriteTokens + sign * group.tokens.cacheWriteTokens,
          },
        }
      : existing,
  )
  if (sign === 1 && !groups.some(existing => sameGroup(existing, group))) next.push(group)
  return next.filter(existing => existing.requests > 0)
}

const replaceSample = (groups: readonly CostGroup[], previous: CostGroup | undefined, group: CostGroup): CostGroup[] =>
  applyDelta(previous === undefined ? groups : applyDelta(groups, previous, -1), group, 1)

const MAX_TURN_COST_GROUPS = 512

const initialCostState = (): CostState => ({ selection: null, last: null, view: { groups: [], turn: null, turns: [] } })

const applyCostEvent = (state: CostState, event: ProjectionEvent): CostState => {
  if (event.type === 'request/header') {
    const parsed = headerSchema.safeParse(event.data)
    if (!parsed.success) return state
    const selection = { provider: parsed.data.header.config.provider, model: parsed.data.header.config.model }
    if (state.selection?.provider === selection.provider && state.selection.model === selection.model) return state
    return { ...state, selection }
  }
  if (event.type === 'request/context') {
    const parsed = contextSchema.safeParse(event.data)
    if (!parsed.success) return state
    if (state.selection?.provider === parsed.data.provider && state.selection.model === parsed.data.model) return state
    return { ...state, selection: { provider: parsed.data.provider, model: parsed.data.model } }
  }
  if (event.type === 'llm/retry-started') {
    const parsed = retrySchema.safeParse(event.data)
    if (!parsed.success || state.last === null || state.last.turn !== parsed.data.turn || state.last.step !== parsed.data.step) return state
    return { ...state, last: null }
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
  const parsed = settlementSchema.safeParse(event.data)
  if (!parsed.success) return state
  const tokens = usageOf(parsed.data)
  if (tokens === undefined) return state
  const { turn, step } = parsed.data
  const group: CostGroup = {
    provider: state.selection?.provider ?? '',
    model: state.selection?.model ?? '',
    band: CostEstimateModel.contextBand(tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens),
    requests: 1,
    tokens,
  }
  const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last.group : undefined
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(group)) return state
  const turnGroups = state.view.turns?.find(candidate => candidate.turn === turn)?.groups ?? (state.view.turn?.turn === turn ? state.view.turn.groups : [])
  const nextTurnGroups = replaceSample(turnGroups, previous, group)
  const turns = [
    ...(state.view.turns ?? (state.view.turn === null ? [] : [state.view.turn])).filter(candidate => candidate.turn !== turn),
    { turn, groups: nextTurnGroups },
  ].sort((left, right) => left.turn - right.turn)
  let retainedGroupCount = 0
  const retainedTurns = turns
    .toReversed()
    .filter(candidate => {
      if (retainedGroupCount + candidate.groups.length > MAX_TURN_COST_GROUPS) return false
      retainedGroupCount += candidate.groups.length
      return true
    })
    .toReversed()
  const view: SessionCostView = {
    groups: replaceSample(state.view.groups, previous, group),
    turn: { turn, groups: nextTurnGroups },
    turns: retainedTurns,
  }
  return { ...state, last: { turn, step, group }, view }
}

export class CostProjectionModel {
  static readonly initialState = initialCostState
  static readonly applyEvent = applyCostEvent
}

/** Bump whenever the state shape or fold semantics change, so stale checkpoints refold. */
const STATE_VERSION = 2

const costProjectionDefinition = {
  key: SESSION_COST_PROJECTION_KEY,
  stateVersion: STATE_VERSION,
  stateSchema,
  init: CostProjectionModel.initialState,
  apply: CostProjectionModel.applyEvent,
  wire: {
    viewSchema: sessionCostViewSchema,
    // The state keeps the view object, so a selection-only change publishes nothing.
    view: (state: CostState): SessionCostView => state.view,
  },
}

interface ProjectionRegistry {
  readonly register: (definition: typeof costProjectionDefinition) => () => void
}

const isProjectionRegistry = (value: unknown): value is ProjectionRegistry =>
  typeof value === 'object' && value !== null && 'register' in value && typeof value.register === 'function'

/** Registers only when the Host runs a projection registry; an older Host simply has no cost readout. */
export const installCostProjection = (ctx: Context): void => {
  ctx.inject(['sessionProjections'], scoped => {
    const registry: unknown = scoped.get('sessionProjections')
    if (!isProjectionRegistry(registry)) return
    scoped.effect(() => registry.register(costProjectionDefinition), 'ai-accounts cost projection')
  })
}
