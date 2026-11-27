import { ReminderWakeModel } from './reminder-wake.js'

/** The durable header fields the settled-lineage walk reads. */
export interface SettledSessionHeader {
  readonly id: string
  readonly origin?: 'subagent' | undefined
  readonly parentSession?: string | undefined
}

/** What one proposed step does under a settled status: run and lift it, or wait for an unsettle. */
export type SettledStepDecision = 'run' | 'reject'

const lineage = (input: {
  readonly header: SettledSessionHeader
  readonly settledSessionIds: readonly string[]
  readonly parentHeader: (sessionId: string) => SettledSessionHeader | undefined
}): ReadonlyArray<string> => {
  const settled = new Set(input.settledSessionIds)
  const owners: string[] = []
  let header = input.header
  const visited = new Set<string>()
  while (!visited.has(header.id)) {
    if (settled.has(header.id)) owners.push(header.id)
    visited.add(header.id)
    if (header.origin !== 'subagent' || header.parentSession === undefined) return owners
    const parent = input.parentHeader(header.parentSession)
    if (parent === undefined) {
      if (settled.has(header.parentSession)) owners.push(header.parentSession)
      return owners
    }
    header = parent
  }
  return owners
}

const under = (input: Parameters<typeof lineage>[0]): boolean => lineage(input).length > 0

const stepFor = (input: {
  readonly settledOwners: readonly string[]
  readonly messages: readonly { readonly source: { readonly kind: string } }[]
}): SettledStepDecision => (input.settledOwners.length === 0 || input.messages.some(ReminderWakeModel.isReminderMessage) ? 'run' : 'reject')

/**
 * The settled status a step is checked against. Every settled Session owning the step is named, nearest first —
 * the Session itself, then any settled subagent ancestor — following the durable header fields through
 * subagent-origin Sessions only: a fork of a settled Session is an independent conversation, exactly as it is for
 * the native archived-set gate. A missing parent header still answers from the recorded parent id, so a pruned
 * ancestor keeps its child settled.
 *
 * A reminder always reaches its thread: the step it proposes lifts the owners it finds and runs, because the claim
 * already carried the message into that step, and refusing it would drop the reminder. Every other wake waits for
 * an unsettle.
 */
export class SettledGateModel {
  static readonly lineage = lineage
  static readonly under = under
  static readonly stepFor = stepFor
}
