import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { describe, expect, it } from 'vitest'
import { RemoteModelDirectory } from '../src/remote-model-directory.js'

const current: ModelSelection = { provider: 'remote', model: 'first' }
const catalog = { groups: [{ id: 'remote', name: 'Remote', models: [{ id: 'first', name: 'First' }] }], failures: [] }

const baseState = (patch: Partial<ModelDirectoryState> = {}): ModelDirectoryState => ({
  current,
  routable: null,
  groups: [],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
  ...patch,
})

const deferredCatalog = () => {
  let resolve: (value: typeof catalog) => void = () => {}
  const fetchCatalog = () => new Promise<typeof catalog>(settle => (resolve = settle))
  return { fetchCatalog, settle: () => resolve(catalog) }
}

const fixture = (fetchCatalog: () => Promise<typeof catalog>) => {
  const base = { store: createSnapshotStore(baseState()), select: async () => ({ ok: true as const, value: undefined }) }
  return { base, remote: new RemoteModelDirectory(base, fetchCatalog) }
}

describe('RemoteModelDirectory status', () => {
  it('stays selecting when the remote catalog loads under an in-flight selection', async () => {
    const { base, remote } = fixture(async () => catalog)
    base.store.set(baseState({ status: 'selecting', pending: current }))
    await remote.load()
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'selecting', pending: current })
    base.store.set(baseState())
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'ready', pending: null })
  })

  it('keeps loading when a selection settles before the remote catalog arrives', async () => {
    const pending = deferredCatalog()
    const { base, remote } = fixture(pending.fetchCatalog)
    const loading = remote.load()
    base.store.set(baseState({ status: 'selecting', pending: current }))
    base.store.set(baseState())
    expect(remote.store.getSnapshot().status).toBe('loading')
    pending.settle()
    await loading
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'ready', routable: true })
  })

  it('clears a selection failure once the base selection recovers', async () => {
    const { base, remote } = fixture(async () => catalog)
    await remote.load()
    base.store.set(baseState({ status: 'error', error: 'session/writer-held: Session is in use' }))
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'error', error: 'session/writer-held: Session is in use' })
    base.store.set(baseState())
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })

  it('reports a catalog failure while the selection is idle', async () => {
    const { remote } = fixture(async () => {
      throw new Error('remote catalog unavailable')
    })
    await remote.load()
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'error', error: 'remote catalog unavailable' })
  })

  it('answers a reload right after a successful load from the catalog it has, and retries after a failure', async () => {
    let fetches = 0
    let fails = true
    const { remote } = fixture(async () => {
      fetches += 1
      if (fails) throw new Error('unreachable')
      return catalog
    })
    await remote.load()
    expect(remote.store.getSnapshot().status).toBe('error')
    fails = false
    await remote.load()
    await remote.load()
    expect(fetches).toBe(2)
    expect(remote.store.getSnapshot()).toMatchObject({ status: 'ready', routable: true })
  })
})
