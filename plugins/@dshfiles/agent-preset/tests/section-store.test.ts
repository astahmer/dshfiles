import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentPresetSectionController } from '../src/native/section-store.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

type Row = { readonly id: string; readonly isDefault: boolean }
const STANDARD_ROWS: readonly Row[] = [
  { id: 'standard', isDefault: true },
  { id: 'cordis', isDefault: false },
]

function fixture(rows: readonly Row[] = STANDARD_ROWS) {
  const ctx = new Context()
  contexts.push(ctx)
  let listFails = false
  let updateFails = false
  const updates: string[] = []
  ctx.provide('remote', {
    agentPresets: {
      list: async () =>
        listFails
          ? { ok: false as const, error: { code: 'gateway/unavailable', message: 'roster read failed' } }
          : { ok: true as const, value: { presets: rows } },
      read: async (id: string) => ({ ok: true as const, value: { agentPreset: id, content: '[]' } }),
    },
    settings: {
      update: async (_namespace: string, patch: { selectedDefault: string }) => {
        if (updateFails) return { ok: false as const, error: { code: 'settings/refused', message: 'the Host refused it' } }
        updates.push(patch.selectedDefault)
        return { ok: true as const, value: {} }
      },
    },
  })
  ctx.provide('configForms', {
    get: () => ({ getSnapshot: () => ({ status: 'ready' as const, writable: true, revision: 3 }) }),
  })
  ctx.provide('locale', { bind: () => () => 'standard unavailable' })
  return {
    section: new AgentPresetSectionController(ctx),
    updates,
    failList: (fails: boolean) => {
      listFails = fails
    },
    failUpdate: (fails: boolean) => {
      updateFails = fails
    },
  }
}

describe('agent-preset settings section', () => {
  it('marks the first read loading and keeps the rows it read', async () => {
    const b = fixture()
    const pending = b.section.load()
    expect(b.section.store.getSnapshot().status).toBe('loading')
    await pending
    expect(b.section.store.getSnapshot()).toMatchObject({ status: 'ready', rows: STANDARD_ROWS, save: { status: 'idle' } })
  })

  it('keeps the rows of the last read when a later read fails', async () => {
    const b = fixture()
    await b.section.load()
    b.failList(true)
    await b.section.load()
    expect(b.section.store.getSnapshot()).toMatchObject({ status: 'error', error: 'roster read failed', rows: STANDARD_ROWS })
  })

  it('reports a refused write in the save outcome instead of a shared error flag', async () => {
    const b = fixture()
    await b.section.load()
    b.failUpdate(true)
    await b.section.makeDefault('cordis')
    expect(b.section.store.getSnapshot()).toMatchObject({
      status: 'ready',
      save: { status: 'error', error: 'the Host refused it' },
    })
  })

  it('runs writes one after the other instead of dropping the one that arrives mid-save', async () => {
    const b = fixture()
    await b.section.load()
    await Promise.all([b.section.makeDefault('cordis'), b.section.makeDefault('standard')])
    expect(b.updates).toEqual(['cordis', 'standard'])
    expect(b.section.store.getSnapshot()).toMatchObject({ save: { status: 'idle' } })
  })

  it('opens and closes the viewer without keeping a second open flag', async () => {
    const b = fixture()
    await b.section.view('cordis')
    expect(b.section.store.getSnapshot().viewer).toMatchObject({ status: 'open', view: { id: 'cordis', content: '[]' } })
    b.section.closeView()
    expect(b.section.store.getSnapshot().viewer).toEqual({ status: 'closed' })
  })

  it('reports a Coding Tools reconcile that cannot fall back to the standard preset', async () => {
    const b = fixture([{ id: 'ptc', isDefault: true }])
    await b.section.load()
    await b.section.reconcileCodingTools(() => true)
    expect(b.section.store.getSnapshot()).toMatchObject({ save: { status: 'error', error: 'standard unavailable' } })
    expect(b.updates).toEqual([])
  })

  it('falls back to the standard preset when the default needs Coding Tools', async () => {
    const b = fixture([
      { id: 'ptc', isDefault: true },
      { id: 'standard', isDefault: false },
    ])
    await b.section.load()
    await b.section.reconcileCodingTools(() => true)
    expect(b.updates).toEqual(['standard'])
    expect(b.section.store.getSnapshot()).toMatchObject({ save: { status: 'idle' } })
  })
})
