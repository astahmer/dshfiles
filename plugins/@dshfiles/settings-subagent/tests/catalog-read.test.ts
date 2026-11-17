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

const show = (controller: SubagentModelSelectionCardController): (() => void) => controller.inject().hooks.subagentModelSelectionCard.subscribe(() => {})

describe('the Subagent page model catalog', () => {
  it('reads once when shown: the read waits for the first connected generation, which needs no reread', async () => {
    const { ctx, modelCatalog } = fixture()
    const controller = new SubagentModelSelectionCardController(enabledScope, ctx, false)
    show(controller)
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
    show(first)
    show(second)
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(1)
    answer?.()
    first.dispose()
    second.dispose()
  })

  it('reads nothing on a settings write while no renderer shows the card, and catches up when it is shown', async () => {
    const { ctx, modelCatalog } = fixture()
    const controller = new SubagentModelSelectionCardController(enabledScope, ctx)
    await settle()
    for (let write = 0; write < 3; write += 1) controller.refreshCatalog()
    await settle()
    expect(modelCatalog).not.toHaveBeenCalled()

    const hide = show(controller)
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(1)
    controller.refreshCatalog()
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(2)

    hide()
    controller.refreshCatalog()
    await settle()
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
})
