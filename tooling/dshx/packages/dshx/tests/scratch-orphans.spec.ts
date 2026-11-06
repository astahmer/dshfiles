import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import type { Readable } from 'node:stream'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { decodeJson, jsonObjectSchema } from '../src/json.js'
import { guardedCommand } from '../src/scratch/guarded-spawn.js'
import { ScratchRegistry, type ScratchOwner, type ScratchRecord } from '../src/scratch/registry.js'
import { pruneScratchStateDirs } from '../src/scratch/retention.js'
import { listProcesses, sweepScratch } from '../src/scratch/sweep.js'

let workRoot = ''
const started = new Set<number>()

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'dshx-orphans-spec-'))
  process.env.DSHX_SCRATCH_REGISTRY_DIR = join(workRoot, 'registry')
})

afterEach(() => {
  for (const pid of started) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        // Gone already.
      }
    }
  }
  started.clear()
})

afterAll(async () => {
  delete process.env.DSHX_SCRATCH_REGISTRY_DIR
  await rm(workRoot, { recursive: true, force: true })
})

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const firstChunk = async (stream: Readable | null): Promise<string> => {
  if (stream === null) throw new Error('the process has no stdout pipe')
  for await (const chunk of stream) return String(chunk).trim()
  throw new Error('the process closed stdout before printing')
}

const waitUntil = async (condition: () => boolean, timeoutMs: number): Promise<number> => {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`condition still false after ${String(timeoutMs)} ms`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return Date.now() - startedAt
}

