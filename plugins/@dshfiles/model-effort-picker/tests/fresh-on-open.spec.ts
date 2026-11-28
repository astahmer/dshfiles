import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RemoteModelDirectory } from '../src/remote-model-directory.js'

const base = () => {
  const listeners = new Set<() => void>()
  const snapshot = { status: 'ready', groups: [], failures: [], current: null, pending: null, routable: true } as const
  return {
    store: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)) },
    select: async () => undefined,
  }
}
// SAFETY: the directory reads only getSnapshot and subscribe from its base store and never calls select in these tests.
const baseDirectory = (): ConstructorParameters<typeof RemoteModelDirectory>[0] => base() as never

describe('opening the picker reads the catalog again (council picker round 5, U3)', () => {
  it('answers a composer mount from a recent read, but reads again when asked fresh, keeping the list shown', async () => {
    let reads = 0
    const groups = [[{ id: 'cc1', name: 'Command Code 1', models: [{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }] }], []]
    const directory = new RemoteModelDirectory(baseDirectory(), async () => ({ groups: groups[Math.min(reads++, 1)] ?? [], failures: [] }))
    await directory.load()
    expect(reads).toBe(1)
    await directory.load()
    expect(reads).toBe(1)
    const statuses: string[] = []
    const unsubscribe = directory.store.subscribe(() => statuses.push(directory.store.getSnapshot().status))
    await directory.load({ fresh: true })
    unsubscribe()
    expect(reads).toBe(2)
    expect(directory.store.getSnapshot().groups).toEqual([])
    expect(statuses).not.toContain('loading')
  })

  it('asks fresh when the picker opens, not on every composer mount', () => {
    const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
    expect(picker).toContain('if (open && available) load({ fresh: true })')
    expect(picker).toContain("if (available && connection === 'online') load()")
  })
})
