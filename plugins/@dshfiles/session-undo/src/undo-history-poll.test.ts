import { QueryClient, QueryObserver } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { undoHistoryQuery } from './rewind-flow.js'

const counted = () => {
  const api = {
    reads: 0,
    history: async () => {
      api.reads += 1
      return { checkpoints: [], redoTo: null }
    },
  }
  return api
}

describe('undo history polling', () => {
  it('polls only the thread the main view shows; a thread kept mounted in a background tab does not', () => {
    const api = counted()
    expect(undoHistoryQuery({ api, sessionId: 'shown', onScreen: true }).refetchInterval).toBe(15_000)
    expect(undoHistoryQuery({ api, sessionId: 'background-tab', onScreen: false }).refetchInterval).toBe(false)
  })

  it('still reads an off-screen thread once when it mounts, so a side-panel composer shows its controls', async () => {
    const client = new QueryClient()
    const api = counted()
    const observer = new QueryObserver(client, undoHistoryQuery({ api, sessionId: 'aside', onScreen: false }))
    const unsubscribe = observer.subscribe(() => undefined)
    await client.getQueryCache().find({ queryKey: ['session-undo', 'history', 'aside'] })?.promise
    unsubscribe()
    client.clear()
    expect(api.reads).toBe(1)
  })
})
