import type { OAuthCredential } from '@earendil-works/pi-ai'
import { z } from 'zod'
import type { UsageCard } from './api.js'
import { ProviderUsageModel } from './usage.js'
import { providerFetch } from './provider-request.js'

/**
 * GitHub Copilot's subscription quota, from the endpoint GitHub's own Copilot clients read (`copilot_internal/user`).
 * GitHub documents no quota API, so this is the same kind of best effort as the Cursor dashboard read: a response that
 * no longer matches the shape below turns the card into "unsupported" rather than a guessed number.
 */
const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user'

const snapshotSchema = z.object({
  percent_remaining: z.number().finite().optional(),
  unlimited: z.boolean().optional(),
})

const copilotUserSchema = z.object({
  copilot_plan: z.string().optional(),
  quota_reset_date: z.string().optional(),
  quota_snapshots: z.object({
    premium_interactions: snapshotSchema.nullish(),
    chat: snapshotSchema.nullish(),
  }),
})

type CopilotUser = z.infer<typeof copilotUserSchema>

/** Windows GitHub meters, in the order the card shows them. */
const WINDOWS = [
  ['premium_interactions', 'Premium requests'],
  ['chat', 'Chat'],
] as const

class CopilotQuotaModel {
  /** Card for one decoded `copilot_internal/user` response, or null when it carries no quota the card can show. */
  static cardFrom(user: CopilotUser): UsageCard | null {
    const resetsAt = user.quota_reset_date === undefined ? Number.NaN : Date.parse(user.quota_reset_date)
    const windows = WINDOWS.flatMap(([key, label]) => {
      const snapshot = user.quota_snapshots[key]
      if (snapshot === undefined || snapshot === null || snapshot.unlimited === true || snapshot.percent_remaining === undefined) return []
      return [
        {
          label,
          percentRemaining: Math.max(0, Math.min(100, Math.round(snapshot.percent_remaining * 10) / 10)),
          resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
        },
      ]
    })
    if (windows.length === 0) return null
    return { ...ProviderUsageModel.emptyUsage('ok'), plan: user.copilot_plan ?? null, windows }
  }
}

export const readCopilotUsage = async (input: {
  readonly credential: OAuthCredential | undefined
  readonly signal?: AbortSignal | undefined
  readonly onAuthenticated?: (() => void) | undefined
  readonly fetch?: typeof fetch
}): Promise<UsageCard> => {
  if (input.signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  // The grant's refresh token is the GitHub OAuth token; the access token only talks to the Copilot API.
  const githubToken = input.credential?.refresh
  if (githubToken === undefined || githubToken === '') return ProviderUsageModel.emptyUsage('unauthenticated', 'Sign in to GitHub Copilot to read its quota.')
  try {
    const response = await providerFetch({
      provider: 'copilot',
      operation: 'usage',
      url: COPILOT_USER_URL,
      init: {
        headers: { authorization: `token ${githubToken}`, accept: 'application/json', 'x-github-api-version': '2025-04-01' },
        redirect: 'error',
        signal: ProviderUsageModel.usageSignal(input.signal),
      },
      fetch: input.fetch,
    })
    if (response.status === 401 || response.status === 403)
      return ProviderUsageModel.emptyUsage('unauthenticated', 'GitHub rejected this Copilot sign-in; sign in again.')
    if (response.status === 429) return ProviderUsageModel.emptyUsage('rate-limited', 'GitHub rate-limited the quota request.')
    if (!response.ok) return ProviderUsageModel.emptyUsage('error', `GitHub returned ${String(response.status)} for Copilot quota.`)
    const user = copilotUserSchema.safeParse(await response.json())
    if (
      user.success &&
      !input.signal?.aborted &&
      (user.data.copilot_plan?.trim() ||
        WINDOWS.some(([key]) => {
          const snapshot = user.data.quota_snapshots[key]
          return snapshot?.unlimited === true || snapshot?.percent_remaining !== undefined
        }))
    )
      input.onAuthenticated?.()
    const card = user.success ? CopilotQuotaModel.cardFrom(user.data) : null
    return card ?? ProviderUsageModel.emptyUsage('unsupported', 'GitHub returned no Copilot quota this card can show.')
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Copilot quota could not be read.')
  }
}
