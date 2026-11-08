import { SqliteStore } from '@dshfiles/sqlite-store'
import { Context, Effect, Exit, FileSystem, Layer, Option, Path, Predicate, Schedule, Schema, Scope } from 'effect'
import { flow } from 'effect/Function'
import { Reactivity } from 'effect/reactivity'
import { SqlClient, SqlError } from 'effect/sql'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { IdempotencyKeyConflict, TaskHistoryFull, TaskNotFound, TaskStoreCorrupted, TaskStoreUnavailable } from './errors.ts'
import { durableTaskSchema, type DurableTask } from './durable-tasks.ts'
import type { StoredReceipt } from './store.ts'

const MAX_TASK_ROWS = 1_000
const SQLITE_BUSY = 5
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const BUSY_RETRY = Schedule.spaced('20 millis').pipe(Schedule.upTo({ duration: '10 seconds' }))
const CLAIM_RETRY = Schedule.spaced('50 millis')

export interface LegacyDurableTaskData {
  readonly tasks: ReadonlyArray<DurableTask>
  readonly receipts: ReadonlyArray<StoredReceipt>
}

const decodeTaskJson = Schema.decodeUnknownEffect(Schema.fromJsonString(durableTaskSchema))
const decodeReceiptJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const encodeTask = Schema.encodeEffect(Schema.fromJsonString(durableTaskSchema))
const encodeReceipt = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const validTask = Schema.decodeUnknownEffect(durableTaskSchema)

const PayloadRow = Schema.Struct({ payload: Schema.String })
const TaskKeyRow = Schema.Struct({ task_id: Schema.String, action_id: Schema.String, action_fingerprint: Schema.String })
const CountRow = Schema.Struct({ count: Schema.Number })
const TaskIdRow = Schema.Struct({ task_id: Schema.String })
const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))
// Only a row that fails its schema is a defect; a busy statement must stay a failure the lock retry can see.
const decodeRowsOrDie = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) => flow(decodeRows(schema), Effect.orDie)

/** Walks a wrapped failure chain for SQLite's busy/locked signal. */
const isLockTimeout = (error: unknown): boolean => {
  if (SqlError.isSqlError(error)) return error.reason._tag === 'LockTimeoutError'
  if (Predicate.hasProperty(error, 'cause') && error.cause !== error) return isLockTimeout(error.cause)
  return false
}

const isSqliteBusy = (error: unknown): boolean => Predicate.hasProperty(error, 'errcode') && error.errcode === SQLITE_BUSY

const migrations = {
  '0001_init': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql.unsafe(`
      CREATE TABLE task_keys (
        session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        task_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        action_fingerprint TEXT NOT NULL,
        PRIMARY KEY (session_id, idempotency_key),
        UNIQUE (task_id)
      ) STRICT`)
    yield* sql.unsafe(`
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload))
      ) STRICT`)
    yield* sql.unsafe('CREATE INDEX tasks_session_created ON tasks (session_id, created_at DESC, task_id)')
    yield* sql.unsafe(`
      CREATE TABLE attempt_receipts (
        task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        finished_at INTEGER NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        PRIMARY KEY (task_id, attempt_id)
      ) STRICT`)
    yield* sql.unsafe('CREATE INDEX attempt_receipts_session_finished ON attempt_receipts (session_id, finished_at DESC)')
  }),
}

/** The private Project Checks data directory: created `0700`, refused when it or its files are symlinks. */
export class TaskStoreRoot extends Context.Service<TaskStoreRoot, { readonly directory: string }>()('@dshfiles/project-checks/TaskStoreRoot') {
  static readonly layer = (directory: string) => Layer.succeed(TaskStoreRoot, TaskStoreRoot.of({ directory }))
  /** `$DSH_HOME/plugins/project-checks`, read when the plugin activates. */
  static readonly fromDshHome = Layer.effect(
    TaskStoreRoot,
    Effect.gen(function* () {
      const path = yield* Path.Path
      const home = process.env['DSH_HOME']?.trim() || path.join(homedir(), '.dsh')
      return TaskStoreRoot.of({ directory: path.join(path.resolve(home), 'plugins', 'project-checks') })
    }),
  )
}

