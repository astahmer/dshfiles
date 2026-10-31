import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readLogFrom } from '@dshfiles/usage/session-log'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import { Schema } from 'effect'
import { boundedLabel } from './bounds.js'
import { historyJobSchema, jobSessionSchema, jobStateSchema, type HistoryJob, type JobIndexing, type JobSession } from './types.js'

/**
 * Durable index of the jobs every Session log recorded. The Host only knows the
 * jobs of its own process, so the log is the one source that still lists what
 * earlier DSH processes ran. One pass reads a bounded number of changed files,
 * resuming each at the byte offset of its last complete frame.
 */

const DEFAULT_MAX_JOBS = 20_000
const DEFAULT_FILES_PER_PASS = 40
const DEFAULT_BUDGET_MS = 2_000

const nonemptyString = Schema.String.check(Schema.isMinLength(1))
const nonnegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const headerSchema = Schema.Struct({ id: nonemptyString, cwd: Schema.optional(nonemptyString) })
const titleSchema = Schema.Struct({ title: nonemptyString })
const registeredSchema = Schema.Struct({
  jobId: nonemptyString,
  owner: Schema.optional(nonemptyString),
  kind: nonemptyString,
  label: Schema.String,
  startedAt: nonnegativeInteger,
})
const settledSchema = Schema.Struct({
  jobId: nonemptyString,
  owner: Schema.optional(nonemptyString),
  kind: nonemptyString,
  label: Schema.String,
  startedAt: nonnegativeInteger,
  finishedAt: nonnegativeInteger,
  status: Schema.Literals(['completed', 'killed', 'failed']),
  cause: nonemptyString,
  detail: Schema.optional(Schema.String),
})
type DecodeResult<Value> = { readonly success: true; readonly data: Value } | { readonly success: false }
const decodeJsonSafe = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, text: string): DecodeResult<S['Type']> => {
  try {
    return { success: true, data: Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(JSON.parse(text)) }
  } catch {
    return { success: false }
  }
}
const decodeRecord = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] | null => {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch {
    return null
  }
}

interface LogFile {
  readonly path: string
  readonly project: string
  readonly size: number
  readonly mtimeMs: number
}

export interface HistoryIndexOptions {
  readonly root: string
  readonly statePath: string
  readonly now?: () => number
  readonly maxJobs?: number
  readonly filesPerPass?: number
  readonly budgetMs?: number
}

/** The history face the board reads; `HistoryIndex` is one, a test fixture can be another. */
export interface JobHistorySource {
  readonly historyRows: readonly HistoryJob[]
  readonly indexing: JobIndexing
  sessionOf(sessionId: string | null): JobSession | null
}

const sessionIdOf = (directory: string): string => (directory.startsWith('session-') ? directory : `session-${directory}`)

export class HistoryIndex implements JobHistorySource {
  private readonly options: Required<HistoryIndexOptions>
  private readonly offsets = new Map<string, number>()
  private readonly jobs = new Map<string, HistoryJob>()
  private readonly sessions = new Map<string, JobSession>()
  private files: readonly LogFile[] = []
  private readonly startedAt: number
  private startedPassAt = 0
  private active = false
  private lastIndexedAt: number | null = null
  private lastError: string | null = null
  private caughtUp = false

  constructor(options: HistoryIndexOptions) {
    this.options = {
      root: options.root,
      statePath: options.statePath,
      now: options.now ?? (() => Date.now()),
      maxJobs: options.maxJobs ?? DEFAULT_MAX_JOBS,
      filesPerPass: options.filesPerPass ?? DEFAULT_FILES_PER_PASS,
      budgetMs: options.budgetMs ?? DEFAULT_BUDGET_MS,
    }
    this.startedAt = this.options.now()
  }

  async load(): Promise<void> {
    try {
      const parsed = decodeJsonSafe(jobStateSchema, await readFile(this.options.statePath, 'utf8'))
      if (!parsed.success) return
      for (const [path, offset] of Object.entries(parsed.data.offsets)) this.offsets.set(path, offset)
      for (const [id, job] of Object.entries(parsed.data.jobs)) this.jobs.set(id, job)
      for (const [id, session] of Object.entries(parsed.data.sessions)) this.sessions.set(id, session)
    } catch {
      return
    }
  }

  get historyRows(): readonly HistoryJob[] {
    return [...this.jobs.values()]
  }

  sessionOf(sessionId: string | null): JobSession | null {
    return sessionId === null ? null : (this.sessions.get(sessionId) ?? null)
  }

  get indexing(): JobIndexing {
    return {
      active: this.active,
      caughtUp: this.caughtUp,
      files: this.files.length,
      indexedFiles: this.offsets.size,
      historyRows: this.jobs.size,
      lastIndexedAt: this.lastIndexedAt,
      lastError: this.lastError,
    }
  }

  async pass(): Promise<void> {
    if (this.active) return
    this.active = true
    try {
      await withSpan('background-jobs history pass', {}, async span => {
        await this.listFiles()
        let changed = 0
        for (const file of this.files) {
          if (changed >= this.options.filesPerPass || this.options.now() - this.startedPassAt > this.options.budgetMs) break
          if (file.size <= (this.offsets.get(file.path) ?? 0)) continue
          changed += 1
          await this.readFile(file)
        }
        this.caughtUp = changed < this.options.filesPerPass
        span.setAttributes(
          pluginAttributes({ plugin: 'background-jobs', attributes: { files: this.files.length, read_files: changed, caught_up: this.caughtUp } }),
        )
        if (changed > 0) await this.persist()
      })
      this.lastIndexedAt = this.options.now()
      this.lastError = null
    } catch (error) {
      this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    } finally {
      this.active = false
    }
  }

