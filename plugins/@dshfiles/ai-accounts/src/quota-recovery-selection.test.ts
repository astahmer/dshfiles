import { describe, expect, it } from 'vitest'
import type { QuotaRecoveryModelCatalog } from './api.js'
import { suggestedQuotaRecoverySelection } from './quota-recovery-selection.js'

const catalog: QuotaRecoveryModelCatalog = {
  default: { provider: 'codex-primary', model: 'gpt-6-luna' },
  routableProviders: ['codex-primary', 'codex-spare', 'native-deepseek'],
  groups: [
    { id: 'codex-primary', name: 'Primary Codex', models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }] },
    {
      id: 'codex-spare',
      name: 'Spare Codex',
      models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }],
    },
    { id: 'native-deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }] },
  ],
  failures: [],
}

describe('quota recovery model selection', () => {
  it('defaults to the same model on another provider and carries that route default effort', () => {
    expect(suggestedQuotaRecoverySelection(catalog, { provider: 'codex-primary', model: 'gpt-6-luna' })).toEqual({
      provider: 'codex-spare',
      model: 'gpt-6-luna',
      reasoningEffort: 'high',
    })
  })

  it('falls back to another provider model when no route offers the failed model', () => {
    expect(suggestedQuotaRecoverySelection(catalog, { provider: 'codex-primary', model: 'not-in-catalog' })).toEqual({
      provider: 'codex-spare',
      model: 'gpt-6-luna',
      reasoningEffort: 'high',
    })
  })
})
