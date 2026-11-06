import { spawn, spawnSync } from 'node:child_process'
import { Result, SchemaIssue } from 'effect'
import * as Schema from 'effect/Schema'
import { closeSync, openSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { decodeJson, jsonValueSchema } from '../json.js'
import { REACH_SEEDS } from '../project/features.js'

/** The live DSH the user works in; a scratch instance never takes its port or its home. */
export const LIVE_DSH_PORT = 3080
export const LIVE_DSH_HOME = resolve(process.env.DSH_LIVE_HOME ?? join(homedir(), '.dsh'))

export class ScratchError extends Error {
  readonly code: string
  readonly hint: string
  constructor(code: string, message: string, hint: string) {
    super(message)
    this.name = 'ScratchError'
    this.code = code
    this.hint = hint
  }
}

const ownedProcessFields = {
  pid: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  signature: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
}
const ownedProcessSchema = Schema.Struct(ownedProcessFields)

/** The persisted lease phase: one authority for in use, warned and pinned. */
export const scratchLeaseSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('active') }),
  Schema.Struct({ kind: Schema.Literal('warned'), warnedAt: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('pinned') }),
])

export type ScratchLease = (typeof scratchLeaseSchema)['Type']

export const ScratchStateSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: Schema.String,
  createdAt: Schema.String,
  stateDir: Schema.String,
  home: Schema.String,
  profile: Schema.String,
  port: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  origin: Schema.String,
  /** Tokenized launch URL. A secret: only this file (mode 600) holds it; never print it. */
  launchUrl: Schema.String,
  bundles: Schema.Array(Schema.String),
  expectedClientEntries: Schema.Array(Schema.String),
  project: Schema.Struct({ path: Schema.String, workspaceId: Schema.String, ownedByScratch: Schema.Boolean }),
  host: ownedProcessSchema,
  browser: Schema.Struct({ ...ownedProcessFields, cdpPort: Schema.Number.check(Schema.isFinite(), Schema.isInt()) }),
  hostLog: Schema.String,
  browserLog: Schema.String,
  browserEvents: Schema.String,
  evidenceDir: Schema.String,
  /** Directory holding the fake `secret` CLI and its store, first on the Host's PATH (`up --fake-secret-cli`). */
  fakeSecretCli: Schema.optional(Schema.String),
  /** Seeds `dshx dev open` already applied to this instance, with the checkout file one changed for `down` to restore. */
  seeds: Schema.optional(Schema.Array(Schema.Struct({ seed: Schema.Literals(REACH_SEEDS), changedFile: Schema.optional(Schema.String) }))),
  /** The loopback model provider started by `tool-call-thread` or `credential-recovery`; `down` stops it. */
  fakeProvider: Schema.optional(ownedProcessSchema),
  /** Minutes without a `dshx dev` command (the state file's mtime is the lease) before the watchdog warns; 0 never. */
  idleTimeoutMinutes: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  /** Minutes of warning grace between the expired lease and the automatic `down`; 0 stops without warning. The CLI takes whole minutes; a spec passes a fraction to watch the grace end quickly. */
  warnMinutes: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
  /** ISO time the warning started; absent while the instance is in use. Its own grace clock, not the lease. */
  warnedAt: Schema.optional(Schema.String),
  /** `dshx dev keep --forever` pinned the instance: no idle stop until another `up` or `down`. */
  kept: Schema.optional(Schema.Boolean),
  /** The lease phase; a state file written before it existed is normalized from `kept`/`warnedAt` on read. */
  lease: Schema.optional(scratchLeaseSchema),
  /** The detached process that runs `down` when the lease expires or the dsh process is gone. */
  watchdog: Schema.optional(ownedProcessSchema),
})

type Mutable<T> = T extends ReadonlyArray<infer Item> ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T

export type ScratchState = Mutable<Schema.Schema.Type<typeof ScratchStateSchema>>

export const scratchNameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/, { message: 'use 1-32 lowercase letters, digits or hyphens' }),
)

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30

/** Grace between the expired idle lease and the automatic `down`, so a user can answer the warning. */
export const DEFAULT_WARN_MINUTES = 10

