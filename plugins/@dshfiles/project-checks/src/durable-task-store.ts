import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { durableTaskSchema, type DurableTask } from './durable-tasks.ts'
import type { StoredReceipt } from './store.ts'

const MAX_TASK_ROWS = 1_000
const SQLITE_BUSY = 5

export interface LegacyDurableTaskData {
  readonly tasks: readonly DurableTask[]
  readonly receipts: readonly StoredReceipt[]
}

export interface DurableTaskStoreOptions {
  readonly root?: string
  readonly busyTimeoutMs?: number
}

export interface DurableTaskTable {
  get(taskId: string): DurableTask | undefined
  entries(): IterableIterator<[string, DurableTask]>
  keys(): IterableIterator<string>
  readonly size: number
  createIfAbsent(task: DurableTask, maxRows: number): Promise<DurableTask>
  put(taskId: string, task: DurableTask): Promise<void>
  update(taskId: string, update: (current: DurableTask) => DurableTask): Promise<DurableTask>
  delete(taskId: string): Promise<boolean>
}

export interface DurableTaskExecutionStore extends DurableTaskTable {
  withWorkerClaim<Result>(signal: AbortSignal, work: () => Promise<Result>): Promise<Result>
}

const defaultRoot = (): string => join(resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')), 'plugins', 'project-checks')

const isSqliteBusy = (error: unknown): boolean => error instanceof Error && 'errcode' in error && error.errcode === SQLITE_BUSY

const secureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const facts = await lstat(path)
  if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error('Project Checks data path must be a directory.')
  await chmod(path, 0o700)
}

