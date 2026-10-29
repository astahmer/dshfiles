import { z } from 'zod'

const ruleSchema = z
  .object({
    name: z.string().max(120),
    tool: z.string().min(1).max(200),
    match: z.string().max(2000),
    reason: z.string().max(1000),
    enabled: z.boolean(),
  })
  .strict()

export type PolicyRule = z.infer<typeof ruleSchema>

const patterns = new Map<string, RegExp>()

const compiled = (source: string): RegExp => {
  const known = patterns.get(source)
  if (known !== undefined) return known
  const pattern = new RegExp(source, 'u')
  patterns.set(source, pattern)
  return pattern
}

const toolPattern = (glob: string): string =>
  `^${glob
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*')}$`

/** Deny rules matched against one tool call. A rule whose pattern does not compile denies every call of its tool: a policy fails closed. */
export class Policies {
  static readonly ruleSchema = ruleSchema

  static denying(rules: readonly PolicyRule[], call: { readonly name: string; readonly arguments: unknown }): PolicyRule | undefined {
    const serialized = JSON.stringify(call.arguments ?? null)
    return rules.find(rule => {
      if (!rule.enabled || !compiled(toolPattern(rule.tool)).test(call.name)) return false
      try {
        return rule.match === '' || compiled(rule.match).test(serialized)
      } catch {
        return true
      }
    })
  }

  /** A `ctx.tools.guard` check over the current rules: a returned string denies the call. */
  static guard(rules: () => readonly PolicyRule[]): (execution: { readonly name: string; readonly arguments: unknown }) => string | undefined {
    return execution => {
      const rule = Policies.denying(rules(), execution)
      return rule === undefined ? undefined : Policies.refusal(rule)
    }
  }

  static refusal(rule: PolicyRule): string {
    const label = rule.name === '' ? `the ${rule.tool} policy` : `policy “${rule.name}”`
    return `Denied by ${label}${rule.reason === '' ? '' : `: ${rule.reason}`}. Policies are fixed by the user in Settings › dshfiles-policies; no approval or retry can allow this call, so choose another approach or ask the user to change the policy.`
  }
}
