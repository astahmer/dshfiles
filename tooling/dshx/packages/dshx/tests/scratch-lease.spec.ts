import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyLease, leaseOf, ScratchStateRuntime, type ScratchState } from '../src/scratch/state.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const baseState = (stateDir: string): ScratchState => ({
  schemaVersion: 1,
  name: 'lease',
  createdAt: new Date().toISOString(),
  stateDir,
  home: join(stateDir, 'home'),
  profile: 'dshx-boot',
  port: 45999,
  origin: 'http://127.0.0.1:45999',
  launchUrl: 'http://127.0.0.1:45999/?token=secret',
  bundles: ['@dshfiles/tool-meta'],
  expectedClientEntries: ['@dshfiles/tool-meta'],
  project: { path: join(stateDir, 'sample'), workspaceId: 'workspace', ownedByScratch: true },
  host: { pid: 999_999, signature: ['--profile dshx-boot'] },
  browser: { pid: 999_998, signature: ['browser-host.js'], cdpPort: 46000 },
  hostLog: join(stateDir, 'host.log'),
  browserLog: join(stateDir, 'browser.log'),
  browserEvents: join(stateDir, 'browser-events.jsonl'),
  evidenceDir: join(stateDir, 'evidence'),
})

const instance = async (): Promise<ScratchState> => {
  const stateDir = await mkdtemp(join(tmpdir(), 'dshx-lease-'))
  temporaryDirectories.push(stateDir)
  await ScratchStateRuntime.write(baseState(stateDir))
  return ScratchStateRuntime.read(stateDir, 'lease')
}

describe('scratch lease phase', () => {
  it('normalizes a state file written before the lease phase existed', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dshx-lease-'))
    temporaryDirectories.push(stateDir)
    const legacyState = baseState(stateDir)
    legacyState.kept = true
    await writeFile(join(stateDir, 'state.json'), JSON.stringify(legacyState), 'utf8')

    const stored = await ScratchStateRuntime.read(stateDir, 'lease')
    expect(leaseOf(stored)).toEqual({ kind: 'pinned' })
    expect(stored.kept).toBeUndefined()

    const warning = baseState(stateDir)
    warning.warnedAt = new Date().toISOString()
    await writeFile(join(stateDir, 'state.json'), JSON.stringify(warning), 'utf8')
    expect(leaseOf(await ScratchStateRuntime.read(stateDir, 'lease')).kind).toBe('warned')
  })

  it('keeps one phase: a pinned instance cannot re-enter its warning', async () => {
    const pinned = applyLease(await instance(), { kind: 'pin' })
    expect(applyLease(pinned, { kind: 'warn', warnedAt: new Date().toISOString() })).toBe(pinned)
  })

  it('clears a pending warning when the lease is answered or pinned', async () => {
    const warned = applyLease(await instance(), { kind: 'warn', warnedAt: new Date().toISOString() })
    expect(leaseOf(applyLease(warned, { kind: 'keep' }))).toEqual({ kind: 'active' })
    expect(leaseOf(applyLease(warned, { kind: 'pin' }))).toEqual({ kind: 'pinned' })
  })

  it('keeps a pinned instance pinned when a plain keep renews its lease', async () => {
    const pinned = await ScratchStateRuntime.keepScratch({ stateDir: (await instance()).stateDir, name: 'lease', forever: true })
    const renewed = await ScratchStateRuntime.keepScratch({ stateDir: pinned.state.stateDir, name: 'lease', forever: false })
    expect(leaseOf(renewed.state)).toEqual({ kind: 'pinned' })
  })

  it('reports a pinned instance as kept with no idle timeout', async () => {
    const pinned = await ScratchStateRuntime.keepScratch({ stateDir: (await instance()).stateDir, name: 'lease', forever: true })
    expect(ScratchStateRuntime.publicState(pinned.state)).toMatchObject({ kept: true, idleTimeoutMinutes: 0 })
  })

  it('serializes a lease write behind another state write instead of overwriting it', async () => {
    const state = await instance()
    let pending: Promise<void> | undefined
    await ScratchStateRuntime.withLock(state.stateDir, async () => {
      pending = ScratchStateRuntime.trackFakeProvider(state, { pid: 4242, signature: ['fake-provider-main.js'] })
      await ScratchStateRuntime.write({ ...state, bundles: ['@dshfiles/changed'] })
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    await pending

    const stored = await ScratchStateRuntime.read(state.stateDir, 'lease')
    expect(stored.bundles).toEqual(['@dshfiles/changed'])
    expect(stored.fakeProvider?.pid).toBe(4242)
  })

  it('answers a warning under the lock and renews the lease', async () => {
    const state = await instance()
    const warnedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    await ScratchStateRuntime.write(applyLease(state, { kind: 'warn', warnedAt }))
    const warned = await ScratchStateRuntime.read(state.stateDir, 'lease')
    expect(ScratchStateRuntime.scratchWarning(warned, Date.now())?.minutesLeft).toBeGreaterThan(0)

    const before = (await stat(join(state.stateDir, 'state.json'))).mtimeMs
    await new Promise(resolve => setTimeout(resolve, 10))
    const answered = await ScratchStateRuntime.cancelWarning({ stateDir: state.stateDir, name: 'lease' })
    expect(answered.cancelled).toBe(true)
    expect(leaseOf(answered.state)).toEqual({ kind: 'active' })
    expect((await stat(join(state.stateDir, 'state.json'))).mtimeMs).toBeGreaterThan(before)

    const untouched = await ScratchStateRuntime.cancelWarning({ stateDir: state.stateDir, name: 'lease' })
    expect(untouched.cancelled).toBe(false)
    expect(leaseOf(await ScratchStateRuntime.read(state.stateDir, 'lease'))).toEqual({ kind: 'active' })
  })
})
