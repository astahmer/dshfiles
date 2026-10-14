import { describe, expect, it } from 'vitest'
import { createComposerWorkspaceNavigation } from './composer-workspace-navigation.js'

const navigationFixture = () => {
  let selected = 'project'
  const listeners = new Set<() => void>()
  const navigation = createComposerWorkspaceNavigation({
    selectedWorkspace: () => selected,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  const arrive = (workspaceId: string) => {
    selected = workspaceId
    for (const listener of listeners) listener()
  }
  return { navigation, arrive, listeners }
}

describe('composer-owned workspace navigation', () => {
  it('uses the native picker and waits for the destination rather than releasing Send at the pending chip', async () => {
    const fixture = navigationFixture()
    const picked: string[] = []
    fixture.navigation.bind(workspaceId => picked.push(workspaceId))
    const opened = fixture.navigation.open('thread', new AbortController().signal)
    expect(picked).toEqual(['thread'])
    expect(fixture.listeners.size).toBe(1)
    fixture.arrive('thread')
    await opened
    expect(fixture.listeners.size).toBe(0)
  })

  it('handles synchronous native navigation and cleans up its subscription', async () => {
    const fixture = navigationFixture()
    fixture.navigation.bind(fixture.arrive)
    await fixture.navigation.open('thread', new AbortController().signal)
    expect(fixture.listeners.size).toBe(0)
  })

  it('keeps the newest composer binding when the previous mount releases its picker', async () => {
    const fixture = navigationFixture()
    const releaseOld = fixture.navigation.bind(() => {
      throw new Error('stale composer')
    })
    fixture.navigation.bind(fixture.arrive)
    releaseOld()
    await fixture.navigation.open('thread', new AbortController().signal)
  })

  it('refuses navigation after the composer unmounts instead of bypassing draft transfer', async () => {
    const fixture = navigationFixture()
    fixture.navigation.bind(fixture.arrive)()
    await expect(fixture.navigation.open('thread', new AbortController().signal)).rejects.toThrow('no longer mounted')
    expect(fixture.listeners.size).toBe(0)
  })

  it('cancels waiting for navigation when the owning switch is canceled', async () => {
    const fixture = navigationFixture()
    fixture.navigation.bind(() => undefined)
    const controller = new AbortController()
    const opened = fixture.navigation.open('thread', controller.signal)
    controller.abort(new Error('switch canceled'))
    await expect(opened).rejects.toThrow('switch canceled')
    expect(fixture.listeners.size).toBe(0)
  })

  it('cleans up if the native picker rejects synchronously', async () => {
    const fixture = navigationFixture()
    fixture.navigation.bind(() => {
      throw new Error('pick failed')
    })
    await expect(fixture.navigation.open('thread', new AbortController().signal)).rejects.toThrow('pick failed')
    expect(fixture.listeners.size).toBe(0)
  })
})
