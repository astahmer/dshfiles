import { describe, expect, it } from 'vitest'
import { RecipientDirectoryModel, type RecipientResolution } from './recipient-directory.js'

const realSession = 'session-53ba46e2-294a-47b9-99f8-d29c9b94dd60'

const suggestionsOf = (resolution: RecipientResolution): readonly string[] => {
  if (resolution.status !== 'unknown') throw new Error(`expected an unknown recipient, received ${resolution.status}`)
  return resolution.suggestions
}

describe('direct-message recipient resolution', () => {
  it('accepts a live Agent and a persisted Session', () => {
    expect(RecipientDirectoryModel.resolve({ requestedId: 'session-live', liveIds: ['session-live'], durableIds: [] })).toEqual({ status: 'live' })
    expect(RecipientDirectoryModel.resolve({ requestedId: realSession, liveIds: [], durableIds: [realSession] })).toEqual({ status: 'durable' })
  })

  it('accepts a subagent id in either form', () => {
    expect(RecipientDirectoryModel.resolve({ requestedId: 'abcd1234', liveIds: ['session-abcd1234'], durableIds: [] })).toEqual({ status: 'live' })
    expect(RecipientDirectoryModel.resolve({ requestedId: 'session-abcd1234', liveIds: [], durableIds: ['abcd1234'] })).toEqual({ status: 'durable' })
  })

  it('refuses a mistyped Session id and suggests the mailbox it resembles', () => {
    const resolution = RecipientDirectoryModel.resolve({
      requestedId: 'session-53ba46e2-294a-47f5-b645-48b9c9d94dd60',
      liveIds: [],
      durableIds: [realSession],
    })

    expect(resolution.status).toBe('unknown')
    expect(suggestionsOf(resolution)).toEqual([realSession])
  })

  it('refuses a decorative id with no close match', () => {
    const resolution = RecipientDirectoryModel.resolve({
      requestedId: 'session-53ba46e2-294a-47b9-99f8-df2?',
      liveIds: [],
      durableIds: [realSession],
    })

    expect(suggestionsOf(resolution)).toEqual([realSession])
  })

  it('suggests nothing when no known id shares a useful prefix', () => {
    const resolution = RecipientDirectoryModel.resolve({ requestedId: 'session-ffffffff', liveIds: [], durableIds: [realSession] })

    expect(resolution).toEqual({ status: 'unknown', suggestions: [] })
  })
})
