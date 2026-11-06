import { Effect, Layer, Option, Ref } from 'effect'
import { HostCallFailed, HostCapabilityMissing } from './sidebar-errors.js'
import { SidebarHost, type HostSession } from './sidebar-host-promise.js'

/** The parts of a DSH Host the sidebar reads, as plain values a test changes. */
export interface FakeHost {
  readonly running: Ref.Ref<ReadonlyArray<string>>
  readonly sessions: Ref.Ref<ReadonlyArray<HostSession>>
  /** The exit codes DSH was asked to exit with; the exit hook is a plain callback, so it records synchronously. */
  readonly exits: Effect.Effect<ReadonlyArray<number>>
  readonly recordExit: (code: number) => void
  readonly prompts: Ref.Ref<ReadonlyArray<{ readonly sessionId: string; readonly requestId: string }>>
  readonly persistenceFails: Ref.Ref<boolean>
}

export const makeFakeHost = Effect.all({
  running: Ref.make<ReadonlyArray<string>>([]),
  sessions: Ref.make<ReadonlyArray<HostSession>>([]),
  prompts: Ref.make<ReadonlyArray<{ readonly sessionId: string; readonly requestId: string }>>([]),
  persistenceFails: Ref.make(false),
}).pipe(
  Effect.map(refs => {
    const codes: number[] = []
    return {
      ...refs,
      exits: Effect.sync(() => [...codes]),
      recordExit: (code: number) => {
        codes.push(code)
      },
    }
  }),
)

/** A SidebarHost over a FakeHost; `exitHook: false` stands for a Host where plugins may not exit DSH. */
export const fakeSidebarHost = (fake: FakeHost, options: { readonly exitHook?: boolean } = {}) =>
  Layer.succeed(
    SidebarHost,
    SidebarHost.of({
      runningSessionIds: Ref.get(fake.running),
      sessions: Ref.get(fake.sessions),
      workspaces: Effect.succeed([]),
      archivedSessionIds: Effect.succeed([]),
      pinnedSessionIds: Effect.succeed([]),
      flushPersistence: Effect.flatMap(Ref.get(fake.persistenceFails), fails =>
        fails ? Effect.fail(new HostCallFailed({ operation: 'flush session persistence' })) : Effect.void,
      ),
      queuePrompt: input =>
        Effect.flatMap(Ref.get(fake.running), () =>
          Ref.update(fake.prompts, prompts => [...prompts, { sessionId: input.sessionId, requestId: input.requestId }]),
        ),
      updateQueue: () => Effect.fail(new HostCapabilityMissing({ capability: 'session-controller' })),
      rebasedThreads: Effect.succeedNone,
      appExit: options.exitHook === false ? Option.none() : Option.some(fake.recordExit),
      stopJobs: () => Effect.succeed([]),
    }),
  )
