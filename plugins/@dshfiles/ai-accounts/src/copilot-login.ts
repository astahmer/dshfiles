import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import type { CopilotLoginState } from './api.js'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
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
  readonly isPendingAccount?: (instanceId: string) => boolean
}) => {
  const credentials = createCopilotCredentialsService(input.credentials)
  const states = new Map<string, CopilotLoginState>()
  const controllers = new Map<string, AbortController>()
  const tasks = new Map<string, Promise<void>>()
  const staged = new Map<string, { credential: OAuthCredential; before: OAuthCredential | undefined }>()
  const current = (id: string, controller: AbortController): boolean =>
    controllers.get(id) === controller && !controller.signal.aborted && input.isCopilotAccount(id)

  const state = (instanceId: string): CopilotLoginState => states.get(instanceId) ?? initialState(instanceId)

  const cancel = (instanceId: string): void => {
    controllers.get(instanceId)?.abort()
    controllers.delete(instanceId)
    tasks.delete(instanceId)
    staged.delete(instanceId)
  }

  const begin = async (instanceId: string): Promise<CopilotLoginState> => {
    if (!input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    cancel(instanceId)
    const controller = new AbortController()
    controllers.set(instanceId, controller)
    states.set(instanceId, { ...initialState(instanceId), status: 'starting', message: 'Connecting to GitHub…' })

    const login = input.login ?? copilotOAuth?.login
    if (login === undefined) throw new Error('The GitHub Copilot OAuth provider is unavailable.')
    let phase: 'github' | 'credential-storage' = 'github'
    const owner = randomUUID()
    const before = await credentials.read(instanceId)
    if (!current(instanceId, controller)) return state(instanceId)
    const task = login({
      signal: controller.signal,
      prompt: async () => '',
      notify: event => {
        if (!current(instanceId, controller)) return
        if (event.type === 'device_code') {
          const verificationUri = URL.parse(event.verificationUri)
          if (verificationUri === null || verificationUri.href !== 'https://github.com/login/device') {
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
    })
      .then(async credential => {
        if (!current(instanceId, controller)) return
        phase = 'credential-storage'
        if (input.isPendingAccount?.(instanceId) === true) {
          staged.set(instanceId, { credential, before })
        } else {
          await credentials.modify({
            instanceId,
            mutate: async saved => {
              if (!current(instanceId, controller)) return undefined
              if (JSON.stringify(saved) !== JSON.stringify(before)) throw new Error('Copilot credential changed')
              return { ...credential, dshLoginOwner: owner }
            },
          })
          if (!current(instanceId, controller)) {
            // Owner-only rollback under the provider lock. A later grant is never overwritten.
            await credentials.restoreOwned(instanceId, owner, before)
            return
          }
        }
        states.set(instanceId, { ...state(instanceId), status: 'complete', message: 'GitHub Copilot is connected.' })
        input.onChange()
      })
      .catch(cause => {
        if (!current(instanceId, controller)) return
        const latest = state(instanceId)
        states.set(instanceId, { ...latest, status: 'error', message: failureMessage(cause, phase, latest) })
      })
      .finally(() => {
        if (controllers.get(instanceId) === controller) controllers.delete(instanceId)
        if (tasks.get(instanceId) === task) tasks.delete(instanceId)
      })
    tasks.set(instanceId, task)
    return state(instanceId)
  }

  const cancelLogin = (instanceId: string): void => {
    cancel(instanceId)
    states.set(instanceId, { ...initialState(instanceId), message: 'GitHub sign-in was cancelled.' })
  }

  const signOut = async (instanceId: string): Promise<void> => {
    if (!input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    cancel(instanceId)
    await credentials.remove(instanceId)
    states.set(instanceId, { ...initialState(instanceId), status: 'idle', message: 'GitHub Copilot was disconnected.' })
    input.onChange()
  }

  return {
    begin,
    state,
    cancel: cancelLogin,
    readPending: (instanceId: string): OAuthCredential | undefined => staged.get(instanceId)?.credential,
    commitPending: async (instanceId: string): Promise<void> => {
      const pending = staged.get(instanceId)
      if (pending === undefined) return
      await credentials.modify({
        instanceId,
        mutate: async saved => {
          if (JSON.stringify(saved) !== JSON.stringify(pending.before)) throw new Error('The Copilot grant changed during connection.')
          return pending.credential
        },
      })
      if (staged.get(instanceId) === pending) staged.delete(instanceId)
    },
    signOut,
    dispose: (): void => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      tasks.clear()
      states.clear()
      staged.clear()
    },
    isSignedIn: async (instanceId: string): Promise<boolean> => (await credentials.read(instanceId)) !== undefined,
  }
}

export type CopilotLoginService = ReturnType<typeof createCopilotLoginService>
