import { describe, expect, it } from 'vitest'
import { PANEL_REREGISTER_GRACE_MS, PanelRetentionModel } from './panel-retention.ts'

const harness = (initial: { readonly active: string | null; readonly keys: readonly string[] }) => {
  const state = { active: initial.active, keys: [...initial.keys] }
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = []
  const retention = PanelRetentionModel.create({
    activePanelId: () => state.active,
    panelKeys: () => state.keys,
    release: keys => {
      if (state.active !== null && !keys.includes(state.active)) state.active = null
    },
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const fire = (): void => timers.filter(timer => !timer.cancelled).forEach(timer => timer.run())
  return { state, timers, retention, fire }
}

describe('panel retention', () => {
  it('keeps a panel selected while its plugin reloads and registers it again', () => {
    const { state, timers, retention, fire } = harness({ active: 'backlog', keys: ['backlog', 'usage'] })
    state.keys = ['usage']
    retention.check()
    expect(state.active).toBe('backlog')
    expect(timers[0]?.delayMs).toBe(PANEL_REREGISTER_GRACE_MS)

    state.keys = ['usage', 'backlog']
    retention.check()
    fire()
    expect(state.active).toBe('backlog')
  })

  it('releases a panel that is still gone once the grace ends', () => {
    const { state, retention, fire } = harness({ active: 'backlog', keys: ['backlog'] })
    state.keys = []
    retention.check()
    retention.check()
    fire()
    expect(state.active).toBeNull()
  })

  it('arms nothing when no panel is selected or the selected one is registered', () => {
    const { timers, retention } = harness({ active: null, keys: [] })
    retention.check()
    expect(timers).toHaveLength(0)
  })
})
