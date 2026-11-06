import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import type { CopilotLoginState } from './api.js'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
import { createCopilotCredentialsService } from './copilot-credentials.js'
import { DeviceLoginModel, type DeviceLoginEvent, type DeviceLoginPhase } from './device-login-machine.js'

const copilotOAuth = githubCopilotProvider().auth.oauth
const GITHUB_DEVICE_URI = 'https://github.com/login/device'

type CopilotFailure = 'github' | 'credential-storage'

const failureOf = (phase: DeviceLoginPhase<CopilotFailure>): CopilotFailure =>
  phase.kind === 'adopting' || phase.kind === 'complete' ? 'credential-storage' : 'github'

const failureMessage = (cause: unknown, area: CopilotFailure, current: CopilotLoginState): string => {
  if (area === 'credential-storage') return 'GitHub approved this device, but DSH could not save the Copilot credential.'
  if (current.userCode === null) return 'Could not start GitHub Copilot sign-in. Check the Host network and try again.'

  const status = cause instanceof Error ? /\b(401|403|429)\b/u.exec(cause.message)?.[1] : undefined
  if (status === '401' || status === '403')
    return 'GitHub approved the device, but Copilot rejected this account. Check subscription access or organization policy.'
  if (status === '429') return 'GitHub is rate-limiting Copilot sign-in. Wait a moment, then try again.'
  return 'GitHub approved the device, but Copilot setup failed. Check Host connectivity and subscription access, then retry.'
}

const idlePhase = (message: string | null): DeviceLoginPhase<CopilotFailure> => ({ kind: 'idle', message })
const startPhase = (message: string): DeviceLoginPhase<CopilotFailure> => ({ kind: 'starting', message })
const failedPhase = (area: CopilotFailure, message: string): DeviceLoginPhase<CopilotFailure> => ({
  kind: 'failed',
  message,
  failure: area,
  prompt: null,
})

const project = (instanceId: string, phase: DeviceLoginPhase<CopilotFailure>): CopilotLoginState => {
  const view = DeviceLoginModel.view(phase)
  const prompt = view.status === 'waiting' || view.status === 'complete' || view.status === 'error' ? view.prompt : null
  return {
    instanceId,
    status: view.status === 'cancelled' ? 'idle' : view.status,
    userCode: prompt?.userCode ?? null,
    verificationUri: prompt?.verificationUri ?? null,
    message: view.message,
  }
}

interface CopilotAttempt {
  /** Identity of one attempt, shared by its login, storage and late-result guards. */
  readonly token: symbol
  readonly phase: DeviceLoginPhase<CopilotFailure>
  readonly work: { readonly controller: AbortController } | null
}