const secureDatabaseFile = async (path: string): Promise<void> => {
  try {
    const facts = await lstat(path)
    if (!facts.isFile() || facts.isSymbolicLink()) throw new Error('Project Checks database path must be a regular file.')
    await chmod(path, 0o600)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

const parsedTask = (value: unknown): DurableTask => durableTaskSchema.parse(JSON.parse(String(value)))
const serializedTask = (task: DurableTask): string => JSON.stringify(durableTaskSchema.parse(task))
const parsedReceipt = (value: unknown): unknown => JSON.parse(String(value))
const serializedReceipt = (receipt: StoredReceipt): string => JSON.stringify(receipt)

export class DurableTaskStore implements DurableTaskExecutionStore {
  readonly #database: DatabaseSync
  readonly #claimPath: string
  readonly #busyTimeoutMs: number
  #closed = false

  private constructor(root: string, busyTimeoutMs: number) {
    this.#busyTimeoutMs = busyTimeoutMs
    this.#database = new DatabaseSync(join(root, 'durable-tasks.sqlite'), { timeout: 0 })
    this.#claimPath = join(root, 'worker-claim.sqlite')
    this.#database.exec('PRAGMA foreign_keys = ON')
  }

  static async open(options: DurableTaskStoreOptions = {}): Promise<DurableTaskStore> {
    const root = resolve(options.root ?? defaultRoot())
    await secureDirectory(root)
    const databasePath = join(root, 'durable-tasks.sqlite')
    const claimPath = join(root, 'worker-claim.sqlite')
    await secureDatabaseFile(databasePath)
    await secureDatabaseFile(claimPath)
    const store = new DurableTaskStore(root, options.busyTimeoutMs ?? 10_000)
    try {
      await store.#initialize()
      await secureDatabaseFile(databasePath)
      return store
    } catch (error) {
      store.close()
      throw error
    }
  }

  async importLegacy(data: LegacyDurableTaskData): Promise<void> {
    this.#assertOpen()
    await this.#transaction(() => {
      const putTaskKey = this.#database.prepare(
        'INSERT OR IGNORE INTO task_keys (session_id, idempotency_key, task_id, action_id, action_fingerprint) VALUES (?, ?, ?, ?, ?)',
      )
      const putTask = this.#database.prepare('INSERT INTO tasks (task_id, session_id, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)')
      for (const saved of data.tasks) {
        const task = durableTaskSchema.parse(saved)
        const inserted = putTaskKey.run(task.sessionId, task.idempotencyKey, task.id, task.actionId, task.actionFingerprint)
        if (inserted.changes !== 1) continue
        putTask.run(task.id, task.sessionId, task.status, task.createdAt, task.updatedAt, serializedTask(task))
      }
      const putReceipt = this.#database.prepare(
        'INSERT OR IGNORE INTO attempt_receipts (task_id, attempt_id, session_id, finished_at, payload) VALUES (?, ?, ?, ?, ?)',
      )
      for (const receipt of data.receipts) {
        if (receipt.taskId === undefined || receipt.taskAttemptId === undefined) continue
        const exists = this.#database.prepare('SELECT 1 AS found FROM tasks WHERE task_id = ?').get(receipt.taskId)
        if (exists === undefined) continue
        putReceipt.run(receipt.taskId, receipt.taskAttemptId, receipt.sessionId, receipt.finishedAt, serializedReceipt(receipt))
      }
    })
  }

  get(taskId: string): DurableTask | undefined {
    this.#assertOpen()
    const row = this.#database.prepare('SELECT payload FROM tasks WHERE task_id = ?').get(taskId) as { payload: string } | undefined
    return row === undefined ? undefined : parsedTask(row.payload)
  }

  entries(): IterableIterator<[string, DurableTask]> {
    this.#assertOpen()
    const rows = this.#database.prepare('SELECT task_id, payload FROM tasks ORDER BY created_at, task_id').all() as { task_id: string; payload: string }[]
    return rows.map(row => [row.task_id, parsedTask(row.payload)] as [string, DurableTask]).values()
  }

  keys(): IterableIterator<string> {
    this.#assertOpen()
    const rows = this.#database.prepare('SELECT task_id FROM tasks ORDER BY task_id').all() as { task_id: string }[]
    return rows.map(row => row.task_id).values()
  }

  get size(): number {
    this.#assertOpen()
    const row = this.#database.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }
    return row.count
  }

  async createIfAbsent(task: DurableTask, maxRows: number): Promise<DurableTask> {
    this.#assertOpen()
    return this.#transaction(() => {
      const parsed = durableTaskSchema.parse(task)
      const existingKey = this.#database
        .prepare('SELECT task_id, action_id, action_fingerprint FROM task_keys WHERE session_id = ? AND idempotency_key = ?')
        .get(parsed.sessionId, parsed.idempotencyKey) as { task_id: string; action_id: string; action_fingerprint: string } | undefined
      if (existingKey !== undefined) {
        if (existingKey.task_id !== parsed.id) throw new Error('That idempotency key resolves to a different Project Checks task identity.')
        if (existingKey.action_id !== parsed.actionId || existingKey.action_fingerprint !== parsed.actionFingerprint)
          throw new Error('That idempotency key is already bound to a different Project Checks action.')
        const existingTask = this.get(existingKey.task_id)
        if (existingTask === undefined) throw new Error('That idempotency key was already used; its task history has expired.')
        return existingTask
      }

      const count = this.size
      if (count >= Math.min(MAX_TASK_ROWS, Math.max(1, Math.trunc(maxRows)))) {
        const removable = this.#database
          .prepare("SELECT task_id FROM tasks WHERE status IN ('succeeded', 'failed', 'cancelled', 'timed-out') ORDER BY updated_at, task_id")
          .all() as { task_id: string }[]
        const remove = this.#database.prepare('DELETE FROM tasks WHERE task_id = ?')
        let remaining = count
        for (const row of removable) {
          if (remaining < Math.min(MAX_TASK_ROWS, Math.max(1, Math.trunc(maxRows)))) break
          remove.run(row.task_id)
          remaining -= 1
        }
        if (remaining >= Math.min(MAX_TASK_ROWS, Math.max(1, Math.trunc(maxRows))))
          throw new Error('Durable Project Checks task history is full; resolve pending/unknown work before dispatching more.')
      }

      this.#database
        .prepare('INSERT INTO task_keys (session_id, idempotency_key, task_id, action_id, action_fingerprint) VALUES (?, ?, ?, ?, ?)')
        .run(parsed.sessionId, parsed.idempotencyKey, parsed.id, parsed.actionId, parsed.actionFingerprint)
      this.#insert(parsed)
      return parsed
    })
  }

  async put(taskId: string, task: DurableTask): Promise<void> {
    this.#assertOpen()
    await this.#transaction(() => this.#put(taskId, durableTaskSchema.parse(task)))
  }

  async update(taskId: string, update: (current: DurableTask) => DurableTask): Promise<DurableTask> {
    this.#assertOpen()
    return this.#transaction(() => {
      const current = this.get(taskId)
      if (current === undefined) throw new Error('Durable Project Checks task is missing.')
      const next = durableTaskSchema.parse(update(current))
      this.#put(taskId, next)
      return next
    })
  }

  async delete(taskId: string): Promise<boolean> {
    this.#assertOpen()
    return this.#transaction(() => this.#database.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId).changes > 0)
  }

  async saveAttemptReceipt(receiptInput: StoredReceipt): Promise<void> {
    this.#assertOpen()
    if (receiptInput.taskId === undefined || receiptInput.taskAttemptId === undefined) throw new Error('A durable attempt receipt needs both task identities.')
    const taskId = receiptInput.taskId
    const attemptId = receiptInput.taskAttemptId
    await this.#transaction(() => {
      const task = this.get(taskId)
      if (task === undefined || task.sessionId !== receiptInput.sessionId || !task.attempts.some(attempt => attempt.id === attemptId))
        throw new Error('A durable attempt receipt does not match a persisted task attempt.')
      const payload = serializedReceipt(receiptInput)
      this.#database
        .prepare('INSERT OR IGNORE INTO attempt_receipts (task_id, attempt_id, session_id, finished_at, payload) VALUES (?, ?, ?, ?, ?)')
        .run(taskId, attemptId, receiptInput.sessionId, receiptInput.finishedAt, payload)
      const existing = this.#database.prepare('SELECT payload FROM attempt_receipts WHERE task_id = ? AND attempt_id = ?').get(taskId, attemptId) as
        | { payload: string }
        | undefined
      if (existing?.payload !== payload) throw new Error('A durable task attempt already has a different persisted receipt.')
    })
  }

  findAttemptReceipt(taskId: string, attemptId: string): unknown | undefined {
    this.#assertOpen()
    const row = this.#database.prepare('SELECT payload FROM attempt_receipts WHERE task_id = ? AND attempt_id = ?').get(taskId, attemptId) as
      | { payload: string }
      | undefined
    return row === undefined ? undefined : parsedReceipt(row.payload)
  }

  listAttemptReceipts(input: { readonly sessionId?: string; readonly since?: number; readonly limit?: number } = {}): readonly unknown[] {
    this.#assertOpen()
    const since = Math.max(0, Math.trunc(input.since ?? 0))
    const limit = Math.max(0, Math.min(2_000, Math.trunc(input.limit ?? 2_000)))
    if (limit === 0) return []
    const rows =
      input.sessionId === undefined
        ? (this.#database
            .prepare('SELECT payload FROM attempt_receipts WHERE finished_at > ? ORDER BY finished_at DESC, task_id, attempt_id LIMIT ?')
            .all(since, limit) as { payload: string }[])
        : (this.#database
            .prepare('SELECT payload FROM attempt_receipts WHERE session_id = ? AND finished_at > ? ORDER BY finished_at DESC, task_id, attempt_id LIMIT ?')
            .all(input.sessionId, since, limit) as { payload: string }[])
    return rows.map(row => parsedReceipt(row.payload))
  }

  async withWorkerClaim<Result>(signal: AbortSignal, work: () => Promise<Result>): Promise<Result> {
    this.#assertOpen()
    const claim = new DatabaseSync(this.#claimPath, { timeout: 0 })
    try {
      await secureDatabaseFile(this.#claimPath)
      while (true) {
        if (signal.aborted) throw signal.reason ?? new Error('Durable task claim was cancelled.')
        try {
          claim.exec('BEGIN IMMEDIATE')
          break
        } catch (error) {
          if (!isSqliteBusy(error)) throw error
          await delay(50, undefined, { signal })
        }
      }
      try {
        return await work()
      } finally {
        if (claim.isTransaction) claim.exec('ROLLBACK')
      }
    } finally {
      claim.close()
    }
  }

  close(): void {
    if (this.#closed) return
    this.#database.close()
    this.#closed = true
  }

  async #initialize(): Promise<void> {
    await this.#transaction(() => {
      const current = this.#database.prepare('PRAGMA user_version').get() as { user_version: number }
      if (current.user_version > 1) throw new Error('Project Checks task database is newer than this plugin supports.')
      if (current.user_version === 1) return
      this.#database.exec(`
        CREATE TABLE task_keys (
          session_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          task_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          action_fingerprint TEXT NOT NULL,
          PRIMARY KEY (session_id, idempotency_key),
          UNIQUE (task_id)
        ) STRICT;
        CREATE TABLE tasks (
          task_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          payload TEXT NOT NULL CHECK (json_valid(payload))
        ) STRICT;
        CREATE INDEX tasks_session_created ON tasks (session_id, created_at DESC, task_id);
        CREATE TABLE attempt_receipts (
          task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
          attempt_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          finished_at INTEGER NOT NULL,
          payload TEXT NOT NULL CHECK (json_valid(payload)),
          PRIMARY KEY (task_id, attempt_id)
        ) STRICT;
        CREATE INDEX attempt_receipts_session_finished ON attempt_receipts (session_id, finished_at DESC);
        PRAGMA user_version = 1;
      `)
    })
  }

  #insert(task: DurableTask): void {
    this.#database
      .prepare('INSERT INTO tasks (task_id, session_id, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(task.id, task.sessionId, task.status, task.createdAt, task.updatedAt, serializedTask(task))
  }

  #put(taskId: string, task: DurableTask): void {
    if (task.id !== taskId) throw new Error('Durable Project Checks task key does not match its record identity.')
    const result = this.#database
      .prepare('UPDATE tasks SET session_id = ?, status = ?, created_at = ?, updated_at = ?, payload = ? WHERE task_id = ?')
      .run(task.sessionId, task.status, task.createdAt, task.updatedAt, serializedTask(task), taskId)
    if (result.changes !== 1) throw new Error('Durable Project Checks task is missing.')
  }

  async #transaction<Result>(work: () => Result): Promise<Result> {
    this.#assertOpen()
    const deadline = Date.now() + this.#busyTimeoutMs
    while (true) {
      try {
        this.#database.exec('BEGIN IMMEDIATE')
        break
      } catch (error) {
        if (!isSqliteBusy(error)) throw error
        if (Date.now() >= deadline) throw new Error('Project Checks task database remained busy past its write deadline.', { cause: error })
        await delay(20)
      }
    }
    try {
      const result = work()
      this.#database.exec('COMMIT')
      return result
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK')
      throw error
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Durable Project Checks task store is closed.')
  }
}
