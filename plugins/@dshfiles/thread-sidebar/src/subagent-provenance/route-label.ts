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

  static readonly displayedAgentRouteLabel = (route: ThreadSidebarModelRoute | undefined, identity: SubagentIdentity | null | undefined): string | undefined =>
    SubagentRouteLabelModel.projectedRouteLabel(route) ?? SubagentRouteLabelModel.agentIdentityLabel(identity)
}
export const providerModelLabel = SubagentRouteLabelModel.providerModelLabel
