import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { decodeJson, jsonObjectSchema } from '../src/json.js'
import { guardedCommand } from '../src/scratch/guarded-spawn.js'
import { ScratchRegistry, type ScratchOwner } from '../src/scratch/registry.js'

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
