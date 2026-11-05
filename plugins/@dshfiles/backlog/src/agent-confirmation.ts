import { Effect } from 'effect'
import { BacklogBackfill } from './backfill.js'
import { BacklogConfirmationRequired } from './errors.js'

/** More items than this in one agent call is a bulk write the user must have asked for. */
const AGENT_BULK_LIMIT = 5

/** The agent calls that need `confirm: true`; a person in the panel already confirmed by clicking. */
type GuardedCall =
  | { readonly tool: 'backlog_revert' }
  | { readonly tool: 'backlog_triage_backfill'; readonly limit?: number | undefined }
  | { readonly tool: 'backlog_sync_now'; readonly id?: unknown }

/** What the call would do without confirmation, or `undefined` when it is small enough to run as asked. */
const guardedEffect = (call: GuardedCall): string | undefined => {
  switch (call.tool) {
    case 'backlog_revert':
      return 'overwrites a field with an earlier value'
    case 'backlog_triage_backfill': {
      const limit = call.limit ?? BacklogBackfill.defaultLimit
      return limit > AGENT_BULK_LIMIT ? `may change the status of up to ${String(limit)} items` : undefined
    }
    case 'backlog_sync_now':
      return call.id === undefined ? 'pulls status and field changes into every linked item' : undefined
  }
}

/** Refuses an agent's guarded call that lacks `confirm: true`; every other caller passes. */
const check = (input: { readonly callerKind: string; readonly confirm?: boolean | undefined; readonly call: GuardedCall }) => {
  if (input.callerKind !== 'agent' || input.confirm === true) return Effect.void
  const effect = guardedEffect(input.call)
  return effect === undefined ? Effect.void : Effect.fail(new BacklogConfirmationRequired({ tool: input.call.tool, effect }))
}

/** The sentence a guarded tool's description and its `confirm` argument share. */
const confirmDescription = 'Explicit opt-in an agent must pass when the user asked for this; without it an agent call is refused. The panel never needs it.'

export class AgentConfirmation {
  static readonly bulkLimit = AGENT_BULK_LIMIT
  static readonly guardedEffect = guardedEffect
  static readonly check = check
  static readonly confirmDescription = confirmDescription
}
