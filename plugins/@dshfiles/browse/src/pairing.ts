import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Deferred, Duration, Effect, FiberHandle, Layer, Option, Schema, Semaphore, Stream, SubscriptionRef } from 'effect'
import { BrowseCli, BrowseCommandFailed, type BrowseNotInstalled } from './browse-cli.js'
import { BrowseOutput, IDLE_PAIRING, type Pairing } from './model.js'

export class BrowsePairingFailed extends Schema.TaggedError<BrowsePairingFailed>()(
  'BrowsePairingFailed',
  { reason: Schema.Literals(['no-code', 'exited']), exitCode: Schema.NullOr(Schema.Number) },
  { dshxWireCode: 'browse-pairing-failed' },
) {
  override get message(): string {
    if (this.reason === 'no-code') return 'browse pair printed no pairing code in time.'
    return `browse pair exited with code ${this.exitCode ?? '?'} before printing a code.`
  }
}

type StartError = BrowseNotInstalled | BrowseCommandFailed | BrowsePairingFailed

/** How long the CLI may take to start its relay and print a code. */
const CODE_TIMEOUT = Duration.seconds(20)
/** `browse pair` caps its wait at 600 s; the code it mints is valid 10 minutes. */
const WAIT_SECONDS = 600
const CODE_LIFETIME_MS = 10 * 60 * 1_000
const RECOVERY = 'Run `browse pair` in a terminal to see why, or check that browse works with `browse status`.'

/**
 * The one `browse pair` the Host runs at a time. Its code is returned as soon as the CLI prints it; the process keeps
 * waiting for the browser, and its outcome (paired, expired, failed) stays readable until the next start.
 */
export class BrowsePairing extends Context.Service<
  BrowsePairing,
  {
    readonly current: Effect.Effect<Pairing>
    readonly start: Effect.Effect<Pairing, StartError>
    readonly cancel: Effect.Effect<Pairing>
  }
>()('@dshfiles/browse/BrowsePairing') {
  static readonly layer = Layer.effect(
    BrowsePairing,
    Effect.gen(function* () {
      const cli = yield* BrowseCli
      const state = yield* SubscriptionRef.make<Pairing>(IDLE_PAIRING)
      const lock = yield* Semaphore.make(1)
      const running = yield* FiberHandle.make<void, never>()

      const end = (outcome: Pick<Pairing, 'state' | 'browser' | 'message'>) =>
        Effect.flatMap(Clock.currentTimeMillis, endedAt =>
          SubscriptionRef.update(state, current => ({ ...current, ...outcome, code: outcome.state === 'paired' ? null : current.code, endedAt })),
        )

      const session = (ready: Deferred.Deferred<Pairing, StartError>) =>
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis
          yield* SubscriptionRef.set(state, { ...IDLE_PAIRING, startedAt })
          const handle = yield* cli.spawn({ verb: 'pair', args: ['pair', '--wait-seconds', String(WAIT_SECONDS)] })
          let pairedBrowser: string | null = null
          let codePrinted = false
          /** The CLI prints its instructions right after the code: answer the caller once both are in. */
          const answer = Effect.andThen(SubscriptionRef.get(state), current => Deferred.succeed(ready, current))
          const onLine = (line: string) =>
            Effect.gen(function* () {
              const code = BrowseOutput.parsePairingCode(line)
              if (Option.isSome(code)) {
                codePrinted = true
                yield* SubscriptionRef.update(state, current => ({
                  ...current,
                  state: 'pending' as const,
                  code: code.value,
                  expiresAt: startedAt + CODE_LIFETIME_MS,
                }))
                return
              }
              const instructions = BrowseOutput.parsePairingInstructions(line)
              if (Option.isSome(instructions)) yield* SubscriptionRef.update(state, current => ({ ...current, instructions: instructions.value }))
              const paired = BrowseOutput.parsePairedLine(line)
              if (Option.isSome(paired)) pairedBrowser = paired.value
              if (codePrinted) yield* answer
            })
          const lines = handle.stdout.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.runForEach(onLine),
            Effect.andThen(Effect.suspend(() => (codePrinted ? answer : Effect.void))),
          )
          const [, exitCode] = yield* Effect.all([lines, handle.exitCode, Stream.runDrain(handle.stderr)], { concurrency: 'unbounded' }).pipe(
            Effect.mapError(cause => new BrowseCommandFailed({ verb: 'pair', reason: 'spawn-failed', exitCode: null, cause })),
          )
          const code = Number(exitCode)
          yield* Effect.annotateCurrentSpan({ 'process.exit.code': code, 'dshx.browse.paired': pairedBrowser !== null })
          if (!codePrinted) {
            yield* end({ state: 'failed', browser: null, message: `browse pair exited with code ${code} before printing a code. ${RECOVERY}` })
            yield* Deferred.fail(ready, new BrowsePairingFailed({ reason: 'exited', exitCode: code }))
            return
          }
          if (code === 0 && pairedBrowser !== null) return yield* end({ state: 'paired', browser: pairedBrowser, message: null })
          if (code === 1)
            return yield* end({
              state: 'expired',
              browser: null,
              message: 'No browser entered the code before it expired. Start a new pairing for a fresh code.',
            })
          yield* end({ state: 'failed', browser: null, message: `browse pair exited with code ${code}. ${RECOVERY}` })
        }).pipe(
          Effect.scoped,
          Effect.catch(error =>
            Effect.andThen(end({ state: 'failed', browser: null, message: `${error.message} ${RECOVERY}` }), Deferred.fail(ready, error).pipe(Effect.asVoid)),
          ),
          Effect.onInterrupt(() =>
            SubscriptionRef.get(state).pipe(
              Effect.flatMap(current =>
                current.state === 'pending' || current.state === 'idle'
                  ? end({ state: 'cancelled', browser: null, message: 'Pairing cancelled. Start a new pairing for a fresh code.' })
                  : Effect.void,
              ),
            ),
          ),
          Effect.withSpan('browse pair', { kind: 'client', attributes: { 'dshx.browse.wait_seconds': WAIT_SECONDS } }),
          DshxPlugin.detached,
        )

      const start = lock
        .withPermit(
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(state)
            if (current.state === 'pending') return current
            const ready = yield* Deferred.make<Pairing, StartError>()
            yield* FiberHandle.run(running, session(ready))
            return yield* Deferred.await(ready).pipe(
              Effect.timeoutOrElse({
                duration: CODE_TIMEOUT,
                orElse: () =>
                  FiberHandle.clear(running).pipe(
                    Effect.andThen(end({ state: 'failed', browser: null, message: `browse pair printed no code within 20 seconds. ${RECOVERY}` })),
                    Effect.andThen(Effect.fail(new BrowsePairingFailed({ reason: 'no-code', exitCode: null }))),
                  ),
              }),
            )
          }),
        )
        .pipe(Effect.withSpan('browse pair start'))

      const cancel = lock.withPermit(Effect.andThen(FiberHandle.clear(running), SubscriptionRef.get(state)))

      return BrowsePairing.of({ current: SubscriptionRef.get(state), start, cancel })
    }),
  )
}
