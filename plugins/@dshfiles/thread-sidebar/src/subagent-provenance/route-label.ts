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

const ROUTE_PART_PATTERN = /^[a-z\d][a-z\d._:-]{0,95}$/iu
const SENSITIVE_ROUTE_PATTERN = /@|%40|(?:^|[-_.])(?:api[-_]?key|access[-_]?token|bearer|secret|credential|password|token|private[-_]?key)(?:$|[-_.])/iu
const KNOWN_SECRET_PREFIX_PATTERN = /^(?:sk|rk|pk|gh[pousr]s|xox[baprs])[-_][a-z\d._-]{8,}$/iu

export const visibleRoutePart = (value: string | undefined): string | undefined => {
  const normalized = value?.trim()
  if (
    normalized === undefined ||
    !ROUTE_PART_PATTERN.test(normalized) ||
    SENSITIVE_ROUTE_PATTERN.test(normalized) ||
    KNOWN_SECRET_PREFIX_PATTERN.test(normalized)
  )
    return undefined
  return normalized
}

export const providerModelLabel = (provider: string | undefined, model: string | undefined): string | undefined => {
  const visibleProvider = visibleRoutePart(provider)
  const visibleModel = visibleRoutePart(model)
  return visibleProvider === undefined || visibleModel === undefined ? undefined : `${visibleProvider}/${visibleModel}`
}

export const projectedRouteLabel = (value: ThreadSidebarModelRoute | undefined): string | undefined => {
  const parsed = z.string().max(193).safeParse(value)
  if (!parsed.success) return undefined
  const separator = parsed.data.indexOf('/')
  if (separator <= 0 || separator !== parsed.data.lastIndexOf('/')) return undefined
  return providerModelLabel(parsed.data.slice(0, separator), parsed.data.slice(separator + 1))
}

export const agentIdentityLabel = (identity: SubagentIdentity | null | undefined): string | undefined => {
  const parsed = subagentIdentitySchema.safeParse(identity)
  if (!parsed.success) return undefined
  if (parsed.data.mode === 'one-shot') return visibleRoutePart(parsed.data.provider)
  return providerModelLabel(parsed.data.agentProvider, parsed.data.agentModel) ?? visibleRoutePart(parsed.data.provider)
}

export const displayedAgentRouteLabel = (route: ThreadSidebarModelRoute | undefined, identity: SubagentIdentity | null | undefined): string | undefined =>
  projectedRouteLabel(route) ?? agentIdentityLabel(identity)