class TaskDb extends Context.Service<TaskDb, SqlClient.SqlClient>()('@dshfiles/project-checks/TaskDb') {}

const refuseSymlink = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, path: string) {
  if (Option.isSome(yield* Effect.option(fs.readLink(path)))) return yield* Effect.die(new TaskStoreCorrupted({ reason: 'symlink-path' }))
})

const prepareDirectory = Effect.fn('project-checks store prepare')(function* (directory: string, files: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  yield* refuseSymlink(fs, directory)
  if ((yield* fs.stat(directory)).type !== 'Directory') return yield* Effect.die(new TaskStoreCorrupted({ reason: 'not-directory' }))
  yield* fs.chmod(directory, PRIVATE_DIRECTORY_MODE)
  for (const file of files) {
    if (!(yield* fs.exists(file))) continue
    yield* refuseSymlink(fs, file)
    if ((yield* fs.stat(file)).type !== 'File') return yield* Effect.die(new TaskStoreCorrupted({ reason: 'not-file' }))
    yield* fs.chmod(file, PRIVATE_FILE_MODE)
  }
})

/** Opens the task database, retrying while another Host holds its write lock during migration. */
const taskDbLayer = Layer.effect(
  TaskDb,
  Effect.gen(function* () {
    const root = yield* TaskStoreRoot
    const path = yield* Path.Path
    const filename = path.join(root.directory, 'durable-tasks.sqlite')
    yield* prepareDirectory(root.directory, [filename, path.join(root.directory, 'worker-claim.sqlite')]).pipe(Effect.orDie)
    const layerScope = yield* Scope.Scope
    const attempt = Effect.gen(function* () {
      const scope = yield* Scope.fork(layerScope)
      return yield* SqliteStore.make({
        filename,
        migrations,
        legacyUserVersion: 1,
        pragmas: { journalMode: 'delete', foreignKeys: true, busyTimeout: 0 },
      }).pipe(
        Scope.provide(scope),
        Effect.onError(exit => Scope.close(scope, Exit.failCause(exit))),
      )
    })
    return yield* attempt.pipe(Effect.retry({ while: isLockTimeout, schedule: BUSY_RETRY }), Effect.provide(Reactivity.layer), Effect.orDie)
  }),
)

/**
 * Durable task rows and attempt receipts in one SQLite file. The file is opened with no busy timeout so a lock held
 * by another Host never blocks the event loop; each statement retries asynchronously for up to 10 seconds instead.
 */
export class DurableTaskStore extends Context.Service<
  DurableTaskStore,
  {
    readonly importLegacy: (data: LegacyDurableTaskData) => Effect.Effect<void, TaskStoreUnavailable>
    readonly get: (taskId: string) => Effect.Effect<Option.Option<DurableTask>, TaskStoreUnavailable>
    readonly all: Effect.Effect<ReadonlyArray<DurableTask>, TaskStoreUnavailable>
    /** The newest `limit` tasks of one session, read through `tasks_session_created` instead of scanning every task. */
    readonly listForSession: (input: { readonly sessionId: string; readonly limit: number }) => Effect.Effect<ReadonlyArray<DurableTask>, TaskStoreUnavailable>
    readonly createIfAbsent: (input: {
      readonly task: DurableTask
      readonly maxRows?: number
    }) => Effect.Effect<DurableTask, TaskStoreUnavailable | IdempotencyKeyConflict | TaskHistoryFull>
    readonly update: (taskId: string, update: (current: DurableTask) => DurableTask) => Effect.Effect<DurableTask, TaskStoreUnavailable | TaskNotFound>
    readonly saveAttemptReceipt: (receipt: StoredReceipt) => Effect.Effect<void, TaskStoreUnavailable>
    /** Attempt receipts come back as stored JSON; the receipt owner decodes them. */
    readonly findAttemptReceipt: (taskId: string, attemptId: string) => Effect.Effect<Option.Option<unknown>, TaskStoreUnavailable>
    readonly listAttemptReceipts: (input: {
      readonly sessionId?: string
      readonly since?: number
      readonly limit?: number
    }) => Effect.Effect<ReadonlyArray<unknown>, TaskStoreUnavailable>
    /** Hold the cross-process worker claim for the current Scope, waiting while another Host holds it. */
    readonly claimWorker: Effect.Effect<void, TaskStoreUnavailable, Scope.Scope>
  }
