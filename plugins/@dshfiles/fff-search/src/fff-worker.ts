/**
 * Worker half of fff-search. fff-node's queries are synchronous FFI calls that take from milliseconds to seconds, so
 * every index lives here and the Host's event loop only posts messages.
 */
import { FileFinder } from '@ff-labs/fff-node'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import * as Schema from 'effect/Schema'
import { evictableIndex, IDLE_INDEX_MS, pruneStores } from './index-eviction.js'
import { FffSearch } from './fff-search.js'

// oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot that keeps the null-check narrowing inside the message callbacks.
const port = parentPort
if (port === null) throw new Error('fff-search worker must run in a worker thread')
const { stateRoot } = Schema.decodeUnknownSync(Schema.Struct({ stateRoot: Schema.String }))(workerData)

/** `scanned` is enough for path globs; content search waits for `contentReady`. */
type ResidentIndex = { finder: FileFinder; scanned: Promise<unknown>; contentReady: Promise<unknown>; lastUsedAt: number; inUse: number }
const indexes = new Map<string, ResidentIndex>()

// A deleted thread workspace leaves its search history behind; drop those stores before serving this run.
pruneStores(stateRoot)

const indexFor = (root: string): ResidentIndex => {
  const existing = indexes.get(root)
  if (existing !== undefined) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  const stateDirectory = join(stateRoot, createHash('sha256').update(root).digest('hex').slice(0, 16))
  mkdirSync(stateDirectory, { recursive: true })
  // The directory name is a hash, so record the root it belongs to: a pruning pass can then drop the stores of roots
  // that no longer exist instead of keeping every workspace this machine ever indexed (2,099 of 2,152 here).
  writeFileSync(join(stateDirectory, 'root.txt'), root)
  const created = FileFinder.create({
    basePath: root,
    frecencyDbPath: join(stateDirectory, 'frecency.db'),
    historyDbPath: join(stateDirectory, 'history.db'),
  })
  if (!created.ok) throw new Error(`fff-search could not index ${root}: ${created.error}`)
  const index = {
    finder: created.value,
    scanned: created.value.waitForScan(60_000),
    contentReady: created.value.waitForIndexReady(60_000),
    lastUsedAt: Date.now(),
    inUse: 0,
  }
  indexes.set(root, index)
  return index
}

const evictIdle = setInterval(() => {
  const now = Date.now()
  for (const [root, index] of indexes) {
    if (!evictableIndex(index, now)) continue
    indexes.delete(root)
    index.finder.destroy()
  }
}, IDLE_INDEX_MS / 3)
evictIdle.unref()

const answer = async (request: typeof FffSearch.workerRequest.Type): Promise<typeof FffSearch.grepOutcome.Type | typeof FffSearch.globOutcome.Type | null> => {
  if (request.kind === 'warm') {
    indexFor(request.root)
    return null
  }
  const index = indexFor(request.scope.root)
  index.inUse += 1
  try {
    if (request.kind === 'grep') {
      await index.contentReady
      return FffSearch.grep({
        finder: index.finder,
        scope: request.scope,
        pattern: request.pattern,
        include: request.include,
        workingDirectory: request.workingDirectory,
      })
    }
    await index.scanned
    return FffSearch.glob({ finder: index.finder, scope: request.scope, pattern: request.pattern, workingDirectory: request.workingDirectory })
  } finally {
    index.inUse -= 1
    index.lastUsedAt = Date.now()
  }
}

// oxlint-disable-next-line antislop/no-unknown-parameters -- The worker message boundary; `workerRequest.parse` runs on the next line.
port.on('message', (message: unknown) => {
  const request = Schema.decodeUnknownSync(FffSearch.workerRequest)(message)
  answer(request).then(
    value => port.postMessage({ id: request.id, ok: true, value }),
    (error: unknown) => port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
})

port.on('close', () => {
  clearInterval(evictIdle)
  for (const index of indexes.values()) index.finder.destroy()
  indexes.clear()
})
