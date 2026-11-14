import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnChangesReadError } from './turn-changes.js'
import { TurnDiffModel } from './turn-diff.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TurnDiffModel.read', () => {
  it('reports an expired turn (204 No Content) as gone instead of failing to parse an empty body', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
    const read = TurnDiffModel.read({ sessionId: 'session-1', seq: 4, cwd: undefined, signal: new AbortController().signal })
    await expect(read).rejects.toBeInstanceOf(TurnChangesReadError)
    await expect(read).rejects.toHaveProperty('gone', true)
  })
})
