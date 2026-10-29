import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it, vi } from 'vitest'
import { SidebarSessionViews } from './native/client/session-views.ts'
import { z } from 'zod'

it('restores only saved resource Sessions through owned references and releases inactive Views after unmount', () => {
  const releases = new Map<string, ReturnType<typeof vi.fn>>()
  const retain: ISessions['retain'] = vi.fn((target, _options): SessionReference => {
    // SAFETY: this fixture accepts only the local SessionId branch; the public seam is validated here.
    const sessionId = z.string().parse(target) as SessionId
    const release = vi.fn()
    releases.set(sessionId, release)
    const ready = new Promise<SessionReference['binding']>(() => {})
    // Real references are class instances; snapshot dev-freeze must not traverse opaque reference accessors.
    class Reference implements SessionReference {
      readonly sessionId = sessionId
      readonly ready = ready
      readonly release = release
      get binding(): SessionReference['binding'] {
        throw new Error('unneeded in lifecycle test')
      }
      [Symbol.dispose](): void {
        release()
      }
    }
    return new Reference()
  })
  const retired = vi.fn()
  const views = new SidebarSessionViews({ retain }, retired)
  // SAFETY: stable fixture identity is passed directly to the public fake retain seam.
  const a = 'saved-resource-a' as SessionId
  // SAFETY: distinct stable fixture identity is passed to the same fake retain seam.
  const b = 'saved-resource-b' as SessionId
  views.retainResourceSessions([a, b, a])
  expect(retain).toHaveBeenCalledTimes(2)
  expect(retain).toHaveBeenCalledWith(a, { source: 'sidebarResourceView' })
  expect(views.source.getSnapshot().map(view => [view.sessionId, view.selected])).toEqual([
    [a, false],
    [b, false],
  ])
  const first = views.source.getSnapshot()[0]
  if (first === undefined) throw new Error('expected saved resource View')
  const unmount = views.mount(first.reference)
  views.retainResourceSessions([b])
  expect(views.source.getSnapshot().map(view => view.sessionId)).toEqual([b])
  expect(releases.get(a)).not.toHaveBeenCalled()
  unmount()
  expect(releases.get(a)).toHaveBeenCalledOnce()
  expect(retired).toHaveBeenCalledWith(a)
  views.select(b)
  views.retainResourceSessions([])
  expect(releases.get(b)).not.toHaveBeenCalled()
  views.select(undefined)
  expect(releases.get(b)).toHaveBeenCalledOnce()
  views.dispose()
  views.retainResourceSessions([a])
  expect(retain).toHaveBeenCalledTimes(2)
})

it('bounds saved Session opening concurrency at four and stops queued acquisitions when suspended', async () => {
  const starts: string[] = []
  const settles = new Map<string, () => void>()
  const releases = new Map<string, ReturnType<typeof vi.fn>>()
  const retain: ISessions['retain'] = (target): SessionReference => {
    // SAFETY: this fixture accepts only the local SessionId branch; the public seam is validated here.
    const sessionId = z.string().parse(target) as SessionId
    starts.push(sessionId)
    const release = vi.fn()
    releases.set(sessionId, release)
    const ready = new Promise<SessionReference['binding']>((_resolve, reject) => {
      settles.set(sessionId, () => reject(new Error('fixture history unavailable')))
    })
    class Reference implements SessionReference {
      readonly sessionId = sessionId
      readonly ready = ready
      readonly release = release
      get binding(): SessionReference['binding'] {
        throw new Error('not required for acquisition test')
      }
      [Symbol.dispose](): void {
        release()
      }
    }
    return new Reference()
  }
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const views = new SidebarSessionViews({ retain })
  // SAFETY: stable fixture ids are the exact inputs to the fake public retain seam.
  const ids = Array.from({ length: 8 }, (_, index) => `saved-${index}` as SessionId)
  views.retainResourceSessions(ids)
  expect(starts).toEqual(ids.slice(0, 4))
  settles.get('saved-0')?.()
  await Promise.resolve()
  expect(starts).toEqual(ids.slice(0, 5))
  views.retainResourceSessions([])
  for (const settle of settles.values()) settle()
  await Promise.resolve()
  expect(starts).toHaveLength(5)
  for (const release of releases.values()) expect(release).toHaveBeenCalledOnce()
  views.dispose()
  report.mockRestore()
})