/** A pending warning: when it started, when its grace ends, and how much of that grace is left. */
export interface ScratchWarning {
  readonly warnedAt: string
  readonly graceEndsAt: string
  readonly minutesLeft: number
}

const stateRoot = (): string => resolve(process.env.DSHX_DEV_STATE_ROOT ?? join(tmpdir(), 'dshx-dev'))

const resolveStateDir = (options: { readonly name: string; readonly stateDir?: string }): string => resolve(options.stateDir ?? join(stateRoot(), options.name))

const stateFile = (stateDir: string): string => join(stateDir, 'state.json')

const stateLockFile = (stateDir: string): string => join(stateDir, 'state.lock')

const withLease = (state: ScratchState, lease: ScratchLease): ScratchState => {
  const next = { ...state, lease }
  delete next.warnedAt
  delete next.kept
  return next
}

/** The persisted lease phase, or the phase implied by a state file written before it existed. */
export const leaseOf = (state: ScratchState): ScratchLease => {
  if (state.lease !== undefined) return state.lease
  if (state.kept === true) return { kind: 'pinned' }
  if (state.warnedAt !== undefined) return { kind: 'warned', warnedAt: state.warnedAt }
  return { kind: 'active' }
}

export type LeaseEvent = { readonly kind: 'warn'; readonly warnedAt: string } | { readonly kind: 'keep' } | { readonly kind: 'pin' }

/** One lease transition: only active or warned can warn, keep clears a warning but not a pin, and pin always wins. */
export const applyLease = (state: ScratchState, event: LeaseEvent): ScratchState => {
  const lease = leaseOf(state)
  if (event.kind === 'warn') return lease.kind === 'pinned' ? state : withLease(state, { kind: 'warned', warnedAt: event.warnedAt })
  if (event.kind === 'keep') return lease.kind === 'pinned' ? state : withLease(state, { kind: 'active' })
  return withLease(state, { kind: 'pinned' })
}

const LOCK_TIMEOUT_MS = 5_000
const LOCK_STALE_MS = 10_000

