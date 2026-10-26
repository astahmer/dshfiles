import { Context } from '@deepseek-ai/cordis'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionDraft, SessionDrafts } from '@dshfiles/session-controller/draft-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPresetSeatController, type AgentPresetStage } from '../src/native/seat-store.ts'
import { AgentPresetSectionController } from '../src/native/section-store.ts'

type SeatSession = Pick<SessionSummary, 'id' | 'blank' | 'projectionValues'>
const id = (value: string): SessionId => brandString<SessionId>(`session-${value}`)
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fixture(local = true) {
  const ctx = new Context()
  contexts.push(ctx)
  const sessionId = id('draft')
  let current: SeatSession | undefined = { id: sessionId, blank: true, projectionValues: {} }
  const list = createSnapshotStore<Readonly<Record<string, SessionDraft>>>({
    [sessionId]: { sessionId, preview: '', local },
  })
  const stagePreset = vi.fn((sessionId: SessionId, agentPreset: string): boolean => {
    const draft = list.getSnapshot()[sessionId]
    if (!draft?.local) return false
    list.set({ ...list.getSnapshot(), [sessionId]: { ...draft, agentPreset } })
    return true
  })
  const drafts: SessionDrafts = {
    list,
    stagePreset,
    stageModel: () => false,
    create: () => {
      throw new Error('fixture does not navigate')
    },
    update: () => {},
    whenCreated: () => Promise.resolve(),
    retry: sessionId => Promise.resolve(sessionId),
  }
  let selectedDefault = 'standard'
  const select = vi.fn(async (_sessionId: SessionId, agentPreset: string) => ({ ok: true as const, value: agentPreset }))
  const agentPresets = {
    list: async () => ({ ok: true as const, value: { presets: ['standard', 'cordis'].map(id => ({ id, isDefault: id === selectedDefault })) } }),
    select,
    read: async (id: string) => ({ ok: true as const, value: { agentPreset: id, content: '[]' } }),
  } satisfies Pick<Context['remote']['agentPresets'], 'list' | 'select' | 'read'>
  ctx.provide('remote', {
    agentPresets,
    settings: {
      update: async (_ns: string, patch: { selectedDefault: string }) => {
        selectedDefault = patch.selectedDefault
        return { ok: true, value: {} }
      },
    },
  })
  ctx.provide('sessionDrafts', drafts)
  const staged: AgentPresetStage = { id: undefined, introduce: false }
  const seat = new AgentPresetSeatController(ctx, () => current, staged)
  return {
    ctx,
    seat,
    staged,
    list,
    select,
    stagePreset,
    sessionId,
    setCurrent: (next: SeatSession | undefined) => {
      current = next
    },
  }
}

describe('native preset seat with canonical Session drafts', () => {
  it('selects a local preset without a per-id Host RPC and keeps its caption on reload', async () => {
    const b = fixture()
    await b.seat.load()
    expect(b.seat.store.getSnapshot().current).toBe('standard')
    await b.seat.select('cordis')
    expect(b.stagePreset).toHaveBeenCalledExactlyOnceWith(b.sessionId, 'cordis')
    expect(b.list.getSnapshot()[b.sessionId]?.agentPreset).toBe('cordis')
    expect(b.select).not.toHaveBeenCalled()
    expect(b.staged.id).toBeUndefined()
    await b.seat.load()
    await b.seat.apply()
    expect(b.seat.store.getSnapshot()).toMatchObject({ current: 'cordis', busy: false, error: null })
    expect(b.stagePreset).toHaveBeenCalledTimes(1)
  })

  it('ignores stale provisional projections and reads the local metadata first', async () => {
    const b = fixture()
    b.setCurrent({ id: b.sessionId, blank: true, projectionValues: { agentPreset: 'standard' } })
    await b.seat.select('cordis')
    await b.seat.load()
    expect(b.seat.store.getSnapshot().current).toBe('cordis')
    expect(b.select).not.toHaveBeenCalled()
  })

  it('clears a stage before synchronous draft notifications can reenter apply', async () => {
    const b = fixture()
    const stop = b.list.subscribe(() => {
      void b.seat.apply()
    })
    await b.seat.select('cordis')
    stop()
    expect(b.stagePreset).toHaveBeenCalledTimes(1)
    expect(b.select).not.toHaveBeenCalled()
  })

  it('preserves the native Host path for a materialized blank', async () => {
    const b = fixture(false)
    await b.seat.select('cordis')
    expect(b.select).toHaveBeenCalledExactlyOnceWith(b.sessionId, 'cordis')
    expect(b.stagePreset).not.toHaveBeenCalled()
    expect(b.seat.store.getSnapshot()).toMatchObject({ current: 'cordis', error: null, busy: false })
  })

  it('does not swap a started Host Session', async () => {
    const b = fixture(false)
    b.setCurrent({ id: b.sessionId, blank: false, projectionValues: { agentPreset: 'standard' } })
    await b.seat.select('cordis')
    expect(b.select).not.toHaveBeenCalled()
    expect(b.stagePreset).not.toHaveBeenCalled()
    expect(b.staged.id).toBeUndefined()
  })

  it('synchronizes the Settings default into the captured local blank without selecting it on the Host', async () => {
    const b = fixture()
    const settings = new AgentPresetSectionController(b.ctx)
    await settings.makeDefault('cordis', preset => b.seat.syncBlankSession(b.sessionId, preset))
    expect(settings.store.getSnapshot()).toMatchObject({ saving: false, error: null })
    expect(b.list.getSnapshot()[b.sessionId]?.agentPreset).toBe('cordis')
    expect(b.select).not.toHaveBeenCalled()
  })

  it('does not synchronize a Settings action after navigation replaces its captured blank', async () => {
    const b = fixture()
    b.setCurrent({ id: id('other'), blank: true, projectionValues: {} })
    await b.seat.syncBlankSession(b.sessionId, 'cordis')
    expect(b.stagePreset).not.toHaveBeenCalled()
    expect(b.select).not.toHaveBeenCalled()
  })

  it('stages an unbound Creator choice for the local identity that navigation later opens', async () => {
    const b = fixture()
    b.setCurrent(undefined)
    b.seat.stage('cordis', true)
    await b.seat.apply()
    expect(b.select).not.toHaveBeenCalled()
    b.setCurrent({ id: b.sessionId, blank: true, projectionValues: {} })
    await b.seat.apply()
    expect(b.list.getSnapshot()[b.sessionId]?.agentPreset).toBe('cordis')
    expect(b.seat.store.getSnapshot()).toMatchObject({ current: 'cordis', introduce: true })
    expect(b.select).not.toHaveBeenCalled()
  })

  it('does not spend a Creator stage onto the previous local blank while navigation publishes the new identity', async () => {
    const b = fixture()
    const destination = id('creator')
    b.seat.stage('cordis', true)
    b.list.set({ ...b.list.getSnapshot(), [destination]: { sessionId: destination, local: true, preview: '', agentPreset: 'cordis' } })
    await b.seat.apply()
    expect(b.stagePreset).not.toHaveBeenCalled()
    expect(b.list.getSnapshot()[b.sessionId]?.agentPreset).toBeUndefined()
    b.setCurrent({ id: destination, blank: true, projectionValues: {} })
    await b.seat.apply()
    expect(b.stagePreset).toHaveBeenCalledExactlyOnceWith(destination, 'cordis')
    expect(b.staged.id).toBeUndefined()
    expect(b.select).not.toHaveBeenCalled()
  })
})
