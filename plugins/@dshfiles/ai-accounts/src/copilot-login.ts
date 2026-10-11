import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import type { CopilotLoginState } from './api.js'
import { deleteCopilotCredential, modifyCopilotCredential, readCopilotCredential } from './copilot-credentials.js'

const copilotOAuth = githubCopilotProvider().auth.oauth

const initialState = (instanceId: string): CopilotLoginState => ({
  instanceId,
  status: 'idle',
  userCode: null,
  verificationUri: null,
  message: null,
})

export const createCopilotLoginService = (input: {
  readonly credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'> | undefined
  readonly login?: NonNullable<typeof copilotOAuth>['login']
  readonly isCopilotAccount: (instanceId: string) => boolean
  readonly onChange: () => void
}) => {
  const states = new Map<string, CopilotLoginState>()
  const controllers = new Map<string, AbortController>()
  const tasks = new Map<string, Promise<void>>()

  const state = (instanceId: string): CopilotLoginState => states.get(instanceId) ?? initialState(instanceId)

  const cancel = (instanceId: string): void => {
    controllers.get(instanceId)?.abort()
    controllers.delete(instanceId)
    tasks.delete(instanceId)
  }

  const begin = async (instanceId: string): Promise<CopilotLoginState> => {
    if (!input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    cancel(instanceId)
    const controller = new AbortController()
    controllers.set(instanceId, controller)
    states.set(instanceId, { ...initialState(instanceId), status: 'starting', message: 'Connecting to GitHub…' })

    const login = input.login ?? copilotOAuth?.login
    if (login === undefined) throw new Error('The GitHub Copilot OAuth provider is unavailable.')
    const task = login({
      signal: controller.signal,
      prompt: async () => '',
      notify: event => {
        if (event.type === 'device_code') {
          const verificationUri = URL.parse(event.verificationUri)
          if (verificationUri === null || verificationUri.protocol !== 'https:' || verificationUri.hostname !== 'github.com') {
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
          states.set(instanceId, { ...state(instanceId), message: event.message.slice(0, 300) })
        }
      },
    })
      .then(async credential => {
        if (controller.signal.aborted) return
        await modifyCopilotCredential(input.credentials, instanceId, async () => credential)
        states.set(instanceId, { ...state(instanceId), status: 'complete', message: 'GitHub Copilot is connected.' })
        input.onChange()
      })
      .catch(() => {
        if (controller.signal.aborted) return
        states.set(instanceId, { ...state(instanceId), status: 'error', message: 'GitHub Copilot sign-in failed. Try again.' })
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
    await deleteCopilotCredential(input.credentials, instanceId)
    states.set(instanceId, { ...initialState(instanceId), status: 'idle', message: 'GitHub Copilot was disconnected.' })
    input.onChange()
  }

  return {
    begin,
    state,
    cancel: cancelLogin,
    signOut,
    dispose: (): void => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      tasks.clear()
      states.clear()
    },
    isSignedIn: async (instanceId: string): Promise<boolean> => (await readCopilotCredential(input.credentials, instanceId)) !== undefined,
  }
}

export type CopilotLoginService = ReturnType<typeof createCopilotLoginService>