const readPids = async (file: string): Promise<{ readonly child: number; readonly grandchild: number }> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const text = await readFile(file, 'utf8').catch(() => '')
    const [child, grandchild] = text.trim().split(' ').map(Number)
    if (child !== undefined && grandchild !== undefined && child > 0 && grandchild > 0) return { child, grandchild }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${file} never named the guarded pids`)
}

/** A stand-in Host: ignores SIGTERM (as busy orphaned Hosts did), keeps a grandchild, and names both pids. */
const stubbornHostScript = (pidFile: string): string =>
  [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    "process.on('SIGTERM', () => {})",
    "const grandchild = spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    `writeFileSync(${JSON.stringify(pidFile)}, process.pid + ' ' + grandchild.pid)`,
    'setInterval(() => {}, 1000)',
  ].join('\n')

/**
 * The owner stand-in: a separate process that starts the guard exactly as `boot.ts` does (detached, holding its stdin),
 * prints the guard pid and idles until the spec SIGKILLs it.
 */
const ownerScript = [
  "const { spawn } = require('node:child_process')",
  'const guarded = JSON.parse(process.env.GUARDED)',
  "const guard = spawn(guarded.command, guarded.args, { detached: true, env: guarded.env, stdio: ['pipe', 'ignore', 'ignore'] })",
  "if (process.env.RELEASE === '1') guard.stdin.write('release\\n')",
  'process.stdout.write(String(guard.pid) + "\\n")',
  'setInterval(() => {}, 1000)',
].join('\n')

const startOwner = async (options: {
  readonly hostScript: string
  readonly owner?: ScratchOwner
  readonly release?: boolean
}): Promise<{ readonly owner: ChildProcess; readonly guardPid: number }> => {
  const guarded = guardedCommand({
    command: process.execPath,
    args: ['-e', options.hostScript, '--', '--profile', 'dshx-boot'],
    owner: options.owner ?? { ownerPid: 999_999, ownerStartedAt: 1, workspace: workRoot },
    pipe: true,
    recordKind: 'e2e',
    env: process.env,
  })
  // Without an explicit owner the spec drops the marker, so only the pipe can stop the Host.
  const env = options.owner === undefined ? Object.fromEntries(Object.entries(guarded.env).filter(([key]) => key !== 'DSHX_SCRATCH_OWNER')) : guarded.env
  const owner = spawn(process.execPath, ['-e', ownerScript], {
    env: { ...process.env, GUARDED: JSON.stringify({ ...guarded, env }), RELEASE: options.release === true ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (owner.pid !== undefined) started.add(owner.pid)
  const guardPid = Number(await firstChunk(owner.stdout))
  started.add(guardPid)
  return { owner, guardPid }
}

describe('parent-death guard', () => {
  it('stops the guarded command and its whole group within 5 s of its owner being SIGKILLed, even when SIGTERM is ignored', async () => {
    const pidFile = join(workRoot, 'pipe.pids')
    const { owner, guardPid } = await startOwner({ hostScript: stubbornHostScript(pidFile) })
    const { child, grandchild } = await readPids(pidFile)
    expect([isAlive(guardPid), isAlive(child), isAlive(grandchild)]).toEqual([true, true, true])

    owner.kill('SIGKILL')
    const elapsedMs = await waitUntil(() => !isAlive(guardPid) && !isAlive(child) && !isAlive(grandchild), 5_000)
    process.stdout.write(
      `[parent-guard proof] owner SIGKILLed; guard ${String(guardPid)}, host ${String(child)}, grandchild ${String(grandchild)} gone after ${String(elapsedMs)} ms\n`,
    )
    expect(elapsedMs).toBeLessThan(5_000)
  })

  it('stops the command when the marker owner exits, without any pipe', async () => {
    const ownerStandIn = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const ownerPid = ownerStandIn.pid ?? 0
    started.add(ownerPid)
    await waitUntil(() => ScratchRegistry.processStartedAt(ownerPid) !== undefined, 2_000)
    const pidFile = join(workRoot, 'owner.pids')
    const { owner, guardPid } = await startOwner({
      hostScript: stubbornHostScript(pidFile),
      owner: { ownerPid, ownerStartedAt: ScratchRegistry.processStartedAt(ownerPid) ?? 0, workspace: workRoot },
      release: true,
    })
    const { child } = await readPids(pidFile)
    owner.kill('SIGKILL')
    await new Promise(resolve => setTimeout(resolve, 1_500))
    expect(isAlive(child)).toBe(true)

    ownerStandIn.kill('SIGKILL')
    await waitUntil(() => !isAlive(guardPid) && !isAlive(child), 6_000)
  })

  it('writes the registry record while the command runs and removes it on a clean stop', async () => {
    const pidFile = join(workRoot, 'record.pids')
    const owner = ScratchRegistry.currentOwner(workRoot)
    const { guardPid } = await startOwner({ hostScript: stubbornHostScript(pidFile), owner, release: true })
    const { child } = await readPids(pidFile)
    // The guard writes the record once `ps` reports the command's start time, which can land after the command's own first write.
    let records = await ScratchRegistry.readRecords()
    for (let attempt = 0; attempt < 100 && !records.some(record => record.hostPid === child); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      records = await ScratchRegistry.readRecords()
    }
    expect(records.find(record => record.hostPid === child)).toMatchObject({
      hostPid: child,
      ownerPid: process.pid,
      ownerStartedAt: owner.ownerStartedAt,
      workspace: workRoot,
      kind: 'e2e',
    })
    const record = decodeJson(jsonObjectSchema, await readFile(ScratchRegistry.recordPath(child), 'utf8'))
    expect(Object.keys(record).sort()).toEqual(['command', 'hostPid', 'hostStartedAt', 'kind', 'ownerPid', 'ownerStartedAt', 'workspace'])
    expect(record.command).toContain('--profile dshx-boot')

    process.kill(-guardPid, 'SIGTERM')
    await waitUntil(() => !isAlive(guardPid) && !isAlive(child), 6_000)
    expect((await ScratchRegistry.readRecords()).some(entry => entry.hostPid === child)).toBe(false)
  })
})

describe('scratch registry', () => {
  it('parses the owner marker, keeping colons in the workspace path', () => {
    expect(ScratchRegistry.parseOwner('12:1700000000000:/tmp/a:b')).toEqual({ ownerPid: 12, ownerStartedAt: 1_700_000_000_000, workspace: '/tmp/a:b' })
    expect(ScratchRegistry.parseOwner('nope')).toBeUndefined()
    expect(ScratchRegistry.parseOwner(undefined)).toBeUndefined()
  })

  it('calls a record orphaned when its owner is dead or its pid was recycled', () => {
    const startedAtOf = (pid: number): number | undefined => (pid === 10 ? 5_000_000 : undefined)
    expect(ScratchRegistry.isOrphan({ ownerPid: 10, ownerStartedAt: 5_000_500 }, startedAtOf)).toBe(false)
    expect(ScratchRegistry.isOrphan({ ownerPid: 10, ownerStartedAt: 9_000_000 }, startedAtOf)).toBe(true)
    expect(ScratchRegistry.isOrphan({ ownerPid: 11, ownerStartedAt: 5_000_000 }, startedAtOf)).toBe(true)
    expect(ScratchRegistry.isOrphan(ScratchRegistry.currentOwner(workRoot))).toBe(false)
  })

  it('skips unreadable and foreign files', async () => {
    const directory = join(workRoot, 'junk-registry')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, '1.json'), '{not json')
    await writeFile(join(directory, '2.json'), JSON.stringify({ hostPid: 2 }))
    await writeFile(join(directory, 'notes.txt'), 'x')
    expect(await ScratchRegistry.readRecords(directory)).toEqual([])
  })
})

describe('scratch sweep', () => {
  const startFakeHost = async (): Promise<number> => {
    const host = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", '--', '--profile', 'dshx-boot'], {
      detached: true,
      stdio: 'ignore',
    })
    const pid = host.pid ?? 0
    started.add(pid)
    await waitUntil(() => ScratchRegistry.processStartedAt(pid) !== undefined, 2_000)
    return pid
  }

  const writeRecord = async (directory: string, record: ScratchRecord): Promise<void> => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${String(record.hostPid)}.json`), JSON.stringify(record), { mode: 0o600 })
  }

  it('stops Hosts whose owner is gone, keeps owned ones, drops records of exited Hosts and honours --dry-run', async () => {
    const registryDir = join(workRoot, 'sweep-registry')
    const stateRoot = join(workRoot, 'sweep-state')
    const orphan = await startFakeHost()
    const owned = await startFakeHost()
    const deadOwner = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await once(deadOwner, 'exit')
    const me = ScratchRegistry.currentOwner(workRoot)
    const base = { workspace: workRoot, kind: 'e2e', command: 'node --profile dshx-boot' } as const
    await writeRecord(registryDir, {
      ...base,
      hostPid: orphan,
      hostStartedAt: ScratchRegistry.processStartedAt(orphan) ?? 1,
      ownerPid: deadOwner.pid ?? 1,
      ownerStartedAt: 1_000,
    })
    await writeRecord(registryDir, {
      ...base,
      hostPid: owned,
      hostStartedAt: ScratchRegistry.processStartedAt(owned) ?? 1,
      ownerPid: me.ownerPid,
      ownerStartedAt: me.ownerStartedAt,
    })
    await writeRecord(registryDir, { ...base, hostPid: 999_998, hostStartedAt: 1_000, ownerPid: me.ownerPid, ownerStartedAt: me.ownerStartedAt })
    const ours = (): ReturnType<typeof listProcesses> => listProcesses().filter(entry => entry.pid === orphan || entry.pid === owned)

    const preview = await sweepScratch({ dryRun: true, registryDir, stateRoot, graceMs: 300, processes: ours() })
    expect(preview.actions.map(action => `${action.kind} ${String(action.pid)}`).sort()).toEqual([`drop-record 999998`, `stop-orphan ${String(orphan)}`])
    expect(isAlive(orphan)).toBe(true)
    expect((await readdir(registryDir)).length).toBe(3)

    const swept = await sweepScratch({ dryRun: false, registryDir, stateRoot, graceMs: 300, processes: ours() })
    expect(swept.leftRunning).toEqual([])
    expect(swept.live.map(record => record.hostPid)).toEqual([owned])
    await waitUntil(() => !isAlive(orphan), 2_000)
    expect(isAlive(owned)).toBe(true)
    expect((await readdir(registryDir)).sort()).toEqual([`${String(owned)}.json`])
  })

  it('stops legacy orphans with no record only past the age floor, and never a parent-guard', async () => {
    const legacy = spawn(
      'sh',
      ['-c', `${JSON.stringify(process.execPath)} -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)" -- --profile dshx-boot & echo $!`],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    const pid = Number(await firstChunk(legacy.stdout))
    started.add(pid)
    await waitUntil(() => listProcesses().some(entry => entry.pid === pid && entry.ppid === 1), 3_000)
    const registryDir = join(workRoot, 'legacy-registry')
    const stateRoot = join(workRoot, 'legacy-state')
    const ours = (): ReturnType<typeof listProcesses> => listProcesses().filter(entry => entry.pid === pid)

    const young = await sweepScratch({ dryRun: true, registryDir, stateRoot, processes: ours() })
    expect(young.actions).toEqual([])
    const disguised = ours().map(entry => ({ ...entry, command: `${entry.command} parent-guard.js` }))
    expect((await sweepScratch({ dryRun: true, registryDir, stateRoot, legacyMinAgeMs: 0, processes: disguised })).actions).toEqual([])

    const swept = await sweepScratch({ dryRun: false, registryDir, stateRoot, legacyMinAgeMs: 0, graceMs: 300, processes: ours() })
    expect(swept.actions.map(action => [action.kind, action.pid])).toEqual([['stop-legacy', pid]])
    await waitUntil(() => !isAlive(pid), 2_000)
  })
})