  private async listFiles(): Promise<void> {
    this.startedPassAt = this.options.now()
    const found: LogFile[] = []
    for (const project of await this.listDirectories(this.options.root)) {
      const projectDirectory = join(this.options.root, project)
      for (const session of await this.listDirectories(projectDirectory)) {
        const sessionDirectory = join(projectDirectory, session)
        for (const entry of await this.listEntries(sessionDirectory)) {
          if (!entry.includes('.jsonl')) continue
          const path = join(sessionDirectory, entry)
          const info = await stat(path).catch(() => null)
          if (info === null || !info.isFile()) continue
          found.push({ path, project, size: info.size, mtimeMs: info.mtimeMs })
        }
      }
    }
    this.files = found.sort((left, right) => right.mtimeMs - left.mtimeMs)
  }

  private async listDirectories(path: string): Promise<readonly string[]> {
    return readdir(path, { withFileTypes: true })
      .then(entries => entries.filter(entry => entry.isDirectory()).map(entry => entry.name))
      .catch(() => [])
  }

  private async listEntries(path: string): Promise<readonly string[]> {
    return readdir(path)
      .then(entries => [...entries])
      .catch(() => [])
  }

  private async readFile(file: LogFile): Promise<void> {
    const fromOffset = this.offsets.get(file.path) ?? 0
    const chunk = await readLogFrom({ path: file.path, fromOffset, size: file.size })
    this.offsets.set(file.path, chunk.endOffset)
    const fallbackSession = { id: sessionIdOf(file.path.split('/').at(-2) ?? ''), project: file.project }
    for (const record of chunk.records) this.ingest({ record, file, fallbackSession })
  }

  private ingest(input: {
    readonly record: { readonly type: string; readonly data?: unknown }
    readonly file: LogFile
    readonly fallbackSession: { readonly id: string; readonly project: string }
  }): void {
    const { record, fallbackSession } = input
    if (record.type === 'session') {
      const parsed = decodeRecord(headerSchema, record.data)
      if (parsed === null) return
      const previous = this.sessions.get(parsed.id)
      this.sessions.set(parsed.id, {
        id: parsed.id,
        title: previous?.title ?? null,
        cwd: parsed.cwd ?? previous?.cwd ?? null,
        project: fallbackSession.project ?? previous?.project ?? null,
      })
      return
    }
    if (record.type === 'session/title') {
      const parsed = decodeRecord(titleSchema, record.data)
      if (parsed === null) return
      const previous = this.sessions.get(fallbackSession.id)
      this.sessions.set(fallbackSession.id, {
        id: fallbackSession.id,
        title: parsed.title.slice(0, 300),
        cwd: previous?.cwd ?? null,
        project: previous?.project ?? fallbackSession.project,
      })
      return
    }
    if (record.type === 'job/registered') {
      const parsed = decodeRecord(registeredSchema, record.data)
      if (parsed === null) return
      this.jobs.set(parsed.jobId, {
        id: parsed.jobId,
        kind: parsed.kind,
        label: boundedLabel(parsed.label),
        owner: parsed.owner ?? null,
        startedAt: parsed.startedAt,
        settled: false,
        status: null,
        cause: null,
        detail: null,
        finishedAt: null,
      })
      this.trim()
      return
    }
    if (record.type !== 'job/settled') return
    const parsed = decodeRecord(settledSchema, record.data)
    if (parsed === null) return
    const previous = this.jobs.get(parsed.jobId)
    this.jobs.set(parsed.jobId, {
      id: parsed.jobId,
      kind: parsed.kind,
      label: boundedLabel(parsed.label ?? previous?.label ?? ''),
      owner: parsed.owner ?? previous?.owner ?? null,
      startedAt: parsed.startedAt,
      settled: true,
      status: parsed.status,
      cause: parsed.cause,
      detail: parsed.detail ?? null,
      finishedAt: parsed.finishedAt,
    })
    this.trim()
  }

  private trim(): void {
    if (this.jobs.size <= this.options.maxJobs) return
    const oldest = [...this.jobs.values()].sort((left, right) => left.startedAt - right.startedAt).slice(0, this.jobs.size - this.options.maxJobs)
    for (const job of oldest) this.jobs.delete(job.id)
  }

  private async persist(): Promise<void> {
    const state = Schema.decodeUnknownSync(jobStateSchema, { onExcessProperty: 'error' })({
      schemaVersion: 1,
      offsets: Object.fromEntries(this.offsets),
      jobs: Object.fromEntries(
        [...this.jobs.entries()].map(([id, job]) => [id, Schema.decodeUnknownSync(historyJobSchema, { onExcessProperty: 'error' })(job)]),
      ),
      sessions: Object.fromEntries(
        [...this.sessions.entries()].map(([id, session]) => [id, Schema.decodeUnknownSync(jobSessionSchema, { onExcessProperty: 'error' })(session)]),
      ),
      startedAt: this.startedAt,
    })
    await mkdir(dirname(this.options.statePath), { recursive: true })
    const temporary = `${this.options.statePath}.${String(process.pid)}.tmp`
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await rename(temporary, this.options.statePath)
  }
}
