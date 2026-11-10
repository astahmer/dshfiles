import { stripVTControlCharacters } from 'node:util'
import type { AccountLoginState } from './account-login-api.js'
import { codexLoginFiles, type CodexLoginFiles } from './codex-login-files.js'
import { CodexLoginUnsupported, createCodexLoginRunner, type RunCodexLogin } from './codex-login-process.js'
import type { CodexHomeLayout } from './codex-home.js'
import { DeviceLoginModel, type DeviceLoginEvent, type DeviceLoginPhase } from './device-login-machine.js'

export interface AccountLoginAccount {
  readonly instanceId: string
  readonly kind: string
  readonly layout?: CodexHomeLayout
}

type LoginFailure = NonNullable<AccountLoginState['errorCode']>

const LOGIN_TIMEOUT_MS = 15 * 60_000
const OUTPUT_LIMIT = 16 * 1024
const DEVICE_URI = 'https://auth.openai.com/codex/device'
const CANCELLED_BY_ACCOUNT_CHANGE = 'Sign-in cancelled because the account changed or was removed.'
const CANCELLED_BY_USER = 'Sign-in cancelled. The existing account login was not replaced.'
const CANCELLED_ON_CLOSE = 'Sign-in stopped because AI Accounts closed.'

const idlePhase = (): DeviceLoginPhase<LoginFailure> => ({ kind: 'idle', message: null })
const startPhase = (message: string): DeviceLoginPhase<LoginFailure> => ({ kind: 'starting', message })
const failedPhase = (failure: LoginFailure, message: string): DeviceLoginPhase<LoginFailure> => ({
  kind: 'failed',
  message,
  failure,
  prompt: null,
})
const cancelledPhase = (message: string): DeviceLoginPhase<LoginFailure> => ({ kind: 'cancelled', message })

const project = (instanceId: string, phase: DeviceLoginPhase<LoginFailure>, expiresAt: number | null): AccountLoginState => {
  const view = DeviceLoginModel.view(phase)
  const prompt = view.status === 'waiting' ? view.prompt : null
  return {
    instanceId,
    status: view.status,
    message: view.message ?? 'Sign-in has not started.',
    errorCode: view.failure,
    verificationUri: prompt === null ? null : DEVICE_URI,
    userCode: prompt?.userCode ?? null,
    expiresAt: view.status === 'starting' || view.status === 'waiting' ? expiresAt : null,
  }
}

/** Pinned official CLI prompt, never a general URL/code scraper. Parse complete lines only. */
export const parseCodexDeviceInstructions = (raw: string): { verificationUri: typeof DEVICE_URI; userCode: string } | undefined => {
  const text = stripVTControlCharacters(raw).replaceAll('\r', '')
  const complete = text.slice(0, text.lastIndexOf('\n') + 1)
  const urls = complete.match(/https?:\/\/[^\s]+/gu) ?? []
  if (urls.some(url => url !== DEVICE_URI)) throw new Error('Untrusted device verification URL')
  if (!complete.split('\n').some(line => line.trim() === DEVICE_URI)) return undefined
  const code = /2\. Enter this one-time code[^\n]*\n[ \t]*([A-Z0-9]{4}-[A-Z0-9]{4,5})[ \t]*\n/u.exec(complete)?.[1]
  return code === undefined ? undefined : { verificationUri: DEVICE_URI, userCode: code }
}

interface AttemptWork {
  readonly controller: AbortController
  readonly home: string
  readonly timer: ReturnType<typeof setTimeout>
}

interface Attempt {
  /** Identity of one attempt: a saved-account lookup and the CLI it later starts share it. */
  readonly token: symbol
  readonly phase: DeviceLoginPhase<LoginFailure>
  readonly expiresAt: number | null
  readonly work: AttemptWork | null
}

interface PendingAdoption {
  readonly stage: CodexHomeLayout
  readonly target: CodexHomeLayout
  readonly fingerprint: string | null
}

