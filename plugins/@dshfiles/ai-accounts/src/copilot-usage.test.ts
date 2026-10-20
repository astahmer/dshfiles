import { describe, expect, it } from 'vitest'
import { readCopilotUsage } from './copilot-quota.js'

const credential = { type: 'oauth' as const, refresh: 'gho_github', access: 'copilot-api-token', expires: Date.now() + 60_000 }

const answering =
  (status: number, json: string): typeof fetch =>
  async () =>
    new Response(json, { status, headers: { 'content-type': 'application/json' } })

describe('GitHub Copilot subscription quota', () => {
  it('maps the premium request and chat quotas, resetting on the quota date', async () => {
    const card = await readCopilotUsage({
      credential,
      fetch: answering(
        200,
        JSON.stringify({
          copilot_plan: 'business',
          quota_reset_date: '2026-11-01',
          quota_snapshots: {
            premium_interactions: { entitlement: 300, remaining: 120, percent_remaining: 40.04, unlimited: false },
            chat: { entitlement: 0, remaining: 0, percent_remaining: 100, unlimited: true },
            completions: { entitlement: 0, remaining: 0, percent_remaining: 100, unlimited: true },
          },
        }),
      ),
    })
    expect(card).toMatchObject({
      status: 'ok',
      plan: 'business',
      windows: [{ label: 'Premium requests', percentRemaining: 40, resetsAt: Date.parse('2026-11-01') }],
    })
  })

  it('asks for a sign-in without a stored grant, and again when GitHub rejects it', async () => {
    await expect(readCopilotUsage({ credential: undefined })).resolves.toMatchObject({ status: 'unauthenticated', windows: [] })
    await expect(readCopilotUsage({ credential, fetch: answering(401, JSON.stringify({})) })).resolves.toMatchObject({ status: 'unauthenticated' })
  })

  it('reports an unlimited or unrecognized answer as unsupported instead of a guessed number', async () => {
    await expect(
      readCopilotUsage({
        credential,
        fetch: answering(200, JSON.stringify({ quota_snapshots: { premium_interactions: { percent_remaining: 100, unlimited: true } } })),
      }),
    ).resolves.toMatchObject({ status: 'unsupported', windows: [] })
    await expect(readCopilotUsage({ credential, fetch: answering(200, JSON.stringify({ something: 'else' })) })).resolves.toMatchObject({
      status: 'unsupported',
    })
  })
})
