import { describe, expect, it } from 'vitest'
import { type RecoveryListener, SlotCrashRecovery } from './slot-crash-recovery.js'

const slotCrash = (): Error => Object.assign(new Error("scope 'session-maybe' rendered without an installed adapter"), { name: 'SlotAssemblyError' })

/** One browser tab: session storage survives its reloads, listeners and timers do not. */
const tab = () => {
  const stored = new Map<string, string>()
  let clock = 0
  let reloads = 0
  const load = () => {
    const listeners: Array<(event: { readonly error?: unknown }) => void> = []
    const timers: Array<{ readonly run: () => void; readonly ms: number }> = []
    SlotCrashRecovery.installOnce(
      {
        addEventListener: (_type, listener) => listeners.push(listener),
        storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) },
        setTimeout: (run, ms) => timers.push({ run, ms }),
        reload: () => {
          reloads += 1
        },
        now: () => clock,
      },
      {},
    )
    return {
      throw: (error: unknown) => listeners.forEach(listener => listener({ error })),
      fire: () => timers.splice(0).forEach(timer => timer.run()),
      delays: () => timers.map(timer => timer.ms),
    }
  }
  return { load, advance: (ms: number) => (clock += ms), reloads: () => reloads }
}

describe('SlotCrashRecovery', () => {
  it('reloads a page a slot assembly crash blanked, once per crash burst', () => {
    const browser = tab()
    const page = browser.load()
    page.throw(slotCrash())
    page.throw(slotCrash())
    expect(page.delays()).toEqual([1_500])
    page.fire()
    expect(browser.reloads()).toBe(1)
  })

  it('retries with longer delays while the page keeps crashing after its reloads, then stops', () => {
    const browser = tab()
    const delays: number[][] = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const page = browser.load()
      page.throw(slotCrash())
      delays.push(page.delays())
      page.fire()
      browser.advance(2_000)
    }
    expect(delays).toEqual([[1_500], [5_000], [15_000], []])
    expect(browser.reloads()).toBe(3)

    browser.advance(SlotCrashRecovery.windowMs)
    const later = browser.load()
    later.throw(slotCrash())
    expect(later.delays()).toEqual([1_500])
  })

  it('ignores errors that are not slot assembly crashes', () => {
    const page = tab().load()
    page.throw(new Error('boom'))
    page.throw('not an error')
    expect(page.delays()).toEqual([])
  })

  it('installs one listener per page however often the plugin is set up again', () => {
    const registry = {}
    const listeners: RecoveryListener[] = []
    const page = {
      addEventListener: (_type: 'error', listener: RecoveryListener) => void listeners.push(listener),
      storage: undefined,
      setTimeout: () => undefined,
      reload: () => undefined,
      now: () => 0,
    }
    SlotCrashRecovery.installOnce(page, registry)
    SlotCrashRecovery.installOnce(page, registry)
    expect(listeners).toHaveLength(1)
  })
})
