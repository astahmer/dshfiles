import { spawn, spawnSync } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
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

const ownedProcessSchema = z.object({ pid: z.number().int().positive(), signature: z.array(z.string().min(1)).min(1) }).strict()

export const ScratchStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string(),
    createdAt: z.string(),
    stateDir: z.string(),
    home: z.string(),
    profile: z.string(),
    port: z.number().int(),
    origin: z.string(),
    /** Tokenized launch URL. A secret: only this file (mode 600) holds it; never print it. */
    launchUrl: z.string(),
    bundles: z.array(z.string()),
    expectedClientEntries: z.array(z.string()),
    project: z.object({ path: z.string(), workspaceId: z.string(), ownedByScratch: z.boolean() }).strict(),
    host: ownedProcessSchema,
    browser: ownedProcessSchema.extend({ cdpPort: z.number().int() }).strict(),
    hostLog: z.string(),
    browserLog: z.string(),
    browserEvents: z.string(),
    evidenceDir: z.string(),
    /** Directory holding the fake `secret` CLI and its store, first on the Host's PATH (`up --fake-secret-cli`). */
    fakeSecretCli: z.string().optional(),
    /** Seeds `dshx dev open` already applied to this instance, with the checkout file one changed for `down` to restore. */
    seeds: z.array(z.object({ seed: z.enum(REACH_SEEDS), changedFile: z.string().optional() }).strict()).optional(),
    /** The loopback model provider started by `tool-call-thread` or `credential-recovery`; `down` stops it. */
    fakeProvider: ownedProcessSchema.optional(),
    /** Minutes without a `dshx dev` command (the state file's mtime is the lease) before the watchdog warns; 0 never. */
    idleTimeoutMinutes: z.number().int().nonnegative().optional(),
    /** Minutes of warning grace between the expired lease and the automatic `down`; 0 stops without warning. The CLI takes whole minutes; a spec passes a fraction to watch the grace end quickly. */
    warnMinutes: z.number().nonnegative().optional(),
    /** ISO time the warning started; absent while the instance is in use. Its own grace clock, not the lease. */
    warnedAt: z.string().optional(),
    /** `dshx dev keep --forever` pinned the instance: no idle stop until another `up` or `down`. */
    kept: z.boolean().optional(),
    /** The detached process that runs `down` when the lease expires or the dsh process is gone. */
    watchdog: ownedProcessSchema.optional(),
  })
  .strict()

export type ScratchState = z.infer<typeof ScratchStateSchema>

export const scratchNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'use 1-32 lowercase letters, digits or hyphens')

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

const readScratchState = async (stateDir: string, name: string): Promise<ScratchState> => {
  const source = await readFile(stateFile(stateDir), 'utf8').catch(() => undefined)
  if (source === undefined) {
    throw new ScratchError(
      'not-up',
      `No scratch DSH named "${name}" is recorded in ${stateDir}.`,
      `Run "dshx dev up${name === 'default' ? '' : ` --name ${name}`}" first.`,
    )
  }
  const parsed = ScratchStateSchema.safeParse(JSON.parse(source))
  if (!parsed.success) {
    throw new ScratchError(
      'invalid-state',
      `The scratch state in ${stateFile(stateDir)} is unreadable: ${parsed.error.issues[0]?.message ?? 'invalid shape'}.`,
      'Run "dshx dev down --dry-run" to see what it would stop, then "dshx dev down".',
    )
  }
  return parsed.data
}

