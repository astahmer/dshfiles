import { Schema } from 'effect'

const ruleSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(120)),
  tool: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  match: Schema.String.check(Schema.isMaxLength(2_000)),
  reason: Schema.String.check(Schema.isMaxLength(1_000)),
  enabled: Schema.Boolean,
})

export type PolicyRule = Schema.Schema.Type<typeof ruleSchema>

const patterns = new Map<string, RegExp>()
const toolMatchers = new Map<string, RegExp>()

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

const toolMatcher = (glob: string): RegExp => {
  const known = toolMatchers.get(glob)
  if (known !== undefined) return known
  const matcher = compiled(toolPattern(glob))
  toolMatchers.set(glob, matcher)
  return matcher
}

/** Deny rules matched against one tool call. A rule whose pattern does not compile denies every call of its tool: a policy fails closed. */
export class Policies {
  static readonly ruleSchema = ruleSchema

  static denying(rules: readonly PolicyRule[], call: { readonly name: string; readonly arguments: unknown }): PolicyRule | undefined {
    let serialized: string | undefined
    return rules.find(rule => {
      if (!rule.enabled || !toolMatcher(rule.tool).test(call.name)) return false
      if (rule.match === '') return true
      serialized ??= JSON.stringify(call.arguments ?? null)
      try {
        return compiled(rule.match).test(serialized)
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
