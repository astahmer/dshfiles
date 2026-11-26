import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import type { ThreadSidebarModelRoute } from './projection-types.js'

const subagentIdentitySchema = Schema.StructWithRest(
  Schema.Struct({
    mode: Schema.optional(Schema.String),
    provider: Schema.optional(Schema.String),
    agentProvider: Schema.optional(Schema.String),
    agentModel: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

type SubagentIdentity = Schema.Schema.Type<typeof subagentIdentitySchema>

/** The provider and model a subagent runs on, both checked visible; what the kit's model identity reads. */
export interface SubagentModelRoute {
  readonly provider: string
  readonly model: string
}

export class SubagentRouteLabelModel {
  private static readonly routePartPattern = /^[a-z\d][a-z\d._:-]{0,95}$/iu
  private static readonly sensitiveRoutePattern =
    /@|%40|(?:^|[-_.])(?:api[-_]?key|access[-_]?token|bearer|secret|credential|password|token|private[-_]?key)(?:$|[-_.])/iu
  private static readonly knownSecretPrefixPattern = /^(?:sk|rk|pk|gh[pousr]s|xox[baprs])[-_][a-z\d._-]{8,}$/iu

  static readonly visibleRoutePart = (value: string | undefined): string | undefined => {
    const normalized = value?.trim()
    if (
      normalized === undefined ||
      !SubagentRouteLabelModel.routePartPattern.test(normalized) ||
      SubagentRouteLabelModel.sensitiveRoutePattern.test(normalized) ||
      SubagentRouteLabelModel.knownSecretPrefixPattern.test(normalized)
    )
      return undefined
    return normalized
  }

  static readonly providerModelLabel = (provider: string | undefined, model: string | undefined): string | undefined => {
    const visibleProvider = SubagentRouteLabelModel.visibleRoutePart(provider)
    const visibleModel = SubagentRouteLabelModel.visibleRoutePart(model)
    return visibleProvider === undefined || visibleModel === undefined ? undefined : `${visibleProvider}/${visibleModel}`
  }

  static readonly projectedRouteLabel = (value: ThreadSidebarModelRoute | undefined): string | undefined => {
    const parsed = Schema.decodeUnknownResult(Schema.String.check(Schema.isMaxLength(193)))(value)
    if (Result.isFailure(parsed)) return undefined
    const separator = parsed.success.indexOf('/')
    if (separator <= 0 || separator !== parsed.success.lastIndexOf('/')) return undefined
    return SubagentRouteLabelModel.providerModelLabel(parsed.success.slice(0, separator), parsed.success.slice(separator + 1))
  }

  static readonly agentIdentityLabel = (identity: SubagentIdentity | null | undefined): string | undefined => {
    const parsed = Schema.decodeUnknownResult(subagentIdentitySchema)(identity)
    if (Result.isFailure(parsed)) return undefined
    if (parsed.success.mode === 'one-shot') return SubagentRouteLabelModel.visibleRoutePart(parsed.success.provider)
    return (
      SubagentRouteLabelModel.providerModelLabel(parsed.success.agentProvider, parsed.success.agentModel) ??
      SubagentRouteLabelModel.visibleRoutePart(parsed.success.provider)
    )
  }

  /**
   * The model's own name out of a route label ("openai/gpt-6.1-luna" → "gpt-6.1-luna"), as the model picker shows it.
   * A label that names no model (a one-shot provider) has none: a provider id is not a name to show.
   */
  static readonly modelName = (routeLabel: string | undefined): string | undefined => {
    if (routeLabel === undefined) return undefined
    const separator = routeLabel.indexOf('/')
    return separator <= 0 || separator === routeLabel.length - 1 ? undefined : routeLabel.slice(separator + 1)
  }

  static readonly displayedAgentRouteLabel = (route: ThreadSidebarModelRoute | undefined, identity: SubagentIdentity | null | undefined): string | undefined =>
    SubagentRouteLabelModel.projectedRouteLabel(route) ?? SubagentRouteLabelModel.agentIdentityLabel(identity)

  /** A route label's provider and model; a label that names no model (a backend such as "in-process") has none. */
  static readonly routeOf = (label: string | undefined): SubagentModelRoute | undefined => {
    const model = SubagentRouteLabelModel.modelName(label)
    if (label === undefined || model === undefined) return undefined
    return { provider: label.slice(0, label.indexOf('/')), model }
  }

  /**
   * The model a subagent runs on, for every surface that shows one (council round 17 B1.1): the route projection (the
   * route the child really used or, until it answers, the one its descriptor started it on), else an identity that names
   * one, else the route its call asked for. Unknown stays unknown: no guess from a backend name.
   */
  static readonly subagentRoute = (input: {
    readonly route: ThreadSidebarModelRoute | undefined
    readonly identity: SubagentIdentity | null | undefined
    readonly requested?: { readonly provider?: string | undefined; readonly model?: string | undefined } | undefined
  }): SubagentModelRoute | undefined =>
    SubagentRouteLabelModel.routeOf(SubagentRouteLabelModel.displayedAgentRouteLabel(input.route, input.identity)) ??
    SubagentRouteLabelModel.routeOf(SubagentRouteLabelModel.providerModelLabel(input.requested?.provider, input.requested?.model))
}
export const providerModelLabel = SubagentRouteLabelModel.providerModelLabel