export const createAccountLoginService = (input: {
  readonly account: (instanceId: string) => Promise<AccountLoginAccount | undefined>
  readonly onComplete: (instanceId: string) => Promise<void>
  readonly files?: CodexLoginFiles
  readonly run?: RunCodexLogin
  readonly timeoutMs?: number
  readonly deferAdoption?: (instanceId: string) => boolean
}) => {
  const files = input.files ?? codexLoginFiles
  const run = input.run ?? createCodexLoginRunner()
  const attempts = new Map<string, Attempt>()
  const tasks = new Set<Promise<void>>()
  const tasksByAccount = new Map<string, Promise<void>>()
  const pendingAdoptions = new Map<string, PendingAdoption>()
  const cleanups = new Map<string, Promise<void>>()
  let disposed = false

  const attempt = (id: string): Attempt | undefined => attempts.get(id)
  const owns = (id: string, token: symbol): boolean => attempts.get(id)?.token === token
  const live = (id: string, token: symbol, work: AttemptWork): boolean => !disposed && owns(id, token) && !work.controller.signal.aborted
  const write = (id: string, token: symbol, phase: DeviceLoginPhase<LoginFailure>): void => {
    const current = attempts.get(id)
    if (current === undefined || current.token !== token) return
    attempts.set(id, { ...current, phase })
  }
  const send = (id: string, token: symbol, event: DeviceLoginEvent<LoginFailure>): void => {
    const current = attempts.get(id)
    if (current === undefined || current.token !== token) return
    write(id, token, DeviceLoginModel.transition(current.phase, event))
  }
  const stop = (id: string, token: symbol, event: DeviceLoginEvent<LoginFailure>): void => {
    const current = attempts.get(id)
    if (current === undefined || current.token !== token) return
    if (current.work !== null) {
      clearTimeout(current.work.timer)
      current.work.controller.abort()
    }
    write(id, token, DeviceLoginModel.transition(current.phase, event))
  }
  const fail = (id: string, token: symbol, work: AttemptWork, failure: LoginFailure, message: string): void => {
    if (!live(id, token, work)) return
    stop(id, token, { type: 'fail', failure, message })
  }
  const state = (id: string): AccountLoginState => {
    const current = attempts.get(id)
    return current === undefined ? project(id, idlePhase(), null) : project(id, current.phase, current.expiresAt)
  }
  const reject = (id: string, failure: LoginFailure, message: string): AccountLoginState => project(id, failedPhase(failure, message), null)

  const discardPending = (id: string): Promise<void> => {
    const pending = pendingAdoptions.get(id)
    pendingAdoptions.delete(id)
    if (pending === undefined) return cleanups.get(id) ?? Promise.resolve()
    const cleanup = files.cleanup(pending.stage)
    cleanups.set(id, cleanup)
    void cleanup
      .finally(() => {
        if (cleanups.get(id) === cleanup) cleanups.delete(id)
      })
      .catch(() => undefined)
    return cleanup
  }

  const cancelPhase = (id: string, message: string): void => {
    const current = attempts.get(id)
    attempts.set(
      id,
      current === undefined
        ? { token: Symbol('codex-login-cancelled'), phase: cancelledPhase(message), expiresAt: null, work: null }
        : { ...current, phase: cancelledPhase(message) },
    )
  }

  const begin = async (id: string, replaceExisting?: true): Promise<AccountLoginState> => {
    if (disposed) return reject(id, 'unavailable', 'Account sign-in is unavailable.')
    const previous = attempt(id)
    if (previous !== undefined && (previous.work !== null || DeviceLoginModel.isActive(previous.phase))) return state(id)
    // Establish cancellation identity before the first I/O; even a late saved-account lookup must not resurrect an intent.
    const token = Symbol('codex-login-attempt')
    attempts.set(id, { token, phase: startPhase('Reading the saved account…'), expiresAt: null, work: null })
    const restore = (): void => {
      if (!owns(id, token)) return
      if (previous === undefined) attempts.delete(id)
      else attempts.set(id, previous)
    }
    let account: AccountLoginAccount | undefined
    try {
      account = await input.account(id)
    } catch {
      restore()
      return reject(id, 'unavailable', 'The saved account could not be read.')
    }
    const started = attempts.get(id)
    if (disposed || !owns(id, token) || started === undefined || !DeviceLoginModel.isActive(started.phase)) return state(id)
    if (account === undefined) {
      restore()
      return reject(id, 'unavailable', 'This saved account is no longer available.')
    }
    if (account.kind !== 'codex') {
      restore()
      return reject(
        id,
        'unsupported',
        account.kind === 'claude'
          ? 'Managed Claude sign-in is unavailable: an installed official Claude CLI flow is required. DSH does not recreate Claude.ai OAuth.'
          : 'This provider does not support managed Codex device sign-in. Use its existing key or Copilot setup.',
      )
    }
    const layout = account.layout
    if (layout === undefined) {
      restore()
      return reject(id, 'unsafe-home', 'A valid private Codex account home is required.')
    }
    // The filesystem owner validates either a legacy overlay or an exact Host-managed setup home.
    // Do not infer that every direct layout is a private account home.
    // Includes a cancelled CLI that is still exiting. Never race two writers for one account.
    if (pendingAdoptions.has(id) || cleanups.has(id)) {
      restore()
      return state(id)
    }
    const controller = new AbortController()
    const expiresAt = Date.now() + (input.timeoutMs ?? LOGIN_TIMEOUT_MS)
    const work: AttemptWork = {
      controller,
      home: layout.effectiveHomePath,
      timer: setTimeout(() => fail(id, token, work, 'timeout', 'Codex sign-in expired. Start again from the Web GUI.'), input.timeoutMs ?? LOGIN_TIMEOUT_MS),
    }
    work.timer.unref()
    attempts.set(id, { token, phase: startPhase('Starting the official Codex device sign-in…'), expiresAt, work })
    const task = (async () => {
      let staging: CodexHomeLayout | undefined
      try {
        await files.prepare(layout)
        if (!live(id, token, work)) return
        const before = await files.auth(layout)
        if (!live(id, token, work)) return
        if (before.hasCredential && replaceExisting !== true) {
          fail(
            id,
            token,
            work,
            'replace-required',
            'This account already has CLI credentials. Confirm replacement to connect another account; the existing login is preserved until successful authorization.',
          )
          return
        }
        staging = await files.stage(layout)
        if (!live(id, token, work)) return
        send(id, token, { type: 'run' })
        let output = ''
        let outputBytes = 0
        const code = await run({
          home: staging.effectiveHomePath,
          signal: controller.signal,
          onOutput: chunk => {
            const current = attempt(id)
            if (!live(id, token, work) || current === undefined || (current.phase.kind !== 'starting' && current.phase.kind !== 'running')) return
            outputBytes += Buffer.byteLength(chunk)
            if (outputBytes > OUTPUT_LIMIT) {
              output = ''
              fail(id, token, work, 'invalid-output', 'Codex returned an unsupported device prompt. Update the official CLI and retry.')
              return
            }
            output += chunk
            try {
              const instructions = parseCodexDeviceInstructions(output)
              if (instructions === undefined) return
              output = ''
              send(id, token, {
                type: 'device',
                prompt: instructions,
                message: 'Open the OpenAI link and enter this code yourself. Continue only if you started this sign-in.',
              })
            } catch {
              output = ''
              fail(id, token, work, 'invalid-output', 'Codex returned an untrusted verification link. Sign-in was stopped.')
            }
          },
        })
        output = ''
        if (!live(id, token, work)) return
        if (code !== 0) {
          fail(
            id,
            token,
            work,
            'failed',
            'Official Codex device sign-in failed. Check Host connectivity, CLI device-auth support and account policy, then retry.',
          )
          return
        }
        send(id, token, { type: 'adopt' })
        const auth = await files.auth(staging)
        if (!live(id, token, work)) return
        const current = await input.account(id)
        if (!live(id, token, work)) return
        if (current?.kind !== 'codex' || current.layout?.effectiveHomePath !== layout.effectiveHomePath)
          return stop(id, token, { type: 'cancel', message: CANCELLED_BY_ACCOUNT_CHANGE })
        if (!auth.signedIn) {
          fail(id, token, work, 'auth-not-saved', 'Codex exited successfully but did not save a valid ChatGPT token pair. The existing login was preserved.')
          return
        }
        if (input.deferAdoption?.(id) === true) {
          pendingAdoptions.set(id, { stage: staging, target: layout, fingerprint: before.fingerprint })
          staging = undefined // The connection owner now owns cleanup/adoption of this exact stage.
        } else if (!files.adopt(staging, layout, before.fingerprint)) {
          fail(id, token, work, 'auth-changed', 'The account credentials changed during sign-in. The newer login was preserved; retry if needed.')
          return
        }
        clearTimeout(work.timer)
        send(id, token, { type: 'complete', message: 'Codex is connected. The official CLI credential is saved in this account’s private home.' })
        await input.onComplete(id)
      } catch (error) {
        if (error instanceof CodexLoginUnsupported) fail(id, token, work, 'unsupported', error.message)
        else {
          const phase = attempt(id)?.phase
          if (phase?.kind === 'starting') {
            fail(
              id,
              token,
              work,
              'unsafe-home',
              'The private Codex home could not be prepared safely. Check its owner, permissions and path; symlinked homes or auth files are not accepted.',
            )
          } else if (phase?.kind === 'complete')
            fail(id, token, work, 'refresh-failed', 'Codex credentials were saved, but account routes could not refresh. Reload the Accounts page.')
          else fail(id, token, work, 'failed', 'Official Codex sign-in failed. The existing login was preserved; check the Host and retry.')
        }
      } finally {
        clearTimeout(work.timer)
        if (staging !== undefined) {
          try {
            await files.cleanup(staging)
          } catch {
            const settled = attempt(id)
            if (!disposed && settled?.token === token) {
              attempts.set(id, {
                ...settled,
                phase: DeviceLoginModel.transition(settled.phase, {
                  type: 'cleanup-failed',
                  failure: 'cleanup-failed',
                  message: `${
                    settled.phase.kind === 'complete' ? 'Codex credentials were saved, but' : 'Sign-in stopped, but'
                  } private temporary sign-in files could not be removed. Check Host private-home permissions before retrying.`,
                }),
              })
            }
          }
        }
        const finished = attempt(id)
        if (finished?.token === token) attempts.set(id, { ...finished, work: null })
      }
    })()
    tasks.add(task)
    tasksByAccount.set(id, task)
    void task.finally(() => {
      tasks.delete(task)
      if (tasksByAccount.get(id) === task) tasksByAccount.delete(id)
    })
    return state(id)
  }

  return {
    begin,
    state,
    pendingHome: (id: string): string | undefined => pendingAdoptions.get(id)?.stage.effectiveHomePath,
    discardPending,
    commitPending: async (id: string): Promise<void> => {
      const pending = pendingAdoptions.get(id)
      if (pending === undefined) return
      const account = await input.account(id)
      if (pendingAdoptions.get(id) !== pending || account?.kind !== 'codex' || account.layout?.effectiveHomePath !== pending.target.effectiveHomePath)
        throw new Error('The pending Codex account changed.')
      if (!files.adopt(pending.stage, pending.target, pending.fingerprint)) throw new Error('The Codex credential changed; the newer login was preserved.')
      pendingAdoptions.delete(id)
      await files.cleanup(pending.stage)
    },
    cancel: (id: string): AccountLoginState => {
      const current = attempt(id)
      if (current !== undefined && current.work === null && DeviceLoginModel.isActive(current.phase))
        cancelPhase(id, 'Sign-in cancelled before the account lookup finished.')
      if (pendingAdoptions.has(id)) {
        void discardPending(id).catch(() => undefined)
        cancelPhase(id, CANCELLED_BY_USER)
        return state(id)
      }
      const running = attempt(id)
      if (running !== undefined && running.work !== null && DeviceLoginModel.isActive(running.phase))
        stop(id, running.token, { type: 'cancel', message: CANCELLED_BY_USER })
      return state(id)
    },
    reconcile: (accounts: readonly AccountLoginAccount[]): void => {
      const byId = new Map(accounts.map(account => [account.instanceId, account]))
      for (const [id, current] of attempts) {
        const account = byId.get(id)
        if (DeviceLoginModel.isActive(current.phase)) {
          if (current.work === null) {
            if (account === undefined) cancelPhase(id, CANCELLED_BY_ACCOUNT_CHANGE)
            continue
          }
          if (account?.kind === 'codex' && account.layout?.effectiveHomePath === current.work.home) continue
          stop(id, current.token, { type: 'cancel', message: CANCELLED_BY_ACCOUNT_CHANGE })
          continue
        }
        if (account === undefined && current.work === null) attempts.delete(id)
      }
    },
    dispose: (): void => {
      disposed = true
      for (const [id, current] of attempts) {
        if (current.work === null && DeviceLoginModel.isActive(current.phase)) cancelPhase(id, CANCELLED_ON_CLOSE)
      }
      for (const id of pendingAdoptions.keys()) void discardPending(id).catch(() => undefined)
      for (const [id, current] of attempts) {
        if (current.work !== null && DeviceLoginModel.isActive(current.phase)) stop(id, current.token, { type: 'cancel', message: CANCELLED_ON_CLOSE })
      }
    },
    settledAccount: async (id: string): Promise<void> => {
      await tasksByAccount.get(id)
      await cleanups.get(id)
    },
    /** Tests and orderly teardown can join subprocess termination and staging cleanup. */
    settled: async (): Promise<void> => {
      await Promise.all(tasks)
      await Promise.all(cleanups.values())
    },
  }
}

export type AccountLoginService = ReturnType<typeof createAccountLoginService>
