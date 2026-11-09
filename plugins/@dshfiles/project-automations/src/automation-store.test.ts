import type { StoredEntry } from '@dshfiles/dshx/api'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Effect, Option, Schema, Stream } from 'effect'
import { expect, it } from 'vitest'
import { runRecordSchema, type RunRecord } from './automations-api.js'
import { AutomationStore } from './automation-store.js'

const encodeRun = Schema.encodeSync(Schema.toCodecJson(runRecordSchema))

const run = (automationId: string, id: string, startedAt: number): RunRecord => ({
  id,
  automationId,
  automationTitle: automationId,
  trigger: 'schedule',
  outcome: 'started',
  startedAt,
  finishedAt: startedAt + 1,
})

const storedRuns = (runs: readonly RunRecord[], undecodableIds: readonly string[] = []) => {
  const reads = { count: 0 }
  const entries: StoredEntry[] = runs
    .map(record => {
      const value = undecodableIds.includes(record.id) ? { broken: true } : encodeRun(record)
      return {
        key: `run/${record.automationId}/${String(record.startedAt).padStart(15, '0')}-${record.id}`,
        updatedAt: 0,
        get value() {
          reads.count += 1
          return value
        },
      }
    })
    .toSorted((a, b) => (a.key < b.key ? -1 : 1))
  const storage = PluginStorage.of({
    namespace: 'test',
    get: () => Effect.succeed(Option.none()),
    set: () => Effect.die('read-only'),
    delete: () => Effect.die('read-only'),
    list: () => Effect.die('unused'),
    listAll: input => Effect.succeed(entries.filter(entry => entry.key.startsWith(input?.prefix ?? ''))),
    changes: () => Stream.empty,
  })
  return { reads, storage }
}

const listRuns = (storage: PluginStorage['Service'], input: { readonly automationId?: string; readonly limit: number }) =>
  AutomationStore.use(store => store.runs(input)).pipe(
    Effect.provide(AutomationStore.layerWithoutStorage),
    Effect.provideService(PluginStorage, storage),
    Effect.runPromise,
  )

it('decodes only each automation newest runs and returns them newest first across automations', async () => {
  const runs = ['a', 'b', 'c'].flatMap((automationId, offset) =>
    Array.from({ length: 25 }, (_, index) => run(automationId, `${automationId}${index}`, 1_000 + index * 10 + offset)),
  )
  const { reads, storage } = storedRuns(runs)

  const listed = await listRuns(storage, { limit: 5 })

  expect(reads.count).toBe(15)
  expect(listed.map(record => record.id)).toEqual(['c24', 'b24', 'a24', 'c23', 'b23'])
})

it('breaks a start-time tie at the cut-off as a full sort would, and skips an undecodable newest run', async () => {
  const { reads, storage } = storedRuns([run('a', 'r1', 100), run('a', 'r2', 200), run('a', 'r3', 200), run('a', 'r4', 300)], ['r4'])

  const listed = await listRuns(storage, { automationId: 'a', limit: 1 })

  expect(listed.map(record => record.id)).toEqual(['r2'])
  expect(reads.count).toBe(3)
})
