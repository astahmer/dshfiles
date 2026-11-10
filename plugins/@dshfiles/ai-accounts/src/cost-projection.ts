import type { Context } from '@deepseek-ai/cordis'
import * as Schema from 'effect/Schema'
import {
  SESSION_COST_PROJECTION_KEY,
  CostEstimateModel,
  costGroupSchema,
  sessionCostViewSchema,
  type CostGroup,
  type SessionCostView,
  type TokenBuckets,
} from './cost-estimate.js'
import { AiAccountsSchema } from './effect-schema.js'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'

/**
 * Per-session token usage grouped by route and context band, folded from the
 * session log the way DSH's own `tokenUsage` unit folds it: each settled
 * assistant attempt contributes its last usage sample, a later sample for the
 * same turn/step replaces the earlier one, and `llm/retry-started` makes the
 * retry add instead. The route comes from the newest `request/header` or
 * `request/context`, so an account switch mid-session prices each request
 * with the model that served it.
 */

const nonNegativeInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const selectionSchema = Schema.NullOr(Schema.Struct({ provider: Schema.String, model: Schema.String }))

const stateSchema = Schema.Struct({
  selection: selectionSchema,
  last: Schema.NullOr(Schema.Struct({ turn: nonNegativeInt, step: nonNegativeInt, group: costGroupSchema })),
  view: sessionCostViewSchema,
})

type CostState = typeof stateSchema.Type

interface ProjectionEvent {
  readonly type: string
  readonly data?: unknown
}

const usageSampleSchema = Schema.Struct({
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  cacheReadTokens: Schema.optional(nonNegativeInt),
  cacheWriteTokens: Schema.optional(nonNegativeInt),
})

const streamUsageSchema = Schema.Struct({
  type: Schema.Literal('chunk'),
  chunk: Schema.Struct({ type: Schema.Literal('usage'), usage: usageSampleSchema }),
})

const settlementSchema = Schema.Struct({
  turn: nonNegativeInt,
  step: nonNegativeInt,
  usage: Schema.optional(usageSampleSchema),
  stream: Schema.optional(Schema.Array(Schema.Unknown)),
})

const headerSchema = Schema.Struct({ header: Schema.Struct({ config: Schema.Struct({ provider: Schema.String, model: Schema.String }) }) })
const contextSchema = Schema.Struct({ provider: Schema.String, model: Schema.String })
const retrySchema = Schema.Struct({ turn: nonNegativeInt, step: nonNegativeInt })

const usageOf = (settlement: typeof settlementSchema.Type): TokenBuckets | undefined => {
  let sample = settlement.usage
  if (sample === undefined) {
    for (const record of [...(settlement.stream ?? [])].reverse()) {
      const parsed = AiAccountsSchema.decodeResult(streamUsageSchema, record)
      if (parsed._tag === 'Success') {
        sample = parsed.success.chunk.usage
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
    const parsed = AiAccountsSchema.decodeResult(headerSchema, event.data)
    if (parsed._tag === 'Failure') return state
    const selection = { provider: parsed.success.header.config.provider, model: parsed.success.header.config.model }
    if (state.selection?.provider === selection.provider && state.selection.model === selection.model) return state
    return { ...state, selection }
  }
  if (event.type === 'request/context') {
    const parsed = AiAccountsSchema.decodeResult(contextSchema, event.data)
    if (parsed._tag === 'Failure') return state
    if (state.selection?.provider === parsed.success.provider && state.selection.model === parsed.success.model) return state
    return { ...state, selection: { provider: parsed.success.provider, model: parsed.success.model } }
  }
  if (event.type === 'llm/retry-started') {
    const parsed = AiAccountsSchema.decodeResult(retrySchema, event.data)
    if (parsed._tag === 'Failure') return state
    if (state.last === null || state.last.turn !== parsed.success.turn || state.last.step !== parsed.success.step) return state
    return { ...state, last: null }
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
  const parsed = AiAccountsSchema.decodeResult(settlementSchema, event.data)
  if (parsed._tag === 'Failure') return state
  const tokens = usageOf(parsed.success)
  if (tokens === undefined) return state
  const { turn, step } = parsed.success
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
  // `ctx.sessionProjections` still defines its schema as a Zod schema and calls `.parse` on it.
  stateSchema: zodSchemaFromEffect(stateSchema),
  init: CostProjectionModel.initialState,
  apply: CostProjectionModel.applyEvent,
  wire: {
    viewSchema: zodSchemaFromEffect(sessionCostViewSchema),
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
