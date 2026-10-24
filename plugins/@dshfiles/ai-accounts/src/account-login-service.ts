import { stripVTControlCharacters } from 'node:util'
import type { AccountLoginState } from './account-login-api.js'
import { codexLoginFiles, type CodexLoginFiles } from './codex-login-files.js'
import { CodexLoginUnsupported, createCodexLoginRunner, type RunCodexLogin } from './codex-login-process.js'
import type { CodexHomeLayout } from './codex-home.js'

export interface AccountLoginAccount {
  readonly instanceId: string
  readonly kind: string
  readonly layout?: CodexHomeLayout
}

const LOGIN_TIMEOUT_MS = 15 * 60_000
const OUTPUT_LIMIT = 16 * 1024
const DEVICE_URI = 'https://auth.openai.com/codex/device'
const idle = (instanceId: string): AccountLoginState => ({
  instanceId,
  status: 'idle',
  message: 'Sign-in has not started.',
  errorCode: null,
  verificationUri: null,
  userCode: null,
  expiresAt: null,
})
const errorState = (instanceId: string, errorCode: NonNullable<AccountLoginState['errorCode']>, message: string): AccountLoginState => ({
  ...idle(instanceId),
  status: 'error',
  errorCode,
  message,
})

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

interface Attempt {
  readonly controller: AbortController
  readonly home: string
  readonly requestId: string | undefined
  readonly timer: ReturnType<typeof setTimeout>
}