/** Serialize a lease read-modify-write across the CLI and the detached watchdog process. */
const withStateLock = async <Result>(stateDir: string, work: () => Promise<Result>): Promise<Result> => {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const lockPath = stateLockFile(stateDir)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    const handle = await open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') return undefined
      throw error
    })
    if (handle !== undefined) {
      try {
        return await work()
      } finally {
        await handle.close()
        await rm(lockPath, { force: true })
      }
    }
    const stale = await stat(lockPath).then(
      info => Date.now() - info.mtimeMs > LOCK_STALE_MS,
      () => true,
    )
    if (stale) {
      await rm(lockPath, { force: true })
      continue
    }
    if (Date.now() > deadline) {
      throw new ScratchError(
        'state-locked',
        `The scratch state in ${stateDir} is locked by another dshx dev process.`,
        'Wait for the running command to finish, or remove state.lock if no dshx dev command is running.',
      )
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const readScratchState = async (stateDir: string, name: string): Promise<ScratchState> => {
  const source = await readFile(stateFile(stateDir), 'utf8').catch(() => undefined)
  if (source === undefined) {
    throw new ScratchError(
      'not-up',
      `No scratch DSH named "${name}" is recorded in ${stateDir}.`,
      `Run "dshx dev up${name === 'default' ? '' : ` --name ${name}`}" first.`,
    )
  }
  const parsed = Schema.decodeUnknownResult(ScratchStateSchema, { onExcessProperty: 'error' })(decodeJson(jsonValueSchema, source))
  if (Result.isFailure(parsed)) {
    const issues = SchemaIssue.makeFormatterStandardSchemaV1()(parsed.failure.issue).issues
    throw new ScratchError(
      'invalid-state',
      `The scratch state in ${stateFile(stateDir)} is unreadable: ${issues[0]?.message ?? 'invalid shape'}.`,
      'Run "dshx dev down --dry-run" to see what it would stop, then "dshx dev down".',
    )
  }
  // SAFETY: `Mutable` only drops `readonly` from the decoded state; the value and its shape are the schema's own.
  return withLease(parsed.success as ScratchState, leaseOf(parsed.success as ScratchState))
}

const writeScratchState = async (state: ScratchState): Promise<void> => {
  await mkdir(state.stateDir, { recursive: true, mode: 0o700 })
  const next = withLease(state, leaseOf(state))
  await writeFile(stateFile(next.stateDir), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
}

const removeScratchStateFile = (stateDir: string): Promise<void> => rm(stateFile(stateDir), { force: true })

/** Every `dshx dev` command on an instance renews its idle lease by touching the state file. */
const renewLease = async (stateDir: string): Promise<void> => {
  const now = new Date()
  await utimes(stateFile(stateDir), now, now).catch(() => undefined)
}

const lastUsedAt = async (stateDir: string): Promise<number | undefined> => (await stat(stateFile(stateDir)).catch(() => undefined))?.mtimeMs

/** Minutes the way help and doctor print them; a spec's fractional `warnMinutes` keeps one decimal. */
const formatMinutes = (minutes: number): string => (minutes < 0.1 ? 'under a minute' : `${Math.round(minutes * 10) / 10} min`)

/** One line in `watchdog.log`, whether the event came from the watchdog, `up`'s sweep or a `keep`. */
const logScratchEvent = async (stateDir: string, message: string): Promise<void> => {
  await appendFile(join(stateDir, 'watchdog.log'), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }).catch(() => undefined)
}

const withoutWarning = (state: ScratchState): ScratchState => applyLease(state, { kind: 'keep' })

const scratchWarning = (state: ScratchState, now: number): ScratchWarning | undefined => {
  const lease = leaseOf(state)
  if (lease.kind !== 'warned') return undefined
  const startedAt = Date.parse(lease.warnedAt)
  if (Number.isNaN(startedAt)) return undefined
  const warnMinutes = state.warnMinutes ?? DEFAULT_WARN_MINUTES
  return {
    warnedAt: lease.warnedAt,
    graceEndsAt: new Date(startedAt + warnMinutes * 60_000).toISOString(),
    minutesLeft: Math.max(0, warnMinutes - (now - startedAt) / 60_000),
  }
}

/** One locked read-modify-write of the lease record, so concurrent commands never overwrite each other. */
const updateScratchState = async <Result>(options: {
  readonly stateDir: string
  readonly name: string
  readonly update: (
    state: ScratchState,
  ) =>
    | { readonly state: ScratchState; readonly result: Result; readonly write?: boolean }
    | Promise<{ readonly state: ScratchState; readonly result: Result; readonly write?: boolean }>
}): Promise<Result> =>
  withStateLock(options.stateDir, async () => {
    const current = await readScratchState(options.stateDir, options.name)
    const applied = await options.update(current)
    if (applied.write !== false) await writeScratchState(applied.state)
    return applied.result
  })

const trackFakeProvider = async (state: ScratchState, fakeProvider: NonNullable<ScratchState['fakeProvider']>): Promise<void> => {
  await updateScratchState({
    stateDir: state.stateDir,
    name: state.name,
    update: current => ({ state: { ...current, fakeProvider }, result: undefined }),
  })
}

/**
 * Start the warning phase without renewing the lease: writing the state would otherwise move its mtime, so put the old
 * one back and let the grace clock stand on its own.
 */
const markWarned = async (options: { readonly state: ScratchState; readonly warnedAt: string; readonly lastUsedAt: number }): Promise<ScratchState> => {
  const next = applyLease(options.state, { kind: 'warn', warnedAt: options.warnedAt })
  await writeScratchState(next)
  const seconds = options.lastUsedAt / 1000
  await utimes(stateFile(next.stateDir), seconds, seconds)
  return next
}

/** A command that reached the instance answers a pending warning; it also renews the lease. */
const cancelWarning = async (options: {
  readonly stateDir: string
  readonly name: string
}): Promise<{
  readonly state: ScratchState
  readonly cancelled: boolean
}> =>
  updateScratchState<{ readonly state: ScratchState; readonly cancelled: boolean }>({
    stateDir: options.stateDir,
    name: options.name,
    update: async current => {
      if (leaseOf(current).kind !== 'warned') return { state: current, result: { state: current, cancelled: false }, write: false }
      const next = withoutWarning(current)
      await renewLease(next.stateDir)
      await logScratchEvent(next.stateDir, `answered the warning for "${next.name}"; warning cancelled, lease renewed`)
      return { state: next, result: { state: next, cancelled: true } }
    },
  })

/** `dshx dev keep`: answer the warning and renew the lease, or pin the instance so it never stops on its own. */
const keepScratch = async (options: {
  readonly stateDir: string
  readonly name: string
  readonly forever: boolean
}): Promise<{ readonly state: ScratchState; readonly cancelledWarning: boolean }> =>
  updateScratchState({
    stateDir: options.stateDir,
    name: options.name,
    update: async current => {
      const next = applyLease(current, options.forever ? { kind: 'pin' } : { kind: 'keep' })
      await renewLease(next.stateDir)
      await logScratchEvent(
        next.stateDir,
        options.forever
          ? `keep --forever pinned "${next.name}": warning cancelled, no idle stop`
          : `keep cancelled the warning for "${next.name}"; lease renewed`,
      )
      return { state: next, result: { state: next, cancelledWarning: leaseOf(current).kind === 'warned' } }
    },
  })

/** The state minus the launch token, safe to print. */
const publicState = (state: ScratchState) => {
  const lease = leaseOf(state)
  return {
    name: state.name,
    origin: state.origin,
    port: state.port,
    home: state.home,
    profile: state.profile,
    stateDir: state.stateDir,
    project: state.project.path,
    bundles: state.bundles,
    hostPid: state.host.pid,
    browserPid: state.browser.pid,
    hostLog: state.hostLog,
    evidenceDir: state.evidenceDir,
    idleTimeoutMinutes: lease.kind === 'pinned' ? 0 : (state.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES),
    warnMinutes: state.warnMinutes ?? DEFAULT_WARN_MINUTES,
    warnedAt: lease.kind === 'warned' ? lease.warnedAt : undefined,
    kept: lease.kind === 'pinned',
    watchdogPid: state.watchdog?.pid,
  }
}

const isWithin = (root: string, target: string): boolean => {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

/** Running, and still the process we started: its command line carries every signature fragment. */
const ownedProcessStatus = (owned: { readonly pid: number; readonly signature: readonly string[] }): 'running' | 'gone' | 'foreign' => {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(owned.pid)], { encoding: 'utf8' })
  const command = result.stdout.trim()
  if (result.status !== 0 || command === '') return 'gone'
  return owned.signature.every(fragment => command.includes(fragment)) ? 'running' : 'foreign'
}

