import { describe, expect, it } from 'vitest'
import { failureSentence } from './native/chat/failure-copy.ts'
import { TurnFailure } from './turn-error-action.ts'

/** The core sentence the round-four states audit quoted from a first run with no account. */
const NO_KEY =
  'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment.'

describe('credential failures', () => {
  it('words a missing key as a credential failure, never the core sentence', () => {
    expect(failureSentence(NO_KEY, undefined)).toEqual({ kind: 'credential' })
    expect(failureSentence(NO_KEY, 'MISSING_CREDENTIAL')).toEqual({ kind: 'credential' })
    expect(failureSentence('401: {"error":{"message":"Invalid API key"}}', undefined)).toEqual({ kind: 'credential' })
    expect(failureSentence('403: {"message":"Forbidden"}', 'PROVIDER')).toEqual({ kind: 'credential' })
  })

  it('tells every action in the seat the same class', () => {
    expect(TurnFailure.isCredential({ code: '', message: NO_KEY })).toBe(true)
    expect(TurnFailure.isCredential({ code: 'MISSING_CREDENTIAL', message: '' })).toBe(true)
    expect(TurnFailure.isCredential({ code: 'FAKE_FAILURE', message: '400: {"message":"bad request"}' })).toBe(false)
  })

  it('lets Retry lead only when retrying can succeed', () => {
    expect(TurnFailure.retryLeads({ code: 'FAKE_FAILURE', message: '400: {"message":"bad request"}' })).toBe(false)
    expect(TurnFailure.retryLeads({ code: '', message: '429: {"message":"slow down"}' })).toBe(true)
    expect(TurnFailure.retryLeads({ code: '', message: '408: {"message":"timeout"}' })).toBe(true)
    expect(TurnFailure.retryLeads({ code: '', message: '500: {"message":"oops"}' })).toBe(true)
    expect(TurnFailure.retryLeads({ code: '', message: 'pi-ai stream idle timeout after 300000ms' })).toBe(true)
  })
})
