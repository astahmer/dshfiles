import { z } from 'zod'

export type ThreadContentHit = {
  readonly sessionId: string
  readonly snippet: string
  /** The finder's own title and workspace, so a hit renders even when the client has not listed that thread. */
  readonly title?: string | undefined
  readonly project?: string | undefined
  readonly cwd?: string | undefined
  readonly updatedAt?: number | undefined
}

type RegistryApiView = {
  readonly owner: string
  readonly id: string
  readonly version: number
  readonly methods: readonly { readonly name: string }[]
}

export type RegisteredApi = { readonly owner: string; readonly id: string; readonly version: number }

export type ThreadContentSearchDeps = {
  /** `dshxRegistryApi.list`, so the finder is reached without importing its owning plugin's contract. */
  readonly listApis: () => Promise<readonly RegistryApiView[]>
  /** Call `findThreads` on the discovered entry; the palette wires `createRegisteredApiClient` here. */
  readonly callFinder: (
    api: RegisteredApi,
    input: { readonly query: string; readonly project: string; readonly limit: number },
    signal: AbortSignal,
  ) => Promise<unknown>
  /** DSH's own session-content search, used when Memory is not installed or did not answer. */
  readonly native: (query: string, signal: AbortSignal) => Promise<readonly ThreadContentHit[]>
}

const memoryOwner = '@dshfiles/memory'
const memoryApiId = 'dshfiles-memory'
const finderPage = z.object({
  hits: z.array(
    z.object({
      sessionId: z.string().min(1),
      snippet: z.string(),
      title: z.string().optional(),
      project: z.string().optional(),
      cwd: z.string().nullable().optional(),
      updatedAt: z.number().optional(),
    }),
  ),
})

/**
 * Memory's finder answers from titles, workspace paths and its own digest/message index, so a `#` query shows
 * thread matches at once. DSH's session-content search reconciles every stored log before it answers — minutes on a
 * large history — so it is the fallback, and any discovery or decode failure falls back to it too.
 */
export const createThreadContentSearch = (deps: ThreadContentSearchDeps) => {
  let discovered: RegisteredApi | undefined | null
  return async (query: string, signal: AbortSignal): Promise<readonly ThreadContentHit[]> => {
    if (discovered === undefined) {
      const apis = await deps.listApis().catch(() => [] as readonly RegistryApiView[])
      const api = apis.find(
        candidate => candidate.owner === memoryOwner && candidate.id === memoryApiId && candidate.methods.some(method => method.name === 'findThreads'),
      )
      discovered = api === undefined ? null : { owner: api.owner, id: api.id, version: api.version }
    }
    if (discovered !== null) {
      const answer = await deps
        .callFinder(discovered, { query, project: 'all', limit: 12 }, signal)
        .then(value => finderPage.safeParse(value))
        .catch(() => undefined)
      if (answer?.success === true)
        return answer.data.hits.map(hit => ({
          sessionId: hit.sessionId,
          snippet: hit.snippet,
          title: hit.title,
          project: hit.project,
          cwd: hit.cwd ?? undefined,
          updatedAt: hit.updatedAt,
        }))
    }
    return deps.native(query, signal)
  }
}
