import { describe, expect, it } from 'vitest'
import { failureDetails, failureSentence } from '../src/native/chat/failure-copy.ts'
import { SinceYouLeftRecapModel } from '../src/native/chat/since-you-left.ts'
import { en } from '../src/native/locale.ts'

const REJECTED = '400: {"message":"The fake provider rejected this request","type":"invalid_request_error","code":"FAKE_FAILURE"}'
const TOO_LONG =
  '400: {"message":"The provider rejected this request: maximum context length is 200000 tokens, the request used 214302","type":"invalid_request_error","code":"FAKE_FAILURE"}'

describe('failureSentence', () => {
  it("reads the provider's sentence out of its JSON error body", () => {
    expect(failureSentence(REJECTED, 'INVALID_REQUEST')).toEqual({ kind: 'provider', text: 'The fake provider rejected this request.' })
    expect(failureSentence('{"error":{"message":"Model overloaded"}}', undefined)).toEqual({ kind: 'provider', text: 'Model overloaded.' })
  })

  it('says a stalled stream in minutes, without the library name or milliseconds', () => {
    expect(failureSentence('pi-ai stream idle timeout after 300000ms', 'TIMEOUT')).toEqual({ kind: 'stalled', minutes: 5 })
    expect(en['message.failure.stalled']).not.toMatch(/pi-ai|ms\b/)
  })

  it('names an over-long thread and its next step, whatever the provider wrote', () => {
    expect(failureSentence(TOO_LONG, 'CONTEXT_WINDOW_EXCEEDED')).toEqual({ kind: 'tooLong' })
    expect(failureSentence(TOO_LONG, undefined)).toEqual({ kind: 'tooLong' })
    expect(en['message.failure.tooLong']).toMatch(/\/compact/)
  })

  it('keeps plain text as written and never shows a bare payload', () => {
    expect(failureSentence('Connection refused', undefined)).toEqual({ kind: 'provider', text: 'Connection refused.' })
    expect(failureSentence('The request timed out.', undefined)).toEqual({ kind: 'provider', text: 'The request timed out.' })
    expect(failureSentence('500: {"type":"server_error"}', undefined)).toEqual({ kind: 'unknown' })
    expect(failureSentence('', undefined)).toEqual({ kind: 'unknown' })
  })
})

describe('failureDetails', () => {
  it('holds the code and the original text when the sentence replaced it', () => {
    expect(failureDetails(REJECTED, 'INVALID_REQUEST', 'The fake provider rejected this request.')).toEqual({ code: 'INVALID_REQUEST', raw: REJECTED })
  })

  it('is absent when the sentence is the whole failure', () => {
    expect(failureDetails('Connection refused', undefined, 'Connection refused.')).toBeNull()
    expect(failureDetails('Connection refused', 'NETWORK', 'Connection refused.')).toEqual({ code: 'NETWORK', raw: undefined })
  })
})

describe('since you left', () => {
  it('draws no card for a single unseen turn, which is on screen right below', () => {
    expect(SinceYouLeftRecapModel.worthShowing(null)).toBe(false)
    expect(SinceYouLeftRecapModel.worthShowing({ turns: 1 })).toBe(false)
    expect(SinceYouLeftRecapModel.worthShowing({ turns: 2 })).toBe(true)
  })
})