describe('scratch state retention', () => {
  it('deletes state dirs untouched for 24 h with no live process and keeps the newest 20 evidence runs', async () => {
    const root = join(workRoot, 'retention')
    const stale = join(root, 'stale')
    const fresh = join(root, 'fresh')
    await mkdir(join(stale, 'evidence'), { recursive: true })
    await mkdir(join(fresh, 'evidence'), { recursive: true })
    for (let index = 0; index < 25; index += 1) {
      const file = join(fresh, 'evidence', `run-${String(index).padStart(2, '0')}.png`)
      await writeFile(file, '')
      const at = new Date(Date.now() - (25 - index) * 60_000)
      await utimes(file, at, at)
    }
    const old = new Date(Date.now() - 48 * 3_600_000)
    for (const path of [join(stale, 'evidence'), stale]) await utimes(path, old, old)

    const preview = await pruneScratchStateDirs({ dryRun: true, root })
    expect(preview.filter(action => action.kind === 'remove-state-dir').map(action => action.target)).toEqual([stale])
    expect(preview.filter(action => action.kind === 'prune-evidence')).toHaveLength(5)
    expect((await readdir(root)).sort()).toEqual(['fresh', 'stale'])

    await pruneScratchStateDirs({ dryRun: false, root })
    expect(await readdir(root)).toEqual(['fresh'])
    const kept = (await readdir(join(fresh, 'evidence'))).sort()
    expect(kept).toHaveLength(20)
    expect(kept[0]).toBe('run-05.png')
  })
})
