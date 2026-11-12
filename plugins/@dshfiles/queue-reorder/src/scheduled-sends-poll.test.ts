import { QueryClient, QueryObserver } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { scheduledSendsQuery } from './scheduled-sends-ui.js'

const counted = () => {
  const api = {
    reads: 0,
    list: async () => {
      api.reads += 1
      return { sends: [] }
    },
  }
  return api
}

describe('scheduled sends polling', () => {
  it('polls only the thread the main view shows; a thread kept mounted in a background tab does not', () => {
    const api = counted()
    expect(scheduledSendsQuery({ api, sessionId: 'shown', onScreen: true }).refetchInterval).toBe(15_000)
    expect(scheduledSendsQuery({ api, sessionId: 'background-tab', onScreen: false }).refetchInterval).toBe(false)
  })

  it('still reads an off-screen thread once when it mounts', async () => {
    const client = new QueryClient()
    const api = counted()
    const observer = new QueryObserver(client, scheduledSendsQuery({ api, sessionId: 'aside', onScreen: false }))
    const unsubscribe = observer.subscribe(() => undefined)
    await client.getQueryCache().find({ queryKey: ['queue-reorder', 'scheduled-sends', 'aside'] })?.promise
    unsubscribe()
    client.clear()
    expect(api.reads).toBe(1)
  })
})
