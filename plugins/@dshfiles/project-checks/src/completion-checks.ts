import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { randomUUID } from 'node:crypto'
import { ActionRunner } from './action-runner.js'
import type { CandidateVerificationInput, CandidateVerificationResult } from './api.js'
import type { ProjectChecksVerifiedTurn } from './completion-event.js'
import { ProjectChecksModel, type ProjectAction, type ProjectChecksConfig } from './core.js'
import { ProfileConfigUnavailable, ReceiptStoreUnavailable, SessionPathUnavailable, TaskStoreUnavailable, TurnVerificationBlocked } from './errors.js'
import { ChecksHost, type TurnStopping } from './host-promise.js'
import { ReceiptStore } from './receipt-store.js'
import type { StoredReceipt } from './store.js'

interface CompletionPermit {
  readonly turn: number
  readonly sourceRevision: string
  readonly signal: AbortSignal
  readonly actionIds: ReadonlyArray<string>
}

interface VerifiedCompletion {
  readonly sessionId: string
  readonly turn: number
  readonly sourceRevision: string
}

type CheckError = SessionPathUnavailable | ProfileConfigUnavailable | ReceiptStoreUnavailable | TaskStoreUnavailable

type FailedReceipt = StoredReceipt & { readonly status: 'failed' | 'cancelled' | 'timed-out' }

const isFailed = (receipt: StoredReceipt): receipt is FailedReceipt => receipt.status !== 'passed'

const decodeSessionId = Schema.decodeUnknownEffect(SessionId)

/** Resolves once `signal` aborts; racing a check against it interrupts the check (and its processes). */
const abortOf = (signal: AbortSignal) =>
  Effect.callback<void>(resume => {
    const abort = () => resume(Effect.void)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', abort))
  })

const failurePromptOf = (failed: ReadonlyArray<FailedReceipt>, attempt: number, maxAttempts: number) =>
  ProjectChecksModel.verificationPrompt(
    failed.map(receipt => ({ label: receipt.label, status: receipt.status, exitCode: receipt.exitCode, failure: receipt.failure })),
    attempt,
    maxAttempts,
  )

/**
 * Completion verification: the turn-stopping gate that runs every `verifyBeforeComplete` action against one revision,
 * the permit a verified turn grants jj-integration while `dshfiles/project-checks/verified` dispatches, and the
 * post-rebase rerun of those checks on one exact candidate.
 */
export class CompletionChecks extends Context.Service<
  CompletionChecks,
  {
    readonly isAuthorized: (input: VerifiedCompletion) => Effect.Effect<boolean>
    readonly verifyCandidate: (input: CandidateVerificationInput) => Effect.Effect<CandidateVerificationResult, CheckError>
    readonly verifyTurn: (event: TurnStopping) => Effect.Effect<void, TurnVerificationBlocked | CheckError>
  }
