import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Context, Effect, Layer, Schema } from 'effect'
import { DurableTaskStore } from './durable-task-store.js'
import { durableTaskDomain } from './durable-task-domain.js'
import { ReceiptStoreUnavailable, TaskStoreCorrupted, TaskStoreUnavailable } from './errors.js'
import { ChecksHost } from './host-promise.js'
import { ProjectChecksActivityModel } from './receipt-activity.js'
import { MAX_RECEIPTS_TOTAL, ProjectChecksReceiptModel, projectChecksDomain, storedReceiptSchema, type StoredReceipt } from './store.js'

const decodeReceipts = Schema.decodeUnknownEffect(Schema.Array(storedReceiptSchema))

const MAX_RECEIPTS_PER_SESSION = 30

const byNewest = (left: StoredReceipt, right: StoredReceipt): number => right.finishedAt - left.finishedAt || right.id.localeCompare(left.id)

/**
 * Receipts live in two places: manual and verification runs in the `project_checks` storage domain, durable task
 * attempts beside their task in SQLite. Reads merge both; a receipt is published to the activity timeline once durable.
 */
export class ReceiptStore extends Context.Service<
  ReceiptStore,
  {
    readonly persist: (receipt: StoredReceipt) => Effect.Effect<void, ReceiptStoreUnavailable | TaskStoreUnavailable>
    readonly list: (sessionId: string) => Effect.Effect<ReadonlyArray<StoredReceipt>, ReceiptStoreUnavailable | TaskStoreUnavailable>
    readonly listAfter: (since: number) => Effect.Effect<ReadonlyArray<StoredReceipt>, ReceiptStoreUnavailable | TaskStoreUnavailable>
  }
>()('@dshfiles/project-checks/ReceiptStore') {
  static readonly layer = Layer.effect(
    ReceiptStore,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const tasks = yield* DurableTaskStore
      const host = yield* ChecksHost
      const unavailable = (operation: ReceiptStoreUnavailable['operation']) => (cause: unknown) => new ReceiptStoreUnavailable({ operation, cause })

      const receiptsDomain = yield* storage.open(projectChecksDomain).pipe(Effect.mapError(unavailable('read')), Effect.orDie)
      const legacyTasks = yield* storage.open(durableTaskDomain).pipe(Effect.mapError(unavailable('read')), Effect.orDie)
      const receipts = receiptsDomain.table('receipts')
      const legacyReceipts = yield* receipts.entries.pipe(Effect.orDie)
      yield* tasks
        .importLegacy({
          tasks: (yield* legacyTasks.table('tasks').entries.pipe(Effect.orDie)).map(([, task]) => task),
          receipts: legacyReceipts.map(([, receipt]) => receipt),
        })
        .pipe(Effect.orDie)

      const merged = Effect.fnUntraced(function* (stored: ReadonlyArray<unknown>) {
        const attemptReceipts = yield* decodeReceipts(stored).pipe(Effect.orDie)
        const byId = new Map<string, StoredReceipt>()
        for (const [, receipt] of yield* receipts.entries.pipe(Effect.mapError(unavailable('read')))) byId.set(receipt.id, receipt)
        for (const receipt of attemptReceipts) byId.set(receipt.id, receipt)
        return [...byId.values()]
      })

      const writeDomainReceipt = (receipt: StoredReceipt) =>
        receiptsDomain
          .withWriteLock(
            Effect.gen(function* () {
              yield* receipts.put(ProjectChecksReceiptModel.key(receipt), receipt)
              const removals = ProjectChecksReceiptModel.trimRows(yield* receipts.entries, receipt.sessionId, MAX_RECEIPTS_PER_SESSION, MAX_RECEIPTS_TOTAL)
              yield* Effect.forEach(removals, key => receipts.delete(key), { discard: true })
            }),
          )
          .pipe(Effect.mapError(unavailable('write')))

      const persist = Effect.fn('project-checks receipt persist')(function* (receipt: StoredReceipt) {
        const durable = receipt.taskId !== undefined || receipt.taskAttemptId !== undefined
        if (durable && (receipt.taskId === undefined || receipt.taskAttemptId === undefined))
          return yield* Effect.die(new TaskStoreCorrupted({ reason: 'receipt-identity' }))
        const write: Effect.Effect<void, ReceiptStoreUnavailable | TaskStoreUnavailable> = durable
          ? tasks.saveAttemptReceipt(receipt)
          : writeDomainReceipt(receipt)
        yield* ProjectChecksActivityModel.persistAndEmit({
          receipt,
          persist: write,
          emit: host.emitActivity,
        })
      })

      const list = Effect.fn('project-checks receipts list')(function* (sessionId: string) {
        const all = yield* merged(yield* tasks.listAttemptReceipts({ sessionId, limit: MAX_RECEIPTS_PER_SESSION }))
        return all
          .filter(receipt => receipt.sessionId === sessionId)
          .toSorted(byNewest)
          .slice(0, MAX_RECEIPTS_PER_SESSION)
      })

      const listAfter = Effect.fn('project-checks receipts list after')(function* (since: number) {
        const all = yield* merged(yield* tasks.listAttemptReceipts({ since, limit: MAX_RECEIPTS_TOTAL }))
        return ProjectChecksReceiptModel.after(
          all.map(receipt => [receipt.id, receipt] as const),
          since,
          MAX_RECEIPTS_TOTAL,
        )
      })

      return ReceiptStore.of({ persist, list, listAfter })
    }),
  )
}
