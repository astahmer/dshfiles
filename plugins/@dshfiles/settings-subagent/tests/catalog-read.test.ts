import { Context } from '@deepseek-ai/cordis'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { describe, expect, it, vi } from 'vitest'
import { SubagentModelSelectionCardController, type SubagentModelSelectionSettings } from '../src/native/subagent-model-selection-card-controller.ts'

const enabledScope: SettingsFormScope<SubagentModelSelectionSettings> = {
  getSnapshot: () => ({ status: 'ready', value: { enabled: true, allowedModels: [] }, base: {}, user: {}, writable: true, revision: 1 }),
  subscribe: () => () => {},
  mutate: async () => true,
}

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

const fixture = () => {
  const ctx = new Context()
  const modelCatalog = vi.fn(async () => ({ ok: true as const, value: { groups: [], failures: [] } }))
  ctx.provide('remote', { session: { modelCatalog } })
  return { ctx, modelCatalog }
}

describe('the Subagent page model catalog', () => {
  it('reads once at boot: the read waits for the first connected generation, which needs no reread', async () => {
    const { ctx, modelCatalog } = fixture()
    const controller = new SubagentModelSelectionCardController(enabledScope, ctx, false)
    await settle()
    expect(modelCatalog).not.toHaveBeenCalled()

    controller.connectionReset()
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(1)

    controller.connectionReset()
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('shares one request with another owner reading the catalog at the same time', async () => {
    const { ctx, modelCatalog } = fixture()
    let answer: (() => void) | undefined
    modelCatalog.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answer = () => resolve({ ok: true, value: { groups: [], failures: [] } })
        }),
    )
    const first = new SubagentModelSelectionCardController(enabledScope, ctx)
    const second = new SubagentModelSelectionCardController(enabledScope, ctx)
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(1)
    answer?.()
    first.dispose()
    second.dispose()
  })
})
