import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/native/index.js'
import { AgentPresetSeatController } from '../src/native/seat-store.ts'
import { AgentPresetSeat } from '../src/native/AgentPresetSeat.tsx'
import { AgentPresetLabel } from '../src/native/AgentPresetLabel.tsx'
import { AgentPresetSection } from '../src/native/AgentPresetSection.tsx'
import { CreatePluginMenuItem } from '../src/native/CreatePluginMenuItem.tsx'

// Registration-only tests do not render platform-module UI. The parent scratch
// journey drives the unchanged native components through the real renderer.
vi.mock('../src/native/AgentPresetSeat.tsx', () => ({ AgentPresetSeat: () => null }))
vi.mock('../src/native/AgentPresetLabel.tsx', () => ({ AgentPresetLabel: () => null }))
vi.mock('../src/native/AgentPresetSection.tsx', () => ({ AgentPresetSection: () => null }))
vi.mock('../src/native/CreatePluginMenuItem.tsx', () => ({ CreatePluginMenuItem: () => null }))

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  type Surface = typeof AgentPresetSeat | typeof AgentPresetLabel | typeof AgentPresetSection | typeof CreatePluginMenuItem
  interface CreatorFace {
    startCreatorDraft?: () => void
  }
  interface Entry {
    component: Surface
    inject?: () => CreatorFace
  }
  const entries = new Map<string, Entry>()
  const slots = {
    register: (options: { name: string; inject?: () => CreatorFace }, component: Surface) => {
      const entry: Entry = { component }
      if (options.inject !== undefined) entry.inject = options.inject
      entries.set(options.name, entry)
      return () => {
        entries.delete(options.name)
      }
    },
    inject: (_name: string, install: () => () => void) => install(),
  }
  ctx.provide('slots', slots)
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  ctx.provide('sessions', { list: createSnapshotStore({ byId: {} }), binding: () => undefined })
  ctx.provide('sessionDrafts', { list: createSnapshotStore({}), stagePreset: vi.fn(() => true) })
  ctx.provide('conversation', {})
  const startSession = vi.fn()
  ctx.provide('uiWorkspace', { startSession })
  ctx.provide('configForms', {
    get: () => createSnapshotStore({ status: 'idle', value: {}, writable: false }),
    developerTools: { enabled: createSnapshotStore(true) },
  })
  ctx.provide('remote', { $on: () => () => {}, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }) } })
  ctx.provide('remote.agentPresets', {})
  ctx.provide('remote.settings', {})
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, entries, startSession }
}

describe('whole native Loader row', () => {
  it('requires the canonical draft service and retains all four native surfaces', async () => {
    const { entries } = await fixture()
    expect(inject).toContain('sessionDrafts')
    expect(entries.get('conversation.hero.agentPreset')?.component).toBe(AgentPresetSeat)
    expect(entries.get('conversation.session.header.actions')?.component).toBe(AgentPresetLabel)
    expect(entries.get('settings.section')?.component).toBe(AgentPresetSection)
    expect(entries.get('plugins.add.actions')?.component).toBe(CreatePluginMenuItem)
  })

  it.each(['settings.section', 'plugins.add.actions'])('preserves the %s Creator route and creation preset', async slot => {
    const { entries, startSession } = await fixture()
    const stage = vi.spyOn(AgentPresetSeatController.prototype, 'stage')
    const face = entries.get(slot)?.inject?.()
    if (face?.startCreatorDraft === undefined) throw new Error('Creator route missing')
    face.startCreatorDraft()
    expect(stage).toHaveBeenCalledExactlyOnceWith('cordis', true)
    expect(startSession).toHaveBeenCalledExactlyOnceWith(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })
  })
})
