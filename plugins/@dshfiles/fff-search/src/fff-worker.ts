/**
 * Worker half of fff-search. fff-node's queries are synchronous FFI calls that take from milliseconds to seconds, so
 * every index lives here and the Host's event loop only posts messages.
 */
import { FileFinder } from '@ff-labs/fff-node'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { FffSearch } from './fff-search.js'

/** An index nobody searched for this long is dropped; every jj thread workspace is its own root. */
const IDLE_INDEX_MS = 30 * 60_000

// oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot that keeps the null-check narrowing inside the message callbacks.
const port = parentPort
if (port === null) throw new Error('fff-search worker must run in a worker thread')
const { stateRoot } = z.object({ stateRoot: z.string() }).parse(workerData)

/** `scanned` is enough for path globs; content search waits for `contentReady`. */
type ResidentIndex = { finder: FileFinder; scanned: Promise<unknown>; contentReady: Promise<unknown>; lastUsedAt: number }
const indexes = new Map<string, ResidentIndex>()

const indexFor = (root: string): ResidentIndex => {
  const existing = indexes.get(root)
  if (existing !== undefined) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  const stateDirectory = join(stateRoot, createHash('sha256').update(root).digest('hex').slice(0, 16))
  mkdirSync(stateDirectory, { recursive: true })
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
  }
  indexes.set(root, index)
  return index
}

const evictIdle = setInterval(() => {
  for (const [root, index] of indexes) {
    if (Date.now() - index.lastUsedAt < IDLE_INDEX_MS) continue
    indexes.delete(root)
    index.finder.destroy()
  }
}, IDLE_INDEX_MS / 3)
evictIdle.unref()

const answer = async (
  request: z.infer<typeof FffSearch.workerRequest>,
): Promise<z.infer<typeof FffSearch.grepOutcome> | z.infer<typeof FffSearch.globOutcome> | null> => {
  if (request.kind === 'warm') {
    indexFor(request.root)
    return null
  }
  const index = indexFor(request.scope.root)
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
}

// oxlint-disable-next-line antislop/no-unknown-parameters -- The worker message boundary; `workerRequest.parse` runs on the next line.
port.on('message', (message: unknown) => {
  const request = FffSearch.workerRequest.parse(message)
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