>()('@dshfiles/project-checks/CompletionChecks') {
  static readonly layer = (config: ProjectChecksConfig) =>
    Layer.effect(
      CompletionChecks,
      Effect.gen(function* () {
        const host = yield* ChecksHost
        const runner = yield* ActionRunner
        const receipts = yield* ReceiptStore
        const permits = yield* Ref.make<ReadonlyMap<string, CompletionPermit>>(new Map())

        const permitFor = (sessionId: string) => Effect.map(Ref.get(permits), current => Option.fromUndefinedOr(current.get(sessionId)))

        const isAuthorized = Effect.fn('project-checks completion authorize')(function* (input: VerifiedCompletion) {
          const permit = yield* permitFor(input.sessionId)
          return Option.exists(
            permit,
            current =>
              !current.signal.aborted && current.turn === input.turn && current.sourceRevision === input.sourceRevision && current.actionIds.length > 0,
          )
        })

        const availableIn = (sessionId: string, actions: ReadonlyArray<ProjectAction>) =>
          Effect.forEach(actions, action =>
            runner.paths(sessionId, action).pipe(
              Effect.map(paths => ({ action, cwd: paths.cwd })),
              Effect.option,
            ),
          ).pipe(Effect.map(found => found.flatMap(Option.toArray)))

        const nextAttempt = Effect.fnUntraced(function* (input: {
          readonly sessionId: string
          readonly turn: number
          readonly stage: 'completion' | 'rebase'
        }) {
          const previous = yield* receipts.list(input.sessionId)
          const attempts = previous
            .filter(
              receipt =>
                receipt.automatic &&
                receipt.verificationTurn === input.turn &&
                (input.stage === 'rebase'
                  ? receipt.verificationStage === 'rebase'
                  : receipt.verificationStage === undefined || receipt.verificationStage === 'completion'),
            )
            .map(receipt => receipt.attempt)
          return Math.max(0, ...attempts) + 1
        })

        const verifyCandidate = Effect.fn('project-checks candidate verify')(function* (input: CandidateVerificationInput) {
          if (!(yield* isAuthorized(input))) return { status: 'unavailable', prompt: null } satisfies CandidateVerificationResult
          const current = yield* host.config
          const available = yield* availableIn(
            input.sessionId,
            current.actions.filter(action => action.verifyBeforeComplete),
          )
          const permit = yield* permitFor(input.sessionId)
          if (Option.isNone(permit) || permit.value.actionIds.some(actionId => !available.some(candidate => candidate.action.id === actionId)))
            return {
              status: 'unavailable',
              prompt: 'A completion check is no longer available for this thread directory.',
            } satisfies CandidateVerificationResult
          const firstAvailable = available[0]
          if (firstAvailable === undefined)
            return {
              status: 'unavailable',
              prompt: 'No configured Project Checks are available for this thread directory.',
            } satisfies CandidateVerificationResult

          const currentRevision = yield* runner.sourceRevision(firstAvailable.cwd)
          if (currentRevision === null || currentRevision !== input.expectedRevision)
            return {
              status: 'stale',
              prompt: 'The rebased working copy changed before Project Checks could verify it. The bookmark was not advanced; stop again for verification.',
            } satisfies CandidateVerificationResult

          const attempt = yield* nextAttempt({ sessionId: input.sessionId, turn: input.turn, stage: 'rebase' })
          if (attempt > current.maxVerificationAttempts)
            return {
              status: 'attempt-limit',
              prompt: `Automatic integration stopped after ${current.maxVerificationAttempts} post-rebase verification attempts for this turn. The bookmark was not advanced; review the receipts or retry in a new turn.`,
            } satisfies CandidateVerificationResult

          const results = yield* Effect.forEach(available, ({ action }) =>
            runner.run({
              sessionId: input.sessionId,
              action,
              options: {
                automatic: true,
                attempt,
                verificationTurn: input.turn,
                verificationStage: 'rebase',
                expectedRevision: input.expectedRevision,
                requireRevision: true,
              },
            }),
          )
          const failed = results.filter(isFailed)
          if (failed.length > 0)
            return { status: 'failed', prompt: failurePromptOf(failed, attempt, current.maxVerificationAttempts) } satisfies CandidateVerificationResult

          const finalRevision = yield* runner.sourceRevision(firstAvailable.cwd)
          if (finalRevision !== input.expectedRevision)
            return {
              status: 'stale',
              prompt: 'The rebased working copy changed while Project Checks were running. The bookmark was not advanced; stop again for verification.',
            } satisfies CandidateVerificationResult
          return { status: 'passed', prompt: null } satisfies CandidateVerificationResult
        })

        const announce = Effect.fnUntraced(function* (input: {
          readonly event: TurnStopping
          readonly sessionId: string
          readonly permit: CompletionPermit
          readonly requestAgentFix: (message: string) => void
        }) {
          const verifiedTurn: ProjectChecksVerifiedTurn = {
            sessionId: yield* decodeSessionId(input.sessionId).pipe(Effect.orDie),
            turn: input.event.turn,
            sourceRevision: input.permit.sourceRevision,
            signal: input.event.signal,
            requestAgentFix: input.requestAgentFix,
          }
          yield* Effect.acquireUseRelease(
            Ref.update(permits, current => new Map(current).set(input.sessionId, input.permit)),
            () => host.announceVerified(verifiedTurn),
            () =>
              Ref.update(permits, current => {
                if (current.get(input.sessionId) !== input.permit) return current
                const next = new Map(current)
                next.delete(input.sessionId)
                return next
              }),
          )
        })

        const checkTurn = Effect.fn('project-checks completion verify')(function* (event: TurnStopping) {
          const sessionId = String(event.agent.session.id)
          const available = yield* availableIn(
            sessionId,
            config.actions.filter(action => action.verifyBeforeComplete),
          )
          if (available.length === 0) return
          const attempt = yield* nextAttempt({ sessionId, turn: event.turn, stage: 'completion' })
          if (attempt > config.maxVerificationAttempts) return yield* new TurnVerificationBlocked({ reason: 'attempt-limit' })

          const results = yield* Effect.forEach(available, ({ action }) =>
            runner.run({
              sessionId,
              action,
              options: { automatic: true, attempt, verificationTurn: event.turn, verificationStage: 'completion', requireRevision: true },
            }),
          )
          const failed = results.filter(isFailed)
          const verifiedRevision = results[0]?.sourceRevision ?? null
          const allChecksShareRevision = verifiedRevision !== null && results.every(receipt => receipt.sourceRevision === verifiedRevision)
          const requestAgentFix = (message: string): void => {
            event.agent.steer({
              id: MessageId(randomUUID()),
              role: 'user',
              content: [{ type: 'text', text: message.slice(0, 4_000) }],
              source: { kind: 'dshfiles-project-checks' },
            })
          }

          if (failed.length === 0 && verifiedRevision !== null && allChecksShareRevision) {
            const permit: CompletionPermit = {
              turn: event.turn,
              sourceRevision: verifiedRevision,
              signal: event.signal,
              actionIds: results.map(receipt => receipt.actionId),
            }
            yield* announce({ event, sessionId, permit, requestAgentFix })
            return
          }

          if (attempt < config.maxVerificationAttempts) {
            requestAgentFix(
              failed.length === 0
                ? 'Project checks did not verify one exact working-copy revision. Inspect the work and stop again so every check runs against the same revision.'
                : failurePromptOf(failed, attempt, config.maxVerificationAttempts),
            )
            return
          }
          return yield* new TurnVerificationBlocked({ reason: failed.length === 0 ? 'revision-split' : 'checks-failed' })
        })

        const verifyTurn = (event: TurnStopping) => Effect.raceFirst(checkTurn(event), abortOf(event.signal))

        return CompletionChecks.of({ isAuthorized, verifyCandidate, verifyTurn })
      }),
    )
}
