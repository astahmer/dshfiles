import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { markRosterChanged, readSharedRoster } from '../src/native/settings-store.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const fixture = () => {
  const ctx = new Context()
  contexts.push(ctx)
  let reads = 0
  let fails = false
  ctx.provide('remote', {
    agentPresets: {
      list: async () => {
        reads += 1
        return fails
          ? { ok: false as const, error: { code: 'gateway/unavailable', message: 'roster read failed' } }
          : { ok: true as const, value: { presets: [{ id: 'standard', isDefault: true }] } }
      },
    },
  })
  return {
    ctx,
    reads: () => reads,
    fail: (next: boolean) => {
      fails = next
    },
  }
}

describe('shared roster for the header label and composer seat', () => {
  it('serves every label and seat mount from one read until the Host announces a roster change', async () => {
    const f = fixture()
    await readSharedRoster(f.ctx)
    await readSharedRoster(f.ctx)
    await readSharedRoster(f.ctx)
    expect(f.reads()).toBe(1)
    markRosterChanged()
    expect(await readSharedRoster(f.ctx)).toMatchObject({ ok: true })
    await readSharedRoster(f.ctx)
    expect(f.reads()).toBe(2)
  })

  it('reads again after a failed read instead of keeping the failure', async () => {
    const f = fixture()
    f.fail(true)
    expect(await readSharedRoster(f.ctx)).toEqual({ ok: false, error: 'roster read failed' })
    f.fail(false)
    expect(await readSharedRoster(f.ctx)).toMatchObject({ ok: true })
    expect(f.reads()).toBe(2)
  })
})
