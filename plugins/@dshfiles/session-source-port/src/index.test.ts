import { describe, expect, test } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionSourceRegistry, type MirroredSessionSource } from './index.js'

const id = (value: string): SessionId => value as SessionId

const source = (sourceId: string, owned: readonly string[]): MirroredSessionSource => ({
  id: sourceId,
  label: sourceId,
  list: async () => [],
  owns: sessionId => owned.includes(sessionId),
})

describe('session source registry', () => {
  test('claims follow a source and are forgotten with it', () => {
    const registry = createSessionSourceRegistry()
    const remote = source('remote', ['session-a'])
    const unregister = registry.register(remote)
    registry.claim(remote, [id('session-a'), id('session-b')])

    expect(registry.sources()).toEqual([remote])
    expect(registry.ownerOf(id('session-a'))).toBe(remote)

    unregister()
    expect(registry.sources()).toEqual([])
    expect(registry.ownerOf(id('session-a'))).toBeUndefined()
  })

  test('resolveOwner asks each source only when nothing is claimed', async () => {
    const registry = createSessionSourceRegistry()
    const asked: string[] = []
    const first: MirroredSessionSource = {
      ...source('first', []),
      owns: sessionId => {
        asked.push(`first:${sessionId}`)
        return false
      },
    }
    const second: MirroredSessionSource = {
      ...source('second', []),
      owns: sessionId => {
        asked.push(`second:${sessionId}`)
        return sessionId === 'session-b'
      },
    }
    registry.register(first)
    registry.register(second)

    await expect(registry.resolveOwner(id('session-b'))).resolves.toBe(second)
    expect(asked).toEqual(['first:session-b', 'second:session-b'])
    expect(registry.ownerOf(id('session-b'))).toBe(second)

    asked.length = 0
    await expect(registry.resolveOwner(id('session-b'))).resolves.toBe(second)
    expect(asked).toEqual([])
  })

  test('a cached claim of an unregistered source is dropped before asking', async () => {
    const registry = createSessionSourceRegistry()
    const remote = source('remote', ['session-a'])
    const unregister = registry.register(remote)
    registry.claim(remote, [id('session-a')])
    unregister()

    const other = source('other', ['session-a'])
    registry.register(other)
    await expect(registry.resolveOwner(id('session-a'))).resolves.toBe(other)
  })

  test('an id no source owns resolves to nothing', async () => {
    const registry = createSessionSourceRegistry()
    registry.register(source('remote', ['session-a']))
    await expect(registry.resolveOwner(id('session-z'))).resolves.toBeUndefined()
    expect(registry.ownerOf(id('session-z'))).toBeUndefined()
  })
})
