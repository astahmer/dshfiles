import { Schema } from 'effect'

const MAX_GATES = 20
const gateKinds = ['pr', 'revision', 'check', 'date'] as const

/**
 * An outside condition an item waits on: a pull request merged, a jj revision on main, a project check passing in a
 * thread linked to the item, or a date reached. While one is open the item is not ready.
 */
const gateSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,40}$/)),
  kind: Schema.Literals(gateKinds),
  /** The pull request URL, the revision (change or commit id), the project-check action id, or the date. */
  target: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  /** When the condition was seen met; a date gate opens and closes on the calendar and never records it. */
  resolvedAt: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  /** What resolved it, such as `merged` or `passed in session-…`. */
  detail: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
})
const gatesSchema = Schema.Array(gateSchema).check(Schema.isMaxLength(MAX_GATES))

export type BacklogGate = typeof gateSchema.Type
export type BacklogGateKind = (typeof gateKinds)[number]

/** Whether the gate still holds the item back on `today`'s calendar. */
const isOpen = (gate: Pick<BacklogGate, 'kind' | 'target' | 'resolvedAt'>, today: string): boolean =>
  gate.kind === 'date' ? today < gate.target : gate.resolvedAt === undefined

const openGates = <Gate extends Pick<BacklogGate, 'kind' | 'target' | 'resolvedAt'>>(gates: readonly Gate[] | undefined, today: string): Gate[] =>
  (gates ?? []).filter(gate => isOpen(gate, today))

/** A GitHub pull request or a GitLab merge request URL, read as `owner/repo#number`. */
const pullRequestPattern = /^https:\/\/(github\.com)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|^https:\/\/([\w.-]*gitlab[\w.-]*)\/(.+?)\/-\/merge_requests\/(\d+)/

const pullRequestOf = (url: string): { readonly host: 'github' | 'gitlab'; readonly repo: string; readonly number: number; readonly url: string } | null => {
  const match = pullRequestPattern.exec(url.trim())
  if (match === null) return null
  if (match[1] !== undefined)
    return { host: 'github', repo: match[2] ?? '', number: Number(match[3]), url: `https://github.com/${match[2] ?? ''}/pull/${match[3] ?? ''}` }
  return { host: 'gitlab', repo: match[5] ?? '', number: Number(match[6]), url: url.trim() }
}

const label = (gate: Pick<BacklogGate, 'kind' | 'target'>): string => {
  if (gate.kind === 'pr') {
    const pull = pullRequestOf(gate.target)
    return pull === null ? `PR ${gate.target}` : `${pull.repo}#${String(pull.number)} merged`
  }
  if (gate.kind === 'revision') return `jj:${gate.target.slice(0, 12)} on main`
  if (gate.kind === 'check') return `check ${gate.target} passes`
  return `after ${gate.target}`
}

const salt = (text: string): string => {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(36).slice(0, 6)
}

const gateId = (kind: BacklogGateKind, target: string): string => `${kind}-${salt(target)}`

export class BacklogGates {
  static readonly kinds = gateKinds
  static readonly schema = gateSchema
  static readonly listSchema = gatesSchema
  static readonly max = MAX_GATES
  static readonly isOpen = isOpen
  static readonly open = openGates
  static readonly pullRequestOf = pullRequestOf
  static readonly label = label
  static readonly idOf = gateId
}
