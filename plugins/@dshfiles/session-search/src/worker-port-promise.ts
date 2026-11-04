import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'

import type { IndexHealth, SearchEventsResult, SearchSessionsResult, SessionEventSearchRequest, SessionSearchRequest } from './protocol.js'
import { SearchWorker, type SearchWorkerOptions } from './worker-client.js'

type PortCalls = {
  readonly searchSessions: (request: SessionSearchRequest) => Promise<SearchSessionsResult>
  readonly searchEvents: (request: SessionEventSearchRequest) => Promise<SearchEventsResult>
  readonly health: () => Promise<IndexHealth>
}

/**
 * The worker as core's Promise `SessionQueryEngine` calls it. The Host builds one from its `SearchWorker` with
 * `DshxPlugin.callback`; tests and benches open a standalone one with `openSearchWorker`.
 */
export class SearchWorkerPort {
  readonly searchSessions: PortCalls['searchSessions']
  readonly searchEvents: PortCalls['searchEvents']
  readonly health: PortCalls['health']

  constructor(calls: PortCalls) {
    this.searchSessions = calls.searchSessions
    this.searchEvents = calls.searchEvents
    this.health = calls.health
  }
}

/** A worker of its own for Promise callers: it spawns on the first call and terminates on `close`. */
export const openSearchWorker = (options: SearchWorkerOptions) => {
  const runtime = ManagedRuntime.make(SearchWorker.layer(options).pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))))
  const run = <A, E>(body: (worker: SearchWorker['Service']) => Effect.Effect<A, E>) => runtime.runPromise(Effect.flatMap(SearchWorker, body))
  const port = new SearchWorkerPort({
    searchSessions: request => run(worker => worker.searchSessions(request)),
    searchEvents: request => run(worker => worker.searchEvents(request)),
    health: () => run(worker => worker.health),
  })
  return {
    port,
    health: () => run(worker => worker.health),
    nudge: () => run(worker => worker.nudge),
    startIngest: (root: string) => run(worker => worker.startIngest(root)),
    close: () => runtime.dispose(),
  }
}
