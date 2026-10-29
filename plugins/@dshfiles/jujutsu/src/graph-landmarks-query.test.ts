import { QueryClient, QueryObserver } from '@dshfiles/plugin-ui/query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphNavigation } from './api.js'
import { GraphLandmarksQuery } from './graph-landmarks-query.js'
import { jujutsuQueryKeys } from './repository-query-cache.js'

const ROOT = '/repo'
const REPO_ID = '00000000-0000-4000-8000-000000000000'
const navigation: GraphNavigation = { operationId: 'a'.repeat(128), landmarks: [] }

/** The panel's two reads as `JujutsuPanel` and `useGraphNavigation` wire them: state first, landmarks keyed by its update time. */
const mountPanel = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } })
  let landmarkReads = 0
  const read = async (): Promise<GraphNavigation> => {
    landmarkReads += 1
    return navigation
  }
  const stateOptions = (onScreen: boolean) => ({
    queryKey: jujutsuQueryKeys.state(ROOT, 10),
    queryFn: async () => ({ revisions: [] }),
    enabled: onScreen,
    staleTime: 60_000,
  })
  const landmarksOptions = (onScreen: boolean) =>
    GraphLandmarksQuery.options({ root: ROOT, repoId: REPO_ID, refreshedAt: state.getCurrentResult().dataUpdatedAt, onScreen, read })
  const state = new QueryObserver(client, stateOptions(true))
  const landmarks = new QueryObserver(client, landmarksOptions(true))
  const unsubscribe = [state.subscribe(() => undefined), landmarks.subscribe(() => undefined)]
  /** One render pass: both observers take the props the panel would pass now. */
  const render = (onScreen: boolean): void => {
    state.setOptions(stateOptions(onScreen))
    landmarks.setOptions(landmarksOptions(onScreen))
  }
  const settle = async (onScreen: boolean): Promise<void> => {
    for (let pass = 0; pass < 5; pass += 1) {
      await vi.waitFor(() => expect(client.isFetching()).toBe(0))
      render(onScreen)
    }
  }
  return {
    client,
    render,
    settle,
    landmarkReads: () => landmarkReads,
    dispose: () => {
      for (const stop of unsubscribe) stop()
      client.clear()
    },
  }
}

describe('graph landmarks query', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads landmarks once for the first snapshot', async () => {
    const panel = mountPanel()
    await panel.settle(true)
    expect(panel.landmarkReads()).toBe(1)
    panel.dispose()
  })

  it('reads landmarks once when the panel comes back into view', async () => {
    const panel = mountPanel()
    await panel.settle(true)
    const readsBeforeHiding = panel.landmarkReads()

    panel.render(false)
    vi.setSystemTime(10 * 60_000)
    // The auto-refresh actor announces the return before React re-renders the panel as visible.
    void panel.client.invalidateQueries({ queryKey: jujutsuQueryKeys.repository(ROOT) })
    panel.render(true)
    await panel.settle(true)

    expect(panel.landmarkReads() - readsBeforeHiding).toBe(1)
    panel.dispose()
  })

  it('still rereads landmarks for each new repository snapshot', async () => {
    const panel = mountPanel()
    await panel.settle(true)
    const readsBeforeRefresh = panel.landmarkReads()
    vi.setSystemTime(5_000)
    void panel.client.invalidateQueries({ queryKey: ['jujutsu'] })
    await panel.settle(true)
    expect(panel.landmarkReads() - readsBeforeRefresh).toBe(1)
    panel.dispose()
  })

  it('reads nothing while the panel is off screen', async () => {
    const panel = mountPanel()
    await panel.settle(true)
    const readsBeforeHiding = panel.landmarkReads()
    panel.render(false)
    vi.setSystemTime(10 * 60_000)
    void panel.client.invalidateQueries({ queryKey: ['jujutsu'] })
    await panel.settle(false)
    expect(panel.landmarkReads()).toBe(readsBeforeHiding)
    panel.dispose()
  })
})
