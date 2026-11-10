// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiAccountsApi, type CopilotLoginState } from './api.js'
import { CopilotSignIn } from './copilot-sign-in.js'

type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

const host = vi.hoisted(() => ({
  copilotLoginStatus: vi.fn<AccountsClient['copilotLoginStatus']>(),
  beginCopilotLogin: vi.fn<AccountsClient['beginCopilotLogin']>(),
  cancelCopilotLogin: vi.fn<AccountsClient['cancelCopilotLogin']>(),
  signOutCopilot: vi.fn<AccountsClient['signOutCopilot']>(),
}))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => host,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: vi.fn(async () => undefined) }))

const idle: CopilotLoginState = { instanceId: 'copilot-one', status: 'idle', userCode: null, verificationUri: null, message: null }
const waiting: CopilotLoginState = {
  instanceId: 'copilot-one',
  status: 'waiting',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
  message: 'Enter this code on GitHub to authorize Copilot.',
}

const mounted: Array<{ root: Root; container: HTMLDivElement; client: QueryClient }> = []

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}
const button = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent === label)
  if (found === undefined) throw new Error(`No button named ${label}`)
  return found
}
const click = async (label: string): Promise<void> => {
  await act(async () => {
    button(label).click()
  })
  await flush()
  await flush()
}
const mount = async (input: { readonly signedIn?: boolean; readonly operationId?: string; readonly onConnected?: () => void } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const entry = { root, container, client }
  mounted.push(entry)
  const render = async (next: typeof input): Promise<void> => {
    await act(async () => {
      root.render(
        <PluginQueryProvider client={client}>
          <CopilotSignIn
            instanceId="copilot-one"
            signedIn={next.signedIn ?? false}
            {...(next.operationId === undefined ? {} : { operationId: next.operationId })}
            {...(next.onConnected === undefined ? {} : { onConnected: next.onConnected })}
          />
        </PluginQueryProvider>,
      )
    })
  }
  await render(input)
  return {
    container,
    client,
    rerender: render,
    unmount: async (): Promise<void> => {
      mounted.splice(mounted.indexOf(entry), 1)
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  for (const mock of Object.values(host)) mock.mockReset()
  host.copilotLoginStatus.mockResolvedValue(idle)
  host.beginCopilotLogin.mockResolvedValue(waiting)
  host.cancelCopilotLogin.mockResolvedValue({ cancelled: true })
  host.signOutCopilot.mockResolvedValue({ signedOut: true })
})

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
})

describe('Copilot sign-in card', () => {
  it('cancels the attempt it still owns when the card unmounts mid-flow', async () => {
    const view = await mount()
    await click('Sign in with GitHub')
    expect(host.beginCopilotLogin).toHaveBeenCalledTimes(1)
    expect(view.container.textContent).toContain('ABCD-EFGH')
    expect(button('Cancel sign-in')).toBeTruthy()
    expect(host.cancelCopilotLogin).not.toHaveBeenCalled()
    await view.unmount()
    expect(host.cancelCopilotLogin).toHaveBeenCalledExactlyOnceWith({ instanceId: 'copilot-one', confirm: true })
  })

  it('cancels a begin that is still in flight when the card unmounts', async () => {
    let settle: ((value: CopilotLoginState) => void) | undefined
    host.beginCopilotLogin.mockReturnValue(
      new Promise<CopilotLoginState>(resolve => {
        settle = resolve
      }),
    )
    const view = await mount()
    await click('Sign in with GitHub')
    expect(button('Sign in with GitHub').disabled).toBe(true)
    expect(host.cancelCopilotLogin).not.toHaveBeenCalled()
    await view.unmount()
    expect(host.cancelCopilotLogin).toHaveBeenCalledWith({ instanceId: 'copilot-one', confirm: true })
    settle?.(idle)
  })

  it('does not cancel once the device sign-in is complete', async () => {
    const onConnected = vi.fn()
    host.beginCopilotLogin.mockResolvedValue({ ...waiting, status: 'complete', message: 'GitHub Copilot is connected.' })
    const view = await mount({ onConnected })
    await click('Sign in with GitHub')
    expect(onConnected).toHaveBeenCalledOnce()
    await view.unmount()
    expect(host.cancelCopilotLogin).not.toHaveBeenCalled()
  })

  it('reports an unavailable Host instead of leaving the action pending', async () => {
    host.beginCopilotLogin.mockRejectedValue(new Error('Host unavailable'))
    const view = await mount()
    await click('Sign in with GitHub')
    expect(view.container.textContent).toContain('Could not update GitHub Copilot sign-in. Try again.')
    expect(button('Sign in with GitHub')).toBeTruthy()
    expect(view.container.textContent).not.toContain('ABCD-EFGH')
  })

  it('does not cancel an operation it never started after the card switches operations', async () => {
    const view = await mount({ operationId: 'op-a' })
    await click('Sign in with GitHub')
    expect(host.beginCopilotLogin).toHaveBeenCalledWith({ instanceId: 'copilot-one', operationId: 'op-a' })
    await view.rerender({ operationId: 'op-b' })
    expect(host.cancelCopilotLogin).toHaveBeenCalledExactlyOnceWith({ instanceId: 'copilot-one', operationId: 'op-a', confirm: true })
    await view.unmount()
    expect(host.cancelCopilotLogin).toHaveBeenCalledTimes(1)
  })

  it('disconnects through the shared machine and returns to the sign-in action', async () => {
    await mount({ signedIn: true })
    expect(button('Disconnect GitHub')).toBeTruthy()
    await click('Disconnect GitHub')
    expect(host.signOutCopilot).toHaveBeenCalledExactlyOnceWith({ instanceId: 'copilot-one' })
    expect(button('Disconnect GitHub')).toBeTruthy()
  })
})
