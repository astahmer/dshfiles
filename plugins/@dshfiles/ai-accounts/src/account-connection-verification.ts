import { z } from 'zod'
import { providerFetch } from './provider-request.js'
import type { AccountConnectionMethod } from './api.js'
import { readAccountUsage } from './account-usage.js'
import { ClaudeAccountModel } from './claude-account.js'
import { verifyClaudeAuthStatus, type ClaudeAuthStatusRunner } from './claude-auth-status.js'

type UsageInput = Parameters<typeof readAccountUsage>[0]
const VERIFICATION_TIMEOUT_MS = 6_000
const RETRY_MESSAGE = 'Could not verify this account connection. Check sign-in and try again.'
const failure = (): Error => new Error(RETRY_MESSAGE)
const tokenCountSchema = z.object({ input_tokens: z.number().finite().nonnegative() })

/** Claude's inference route does not carry apiBaseUrl; never validate another origin instead. */
const assertOfficialClaudeBase = (value: string): void => {
  const url = new URL(value.trim() === '' ? 'https://api.anthropic.com' : value.trim())
  if (url.origin !== 'https://api.anthropic.com' || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '')
    throw failure()
}

/**
 * Admission uses fresh provider-owned authenticated evidence, independent of displayable or remaining quota.
 * Claude CLI connections instead use the official CLI's authenticated-CONFIGURATION status, not remote validity.
 * Raw provider/process errors and abort reasons never leave this boundary.
 */
export const verifyAccountConnection = async (
  input: UsageInput & {
    readonly method?: AccountConnectionMethod | undefined
    readonly resolveCredential: NonNullable<UsageInput['resolveCredential']>
    readonly readCopilotCredential: NonNullable<UsageInput['readCopilotCredential']>
    /** Owned adapter seams for offline tests and isolated device-login staging. No card-only success is proof. */
    readonly readAccountUsage?: typeof readAccountUsage
    readonly runClaudeAuthStatus?: ClaudeAuthStatusRunner
  },
): Promise<void> => {
  if (input.signal?.aborted) throw failure()
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, VERIFICATION_TIMEOUT_MS)
  const assertActive = (): void => {
    if (controller.signal.aborted) throw failure()
  }
  let rejectAborted: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAborted = () => reject(failure())
    controller.signal.addEventListener('abort', rejectAborted, { once: true })
  })
  const probe = async (): Promise<void> => {
    assertActive()
    const explicitCli = input.method === 'cli' || input.method === 'subscription'
    const account = {
      ...input.account,
      apiKeyEnv: explicitCli ? '' : input.account.apiKeyEnv.trim(),
      ...(input.method === 'cli'
        ? { authSource: 'cli' as const }
        : input.method === 'key' || input.method === 'reference'
          ? { authSource: 'reference' as const }
          : {}),
    }
    // An explicitly chosen CLI login must never be replaced by a default environment key.
    let resolveCredential = explicitCli ? async (): Promise<string> => '' : input.resolveCredential
    const keyed = account.kind === 'claude' || account.kind === 'opencode-go' || account.kind === 'commandcode' || account.kind === 'cursor'
    let resolvedKey: string | undefined
    if (keyed && account.apiKeyEnv !== '') {
      const name = account.apiKeyEnv
      const key = (await input.resolveCredential(name)).trim()
      resolvedKey = key
      assertActive()
      if (key === '') throw failure()
      resolveCredential = async requested => (requested === name ? key : '')
    } else if (keyed && (input.method === 'key' || input.method === 'reference')) throw failure()

    if (account.kind === 'claude' && input.readAccountUsage === undefined) {
      if (resolvedKey !== undefined) assertOfficialClaudeBase(account.apiBaseUrl)
      if (ClaudeAccountModel.usesCliTransport(account)) {
        await verifyClaudeAuthStatus({
          configDir: ClaudeAccountModel.resolveClaudeConfigDir(account.homePath),
          signal: controller.signal,
          ...(input.runClaudeAuthStatus === undefined ? {} : { run: input.runClaudeAuthStatus }),
        })
      } else {
        assertOfficialClaudeBase(account.apiBaseUrl)
        if (resolvedKey === undefined) throw failure()
        // Officially free and non-generative. Setup-token permission is NOT assumed: only a validated successful
        // response is proof. A denied count request stays retryable; never fall back to paid inference or another login.
        const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json', 'anthropic-version': '2023-06-01' })
        if (resolvedKey.includes('sk-ant-oat')) {
          // pi-ai 1.3.0 Messages transport's OAuth authentication and beta headers.
          headers.set('authorization', `Bearer ${resolvedKey}`)
          headers.set('anthropic-beta', 'claude-code-20250219,oauth-2025-04-20')
          headers.set('x-app', 'cli')
        } else headers.set('x-api-key', resolvedKey)
        const response = await providerFetch({
          provider: 'claude',
          operation: 'verification',
          url: 'https://api.anthropic.com/v1/messages/count_tokens',
          init: {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Connection check' }] }),
            redirect: 'error',
            signal: controller.signal,
          },
        })
        if (!response.ok || !tokenCountSchema.safeParse(await response.json()).success) throw failure()
      }
      assertActive()
      return
    }

    let authenticated = false
    await (input.readAccountUsage ?? readAccountUsage)({
      account,
      shadowRoot: input.shadowRoot,
      resolveCredential,
      readCopilotCredential: input.readCopilotCredential,
      signal: controller.signal,
      onAuthenticated: () => {
        if (!controller.signal.aborted) authenticated = true
      },
    })
    assertActive()
    if (!authenticated) throw failure()
  }
  try {
    await Promise.race([probe(), cancelled])
    assertActive()
  } catch {
    throw failure()
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', abort)
    if (rejectAborted !== undefined) controller.signal.removeEventListener('abort', rejectAborted)
  }
}