const redactUrls = (text: string): string => text.replace(/https?:\/\/(127\.0\.0\.1|localhost):\d+\/[^\s"']*/g, match => `${new URL(match).origin}/[redacted]`)

/** Start a process in its own group, logging to `log`, so `down` can stop it and everything it spawned. */
const spawnDetached = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly log: string },
): number => {
  const output = openSync(options.log, 'a', 0o600)
  try {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', output, output] })
    child.unref()
    if (child.pid === undefined)
      throw new ScratchError('spawn-failed', `${command} did not start.`, `Check that ${command} is on PATH (run dshx through fnm exec --using=22.23.3).`)
    return child.pid
  } finally {
    closeSync(output)
  }
}

export class ScratchStateRuntime {
  static readonly stateRoot = stateRoot
  static readonly resolveStateDir = resolveStateDir
  static readonly read = readScratchState
  static readonly write = writeScratchState
  static readonly trackFakeProvider = trackFakeProvider
  static readonly remove = removeScratchStateFile
  static readonly renewLease = renewLease
  static readonly lastUsedAt = lastUsedAt
  static readonly scratchWarning = scratchWarning
  static readonly formatMinutes = formatMinutes
  static readonly logScratchEvent = logScratchEvent
  static readonly markWarned = markWarned
  static readonly cancelWarning = cancelWarning
  static readonly keepScratch = keepScratch
  static readonly leaseOf = leaseOf
  static readonly applyLease = applyLease
  static readonly withLock = withStateLock
  static readonly publicState = publicState
  static readonly isWithin = isWithin
  static readonly ownedProcessStatus = ownedProcessStatus
  static readonly redactUrls = redactUrls
  static readonly spawnDetached = spawnDetached
}