export const createCopilotLoginService = (input: {
  readonly credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'> | undefined
  readonly login?: NonNullable<typeof copilotOAuth>['login']
  readonly isCopilotAccount: (instanceId: string) => boolean
  readonly onChange: () => void
  readonly isPendingAccount?: (instanceId: string) => boolean
}) => {
  const credentials = createCopilotCredentialsService(input.credentials)
  const attempts = new Map<string, CopilotAttempt>()
  const staged = new Map<string, { credential: OAuthCredential; before: OAuthCredential | undefined }>()

  const attempt = (instanceId: string): CopilotAttempt | undefined => attempts.get(instanceId)
  const state = (instanceId: string): CopilotLoginState => {
    const current = attempt(instanceId)
    return project(instanceId, current?.phase ?? idlePhase(null))
  }
  const current = (instanceId: string, token: symbol, controller: AbortController): boolean =>
    attempts.get(instanceId)?.token === token && !controller.signal.aborted && input.isCopilotAccount(instanceId)
  const write = (instanceId: string, token: symbol, phase: DeviceLoginPhase<CopilotFailure>): void => {
    const live = attempt(instanceId)
    if (live === undefined || live.token !== token) return
    attempts.set(instanceId, { ...live, phase })
  }
  const send = (instanceId: string, token: symbol, event: DeviceLoginEvent<CopilotFailure>): void => {
    const live = attempt(instanceId)
    if (live === undefined || live.token !== token) return
    write(instanceId, token, DeviceLoginModel.transition(live.phase, event))
  }
  const stop = (instanceId: string, token: symbol, event: DeviceLoginEvent<CopilotFailure>): void => {
    const live = attempt(instanceId)
    if (live === undefined || live.token !== token) return
    live.work?.controller.abort()
    write(instanceId, token, DeviceLoginModel.transition(live.phase, event))
  }
  const abortWork = (instanceId: string): void => {
    const live = attempt(instanceId)
    if (live === undefined) return
    live.work?.controller.abort()
    attempts.set(instanceId, { ...live, work: null })
  }

  const begin = async (instanceId: string): Promise<CopilotLoginState> => {
    if (!input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    // Validate before touching the running attempt: a refused start never leaves a 'starting' phase without work.
    const login = input.login ?? copilotOAuth?.login
    if (login === undefined) throw new Error('The GitHub Copilot OAuth provider is unavailable.')
    abortWork(instanceId)
    staged.delete(instanceId)
    const token = Symbol('copilot-login-attempt')
    attempts.set(instanceId, { token, phase: startPhase('Connecting to GitHub…'), work: null })
    const owner = randomUUID()
    let before: OAuthCredential | undefined
    try {
      before = await credentials.read(instanceId)
    } catch {
      write(instanceId, token, failedPhase('github', 'The saved Copilot credential could not be read. Check Host credential storage and try again.'))
      return state(instanceId)
    }
    const reading = attempt(instanceId)
    if (reading === undefined || reading.token !== token || !DeviceLoginModel.isActive(reading.phase)) return state(instanceId)
    const controller = new AbortController()
    attempts.set(instanceId, { ...reading, work: { controller } })
    login({
      signal: controller.signal,
      prompt: async () => '',
      notify: event => {
        if (!current(instanceId, token, controller)) return
        if (event.type === 'device_code') {
          const verificationUri = URL.parse(event.verificationUri)
          if (verificationUri === null || verificationUri.href !== GITHUB_DEVICE_URI) {
            stop(instanceId, token, { type: 'fail', failure: 'github', message: 'GitHub returned an untrusted verification link.' })
            return
          }
          send(instanceId, token, {
            type: 'device',
            prompt: { userCode: event.userCode, verificationUri: verificationUri.href },
            message: 'Enter this code on GitHub to authorize Copilot.',
          })
          return
        }
        if (event.type === 'progress') send(instanceId, token, { type: 'message', message: 'Waiting for GitHub authorization…' })
      },
    })
      .then(async credential => {
        if (!current(instanceId, token, controller)) return
        send(instanceId, token, { type: 'adopt' })
        if (input.isPendingAccount?.(instanceId) === true) {
          staged.set(instanceId, { credential, before })
        } else {
          await credentials.modify({
            instanceId,
            mutate: async saved => {
              if (!current(instanceId, token, controller)) return undefined
              if (JSON.stringify(saved) !== JSON.stringify(before)) throw new Error('Copilot credential changed')
              return { ...credential, dshLoginOwner: owner }
            },
          })
          if (!current(instanceId, token, controller)) {
            // Owner-only rollback under the provider lock. A later grant is never overwritten.
            await credentials.restoreOwned(instanceId, owner, before)
            return
          }
        }
        send(instanceId, token, { type: 'complete', message: 'GitHub Copilot is connected.' })
        input.onChange()
      })
      .catch(cause => {
        if (!current(instanceId, token, controller)) return
        const live = attempt(instanceId)
        if (live === undefined) return
        const area = failureOf(live.phase)
        stop(instanceId, token, { type: 'fail', failure: area, message: failureMessage(cause, area, project(instanceId, live.phase)) })
      })
      .finally(() => {
        const live = attempt(instanceId)
        if (live?.token === token && live.work?.controller === controller) attempts.set(instanceId, { ...live, work: null })
      })
    return state(instanceId)
  }

  const cancel = (instanceId: string): void => {
    const live = attempt(instanceId)
    abortWork(instanceId)
    staged.delete(instanceId)
    attempts.set(instanceId, {
      token: live?.token ?? Symbol('copilot-login-idle'),
      phase:
        live === undefined
          ? idlePhase('GitHub sign-in was cancelled.')
          : DeviceLoginModel.transition(live.phase, { type: 'reset', message: 'GitHub sign-in was cancelled.' }),
      work: null,
    })
  }

  const signOut = async (instanceId: string): Promise<void> => {
    if (!input.isCopilotAccount(instanceId)) throw new Error('This GitHub Copilot account is no longer available.')
    const live = attempt(instanceId)
    abortWork(instanceId)
    staged.delete(instanceId)
    try {
      await credentials.remove(instanceId)
    } catch (cause) {
      if (live !== undefined)
        attempts.set(instanceId, {
          token: live.token,
          phase: DeviceLoginModel.transition(live.phase, {
            type: 'fail',
            failure: failureOf(live.phase),
            message: 'Could not disconnect GitHub Copilot. Check Host credential storage and try again.',
          }),
          work: null,
        })
      throw cause
    }
    attempts.set(instanceId, { token: live?.token ?? Symbol('copilot-login-idle'), phase: idlePhase('GitHub Copilot was disconnected.'), work: null })
    input.onChange()
  }

  return {
    begin,
    state,
    cancel,
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
      for (const live of attempts.values()) live.work?.controller.abort()
      attempts.clear()
      staged.clear()
    },
    isSignedIn: async (instanceId: string): Promise<boolean> => (await credentials.read(instanceId)) !== undefined,
  }
}

export type CopilotLoginService = ReturnType<typeof createCopilotLoginService>
