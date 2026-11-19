import { describe, expect, test } from 'vitest'
import { Schema } from 'effect'
import { aiAccountsLoginApi } from './account-login-api.js'
import { aiAccountsApi, prepareAccountConnectionInputSchema } from './api.js'

const operationId = '3f6b2c1e-8a4d-4e9b-9c7a-5d2e1f0a6b83'
const snapshot = (status: 'pending' | 'complete', loginHint: string | null) => ({
  operationId,
  instanceId: 'claude_work_1',
  status,
  method: 'subscription' as const,
  expiresAt: 0,
  account: { loginHint },
})

const render = (name: 'prepareAccountConnection' | 'getAccountConnection', output: ReturnType<typeof snapshot>): string => {
  const tool = aiAccountsApi.methods[name].tool
  if (tool?.render === undefined) throw new Error(`${name} has no render`)
  // SAFETY: render reads only the fields this snapshot carries; the full account profile is not needed here.
  return tool.render(output as never)
}

describe('ai-accounts connection next step', () => {
  test('a pending connection tells the Agent to complete it after sign-in, with its operationId', () => {
    const text = render('prepareAccountConnection', snapshot('pending', "CLAUDE_CONFIG_DIR='/x' claude auth login"))
    expect(text).toContain(`ai_accounts_complete_connection { operationId: "${operationId}" }`)
    expect(text).toMatch(/loginHint command runs in a terminal the user can see/u)
    expect(text).toMatch(/ai_accounts_login_status does not track this sign-in/u)
    expect(render('getAccountConnection', snapshot('pending', null))).toMatch(/Settings › AI accounts/u)
  })

  test('a finished connection carries no next step', () => {
    expect(render('getAccountConnection', snapshot('complete', null))).not.toContain('Next:')
  })

  test('the request id says it is a UUID the Agent generates, and login status names what it does not track', () => {
    expect(JSON.stringify(Schema.toJsonSchemaDocument(prepareAccountConnectionInputSchema))).toMatch(/A UUID you generate/u)
    expect(aiAccountsLoginApi.methods.status.description).toMatch(/does not track a provisional connection/u)
    expect(aiAccountsApi.methods.completeAccountConnection.description).toMatch(/after the user signed in/u)
  })
})
