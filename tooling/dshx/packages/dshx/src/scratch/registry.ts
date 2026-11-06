import { spawnSync } from 'node:child_process'
import * as Schema from 'effect/Schema'
import { readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeJson } from '../json.js'

/**
 * The scratch Host registry: which `dsh --profile dshx-boot` process belongs to which owner. `@dshfiles/dshx/scratch-registry`
 * publishes it so other tools (worktree memory, the sweeper) label scratch Hosts and find orphans the same way.
 *
 * - Every scratch Host's environment carries `DSHX_SCRATCH_OWNER=<ownerPid>:<ownerStartedAtMs>:<workspacePath>`.
 * - Its guard (`parent-guard.ts`) writes `${TMPDIR}/dshx-scratch/<hostPid>.json` (mode 600) and removes it on a clean
 *   stop; a record left behind by a killed guard names a Host that is gone, and the sweep drops it.
 * - The owner is the process whose death must take the Host down: the Playwright worker for an E2E fixture, the
 *   `dshx dev` watchdog for a `dshx dev up` instance.
 */
export const SCRATCH_OWNER_ENV = 'DSHX_SCRATCH_OWNER'

/** `ps` reports start times to the second; a pid whose start differs by more than this is a recycled pid. */
const START_TOLERANCE_MS = 2_000

const positiveInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

const ScratchRecordSchema = Schema.Struct({
  hostPid: positiveInt,
  hostStartedAt: positiveInt,
  ownerPid: positiveInt,
  ownerStartedAt: positiveInt,
  workspace: Schema.String,
  kind: Schema.Literals(['e2e', 'dev']),
  command: Schema.String,
})

export type ScratchRecord = typeof ScratchRecordSchema.Type
export type ScratchRecordKind = ScratchRecord['kind']

export interface ScratchOwner {
  readonly ownerPid: number
  readonly ownerStartedAt: number
  readonly workspace: string
}

/** `$DSHX_SCRATCH_REGISTRY_DIR` (tests) or `${TMPDIR}/dshx-scratch`. */
const scratchRegistryDir = (): string => resolve(process.env.DSHX_SCRATCH_REGISTRY_DIR ?? join(tmpdir(), 'dshx-scratch'))

const formatScratchOwner = (owner: ScratchOwner): string => `${String(owner.ownerPid)}:${String(owner.ownerStartedAt)}:${owner.workspace}`

/** The owner a `DSHX_SCRATCH_OWNER` value names; the workspace path may itself hold colons. */
const parseScratchOwner = (value: string | undefined): ScratchOwner | undefined => {
  const match = /^(\d+):(\d+):(.*)$/s.exec(value ?? '')
  if (match === null) return undefined
  return { ownerPid: Number(match[1]), ownerStartedAt: Number(match[2]), workspace: match[3] ?? '' }
}

/** When `pid` started, in epoch milliseconds (to the second, from `ps`), or undefined when it is not running. */
const processStartedAt = (pid: number): number | undefined => {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  const startedAt = Date.parse(result.stdout.trim().replace(/\s+/g, ' '))
  return result.status === 0 && Number.isFinite(startedAt) ? startedAt : undefined
}

/** The owner marker for the calling process, as a scratch Host it starts should carry it. */
const currentScratchOwner = (workspace: string): ScratchOwner => ({
  ownerPid: process.pid,
  ownerStartedAt: processStartedAt(process.pid) ?? Math.round(Date.now() - process.uptime() * 1_000),
  workspace,
})

const sameStart = (actual: number | undefined, expected: number): boolean => actual !== undefined && Math.abs(actual - expected) <= START_TOLERANCE_MS

/** The process `pid` that started at `startedAt` is still running (a recycled pid does not count). */
const isSameProcessRunning = (pid: number, startedAt: number, startedAtOf: (pid: number) => number | undefined = processStartedAt): boolean =>
  sameStart(startedAtOf(pid), startedAt)

/** The record's owner is gone: its pid is dead or now belongs to a process that started at another time. */
const isOrphan = (record: Pick<ScratchRecord, 'ownerPid' | 'ownerStartedAt'>, startedAtOf: (pid: number) => number | undefined = processStartedAt): boolean =>
  !isSameProcessRunning(record.ownerPid, record.ownerStartedAt, startedAtOf)

const scratchRecordPath = (hostPid: number, directory: string = scratchRegistryDir()): string => join(directory, `${String(hostPid)}.json`)

/** Every readable record; an unreadable or foreign file is skipped, never fatal. */
const readScratchRecords = async (directory: string = scratchRegistryDir()): Promise<readonly ScratchRecord[]> => {
  const names = await readdir(directory).catch(() => [])
  const records = await Promise.all(
    names
      .filter(name => /^\d+\.json$/.test(name))
      .map(async name => {
        const source = await readFile(join(directory, name), 'utf8').catch(() => undefined)
        if (source === undefined) return undefined
        try {
          return decodeJson(ScratchRecordSchema, source)
        } catch {
          return undefined
        }
      }),
  )
  return records.filter(record => record !== undefined)
}

const removeScratchRecord = (hostPid: number, directory: string = scratchRegistryDir()): Promise<void> =>
  rm(scratchRecordPath(hostPid, directory), { force: true })

/** The registry contract `@dshfiles/dshx/scratch-registry` publishes. */
export class ScratchRegistry {
  static readonly directory = scratchRegistryDir
  static readonly formatOwner = formatScratchOwner
  static readonly parseOwner = parseScratchOwner
  static readonly processStartedAt = processStartedAt
  static readonly currentOwner = currentScratchOwner
  static readonly isSameProcessRunning = isSameProcessRunning
  static readonly isOrphan = isOrphan
  static readonly recordPath = scratchRecordPath
  static readonly readRecords = readScratchRecords
  static readonly removeRecord = removeScratchRecord
}