export const createAccountLoginService = (input: {
  readonly account: (instanceId: string) => Promise<AccountLoginAccount | undefined>
  readonly onComplete: (instanceId: string) => Promise<void>
  readonly files?: CodexLoginFiles
  readonly run?: RunCodexLogin
  readonly timeoutMs?: number
}) => {
  const files = input.files ?? codexLoginFiles
  const run = input.run ?? createCodexLoginRunner()
  const attempts = new Map<string, Attempt>()
  const states = new Map<string, AccountLoginState>()
  const tasks = new Set<Promise<void>>()
  let disposed = false
  const state = (id: string): AccountLoginState => ({ ...(states.get(id) ?? idle(id)) })
  const live = (id: string, attempt: Attempt): boolean => !disposed && attempts.get(id) === attempt && !attempt.controller.signal.aborted
  const stop = (id: string, next: AccountLoginState): void => {
    const attempt = attempts.get(id)
    if (attempt !== undefined) {
      clearTimeout(attempt.timer)
      attempt.controller.abort()
    }
    states.set(id, next)
  }
  const fail = (id: string, attempt: Attempt, code: NonNullable<AccountLoginState['errorCode']>, message: string): void => {
    if (live(id, attempt)) stop(id, errorState(id, code, message))
  }

  const begin = async (id: string, replaceExisting?: true, requestId?: string): Promise<AccountLoginState> => {
    if (disposed) return errorState(id, 'unavailable', 'Account sign-in is unavailable.')
    let account: AccountLoginAccount | undefined
    try {
      account = await input.account(id)
    } catch {
      return errorState(id, 'unavailable', 'The saved account could not be read.')
    }
    if (disposed) return errorState(id, 'unavailable', 'Account sign-in is unavailable.')
    if (account === undefined) return errorState(id, 'unavailable', 'This saved account is no longer available.')
    if (account.kind !== 'codex')
      return errorState(
        id,
        'unsupported',
        account.kind === 'claude'
          ? 'Managed Claude sign-in is unavailable: an installed official Claude CLI flow is required. DSH does not recreate Claude.ai OAuth.'
          : 'This provider does not support managed Codex device sign-in. Use its existing key or Copilot setup.',
      )
    const layout = account.layout
    if (layout === undefined) return errorState(id, 'unsafe-home', 'A valid private Codex account home is required.')
    // The filesystem owner validates either a legacy overlay or an exact Host-managed setup home.
    // Do not infer that every direct layout is a private account home.
    // Includes a cancelled CLI that is still exiting. Never race two writers for one account.
    if (attempts.has(id)) return state(id)
    const controller = new AbortController()
    const expiresAt = Date.now() + (input.timeoutMs ?? LOGIN_TIMEOUT_MS)
    const attempt: Attempt = {
      controller,
      requestId,
      home: layout.effectiveHomePath,
      timer: setTimeout(() => fail(id, attempt, 'timeout', 'Codex sign-in expired. Start again from the Web GUI.'), input.timeoutMs ?? LOGIN_TIMEOUT_MS),
    }
    attempt.timer.unref()
    attempts.set(id, attempt)
    states.set(id, { ...idle(id), status: 'starting', message: 'Starting the official Codex device sign-in…', expiresAt })
    const task = (async () => {
      let staging: CodexHomeLayout | undefined
      let phase: 'home' | 'login' | 'auth' | 'refresh' = 'home'
      try {
        await files.prepare(layout)
        if (!live(id, attempt)) return
        const before = await files.auth(layout)
        if (!live(id, attempt)) return
        if (before.hasCredential && replaceExisting !== true) {
          fail(
            id,
            attempt,
            'replace-required',
            'This account already has CLI credentials. Confirm replacement to connect another account; the existing login is preserved until successful authorization.',
          )
          return
        }
        staging = await files.stage(layout)
        if (!live(id, attempt)) return
        phase = 'login'
        let output = ''
        let outputBytes = 0
        const code = await run({
          home: staging.effectiveHomePath,
          signal: controller.signal,
          onOutput: chunk => {
            if (!live(id, attempt) || state(id).status === 'waiting') return
            outputBytes += Buffer.byteLength(chunk)
            if (outputBytes > OUTPUT_LIMIT) {
              output = ''
              fail(id, attempt, 'invalid-output', 'Codex returned an unsupported device prompt. Update the official CLI and retry.')
              return
            }
            output += chunk
            try {
              const instructions = parseCodexDeviceInstructions(output)
              if (instructions === undefined) return
              output = ''
              states.set(id, {
                ...idle(id),
                ...instructions,
                status: 'waiting',
                expiresAt,
                message: 'Open the OpenAI link and enter this code yourself. Continue only if you started this sign-in.',
              })
            } catch {
              output = ''
              fail(id, attempt, 'invalid-output', 'Codex returned an untrusted verification link. Sign-in was stopped.')
            }
          },
        })
        output = ''
        if (!live(id, attempt)) return
        if (code !== 0) {
          fail(id, attempt, 'failed', 'Official Codex device sign-in failed. Check Host connectivity, CLI device-auth support and account policy, then retry.')
          return
        }
        phase = 'auth'
        const auth = await files.auth(staging)
        if (!live(id, attempt)) return
        const current = await input.account(id)
        if (!live(id, attempt)) return
        if (current?.kind !== 'codex' || current.layout?.effectiveHomePath !== layout.effectiveHomePath) {
          stop(id, { ...idle(id), status: 'cancelled', message: 'Sign-in cancelled because the account changed or was removed.' })
          return
        }
        if (!auth.signedIn) {
          fail(id, attempt, 'auth-not-saved', 'Codex exited successfully but did not save a valid ChatGPT token pair. The existing login was preserved.')
          return
        }
        if (!files.adopt(staging, layout, before.fingerprint)) {
          fail(id, attempt, 'auth-changed', 'The account credentials changed during sign-in. The newer login was preserved; retry if needed.')
          return
        }
        clearTimeout(attempt.timer)
        states.set(id, { ...idle(id), status: 'complete', message: 'Codex is connected. The official CLI credential is saved in this account’s private home.' })
        phase = 'refresh'
        await input.onComplete(id)
      } catch (error) {
        fail(
          id,
          attempt,
          error instanceof CodexLoginUnsupported ? 'unsupported' : phase === 'home' ? 'unsafe-home' : phase === 'refresh' ? 'refresh-failed' : 'failed',
          error instanceof CodexLoginUnsupported
            ? error.message
            : phase === 'home'
              ? 'The private Codex home could not be prepared safely. Check its owner, permissions and path; symlinked homes or auth files are not accepted.'
              : phase === 'refresh'
                ? 'Codex credentials were saved, but account routes could not refresh. Reload the Accounts page.'
                : 'Official Codex sign-in failed. The existing login was preserved; check the Host and retry.',
        )
      } finally {
        clearTimeout(attempt.timer)
        if (staging !== undefined) {
          try {
            await files.cleanup(staging)
          } catch {
            if (!disposed && attempts.get(id) === attempt) {
              const saved = state(id).status === 'complete'
              states.set(
                id,
                errorState(
                  id,
                  'cleanup-failed',
                  `${saved ? 'Codex credentials were saved, but' : 'Sign-in stopped, but'} private temporary sign-in files could not be removed. Check Host private-home permissions before retrying.`,
                ),
              )
            }
          }
        }
        if (attempts.get(id) === attempt) attempts.delete(id)
      }
    })()
    tasks.add(task)
    void task.finally(() => tasks.delete(task))
    return state(id)
  }

  return {
    begin,
    state,
    cancel: (id: string, requestId?: string): AccountLoginState => {
      if (requestId !== undefined && attempts.get(id)?.requestId !== requestId) return state(id)
      if (attempts.has(id) && ['starting', 'waiting'].includes(state(id).status))
        stop(id, { ...idle(id), status: 'cancelled', message: 'Sign-in cancelled. The existing account login was not replaced.' })
      return state(id)
    },
    reconcile: (accounts: readonly AccountLoginAccount[]): void => {
      const byId = new Map(accounts.map(account => [account.instanceId, account]))
      for (const [id, attempt] of attempts) {
        if (!['starting', 'waiting'].includes(state(id).status)) continue
        const account = byId.get(id)
        if (account?.kind === 'codex' && account.layout?.effectiveHomePath === attempt.home) continue
        stop(id, { ...idle(id), status: 'cancelled', message: 'Sign-in cancelled because the account changed or was removed.' })
      }
      for (const id of states.keys()) if (!byId.has(id) && !attempts.has(id)) states.delete(id)
    },
    dispose: (): void => {
      disposed = true
      for (const id of attempts.keys()) {
        if (['starting', 'waiting'].includes(state(id).status))
          stop(id, { ...idle(id), status: 'cancelled', message: 'Sign-in stopped because AI Accounts closed.' })
      }
    },
    /** Tests and orderly teardown can join subprocess termination and staging cleanup. */
    settled: async (): Promise<void> => {
      await Promise.all(tasks)
    },
  }
}

export type AccountLoginService = ReturnType<typeof createAccountLoginService>
