// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { threadAccountApi, type ThreadAccountPreview } from './thread-account-api.js'
import { ThreadAccountSurface } from './thread-account-dialog.js'

// Only the typed Host API seam is replaced. React, Query and the real Radix dialog remain mounted.
type ThreadAccountClient = typeof threadAccountApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const host = vi.hoisted(() => ({
  preview: vi.fn<ThreadAccountClient['preview']>(),
  switch: vi.fn<ThreadAccountClient['switch']>(),
}))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => host,
}))

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'
const ACCOUNT = 'codex_work'
const preview = (overrides: Partial<ThreadAccountPreview> = {}): ThreadAccountPreview => ({
  sessionId: SESSION_A,
  instanceId: ACCOUNT,
  displayName: 'Work account',
  current: { provider: 'codex_personal', model: 'gpt-current', reasoningEffort: 'high' },
  target: { provider: 'codex_work', model: 'gpt-target', reasoningEffort: 'medium' },
  modelName: 'Target model',
  strategy: 'same-model',
  expectedRevision: 17,
  running: false,
  context: null,
  ...overrides,
})
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise was not initialized')
  }
  const promise = new Promise<T>(accept => {
    resolve = accept
  })
  return { promise, resolve }
}
const roots: Array<{ root: Root; container: HTMLDivElement; client: QueryClient }> = []
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
const dialog = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="dialog"]')
  if (element === null) throw new Error('Missing real account-switch dialog')
  return element
}
const button = (name: string, within: ParentNode = document): HTMLButtonElement => {
  const found = [...within.querySelectorAll('button')].find(candidate => (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name)
  if (found === undefined) throw new Error(`Missing native button: ${name}`)
  return found
}
const confirm = () => button('Use this account', dialog())
const click = async (element: HTMLButtonElement): Promise<void> => {
  await act(async () => {
    element.click()
  })
  await flush()
}
async function mount(sessionId: string | null = SESSION_A) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container, client })
  // The production surface is keyed by serving.sessionId at both client entry points.
  const render = async (target: string | null) => {
    await act(async () => {
      root.render(
        <PluginQueryProvider client={client}>
          <ThreadAccountSurface key={target} sessionId={target}>
            {choose => (
              <button type="button" disabled={choose === undefined} onClick={() => choose?.(ACCOUNT)}>
                Choose work account
              </button>
            )}
          </ThreadAccountSurface>
        </PluginQueryProvider>,
      )
    })
    await flush()
  }
  await render(sessionId)
  return { render, client }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host.preview.mockReset().mockResolvedValue(preview())
  host.switch.mockReset().mockResolvedValue(preview())
})
afterEach(async () => {
  await act(async () => {
    for (const { root, container, client } of roots.splice(0)) {
      root.unmount()
      container.remove()
      client.clear()
    }
    await vi.advanceTimersByTimeAsync(1)
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('thread account confirmation through the real dialog', () => {
  it('previews only after choosing an account; Cancel closes without switching or sending work', async () => {
    await mount()
    expect(host.preview).not.toHaveBeenCalled()
    expect(host.switch).not.toHaveBeenCalled()
    await click(button('Choose work account'))
    expect(host.preview).toHaveBeenCalledExactlyOnceWith({ sessionId: SESSION_A, instanceId: ACCOUNT }, { signal: expect.any(AbortSignal) })
    expect(dialog().textContent).toContain('No message is sent automatically.')
    expect(confirm().disabled).toBe(false)
    await click(button('Cancel', dialog()))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.switch).not.toHaveBeenCalled()
  })

  it('keeps confirmation disabled during preview and Cancel aborts that preview without reopening on a late response', async () => {
    const pending = deferred<ThreadAccountPreview>()
    host.preview.mockReturnValueOnce(pending.promise)
    await mount()
    await click(button('Choose work account'))
    expect(dialog().textContent).toContain('Checking available models')
    expect(confirm().disabled).toBe(true)
    const signal = host.preview.mock.calls[0]?.[1]?.signal
    await click(button('Cancel', dialog()))
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      pending.resolve(preview())
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.switch).not.toHaveBeenCalled()
  })

  it('confirms the exact reviewed thread, account, target and revision once, with pending clicks disabled', async () => {
    const switching = deferred<ThreadAccountPreview>()
    host.switch.mockReturnValue(switching.promise)
    await mount()
    await click(button('Choose work account'))
    const submit = confirm()
    await click(submit)
    expect(submit.disabled).toBe(true)
    expect(button('Cancel', dialog()).disabled).toBe(true)
    await click(submit)
    expect(host.switch).toHaveBeenCalledExactlyOnceWith({
      sessionId: SESSION_A,
      instanceId: ACCOUNT,
      target: preview().target,
      expectedRevision: 17,
    })
    await act(async () => {
      switching.resolve(preview())
    })
    await flush()
    expect(dialog().textContent).toContain('Thread account changed')
    expect(dialog().textContent).toContain('other threads and your default model are unchanged')
    expect([...dialog().querySelectorAll('button')].some(candidate => candidate.textContent?.trim() === 'Use this account')).toBe(false)
    await click(button('Done', dialog()))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.switch).toHaveBeenCalledOnce()
  })

  it('shows a long-context estimate, cache uncertainty, compaction cost/loss and an explicit no-automatic-compaction advisory', async () => {
    host.preview.mockResolvedValue(preview({ context: { estimatedTokens: 123456.7, targetWindow: 200000, suggestCompaction: true } }))
    await mount()
    await click(button('Choose work account'))
    const text = dialog().textContent ?? ''
    expect(text).toContain('Consider compacting this long conversation')
    expect(text).toContain(`~${Math.round(123456.7).toLocaleString()} tokens`)
    expect(text).toContain(`target window: ${(200000).toLocaleString()}`)
    expect(text).toContain('may not share the previous account’s prompt cache')
    expect(text).toContain('summarizing costs tokens and can omit details')
    expect(text).toContain('The transcript stays available. No savings are guaranteed.')
    expect(text).toContain('This account switch does not compact the conversation.')
    expect(text).toContain('Native automatic-compaction settings still apply to later requests.')
    expect(text).toContain('/compact')
    expect(text).toContain('not necessarily the account selected here')
    expect(text).toContain('No message is sent automatically.')
    expect(host.switch).not.toHaveBeenCalled()
    expect([...dialog().querySelectorAll('button')].some(candidate => /compact/i.test(candidate.textContent ?? ''))).toBe(false)
  })

  it.each([null, { estimatedTokens: 1000, targetWindow: 200000, suggestCompaction: false }])(
    'does not invent a compaction banner for short or unavailable context %j',
    async context => {
      host.preview.mockResolvedValue(preview({ context }))
      await mount()
      await click(button('Choose work account'))
      expect(dialog().textContent).not.toContain('Consider compacting')
      expect(dialog().textContent).not.toContain('/compact')
      expect(confirm().disabled).toBe(false)
      expect(host.switch).not.toHaveBeenCalled()
    },
  )

  it('permits confirmation while running and explains that the in-flight request is unchanged', async () => {
    const plan = preview({ running: true })
    host.preview.mockResolvedValue(plan)
    host.switch.mockResolvedValue(plan)
    await mount()
    await click(button('Choose work account'))
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain('An in-flight request keeps its account.')
    expect(dialog().textContent).toContain('from the next request; running work is not interrupted')
    expect(confirm().disabled).toBe(false)
    await click(confirm())
    expect(host.switch).toHaveBeenCalledExactlyOnceWith({
      sessionId: SESSION_A,
      instanceId: ACCOUNT,
      target: plan.target,
      expectedRevision: plan.expectedRevision,
    })
    expect(dialog().textContent).toContain('An in-flight request, other threads and your default model are unchanged.')
  })

  it.each(['Preview refused', 'Host API method is unavailable'])('cannot confirm a preview error or old Host: %s', async message => {
    host.preview.mockRejectedValue(new Error(message))
    await mount()
    await click(button('Choose work account'))
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(confirm().disabled).toBe(true)
    await click(confirm())
    expect(host.switch).not.toHaveBeenCalled()
  })

  it('does not confirm a cached plan when reopening fails to refresh it from an unavailable Host', async () => {
    await mount()
    await click(button('Choose work account'))
    await click(button('Cancel', dialog()))
    host.preview.mockRejectedValue(new Error('Host API method is unavailable'))
    await click(button('Choose work account'))
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Host API method is unavailable')
    expect(confirm().disabled).toBe(true)
    await click(confirm())
    expect(host.switch).not.toHaveBeenCalled()
  })

  it('refetches after stale server rejection and requires a fresh explicit confirmation, never an automatic switch', async () => {
    const refreshed = deferred<ThreadAccountPreview>()
    const newer = preview({ expectedRevision: 24, modelName: 'New reviewed model', target: { provider: 'codex_work', model: 'gpt-new' } })
    host.preview.mockResolvedValueOnce(preview()).mockReturnValueOnce(refreshed.promise)
    host.switch.mockRejectedValueOnce(new Error('The thread model changed. Review it again.')).mockResolvedValueOnce(newer)
    await mount()
    await click(button('Choose work account'))
    await click(confirm())
    expect(host.switch).toHaveBeenCalledOnce()
    expect(host.preview).toHaveBeenCalledTimes(2)
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('The thread model changed.')
    expect(confirm().disabled).toBe(true)
    await act(async () => {
      refreshed.resolve(newer)
    })
    await flush()
    expect(dialog().textContent).toContain('New reviewed model')
    expect(confirm().disabled).toBe(false)
    expect(host.switch).toHaveBeenCalledOnce()
    await click(confirm())
    expect(host.switch).toHaveBeenNthCalledWith(2, {
      sessionId: SESSION_A,
      instanceId: ACCOUNT,
      target: newer.target,
      expectedRevision: 24,
    })
    expect(host.switch).toHaveBeenCalledTimes(2)
  })
})

describe('immutable thread identity at the keyed surface', () => {
  it('disables account choice without an active thread', async () => {
    await mount(null)
    expect(button('Choose work account').disabled).toBe(true)
    await click(button('Choose work account'))
    expect(host.preview).not.toHaveBeenCalled()
    expect(host.switch).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('cancels the old preview and discards its open choice and late response when the thread changes', async () => {
    const late = deferred<ThreadAccountPreview>()
    host.preview.mockReturnValueOnce(late.promise).mockResolvedValueOnce(preview({ sessionId: SESSION_B, displayName: 'Thread B account' }))
    const view = await mount()
    await click(button('Choose work account'))
    const oldSignal = host.preview.mock.calls[0]?.[1]?.signal
    expect(oldSignal?.aborted).toBe(false)
    await view.render(SESSION_B)
    expect(oldSignal?.aborted).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => {
      late.resolve(preview({ displayName: 'Late thread A preview' }))
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.switch).not.toHaveBeenCalled()
    await click(button('Choose work account'))
    expect(host.preview).toHaveBeenLastCalledWith({ sessionId: SESSION_B, instanceId: ACCOUNT }, { signal: expect.any(AbortSignal) })
    expect(dialog().textContent).toContain('Thread B account')
    expect(dialog().textContent).not.toContain('Late thread A preview')
  })

  it('does not carry a pending switch result or success dialog into another thread', async () => {
    const late = deferred<ThreadAccountPreview>()
    host.switch.mockReturnValueOnce(late.promise)
    host.preview.mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview({ sessionId: SESSION_B, displayName: 'Thread B account' }))
    const view = await mount()
    await click(button('Choose work account'))
    await click(confirm())
    expect(host.switch).toHaveBeenCalledOnce()
    await view.render(SESSION_B)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => {
      late.resolve(preview())
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.switch).toHaveBeenCalledExactlyOnceWith({ sessionId: SESSION_A, instanceId: ACCOUNT, target: preview().target, expectedRevision: 17 })
    await click(button('Choose work account'))
    expect(dialog().textContent).toContain('Thread B account')
    expect(dialog().textContent).not.toContain('Thread account changed')
    expect(confirm().disabled).toBe(false)
    expect(host.switch).toHaveBeenCalledOnce()
  })
})
