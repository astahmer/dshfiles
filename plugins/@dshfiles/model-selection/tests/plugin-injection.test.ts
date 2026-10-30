import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/native/inject.ts'

describe('model selection plugin dependencies', () => {
  it('deactivates its client boundary when handoff compaction is unavailable', async () => {
    const context = new Context()
    const disposeDependencies = inject.map(name => context.provide(name, {}))
    const fiber = context.plugin({
      inject,
      apply: pluginContext => {
        pluginContext.provide('modelSelectionActive', true)
      },
    })

    await fiber
    expect(context.get('modelSelectionActive')).toBe(true)

    const disposeCommands = disposeDependencies.at(-1)
    if (disposeCommands === undefined) throw new Error('remote.commands is required')
    await disposeCommands()

    expect(context.get('modelSelectionActive')).toBeUndefined()
    await Promise.all(disposeDependencies.slice(0, -1).map(dispose => dispose()))
  })
})