const writeScratchState = async (state: ScratchState): Promise<void> => {
  await mkdir(state.stateDir, { recursive: true, mode: 0o700 })
  await writeFile(stateFile(state.stateDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

const trackFakeProvider = async (state: ScratchState, fakeProvider: NonNullable<ScratchState['fakeProvider']>): Promise<void> => {
  const current = await readScratchState(state.stateDir, state.name)
  await writeScratchState({ ...current, fakeProvider })
}

const removeScratchStateFile = (stateDir: string): Promise<void> => rm(stateFile(stateDir), { force: true })

/** Every `dshx dev` command on an instance renews its idle lease by touching the state file. */
const renewLease = async (stateDir: string): Promise<void> => {
  const now = new Date()
  await utimes(stateFile(stateDir), now, now).catch(() => undefined)
}

const lastUsedAt = async (stateDir: string): Promise<number | undefined> => (await stat(stateFile(stateDir)).catch(() => undefined))?.mtimeMs

/** The pending warning and the grace it has left, or undefined when the instance is not in its warning phase. */
const scratchWarning = (state: ScratchState, now: number): ScratchWarning | undefined => {
  if (state.warnedAt === undefined) return undefined
  const startedAt = Date.parse(state.warnedAt)
  if (Number.isNaN(startedAt)) return undefined
  const warnMinutes = state.warnMinutes ?? DEFAULT_WARN_MINUTES
  return {
    warnedAt: state.warnedAt,
    graceEndsAt: new Date(startedAt + warnMinutes * 60_000).toISOString(),
    minutesLeft: Math.max(0, warnMinutes - (now - startedAt) / 60_000),
  }
}

/** Minutes the way help and doctor print them; a spec's fractional `warnMinutes` keeps one decimal. */
const formatMinutes = (minutes: number): string => (minutes < 0.1 ? 'under a minute' : `${Math.round(minutes * 10) / 10} min`)

/** One line in `watchdog.log`, whether the event came from the watchdog, `up`'s sweep or a `keep`. */
const logScratchEvent = async (stateDir: string, message: string): Promise<void> => {
  await appendFile(join(stateDir, 'watchdog.log'), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }).catch(() => undefined)
}

const withoutWarning = (state: ScratchState): ScratchState => {
  const next = { ...state }
  delete next.warnedAt
  return next
}

/**
 * Start the warning phase without renewing the lease: writing the state would otherwise move its mtime, so put the old
 * one back and let the grace clock stand on its own.
 */
const markWarned = async (options: { readonly state: ScratchState; readonly warnedAt: string; readonly lastUsedAt: number }): Promise<ScratchState> => {
  const next: ScratchState = { ...options.state, warnedAt: options.warnedAt }
  await writeScratchState(next)
  const seconds = options.lastUsedAt / 1000
  await utimes(stateFile(next.stateDir), seconds, seconds)
  return next
}

/** A command that reached the instance answers a pending warning; it also renews the lease. */
const cancelWarning = async (state: ScratchState): Promise<{ readonly state: ScratchState; readonly cancelled: boolean }> => {
  if (state.warnedAt === undefined) return { state, cancelled: false }
  const next = withoutWarning(state)
  await writeScratchState(next)
  await renewLease(next.stateDir)
  await logScratchEvent(next.stateDir, `answered the warning for "${next.name}"; warning cancelled, lease renewed`)
  return { state: next, cancelled: true }
}

/** `dshx dev keep`: answer the warning and renew the lease, or pin the instance so it never stops on its own. */
const keepScratch = async (options: {
  readonly state: ScratchState
  readonly forever: boolean
}): Promise<{ readonly state: ScratchState; readonly cancelledWarning: boolean }> => {
  const base = withoutWarning(options.state)
  const next: ScratchState = options.forever ? { ...base, kept: true, idleTimeoutMinutes: 0 } : base
  await writeScratchState(next)
  await renewLease(next.stateDir)
  await logScratchEvent(
    next.stateDir,
    options.forever ? `keep --forever pinned "${next.name}": warning cancelled, no idle stop` : `keep cancelled the warning for "${next.name}"; lease renewed`,
  )
  return { state: next, cancelledWarning: options.state.warnedAt !== undefined }
}

/** The state minus the launch token, safe to print. */
const publicState = (state: ScratchState) => ({
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
  idleTimeoutMinutes: state.kept === true ? 0 : (state.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES),
  warnMinutes: state.warnMinutes ?? DEFAULT_WARN_MINUTES,
  warnedAt: state.warnedAt,
  kept: state.kept === true,
  watchdogPid: state.watchdog?.pid,
})

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
  static readonly publicState = publicState
  static readonly isWithin = isWithin
  static readonly ownedProcessStatus = ownedProcessStatus
  static readonly redactUrls = redactUrls
  static readonly spawnDetached = spawnDetached
}
