import { QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { beginLoginQuery } from './login-query.js'

describe('replacing a sign-in status read', () => {
  it('aborts and ignores an older completion after a new attempt starts', async () => {
    const client = new QueryClient()
    const key = ['ai-accounts', 'login', 'account'] as const
    let complete: (() => void) | undefined
    let signal: AbortSignal | undefined
    const old = client
      .fetchQuery({
        queryKey: key,
        queryFn: async context => {
          signal = context.signal
          await new Promise<void>(resolve => {
            complete = resolve
          })
          return { status: 'complete', identity: 'old' }
        },
      })
      .catch(() => undefined)
    const next = await beginLoginQuery(client, key, async () => ({ status: 'waiting', identity: 'new' }))
    client.setQueryData(key, next)
    expect(signal?.aborted).toBe(true)
    complete?.()
    await old
    expect(client.getQueryData(key)).toEqual({ status: 'waiting', identity: 'new' })
    client.clear()
  })
})