>()('@dshfiles/project-checks/DurableTaskStore') {
  static readonly layer = Layer.effect(
    DurableTaskStore,
    Effect.gen(function* () {
      const sql = yield* TaskDb
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* TaskStoreRoot
      const claimPath = path.join(root.directory, 'worker-claim.sqlite')

      const statement =
        (operation: string) =>
        <A, E, R>(effect: Effect.Effect<A, E | SqlError.SqlError, R>) =>
          effect.pipe(
            Effect.retry({ while: isLockTimeout, schedule: BUSY_RETRY }),
            Effect.catchIf(SqlError.isSqlError, cause => Effect.fail(new TaskStoreUnavailable({ operation, busy: isLockTimeout(cause), cause }))),
          )
      const transaction =
        (operation: string) =>
        <A, E, R>(effect: Effect.Effect<A, E | SqlError.SqlError, R>) =>
          statement(operation)(sql.withTransaction(effect))

      const readTask = (taskId: string) =>
        sql`SELECT payload FROM tasks WHERE task_id = ${taskId}`.pipe(
          Effect.flatMap(decodeRowsOrDie(PayloadRow)),
          Effect.flatMap(rows => (rows[0] === undefined ? Effect.succeedNone : Effect.asSome(decodeTaskJson(rows[0].payload).pipe(Effect.orDie)))),
        )

      const writeTask = Effect.fnUntraced(function* (task: DurableTask) {
        const payload = yield* encodeTask(task).pipe(Effect.orDie)
        yield* sql`UPDATE tasks SET session_id = ${task.sessionId}, status = ${task.status}, created_at = ${task.createdAt}, updated_at = ${task.updatedAt}, payload = ${payload} WHERE task_id = ${task.id}`
      })

      const insertTask = Effect.fnUntraced(function* (task: DurableTask) {
        const payload = yield* encodeTask(task).pipe(Effect.orDie)
        yield* sql`INSERT INTO tasks (task_id, session_id, status, created_at, updated_at, payload) VALUES (${task.id}, ${task.sessionId}, ${task.status}, ${task.createdAt}, ${task.updatedAt}, ${payload})`
      })

      const importLegacy = Effect.fn('project-checks tasks import legacy')(function* (data: LegacyDurableTaskData) {
        yield* transaction('import-legacy')(
          Effect.gen(function* () {
            for (const saved of data.tasks) {
              const task = yield* validTask(saved).pipe(Effect.orDie)
              const keys =
                yield* sql`INSERT OR IGNORE INTO task_keys (session_id, idempotency_key, task_id, action_id, action_fingerprint) VALUES (${task.sessionId}, ${task.idempotencyKey}, ${task.id}, ${task.actionId}, ${task.actionFingerprint}) RETURNING task_id`
              if (keys.length !== 1) continue
              yield* insertTask(task)
            }
            for (const receipt of data.receipts) {
              if (receipt.taskId === undefined || receipt.taskAttemptId === undefined) continue
              if (Option.isNone(yield* readTask(receipt.taskId))) continue
              const payload = yield* encodeReceipt(receipt).pipe(Effect.orDie)
              yield* sql`INSERT OR IGNORE INTO attempt_receipts (task_id, attempt_id, session_id, finished_at, payload) VALUES (${receipt.taskId}, ${receipt.taskAttemptId}, ${receipt.sessionId}, ${receipt.finishedAt}, ${payload})`
            }
          }),
        )
      })

      const get = Effect.fn('project-checks task get')((taskId: string) => statement('get')(readTask(taskId)))

      const all = statement('list')(
        sql`SELECT payload FROM tasks ORDER BY created_at, task_id`.pipe(
          Effect.flatMap(decodeRowsOrDie(PayloadRow)),
          Effect.flatMap(rows => Effect.forEach(rows, row => decodeTaskJson(row.payload).pipe(Effect.orDie))),
        ),
      )

      const listForSession = Effect.fn('project-checks task list session')(function* (input: { readonly sessionId: string; readonly limit: number }) {
        const limit = Math.max(1, Math.min(MAX_TASK_ROWS, Math.trunc(input.limit)))
        const rows = yield* statement('list')(
          sql`SELECT payload FROM tasks WHERE session_id = ${input.sessionId} ORDER BY created_at DESC, task_id LIMIT ${limit}`.pipe(
            Effect.flatMap(decodeRowsOrDie(PayloadRow)),
          ),
        )
        return yield* Effect.forEach(rows, row => decodeTaskJson(row.payload).pipe(Effect.orDie))
      })

      const createIfAbsent = Effect.fn('project-checks task create')(function* (input: { readonly task: DurableTask; readonly maxRows?: number }) {
        const task = input.task
        const limit = Math.min(MAX_TASK_ROWS, Math.max(1, Math.trunc(input.maxRows ?? MAX_TASK_ROWS)))
        return yield* transaction('create')(
          Effect.gen(function* () {
            const keys =
              yield* sql`SELECT task_id, action_id, action_fingerprint FROM task_keys WHERE session_id = ${task.sessionId} AND idempotency_key = ${task.idempotencyKey}`.pipe(
                Effect.flatMap(decodeRowsOrDie(TaskKeyRow)),
              )
            const existingKey = keys[0]
            if (existingKey !== undefined) {
              if (existingKey.task_id !== task.id) return yield* new IdempotencyKeyConflict({ reason: 'other-task' })
              if (existingKey.action_id !== task.actionId || existingKey.action_fingerprint !== task.actionFingerprint)
                return yield* new IdempotencyKeyConflict({ reason: 'other-action' })
              const existing = yield* readTask(existingKey.task_id)
              if (Option.isNone(existing)) return yield* new IdempotencyKeyConflict({ reason: 'expired' })
              return existing.value
            }
            const count = (yield* sql`SELECT COUNT(*) AS count FROM tasks`.pipe(Effect.flatMap(decodeRowsOrDie(CountRow))))[0]?.count ?? 0
            if (count >= limit) {
              const removable =
                yield* sql`SELECT task_id FROM tasks WHERE status IN ('succeeded', 'failed', 'cancelled', 'timed-out') ORDER BY updated_at, task_id`.pipe(
                  Effect.flatMap(decodeRowsOrDie(TaskIdRow)),
                )
              const toRemove = removable.slice(0, count - limit + 1)
              if (count - toRemove.length >= limit) return yield* new TaskHistoryFull({ limit })
              for (const row of toRemove) yield* sql`DELETE FROM tasks WHERE task_id = ${row.task_id}`
            }
            yield* sql`INSERT INTO task_keys (session_id, idempotency_key, task_id, action_id, action_fingerprint) VALUES (${task.sessionId}, ${task.idempotencyKey}, ${task.id}, ${task.actionId}, ${task.actionFingerprint})`
            yield* insertTask(task)
            return task
          }),
        )
      })

      const update = Effect.fn('project-checks task update')(function* (taskId: string, change: (current: DurableTask) => DurableTask) {
        return yield* transaction('update')(
          Effect.gen(function* () {
            const current = yield* readTask(taskId)
            if (Option.isNone(current)) return yield* new TaskNotFound({ taskId })
            const next = yield* validTask(change(current.value)).pipe(Effect.orDie)
            if (next.id !== taskId) return yield* Effect.die(new TaskStoreCorrupted({ reason: 'key-mismatch' }))
            yield* writeTask(next)
            return next
          }),
        )
      })

      const saveAttemptReceipt = Effect.fn('project-checks attempt receipt save')(function* (receipt: StoredReceipt) {
        const taskId = receipt.taskId
        const attemptId = receipt.taskAttemptId
        if (taskId === undefined || attemptId === undefined) return yield* Effect.die(new TaskStoreCorrupted({ reason: 'receipt-identity' }))
        const payload = yield* encodeReceipt(receipt).pipe(Effect.orDie)
        yield* transaction('save-receipt')(
          Effect.gen(function* () {
            const task = yield* readTask(taskId)
            if (Option.isNone(task) || task.value.sessionId !== receipt.sessionId || !task.value.attempts.some(attempt => attempt.id === attemptId))
              return yield* Effect.die(new TaskStoreCorrupted({ reason: 'receipt-mismatch' }))
            yield* sql`INSERT OR IGNORE INTO attempt_receipts (task_id, attempt_id, session_id, finished_at, payload) VALUES (${taskId}, ${attemptId}, ${receipt.sessionId}, ${receipt.finishedAt}, ${payload})`
            const existing = yield* sql`SELECT payload FROM attempt_receipts WHERE task_id = ${taskId} AND attempt_id = ${attemptId}`.pipe(
              Effect.flatMap(decodeRowsOrDie(PayloadRow)),
            )
            if (existing[0]?.payload !== payload) return yield* Effect.die(new TaskStoreCorrupted({ reason: 'receipt-conflict' }))
          }),
        )
      })

      const findAttemptReceipt = Effect.fn('project-checks attempt receipt find')((taskId: string, attemptId: string) =>
        statement('find-receipt')(
          sql`SELECT payload FROM attempt_receipts WHERE task_id = ${taskId} AND attempt_id = ${attemptId}`.pipe(
            Effect.flatMap(decodeRowsOrDie(PayloadRow)),
            Effect.flatMap(rows => (rows[0] === undefined ? Effect.succeedNone : Effect.asSome(decodeReceiptJson(rows[0].payload).pipe(Effect.orDie)))),
          ),
        ),
      )

      const listAttemptReceipts = Effect.fn('project-checks attempt receipts list')(function* (input: {
        readonly sessionId?: string
        readonly since?: number
        readonly limit?: number
      }) {
        const since = Math.max(0, Math.trunc(input.since ?? 0))
        const limit = Math.max(0, Math.min(2_000, Math.trunc(input.limit ?? 2_000)))
        if (limit === 0) return []
        const rows = yield* statement('list-receipts')(
          (input.sessionId === undefined
            ? sql`SELECT payload FROM attempt_receipts WHERE finished_at > ${since} ORDER BY finished_at DESC, task_id, attempt_id LIMIT ${limit}`
            : sql`SELECT payload FROM attempt_receipts WHERE session_id = ${input.sessionId} AND finished_at > ${since} ORDER BY finished_at DESC, task_id, attempt_id LIMIT ${limit}`
          ).pipe(Effect.flatMap(decodeRowsOrDie(PayloadRow))),
        )
        return yield* Effect.forEach(rows, row => decodeReceiptJson(row.payload).pipe(Effect.orDie))
      })

      const claimWorker = Effect.gen(function* () {
        const claim = yield* Effect.acquireRelease(
          Effect.try({
            try: () => new DatabaseSync(claimPath, { timeout: 0 }),
            catch: cause => new TaskStoreUnavailable({ operation: 'claim-open', busy: false, cause }),
          }),
          opened =>
            Effect.sync(() => {
              if (opened.isTransaction) opened.exec('ROLLBACK')
              opened.close()
            }),
        )
        yield* fs.chmod(claimPath, PRIVATE_FILE_MODE).pipe(Effect.ignore)
        yield* Effect.try({
          try: () => claim.exec('BEGIN IMMEDIATE'),
          catch: cause => new TaskStoreUnavailable({ operation: 'claim', busy: isSqliteBusy(cause), cause }),
        }).pipe(Effect.retry({ while: error => error.busy, schedule: CLAIM_RETRY }))
      }).pipe(Effect.withSpan('project-checks worker claim'))

      return DurableTaskStore.of({
        importLegacy,
        get,
        all,
        listForSession,
        createIfAbsent,
        update,
        saveAttemptReceipt,
        findAttemptReceipt,
        listAttemptReceipts,
        claimWorker,
      })
    }),
  ).pipe(Layer.provide(taskDbLayer))
}
