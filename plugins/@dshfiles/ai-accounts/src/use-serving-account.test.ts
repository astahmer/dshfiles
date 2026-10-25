import { QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { servingAccountQuery, servingAccountPollInterval } from './serving-account-query.js'

const snapshot = (sessionId: string) => ({ sessionId, currentAttempt: null, lastSuccessful: null })
const wire = (value: unknown) => JSON.parse(JSON.stringify(value))

describe('serving account query boundary', () => {
  it('fails closed on old Hosts, malformed metadata and cross-chat replies', async () => {
    const client = new QueryClient()
    try {
      const absent = servingAccountQuery(
        {
          snapshot: async () => {
            throw new Error('unknown method')
          },
        },
        'one',
        true,
      )
      expect(await client.fetchQuery(absent)).toBeNull()
      expect(servingAccountPollInterval(true, client.getQueryData(absent.queryKey))).toBe(false)
      for (const value of [{}, snapshot('other'), { ...snapshot('one'), lastSuccessful: { accountId: 'guessed' } }]) {
        expect(await client.fetchQuery(servingAccountQuery({ snapshot: async () => wire(value) }, 'one', false))).toBeNull()
      }
    } finally {
      client.clear()
    }
  })
  it('keys by selected chat and running state, with bounded active polling independent of quota', async () => {
    const client = new QueryClient()
    try {
      const active = servingAccountQuery({ snapshot: async input => snapshot(input.sessionId ?? '') }, 'one', true)
      await client.fetchQuery(active)
      expect(servingAccountPollInterval(true, client.getQueryData(active.queryKey))).toBe(1500)
      expect(active.queryKey).not.toEqual(servingAccountQuery({ snapshot: async () => snapshot('two') }, 'two', true).queryKey)
      const idle = servingAccountQuery({ snapshot: async () => snapshot('one') }, 'one', false)
      expect(idle.queryKey).not.toEqual(active.queryKey)
      await client.fetchQuery(idle)
      expect(servingAccountPollInterval(false, client.getQueryData(idle.queryKey))).toBe(false)
      expect(servingAccountQuery({ snapshot: async () => snapshot('one') }, null, false).enabled).toBe(false)
    } finally {
      client.clear()
    }
  })
  it('forwards cancellation and isolates a late previous-chat reply from the new chat cache', async () => {
    const client = new QueryClient()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let signal: AbortSignal | undefined
    const old = servingAccountQuery(
      {
        snapshot: async (input, options) => {
          signal = options?.signal
          await gate
          return snapshot(input.sessionId ?? '')
        },
      },
      'old',
      true,
    )
    const pending = client.fetchQuery(old).catch(() => null)
    try {
      await client.cancelQueries({ queryKey: old.queryKey })
      expect(signal?.aborted).toBe(true)
      const next = servingAccountQuery({ snapshot: async () => snapshot('new') }, 'new', true)
      expect(await client.fetchQuery(next)).toEqual(snapshot('new'))
      release?.()
      await pending
      expect(client.getQueryData(next.queryKey)).toEqual(snapshot('new'))
      expect(client.getQueryData(old.queryKey)).toBeUndefined()
    } finally {
      release?.()
      client.clear()
    }
  })
})
