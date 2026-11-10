import { isApiOwnerMissing, type ApiCallOptions } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { jjIntegrationApi, type ThreadView } from './api.js'

const { discard, integrationProgress, land, repositories } = jjIntegrationApi.methods
type OutputOf<Method extends { readonly output?: Schema.Top }> = NonNullable<Method['output']>['Type']
type Repositories = OutputOf<typeof repositories>
type Repository = Repositories['repositories'][number]
type LandResult = OutputOf<typeof land>
type Progress = OutputOf<typeof integrationProgress>
type DiscardResult = OutputOf<typeof discard>
type PathInput = { readonly path: string; readonly bookmark?: string }
type DiscardInput = { readonly path: string; readonly force: boolean }

/** What the Land page calls on this Host. */
export interface LocalLandApi {
  readonly repositories: (input: Record<string, never>, options?: ApiCallOptions) => Promise<Repositories>
  readonly land: (input: PathInput, options?: ApiCallOptions) => Promise<LandResult>
  readonly integrationProgress: (input: { readonly path: string }, options?: ApiCallOptions) => Promise<Progress>
  readonly discard: (input: DiscardInput, options?: ApiCallOptions) => Promise<DiscardResult>
}

/** The multi-host path to threads on other machines. */
export interface RemoteLandPort {
  readonly remoteRepositories: (
    input: Record<string, never>,
    options?: ApiCallOptions,
  ) => Promise<{
    readonly hosts: readonly {
      readonly runtimeId: string
      readonly hostName: string
      readonly refreshing: boolean
      readonly repositories: readonly Repository[]
    }[]
    readonly unreachable: readonly string[]
  }>
  readonly sessionJjCall: (
    input: { readonly sessionId: string; readonly method: 'land' | 'integrationProgress' | 'discard'; readonly input: PathInput | DiscardInput },
    options?: ApiCallOptions,
  ) => Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: string; readonly message: string }>
}

export type LandRepositories = Repositories & { readonly unreachableHosts: readonly string[] }

const empty = { hosts: [], unreachable: [] }

/**
 * The Land page's calls over this Host and every remote host at once. A thread on another machine lands, reports
 * progress and is removed on the runtime that owns it, through one of its Sessions, which the Host authorizes.
 * @param input - this Host's API and the multi-host path.
 * @returns the same calls, plus the hosts that did not answer the last read.
 */
export const landRepositoriesApi = (input: { readonly local: LocalLandApi; readonly remote: RemoteLandPort }) => {
  const { local, remote } = input
  const owners = new Map<string, string>()
  const remember = (repository: Repository): void => {
    for (const thread of repository.threads as readonly ThreadView[]) {
      const sessionId = thread.sessionIds[0]
      if (sessionId !== undefined) owners.set(thread.path, sessionId)
    }
  }
  const remoteCall = async <Value>(call: {
    readonly sessionId: string
    readonly method: 'land' | 'integrationProgress' | 'discard'
    readonly input: PathInput | DiscardInput
    readonly output: Schema.ConstraintDecoder<Value> | undefined
    readonly options: ApiCallOptions | undefined
  }): Promise<Value> => {
    if (call.output === undefined) throw new TypeError('This JJ thread method has no output contract.')
    const result = await remote.sessionJjCall({ sessionId: call.sessionId, method: call.method, input: call.input }, call.options)
    if (!result.ok) throw Object.assign(new Error(result.message), { remoteCode: result.code })
    return Schema.decodeUnknownSync(call.output)(result.value)
  }
  return {
    repositories: async (request: Record<string, never>, options?: ApiCallOptions): Promise<LandRepositories> => {
      const [mine, theirs] = await Promise.all([
        local.repositories(request, options),
        remote.remoteRepositories({}, options).catch((error: unknown) => {
          // A Host without multi-host has no other machines; any other failure says this list may be incomplete.
          if (error instanceof Error && isApiOwnerMissing(error)) return empty
          return { hosts: [], unreachable: ['Remote hosts'] }
        }),
      ])
      owners.clear()
      const elsewhere = theirs.hosts.flatMap(host =>
        host.repositories.map(repository => {
          remember(repository)
          return { ...repository, title: `${repository.title} · ${host.hostName}` }
        }),
      )
      const refreshing = mine.refreshing === true || theirs.hosts.some(host => host.refreshing)
      return { ...mine, repositories: [...mine.repositories, ...elsewhere], unreachableHosts: theirs.unreachable, ...(refreshing && { refreshing }) }
    },
    land: (request: PathInput, options?: ApiCallOptions): Promise<LandResult> => {
      const sessionId = owners.get(request.path)
      return sessionId === undefined ? local.land(request, options) : remoteCall({ sessionId, method: 'land', input: request, output: land.output, options })
    },
    integrationProgress: (request: { readonly path: string }, options?: ApiCallOptions): Promise<Progress> => {
      const sessionId = owners.get(request.path)
      return sessionId === undefined
        ? local.integrationProgress(request, options)
        : remoteCall({ sessionId, method: 'integrationProgress', input: request, output: integrationProgress.output, options })
    },
    discard: (request: DiscardInput, options?: ApiCallOptions): Promise<DiscardResult> => {
      const sessionId = owners.get(request.path)
      return sessionId === undefined
        ? local.discard(request, options)
        : remoteCall({ sessionId, method: 'discard', input: request, output: discard.output, options })
    },
    /** Whether a row is on another machine, where this Host's review surfaces have nothing to show. */
    isRemote: (path: string): boolean => owners.has(path),
  }
}
