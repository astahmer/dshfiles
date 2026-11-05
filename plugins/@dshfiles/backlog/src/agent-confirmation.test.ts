import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Result, Schema } from 'effect'
import { AgentConfirmation } from './agent-confirmation.js'
import { backlogApi } from './api.js'

const outcome = (input: Parameters<typeof AgentConfirmation.check>[0]) => Effect.runSyncExit(AgentConfirmation.check(input))
const refusal = (input: Parameters<typeof AgentConfirmation.check>[0]): string | undefined => {
  const exit = outcome(input)
  if (Exit.isSuccess(exit)) return undefined
  const failure = exit.cause.reasons.find(reason => reason._tag === 'Fail')
  return failure?._tag === 'Fail' ? failure.error.message : 'defect'
}

describe('agent confirmation', () => {
  it('refuses an agent revert without confirm and names the recovery', () => {
    expect(refusal({ callerKind: 'agent', call: { tool: 'backlog_revert' } })).toBe(
      'backlog_revert overwrites a field with an earlier value, so an agent must confirm it. Ask the user first; once they asked for it, call backlog_revert again with confirm: true.',
    )
    expect(refusal({ callerKind: 'agent', confirm: false, call: { tool: 'backlog_revert' } })).toContain('confirm: true')
    expect(refusal({ callerKind: 'agent', confirm: true, call: { tool: 'backlog_revert' } })).toBeUndefined()
  })

  it('refuses an agent backfill over more than the bulk limit, including the default limit', () => {
    expect(refusal({ callerKind: 'agent', call: { tool: 'backlog_triage_backfill' } })).toContain('up to 25 items')
    expect(refusal({ callerKind: 'agent', call: { tool: 'backlog_triage_backfill', limit: AgentConfirmation.bulkLimit + 1 } })).toContain('up to 6 items')
    expect(refusal({ callerKind: 'agent', call: { tool: 'backlog_triage_backfill', limit: AgentConfirmation.bulkLimit } })).toBeUndefined()
    expect(refusal({ callerKind: 'agent', confirm: true, call: { tool: 'backlog_triage_backfill', limit: 100 } })).toBeUndefined()
  })

  it('refuses an agent sync of every linked item but lets one item through', () => {
    expect(refusal({ callerKind: 'agent', call: { tool: 'backlog_sync_now' } })).toContain('every linked item')
    expect(refusal({ callerKind: 'agent', call: { tool: 'backlog_sync_now', id: 'b:k3f9' } })).toBeUndefined()
    expect(refusal({ callerKind: 'agent', confirm: true, call: { tool: 'backlog_sync_now' } })).toBeUndefined()
  })

  it('never asks the panel or the Host to confirm', () => {
    for (const callerKind of ['user', 'host', 'system']) {
      expect(refusal({ callerKind, call: { tool: 'backlog_revert' } })).toBeUndefined()
      expect(refusal({ callerKind, call: { tool: 'backlog_triage_backfill', limit: 100 } })).toBeUndefined()
      expect(refusal({ callerKind, call: { tool: 'backlog_sync_now' } })).toBeUndefined()
    }
  })

  it('takes confirm on every guarded method as an optional boolean with no default', () => {
    for (const [name, base] of [
      ['revert', { id: 1, at: 1, field: 'status' }],
      ['backfillTriage', {}],
      ['syncNow', {}],
    ] as const) {
      const input = backlogApi.methods[name].input
      if (input === undefined) throw new Error(`${name} has no input schema`)
      const validate = Schema.decodeUnknownResult(input)
      expect(Result.isSuccess(validate(base))).toBe(true)
      expect(Result.isSuccess(validate({ ...base, confirm: true }))).toBe(true)
      expect(Result.isFailure(validate({ ...base, confirm: 'yes' }))).toBe(true)
      const decoded = validate(base)
      expect(Result.isSuccess(decoded) && 'confirm' in decoded.success).toBe(false)
    }
  })
})
