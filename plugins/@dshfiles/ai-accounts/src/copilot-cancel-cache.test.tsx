import type { QueryClient as QueryClientType } from '@dshfiles/plugin-ui/query'
import { QueryClient } from '@dshfiles/plugin-ui/query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopilotSignIn } from './copilot-sign-in.js'

const harness = vi.hoisted(() => {
  const callbacks: Array<{ onSuccess?: () => void | Promise<void> }> = []
  const cleanups: Array<() => void> = []
  return {
    callbacks,
    cleanups,
    getClient: (): QueryClientType => {
      throw new Error('Test query client is not ready')
    },
  }
})

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: vi.fn() }))
vi.mock('@dshfiles/dshx/client', () => ({ useApi: () => ({ cancelCopilotLogin: async () => ({ cancelled: true }) }) }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: () => ['11111111-1111-4111-8111-111111111111', vi.fn()],
    useRef: <T,>(value: T) => ({ current: value }),
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect()
      if (cleanup !== undefined) harness.cleanups.push(cleanup)
    },
  }
})
vi.mock('@dshfiles/plugin-ui/query', async importOriginal => {
  const actual = await importOriginal<typeof import('@dshfiles/plugin-ui/query')>()
  return {
    ...actual,
    useQueryClient: () => harness.getClient(),
    useQuery: () => ({ data: harness.getClient().getQueryData(['ai-accounts', 'copilot-login', 'work']) }),
    useMutation: (options: { onSuccess?: () => void | Promise<void> }) => {
      harness.callbacks.push(options)
      return { mutate: vi.fn(), error: null, isPending: false, isSuccess: false }
    },
  }
})

afterEach(() => {
  harness.callbacks.length = 0
  harness.cleanups.length = 0
})

describe('late Copilot cancellation response', () => {
  it.each([false, true])('keeps the newer waiting code when an old cancellation completes (old form closed: %s)', async closed => {
    const client = new QueryClient()
    harness.getClient = () => client
    const key = ['ai-accounts', 'copilot-login', 'work'] as const
    const newer = { instanceId: 'work', status: 'waiting', userCode: 'NEW1-CODE', verificationUri: 'https://github.com/login/device', message: null }
    try {
      CopilotSignIn({ instanceId: 'work', signedIn: false })
      const cancel = harness.callbacks[1]
      if (cancel?.onSuccess === undefined) throw new Error('Missing cancellation callback')
      let reply: (() => void) | undefined
      const pending = new Promise<void>(resolve => {
        reply = resolve
      }).then(() => cancel.onSuccess?.())
      if (closed) for (const cleanup of harness.cleanups) cleanup()
      // Host has already ignored A's stale requestId and B is now waiting for approval.
      client.setQueryData(key, newer)
      reply?.()
      await pending
      expect(client.getQueryData(key)).toEqual(newer)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      expect(client.getQueryData<{ status: string }>(key)?.status).toBe('waiting')
    } finally {
      client.clear()
    }
  })
})
