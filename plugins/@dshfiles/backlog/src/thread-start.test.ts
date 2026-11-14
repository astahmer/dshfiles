import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createTestHost } from '@dshfiles/dshx/testing'
import { VcsProviderService, type VcsResolution } from '@dshfiles/vcs-provider-port/effect'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { HostSessions, HostUploads, HostWorkspaces } from './host-edge-promise.js'
import { StartIntentClaims, StartIntents } from './start-intents.js'
import { BacklogStore } from './store.js'
import { BacklogTestStore } from './test-support.js'
import { ThreadStart } from './thread-start.js'

const project = { id: 'ws-project', path: '/repo/project' }

/** What the fakes saw: each provision request and the workspace every Session was created in. */
interface Recorded {
  readonly provisions: { readonly workspaceId: string; readonly isolate?: boolean | undefined; readonly base?: string | undefined }[]
  readonly created: (string | undefined)[]
}

const openThreadStart = (recorded: Recorded) => {
  const rows = BacklogTestStore.rows()
  const vcs = Layer.succeed(
    VcsProviderService,
    VcsProviderService.of({
      contract: () => Effect.die('unused') as never,
      owners: Effect.succeed(['@test/jj']),
      resolve: ({ path }) =>
        Effect.succeed(
          path === project.path
            ? Option.some({
                owner: '@test/jj',
                match: { vcs: 'jj', priority: 10, repoRoot: path, workspaceRoot: path, isolated: false },
                // SAFETY: a test double; ThreadStart calls only `provision` on the provider client.
                client: {
                  provision: (input: Recorded['provisions'][number]) =>
                    Effect.sync(() => {
                      recorded.provisions.push(input)
                      return { workspaceId: 'ws-thread-1', isolated: true }
                    }),
                } as unknown as VcsResolution['client'],
              } satisfies VcsResolution)
            : Option.none(),
        ),
    }),
  )
  const sessions = Layer.succeed(
    HostSessions,
    HostSessions.of({
      list: Effect.die('unused'),
      summary: () => Effect.succeed(null),
      create: request =>
        Effect.sync(() => {
          recorded.created.push(request.workspaceId === undefined ? undefined : String(request.workspaceId))
          return { sessionId: `session-${String(recorded.created.length)}` }
        }),
      selectModel: () => Effect.void,
      rename: () => Effect.void,
      prompt: () => Effect.void,
    }),
  )
  const workspaces = Layer.succeed(HostWorkspaces, HostWorkspaces.of({ list: Effect.succeed([project]) }))
  const uploads = Layer.succeed(HostUploads, HostUploads.of({ upload: () => Effect.die('no attachments in these items') }))
  return Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        host => Effect.sync(() => host.dispose()),
      ),
      host =>
        ThreadStart.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(vcs, sessions, workspaces, uploads, HostApis.layer, StartIntentClaims.layer)),
          Layer.provideMerge(StartIntents.layer.pipe(Layer.provideMerge(BacklogTestStore.dbLayer(rows)))),
          Layer.provideMerge(BacklogTestStore.layer({ rows })),
          Layer.provideMerge(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/backlog' })),
        ),
    ),
  )
}

const run = <A, E>(recorded: Recorded, body: (services: { threads: ThreadStart['Service']; store: BacklogStore['Service'] }) => Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.flatMap(Layer.build(openThreadStart(recorded)), context =>
      body({ threads: Context.get(context, ThreadStart), store: Context.get(context, BacklogStore) }),
    ),
  )

const user = { kind: 'user' } as const
const panel = { kind: 'client' } as const

describe('ThreadStart workspace choice', () => {
  it.effect('cuts a new workspace from the bookmark the caller chose, a remote one included', () => {
    const recorded: Recorded = { provisions: [], created: [] }
    return run(recorded, ({ threads, store }) =>
      Effect.gen(function* () {
        const { item } = yield* store.capture({ text: 'fix the login flow', actor: user })
        yield* threads.start({ ids: [item.id], workspaceId: project.id, base: 'feature@origin' }, panel)
        expect(recorded.provisions).toEqual([{ workspaceId: project.id, isolate: true, base: 'feature@origin' }])
        expect(recorded.created).toEqual(['ws-thread-1'])
      }),
    )
  })

  it.effect('keeps cutting a new workspace from the main branch when the caller chose nothing', () => {
    const recorded: Recorded = { provisions: [], created: [] }
    return run(recorded, ({ threads, store }) =>
      Effect.gen(function* () {
        const { item } = yield* store.capture({ text: 'fix the login flow', actor: user })
        yield* threads.start({ ids: [item.id], workspaceId: project.id }, panel)
        expect(recorded.provisions).toEqual([{ workspaceId: project.id, isolate: true }])
        expect(recorded.created).toEqual(['ws-thread-1'])
      }),
    )
  })

  it.effect('runs in the project checkout without creating a workspace when isolation is off', () => {
    const recorded: Recorded = { provisions: [], created: [] }
    return run(recorded, ({ threads, store }) =>
      Effect.gen(function* () {
        const { item } = yield* store.capture({ text: 'fix the login flow', actor: user })
        yield* threads.start({ ids: [item.id], workspaceId: project.id, isolate: false }, panel)
        expect(recorded.provisions).toEqual([])
        expect(recorded.created).toEqual([project.id])
      }),
    )
  })

  it.effect('refuses a starting bookmark for a thread kept in the checkout, before creating anything', () => {
    const recorded: Recorded = { provisions: [], created: [] }
    return run(recorded, ({ threads, store }) =>
      Effect.gen(function* () {
        const { item } = yield* store.capture({ text: 'fix the login flow', actor: user })
        const failure = yield* Effect.flip(threads.start({ ids: [item.id], workspaceId: project.id, isolate: false, base: 'main' }, panel))
        expect(failure._tag).toBe('StartContextInvalid')
        expect(recorded.provisions).toEqual([])
        expect(recorded.created).toEqual([])
      }),
    )
  })
})
