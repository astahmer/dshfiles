import { describe, expect, it } from 'vitest'
import type { DevChildProcess } from '../src/dev/types.js'
import {
  advanceBuild,
  beginReload,
  buildsReady,
  finishReload,
  initialBuilds,
  initialChild,
  initialReload,
  isChildRunning,
  isClosed,
  nextBuilds,
  projectDevState,
  requestReload,
  transitionChild,
} from '../src/dev/session-state.js'

const child = { on: () => child, kill: () => true } as unknown as DevChildProcess

const start = async (): Promise<{ readonly completion: Promise<void> }> => {
  const completion = Promise.resolve()
  return { completion }
}

describe('dev session build region', () => {
  it('ignores a build event from a replaced generation', () => {
    const builds = nextBuilds(initialBuilds({ host: true, client: true }), { host: true, client: true })

    expect(advanceBuild(builds, { generation: builds.generation - 1, face: 'host', kind: 'succeeded' })).toBeUndefined()
    expect(buildsReady(advanceBuild(builds, { generation: builds.generation, face: 'host', kind: 'succeeded' })!.builds)).toBe(false)
  })

  it('reports the first success per face as initial and keeps a failed rebuild ready', () => {
    let builds = initialBuilds({ host: true, client: false })
    const first = advanceBuild(builds, { generation: 0, face: 'host', kind: 'succeeded' })
    expect(first?.initial).toBe(true)
    builds = first!.builds
    expect(buildsReady(builds)).toBe(true)

    builds = advanceBuild(builds, { generation: 0, face: 'host', kind: 'failed' })!.builds
    expect(builds.host).toBe('ready-failed')
    expect(buildsReady(builds)).toBe(true)

    const rebuild = advanceBuild(builds, { generation: 0, face: 'host', kind: 'succeeded' })
    expect(rebuild?.initial).toBe(false)
    expect(buildsReady(rebuild!.builds)).toBe(true)
  })

  it('maps each phase to one dev state and never exposes a ready build as a startup failure', () => {
    const builds = { generation: 0, host: 'ready-failed', client: 'failed' } as const
    expect(projectDevState({ lifecycle: 'open', builds, child: initialChild })).toMatchObject({
      hostBuild: 'error',
      clientBuild: 'error',
      dshProcess: 'stopped',
    })
    expect(projectDevState({ lifecycle: 'open', builds: { generation: 0, host: 'rebuilding', client: 'building' }, child: initialChild })).toMatchObject({
      hostBuild: 'building',
      clientBuild: 'building',
    })
  })
})

describe('dev session child region', () => {
  it('starts only from pending and reaches running through the accepted transitions', async () => {
    const starting = transitionChild(initialChild, { kind: 'start', completion: (await start()).completion })
    expect(starting.kind).toBe('starting')
    expect(transitionChild(starting, { kind: 'spawned', child }).kind).toBe('running')
    expect(transitionChild(starting, { kind: 'start-failed' })).toEqual({ kind: 'failed' })
    expect(transitionChild(initialChild, { kind: 'spawned', child })).toEqual(initialChild)
  })

  it('turns an unexpected exit into a failed child that no rebuild restarts', () => {
    const running = transitionChild(transitionChild(initialChild, { kind: 'start', completion: Promise.resolve() }), { kind: 'spawned', child })
    const failed = transitionChild(running, { kind: 'exited' })
    expect(failed).toEqual({ kind: 'failed' })
    expect(transitionChild(failed, { kind: 'start', completion: Promise.resolve() })).toEqual({ kind: 'failed' })
  })

  it('keeps a manual Host rebuild as a restart requirement until the child is restarted', () => {
    const running = transitionChild(transitionChild(initialChild, { kind: 'start', completion: Promise.resolve() }), { kind: 'spawned', child })
    const required = transitionChild(running, { kind: 'restart-required' })
    expect(required.kind).toBe('restart-required')
    expect(isChildRunning(required)).toBe(true)
    expect(projectDevState({ lifecycle: 'open', builds: initialBuilds({ host: false, client: false }), child: required }).hostRestartRequired).toBe(true)
    expect(transitionChild(required, { kind: 'stopped' })).toEqual(initialChild)
    expect(transitionChild(required, { kind: 'reset' })).toEqual(initialChild)
  })

  it('lets a project reload invalidate a start that is still in flight', async () => {
    const starting = transitionChild(initialChild, { kind: 'start', completion: (await start()).completion })
    expect(starting.kind).toBe('starting')
    expect(transitionChild(starting, { kind: 'reset' })).toEqual(initialChild)
    expect(transitionChild(starting, { kind: 'stopped' }).kind).toBe('starting')
  })

  it('never leaves the terminal child state', () => {
    const ended = transitionChild(initialChild, { kind: 'ended' })
    for (const event of [
      { kind: 'start', completion: Promise.resolve() },
      { kind: 'spawned', child },
      { kind: 'exited' },
      { kind: 'reset' },
      { kind: 'stopped' },
    ] as const) {
      expect(transitionChild(ended, event)).toEqual({ kind: 'ended' })
    }
  })
})

describe('dev session reload region', () => {
  it('coalesces changes, keeping the latest file for the next pass', () => {
    const queued = requestReload(initialReload, 'a.ts')
    expect(queued).toEqual({ kind: 'queued', changedFile: 'a.ts' })
    expect(requestReload(queued, 'b.ts')).toEqual({ kind: 'queued', changedFile: 'b.ts' })

    const running = beginReload(requestReload(queued, 'c.ts'))
    expect(running?.changedFile).toBe('c.ts')
    const busy = requestReload(running!.phase, 'd.ts')
    expect(busy).toEqual({ kind: 'running', changedFile: 'c.ts', next: 'd.ts' })
    expect(finishReload(busy)).toEqual({ kind: 'queued', changedFile: 'd.ts' })
    expect(finishReload(running!.phase)).toEqual(initialReload)
    expect(beginReload(initialReload)).toBeUndefined()
  })
})

describe('dev session lifecycle', () => {
  it('projects every shutting-down lifecycle as a stopped DSH process', () => {
    const builds = initialBuilds({ host: false, client: false })
    const running = transitionChild(transitionChild(initialChild, { kind: 'start', completion: Promise.resolve() }), { kind: 'spawned', child })
    expect(projectDevState({ lifecycle: 'open', builds, child: running }).dshProcess).toBe('running')
    for (const lifecycle of ['closing', 'closed'] as const) {
      expect(isClosed(lifecycle)).toBe(true)
      expect(projectDevState({ lifecycle, builds, child: running })).toMatchObject({ dshProcess: 'stopped', hostRestartRequired: false })
    }
  })
})
