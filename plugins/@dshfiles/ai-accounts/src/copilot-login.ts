import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import type { CopilotLoginState } from './api.js'
import { createCopilotCredentialsService } from './copilot-credentials.js'

const copilotOAuth = githubCopilotProvider().auth.oauth

const initialState = (instanceId: string): CopilotLoginState => ({
  instanceId,
  status: 'idle',
  userCode: null,
  verificationUri: null,
  message: null,
})

const failureMessage = (cause: unknown, phase: 'github' | 'credential-storage', current: CopilotLoginState): string => {
  if (phase === 'credential-storage') return 'GitHub approved this device, but DSH could not save the Copilot credential.'
  if (current.userCode === null) return 'Could not start GitHub Copilot sign-in. Check the Host network and try again.'

  const status = cause instanceof Error ? /\b(401|403|429)\b/u.exec(cause.message)?.[1] : undefined
  if (status === '401' || status === '403')
    return 'GitHub approved the device, but Copilot rejected this account. Check subscription access or organization policy.'
  if (status === '429') return 'GitHub is rate-limiting Copilot sign-in. Wait a moment, then try again.'
  return 'GitHub approved the device, but Copilot setup failed. Check Host connectivity and subscription access, then retry.'
}

export const createCopilotLoginService = (input: {
  readonly credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'> | undefined
  readonly login?: NonNullable<typeof copilotOAuth>['login']
  readonly isCopilotAccount: (instanceId: string) => boolean
  readonly onChange: () => void
}) => {
  const credentials = createCopilotCredentialsService(input.credentials)
  const states = new Map<string, CopilotLoginState>()
  const controllers = new Map<string, AbortController>()
  const tasks = new Map<string, Promise<void>>()
  const requestIds = new Map<string, string | undefined>()
  let disposed = false
  const live = (instanceId: string, controller: AbortController): boolean =>
    !disposed && controllers.get(instanceId) === controller && !controller.signal.aborted && input.isCopilotAccount(instanceId)

  const state = (instanceId: string): CopilotLoginState => states.get(instanceId) ?? initialState(instanceId)

  const cancel = (instanceId: string): void => {
    controllers.get(instanceId)?.abort()
    controllers.delete(instanceId)
    tasks.delete(instanceId)
  }

  const begin = async (instanceId: string, requestId?: string): Promise<CopilotLoginState> => {
    if (disposed || !input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    if (requestId !== undefined && requestIds.get(instanceId) === requestId && controllers.has(instanceId)) return state(instanceId)
    cancel(instanceId)
    requestIds.set(instanceId, requestId)
    const controller = new AbortController()
    controllers.set(instanceId, controller)
    states.set(instanceId, { ...initialState(instanceId), status: 'starting', message: 'Connecting to GitHub…' })

    const login = input.login ?? copilotOAuth?.login
    if (login === undefined) throw new Error('The GitHub Copilot OAuth provider is unavailable.')
    let phase: 'github' | 'credential-storage' = 'github'
    // Observe the original grant before login; compare under the credential owner's mutation lock.
    const before = credentials.read(instanceId)
    void before.catch(() => undefined)
    const timer = setTimeout(() => {
      if (!live(instanceId, controller)) return
      states.set(instanceId, { ...initialState(instanceId), status: 'error', message: 'GitHub sign-in expired. Start again.' })
      controller.abort()
    }, 15 * 60_000)
    timer.unref()
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    const task = Promise.resolve()
      .then(() =>
        login({
          signal: controller.signal,
          prompt: async () => '',
          notify: event => {
            if (!live(instanceId, controller)) return
            if (event.type === 'device_code') {
              const verificationUri = URL.parse(event.verificationUri)
              if (verificationUri?.href !== 'https://github.com/login/device' || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(event.userCode)) {
                states.set(instanceId, { ...initialState(instanceId), status: 'error', message: 'GitHub returned an untrusted verification link.' })
                controller.abort()
                return
              }
              states.set(instanceId, {
                instanceId,
                status: 'waiting',
                userCode: event.userCode,
                verificationUri: verificationUri.href,
                message: 'Enter this code on GitHub to authorize Copilot.',
              })
              return
            }
            if (event.type === 'progress') {
              states.set(instanceId, { ...state(instanceId), message: 'Waiting for GitHub authorization…' })
            }
          },
        }),
      )
      .then(async credential => {
        if (!live(instanceId, controller)) return
        const original = await before
        if (!live(instanceId, controller)) return
        phase = 'credential-storage'
        await credentials.modify({
          instanceId,
          mutate: async current => {
            // Throw, rather than returning undefined: the owner must not delete or replace an existing grant.
            if (!live(instanceId, controller)) throw new Error('Stale GitHub sign-in')
            if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error('GitHub credential changed during sign-in')
            return credential
          },
        })
        if (!live(instanceId, controller)) return
        states.set(instanceId, { ...initialState(instanceId), status: 'complete', message: 'GitHub Copilot is connected.' })
        input.onChange()
      })
      .catch(cause => {
        if (!live(instanceId, controller)) return
        const current = state(instanceId)
        states.set(instanceId, { ...initialState(instanceId), status: 'error', message: failureMessage(cause, phase, current) })
      })
      .finally(() => {
        clearTimeout(timer)
        if (controllers.get(instanceId) === controller) controllers.delete(instanceId)
        if (tasks.get(instanceId) === task) tasks.delete(instanceId)
      })
    tasks.set(instanceId, task)
    return state(instanceId)
  }

  const cancelLogin = (instanceId: string, requestId?: string): void => {
    if (requestId !== undefined && requestIds.get(instanceId) !== requestId) return
    cancel(instanceId)
    states.set(instanceId, { ...initialState(instanceId), message: 'GitHub sign-in was cancelled.' })
  }

  const signOut = async (instanceId: string): Promise<void> => {
    if (disposed || !input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    cancel(instanceId)
    await credentials.remove(instanceId)
    states.set(instanceId, { ...initialState(instanceId), status: 'idle', message: 'GitHub Copilot was disconnected.' })
    input.onChange()
  }

  return {
    begin,
    state,
    cancel: cancelLogin,
    signOut,
    reconcile: (): void => {
      for (const id of controllers.keys()) if (!input.isCopilotAccount(id)) cancelLogin(id)
      for (const id of states.keys()) {
        if (input.isCopilotAccount(id)) continue
        states.delete(id)
        requestIds.delete(id)
      }
    },
    dispose: (): void => {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      tasks.clear()
      states.clear()
    },
    isSignedIn: async (instanceId: string): Promise<boolean> => (await credentials.read(instanceId)) !== undefined,
  }
}

export type CopilotLoginService = ReturnType<typeof createCopilotLoginService>
