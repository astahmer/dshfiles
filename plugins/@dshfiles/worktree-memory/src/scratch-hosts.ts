import { Option, Schema } from 'effect'
import { ProcessTable, type PsRow } from './process-table.js'
import { scratchKindValues, type ScratchHost, type ScratchHosts } from './types.js'

export type ScratchProcessRow = PsRow

/**
 * `${os.tmpdir()}/dshx-scratch/<hostPid>.json`, written by dshx for every scratch Host it starts (docs/orphan-cleanup.md). Read here directly: the contract is a file shape, not a dshx module this plugin could import.
 */
const scratchRecordSchema = Schema.Struct({
  hostPid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  hostStartedAt: Schema.Number,
  ownerPid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ownerStartedAt: Schema.Number,
  workspace: Schema.String,
  kind: Schema.Literals(scratchKindValues),
  command: Schema.String,
})
export type ScratchRecord = typeof scratchRecordSchema.Type

const decodeRecordJson = Schema.decodeUnknownOption(Schema.fromJsonString(scratchRecordSchema))

// `Mon Oct 19 14:02:03 2026`, as `ps -o lstart` prints it under LC_ALL=C.
const SCRATCH_PROFILE = /(?:^|\s)--profile[\s=]dshx-boot(?=\s|$)/
const PORT = /(?:^|\s)--port[\s=](\d+)(?=\s|$)/
// `ps -o lstart` has one-second resolution, so a start time recorded in milliseconds lands within a second of it.
const START_SLACK_MS = 2_000
const LEGACY_MIN_AGE_MS = 2 * 60 * 60 * 1000
const MAX_HOSTS = 200
const MAX_ANCESTORS = 64

const isScratchCommand = (command: string): boolean => SCRATCH_PROFILE.test(command)

const sameStart = (left: number, right: number): boolean => Math.abs(left - right) < START_SLACK_MS

/** The Host serving this page and every process above it (a supervisor): never listed, never signalled. */
const protectedPids = (rows: readonly ScratchProcessRow[], hostPid: number): ReadonlySet<number> => {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const protectedSet = new Set<number>()
  for (let pid = hostPid; pid > 1 && !protectedSet.has(pid) && protectedSet.size < MAX_ANCESTORS; pid = byPid.get(pid)?.ppid ?? 1) protectedSet.add(pid)
  return protectedSet
}

const describeHost = (input: {
  readonly row: ScratchProcessRow
  readonly rows: readonly ScratchProcessRow[]
  readonly records: readonly ScratchRecord[]
  readonly now: number
}): ScratchHost => {
  const { row, rows } = input
  const byPid = new Map(rows.map(candidate => [candidate.pid, candidate]))
  const members = ProcessTable.treePids(rows, row.pid).flatMap(pid => {
    const member = byPid.get(pid)
    return member === undefined ? [] : [member]
  })
  const port = Number(PORT.exec(row.command)?.[1] ?? Number.NaN)
  const totals = {
    pid: row.pid,
    startedAt: row.startedAt,
    port: Number.isInteger(port) && port > 0 ? port : null,
    bytes: members.reduce((sum, member) => sum + member.rssKb * 1024, 0),
    cpuPercent: members.reduce((sum, member) => sum + member.cpuPercent, 0),
    processCount: Math.max(1, members.length),
  }
  const record = input.records.find(candidate => candidate.hostPid === row.pid && sameStart(candidate.hostStartedAt, row.startedAt))
  if (record === undefined) {
    const orphan = row.ppid === 1 && input.now - row.startedAt > LEGACY_MIN_AGE_MS
    return { ...totals, owner: null, orphan, reason: orphan ? 'legacy-detached' : null }
  }
  const alive = rows.some(candidate => candidate.pid === record.ownerPid && sameStart(candidate.startedAt, record.ownerStartedAt))
  return {
    ...totals,
    owner: { pid: record.ownerPid, startedAt: record.ownerStartedAt, workspace: record.workspace.slice(0, 1024), kind: record.kind, alive },
    orphan: !alive,
    reason: alive ? null : 'owner-gone',
  }
}

/**
 * Every scratch DSH Host (`--profile dshx-boot`) of this user, labelled by the owner its dshx record names, and whether
 * it is an orphan. A record whose Host is gone is the dshx sweeper's to delete; it lists nothing here.
 */
const detect = (input: {
  readonly rows: readonly ScratchProcessRow[]
  readonly records: readonly ScratchRecord[]
  readonly now: number
  readonly hostPid: number
  readonly alert: ScratchHosts['alert']
}): ScratchHosts => {
  const byPid = new Map(input.rows.map(row => [row.pid, row]))
  const excluded = protectedPids(input.rows, input.hostPid)
  // A wrapper (`pnpm exec dsh --profile dshx-boot`) and the node it runs both carry the flag; list the topmost only.
  const roots = input.rows.filter(row => isScratchCommand(row.command) && !excluded.has(row.pid) && !isScratchCommand(byPid.get(row.ppid)?.command ?? ''))
  const hosts = roots
    .map(row => describeHost({ row, rows: input.rows, records: input.records, now: input.now }))
    .toSorted((left, right) => Number(right.orphan) - Number(left.orphan) || right.bytes - left.bytes)
  const orphans = hosts.filter(host => host.orphan)
  return {
    hosts: hosts.slice(0, MAX_HOSTS),
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((sum, host) => sum + host.bytes, 0),
    orphanCpuPercent: orphans.reduce((sum, host) => sum + host.cpuPercent, 0),
    alert: input.alert,
  }
}

/**
 * - `signal-group`: a scratch Host that leads its process group (dshx spawns it detached), so the group goes at once.
 * - `signal-tree`: a scratch Host inside another group; only its own tree is signalled, children first.
 * - `gone`, `recycled`, `not-scratch`, `protected`: refuse; the pid exited, now runs another process, no longer carries
 *   `--profile dshx-boot`, or is this Host or one of its ancestors.
 */
export type StopVerdict = 'signal-group' | 'signal-tree' | 'gone' | 'recycled' | 'not-scratch' | 'protected'

/** Re-checks a target against the process table read right before signalling it. */
const guardStop = (input: {
  readonly target: { readonly pid: number; readonly startedAt: number }
  readonly rows: readonly ScratchProcessRow[]
  readonly hostPid: number
}): StopVerdict => {
  if (protectedPids(input.rows, input.hostPid).has(input.target.pid)) return 'protected'
  const row = input.rows.find(candidate => candidate.pid === input.target.pid)
  if (row === undefined) return 'gone'
  if (row.startedAt !== input.target.startedAt) return 'recycled'
  if (!isScratchCommand(row.command)) return 'not-scratch'
  return row.pgid === row.pid ? 'signal-group' : 'signal-tree'
}

export const parsePs = ProcessTable.parsePs
export const decodeRecord = (text: string): Option.Option<ScratchRecord> => decodeRecordJson(text)
export { detect, guardStop }
