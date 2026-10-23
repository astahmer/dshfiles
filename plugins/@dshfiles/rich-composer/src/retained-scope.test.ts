import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { isRetainedScope } from './retained-scope.ts'

interface Face {
  readonly sessionId: SessionId
}

const sessionId = SessionId('session-swapped')
const firstGeneration: Face = { sessionId }
const secondGeneration: Face = { sessionId }
const scope = { scope: 'session' }

const lookup = (input: { readonly scopeSession: Face | undefined; readonly retained: Face | undefined }) => ({
  sessionOf: () => input.scopeSession,
  binding: () => (input.retained === undefined ? undefined : { session: input.retained }),
})

describe('isRetainedScope', () => {
  it('accepts a scope of the retained Session generation', () => {
    expect(isRetainedScope(lookup({ scopeSession: firstGeneration, retained: firstGeneration }), scope)).toBe(true)
  })

  it('rejects a scope whose generation a hot replacement already swapped', () => {
    expect(isRetainedScope(lookup({ scopeSession: firstGeneration, retained: secondGeneration }), scope)).toBe(false)
  })

  it('rejects a scope with no Session or no retained binding', () => {
    expect(isRetainedScope(lookup({ scopeSession: undefined, retained: firstGeneration }), scope)).toBe(false)
    expect(isRetainedScope(lookup({ scopeSession: firstGeneration, retained: undefined }), scope)).toBe(false)
  })
})
