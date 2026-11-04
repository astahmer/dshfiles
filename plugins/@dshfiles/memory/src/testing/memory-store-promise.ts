import { Effect, ManagedRuntime } from 'effect'

import { MemoryRepo, type NoteInput, type ThreadDigest } from '../memory-repo.ts'
import { repoLayer } from './memory-store.ts'

/**
 * A second connection to a profile's memory file for e2e journeys and benches, which drive memory from Promise code.
 * The Host has the same file open in WAL mode; writes here land the way `memory_note` would write them.
 */
export const openMemoryStore = (options: { readonly path: string }) => {
  const runtime = ManagedRuntime.make(repoLayer(options.path))
  const run = <A, E>(body: (repo: MemoryRepo['Service']) => Effect.Effect<A, E>) => runtime.runPromise(Effect.flatMap(MemoryRepo, body))
  return {
    addNote: (input: NoteInput) => run(repo => repo.addNote(input)),
    putThread: (digest: ThreadDigest) => run(repo => repo.putThread(digest)),
    thread: (id: string) => run(repo => repo.thread(id)),
    indexMessages: (input: Parameters<MemoryRepo['Service']['indexMessages']>[0]) => run(repo => repo.indexMessages(input)),
    search: (request: Parameters<MemoryRepo['Service']['search']>[0]) => run(repo => repo.search(request)),
    close: () => runtime.dispose(),
  }
}
