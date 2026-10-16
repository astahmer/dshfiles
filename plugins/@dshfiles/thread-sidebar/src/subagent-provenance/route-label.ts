import { z } from 'zod'
import type { ThreadSidebarModelRoute } from './projection-types.js'

const subagentIdentitySchema = z
  .object({
    mode: z.string().optional(),
    provider: z.string().optional(),
    agentProvider: z.string().optional(),
    agentModel: z.string().optional(),
  })
  .passthrough()

type SubagentIdentity = z.input<typeof subagentIdentitySchema>

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
    const parsed = z.string().max(193).safeParse(value)
    if (!parsed.success) return undefined
    const separator = parsed.data.indexOf('/')
    if (separator <= 0 || separator !== parsed.data.lastIndexOf('/')) return undefined
    return SubagentRouteLabelModel.providerModelLabel(parsed.data.slice(0, separator), parsed.data.slice(separator + 1))
  }

  static readonly agentIdentityLabel = (identity: SubagentIdentity | null | undefined): string | undefined => {
    const parsed = subagentIdentitySchema.safeParse(identity)
    if (!parsed.success) return undefined
    if (parsed.data.mode === 'one-shot') return SubagentRouteLabelModel.visibleRoutePart(parsed.data.provider)
    return (
      SubagentRouteLabelModel.providerModelLabel(parsed.data.agentProvider, parsed.data.agentModel) ??
      SubagentRouteLabelModel.visibleRoutePart(parsed.data.provider)
    )
  }

  static readonly displayedAgentRouteLabel = (route: ThreadSidebarModelRoute | undefined, identity: SubagentIdentity | null | undefined): string | undefined =>
    SubagentRouteLabelModel.projectedRouteLabel(route) ?? SubagentRouteLabelModel.agentIdentityLabel(identity)
}
