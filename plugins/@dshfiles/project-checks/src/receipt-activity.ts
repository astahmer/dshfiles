import { Effect, Option, Schema } from 'effect'
import type { StoredReceipt } from './store.js'

const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const revisionSchema = Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/u)))
const remoteIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u))
const remoteFailureCodeSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/u))

/**
 * Reviewed, fixed text per peer failure code. The Activity boundary never carries the stored
 * `remoteFailure.message`, which can quote peer stderr, paths or hostnames.
 */
const safeRemoteFailureMessages = [
  'remote execution failed',
  'no configured remote was available',
  'the working-copy snapshot was unavailable',
  'the snapshot could not be pushed',
  'the remote was unreachable',
  'the remote run timed out',
  'the remote could not fetch the snapshot',
  'the remote could not check out the snapshot',
  'the remote checked out a different revision',
  'remote dependency install failed',
  'the remote working copy moved during the run',
  'the remote run was cancelled',
] as const

type SafeRemoteFailureMessage = (typeof safeRemoteFailureMessages)[number]

const remoteFailureText = new Map<string, SafeRemoteFailureMessage>([
  ['peer-unavailable', 'no configured remote was available'],
  ['peer-snapshot-unavailable', 'the working-copy snapshot was unavailable'],
  ['peer-push-failed', 'the snapshot could not be pushed'],
  ['peer-unreachable', 'the remote was unreachable'],
  ['peer-timeout', 'the remote run timed out'],
  ['peer-fetch-failed', 'the remote could not fetch the snapshot'],
  ['peer-edit-failed', 'the remote could not check out the snapshot'],
  ['peer-revision-mismatch', 'the remote checked out a different revision'],
  ['peer-install-failed', 'remote dependency install failed'],
  ['peer-source-changed', 'the remote working copy moved during the run'],
  ['peer-cancelled', 'the remote run was cancelled'],
])

const safeRemoteFailureMessage = (code: string): SafeRemoteFailureMessage => remoteFailureText.get(code) ?? 'remote execution failed'

/**
 * v1 executor as the Activity consumer validates it. Activity Timeline's v1 schema still requires
 * `sshTarget` and `workspace` keys on a remote executor, so the producer sends them as empty
 * strings: the literal `''` makes any real peer value fail to encode instead of leaking.
 */
const activityExecutorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({ kind: Schema.Literal('remote'), remoteId: remoteIdSchema, sshTarget: Schema.Literal(''), workspace: Schema.Literal('') }),
])

const activityRemoteFailureSchema = Schema.Struct({
  remoteId: remoteIdSchema,
  code: remoteFailureCodeSchema,
  message: Schema.Literals(safeRemoteFailureMessages),
})

const projectChecksActivitySummarySchema = Schema.Struct({
  receiptId: Schema.String.check(Schema.isUUID()),
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  actionId: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u)),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80), Schema.isPattern(/^[^\p{Cc}]+$/u)),
  status: Schema.Literals(['passed', 'failed', 'cancelled', 'timed-out']),
  failure: Schema.NullOr(
    Schema.Literals(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed', 'remote-unavailable', 'remote-failed']),
  ),
  executor: Schema.optionalKey(activityExecutorSchema),
  remoteFailure: Schema.optionalKey(Schema.NullOr(activityRemoteFailureSchema)),
  startedAt: countInt,
  finishedAt: countInt,
  durationMs: countInt,
  exitCode: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  automatic: Schema.Boolean,
  verificationTurn: Schema.NullOr(countInt),
  attempt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)),
  sourceRevisionBefore: revisionSchema,
  sourceRevisionAfter: revisionSchema,
})

export const projectChecksActivityEventSchema = Schema.Struct({
  kind: Schema.Literal('verification-receipt'),
  version: Schema.Literal(1),
  value: projectChecksActivitySummarySchema,
})

export type ProjectChecksActivityEvent = typeof projectChecksActivityEventSchema.Type

const activityEventInput = (receipt: StoredReceipt) => {
  const summaryExtras: { -readonly [Key in keyof ProjectChecksActivityEvent['value']]?: ProjectChecksActivityEvent['value'][Key] } = {}
  if (receipt.executor !== undefined)
    summaryExtras.executor =
      receipt.executor.kind === 'local' ? { kind: 'local' } : { kind: 'remote', remoteId: receipt.executor.remoteId, sshTarget: '', workspace: '' }
  if (receipt.remoteFailure !== undefined)
    summaryExtras.remoteFailure =
      receipt.remoteFailure === null
        ? null
        : {
            remoteId: receipt.remoteFailure.remoteId,
            code: receipt.remoteFailure.code,
            message: safeRemoteFailureMessage(receipt.remoteFailure.code),
          }
  return {
    kind: 'verification-receipt',
    version: 1,
    value: {
      receiptId: receipt.id,
      sessionId: receipt.sessionId,
      actionId: receipt.actionId,
      label:
        receipt.label
          .replace(/\p{Cc}/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80) || receipt.actionId,
      status: receipt.status,
      failure: receipt.failure,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      durationMs: receipt.durationMs,
      exitCode: receipt.exitCode,
      automatic: receipt.automatic,
      verificationTurn: receipt.verificationTurn,
      attempt: receipt.attempt,
      sourceRevisionBefore: receipt.sourceRevisionBefore ?? null,
      sourceRevisionAfter: receipt.sourceRevisionAfter === undefined ? receipt.sourceRevision : receipt.sourceRevisionAfter,
      ...summaryExtras,
    },
  }
}

const projectChecksActivityEvent = (receipt: StoredReceipt): ProjectChecksActivityEvent =>
  Schema.decodeUnknownSync(projectChecksActivityEventSchema)(activityEventInput(receipt))

const activityEventOf = (receipt: StoredReceipt): Option.Option<ProjectChecksActivityEvent> =>
  Schema.decodeUnknownOption(projectChecksActivityEventSchema)(activityEventInput(receipt))

/** Publish a receipt only after it is durable; a receipt the timeline cannot summarize is not published. */
const persistReceiptAndEmitActivity = <E, R>(input: {
  readonly receipt: StoredReceipt
  readonly persist: Effect.Effect<void, E, R>
  readonly emit: (event: ProjectChecksActivityEvent) => Effect.Effect<void>
}): Effect.Effect<void, E, R> => Effect.andThen(input.persist, publishActivity(input))

const publishActivity = (input: { readonly receipt: StoredReceipt; readonly emit: (event: ProjectChecksActivityEvent) => Effect.Effect<void> }) =>
  Effect.suspend(() => Option.match(activityEventOf(input.receipt), { onNone: () => Effect.void, onSome: input.emit }))

export class ProjectChecksActivityModel {
  static readonly event = projectChecksActivityEvent
  static readonly publish = publishActivity
  static readonly persistAndEmit = persistReceiptAndEmitActivity
}
