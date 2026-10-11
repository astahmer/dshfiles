import { describe, expect, it } from 'vitest'
import { draftProblem, newAccountDraft, suggestedApiKeyRef } from './account-draft.js'

describe('account draft defaults', () => {
  it('creates a unique API-key reference for newly added keyed accounts', () => {
    const first = newAccountDraft({ kind: 'opencode-go', existing: [] })
    const second = newAccountDraft({ kind: 'opencode-go', existing: [] })

    expect(first.apiKeyEnv).toBe('OPENCODE_GO_WORK_API_KEY')
    expect(second.apiKeyEnv).toBe(first.apiKeyEnv)
    expect(newAccountDraft({ kind: 'codex', existing: [] }).apiKeyEnv).toBe('')
    const copilot = newAccountDraft({ kind: 'github-copilot', existing: [] })
    expect(copilot.apiKeyEnv).toBe('')
    expect(draftProblem(copilot)).toBeNull()
  })

  it('normalizes reference names to a valid bounded API-key identifier', () => {
    expect(suggestedApiKeyRef('2-company/app')).toBe('ACCOUNT_2_COMPANY_APP_API_KEY')
    expect(suggestedApiKeyRef('a'.repeat(200))).toHaveLength(120)
  })
})
