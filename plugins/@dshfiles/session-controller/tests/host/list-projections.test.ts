import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ApiSessionList } from '../../src/native/list.ts'
import type { SessionProjectionValue } from '../../src/native/types.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

const fixtureValues = {
  title: 'fixture title',
  turnOutline: [{ prompt: 'hello' }],
  sessionListMetadata: { blank: false, lastPromptAt: 200 },
} satisfies Readonly<Record<string, SessionProjectionValue>>
const fixtureEntries = new Map(Object.entries(fixtureValues))

/**
 * One cold Session row served from an in-memory projection checkpoint. The
 * cache records the exact key sets the Host asks it to view, which is what a
 * filtered read must narrow.
 */
const coldFixture = async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const list = new ApiSessionList(ctx, 8)
  const session = ctx.sessions.prepare(SessionId('cold-one'), { meta: { createdAt: 100, cwd: resolve('list-projections-fixture') } })
  const records: SessionRecord[] = [{ header: session.header, live: false, persisted: true }]
  const reads: (readonly string[] | undefined)[] = []
  // SAFETY: list() reads only listSessions from the query service and these cache methods.
  ctx.provide('sessionQuery', { listSessions: async () => records } as never)
  // SAFETY: the cold path calls only cachedSnapshot and cachedPredecessorTitle on the persisted cache.
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: (_header: SessionRecord['header'], keys?: readonly string[]) => {
      reads.push(keys)
      const picked: Record<string, SessionProjectionValue> = {}
      for (const key of keys ?? []) {
        const value = fixtureEntries.get(key)
        if (value !== undefined) picked[key] = value
      }
      const values = keys === undefined ? fixtureValues : picked
      return Object.keys(values).length === 0 ? undefined : { asOfSeq: -1, values }
    },
    cachedPredecessorTitle: () => undefined,
  } as never)
  return { list, reads }
}

it('omitted selector returns every projection', async () => {
  const { list, reads } = await coldFixture()
  const items = await list.list()
  expect(reads).toEqual([undefined])
  expect(items[0]?.projections?.values).toEqual(fixtureValues)
})

it('a selector returns only the named projections', async () => {
  const { list, reads } = await coldFixture()
  const items = await list.list({ projections: ['title'] })
  // The row's own metadata is read internally even when the caller does not ask for it.
  expect(reads).toEqual([['title'], ['sessionListMetadata']])
  expect(items[0]?.projections?.values).toEqual({ title: fixtureValues.title })
  expect(items[0]?.blank).toBe(false)
  expect(items[0]?.updatedAt).toBe(200)
})

it('an unknown projection key is ignored deliberately', async () => {
  const { list, reads } = await coldFixture()
  const items = await list.list({ projections: ['title', 'notAProjection'] })
  expect(reads).toEqual([['title', 'notAProjection'], ['sessionListMetadata']])
  expect(items[0]?.projections?.values).toEqual({ title: fixtureValues.title })
})

it('an empty selector returns no projection columns but keeps the row metadata', async () => {
  const { list, reads } = await coldFixture()
  const items = await list.list({ projections: [] })
  expect(reads).toEqual([['sessionListMetadata']])
  expect(items[0]?.projections).toBeUndefined()
  expect(items[0]?.blank).toBe(false)
  expect(items[0]?.updatedAt).toBe(200)
})

it('keeps the cold cache full after a filtered read', async () => {
  const { list, reads } = await coldFixture()
  await list.list({ projections: ['title'] })
  const full = await list.list()
  expect(reads).toEqual([['title'], ['sessionListMetadata'], undefined])
  expect(full[0]?.projections?.values).toEqual(fixtureValues)
})
