import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import {
  candidateVerificationInputSchema,
  candidateVerificationResultSchema,
  completionAuthorizationResultSchema,
  hookEventSchema,
  mayVerifyCandidate,
  verifiedCompletionInputSchema,
} from './api.js'

describe('Project Checks hook event contract', () => {
  it('accepts fractional durations recorded by the native Hook Protocol', () => {
    const event = Schema.decodeUnknownSync(hookEventSchema)({
      seq: 12,
      time: 1_234,
      kind: 'result',
      turn: 1,
      point: 'Stop',
      dialect: null,
      decision: 'pass',
      exitCode: 7,
      durationMs: 0.375,
      stderrPresent: true,
    })

    expect(event.durationMs).toBe(0.375)
  })
})

describe('rebased candidate verification contract', () => {
  it('admits only the jj-integration Host plugin', () => {
    expect(mayVerifyCandidate({ kind: 'plugin', packageId: '@dshfiles/jj-integration' })).toBe(true)
    expect(mayVerifyCandidate({ kind: 'plugin', packageId: '@dshfiles/other' })).toBe(false)
    expect(mayVerifyCandidate({ kind: 'client' })).toBe(false)
    expect(mayVerifyCandidate({ kind: 'agent', sessionId: 'session-1' })).toBe(false)
  })

  it('bounds source and candidate revisions and verification responses', () => {
    expect(verifiedCompletionInputSchema.safeParse({ sessionId: 'session-1', turn: 2, sourceRevision: 'a'.repeat(40) }).success).toBe(true)
    expect(
      candidateVerificationInputSchema.safeParse({
        sessionId: 'session-1',
        turn: 2,
        sourceRevision: 'a'.repeat(40),
        expectedRevision: 'b'.repeat(40),
      }).success,
    ).toBe(true)
    expect(
      candidateVerificationInputSchema.safeParse({ sessionId: 'session-1', turn: 2, sourceRevision: 'main', expectedRevision: 'b'.repeat(40) }).success,
    ).toBe(false)
    expect(Schema.decodeUnknownSync(completionAuthorizationResultSchema)({ status: 'authorized' })).toEqual({ status: 'authorized' })
    expect(Schema.decodeUnknownSync(candidateVerificationResultSchema)({ status: 'passed', prompt: null })).toEqual({ status: 'passed', prompt: null })
    expect(Schema.is(candidateVerificationResultSchema)({ status: 'failed', prompt: 'x'.repeat(2_049) })).toBe(false)
  })
})
