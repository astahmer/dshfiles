import { describe, expect, it } from 'vitest'
import type { DevChildProcess } from '../src/dev/types.js'
import { DevSessionStateModel } from '../src/dev/session-state.js'

const child: DevChildProcess = { on: () => child, kill: () => true }

const start = async (): Promise<{ readonly completion: Promise<void> }> => {
  const completion = Promise.resolve()
  return { completion }
}

describe('dev session build region', () => {
  it('ignores a build event from a replaced generation', () => {
    const builds = DevSessionStateModel.nextBuilds(DevSessionStateModel.initialBuilds({ host: true, client: true }), { host: true, client: true })

    expect(DevSessionStateModel.advanceBuild(builds, { generation: builds.generation - 1, face: 'host', kind: 'succeeded' })).toBeUndefined()
    expect(
      DevSessionStateModel.buildsReady(DevSessionStateModel.advanceBuild(builds, { generation: builds.generation, face: 'host', kind: 'succeeded' })!.builds),
    ).toBe(false)
  })

  it('reports the first success per face as initial and keeps a failed rebuild ready', () => {
    let builds = DevSessionStateModel.initialBuilds({ host: true, client: false })
    const first = DevSessionStateModel.advanceBuild(builds, { generation: 0, face: 'host', kind: 'succeeded' })
    expect(first?.initial).toBe(true)
    builds = first!.builds
    expect(DevSessionStateModel.buildsReady(builds)).toBe(true)

    builds = DevSessionStateModel.advanceBuild(builds, { generation: 0, face: 'host', kind: 'failed' })!.builds
    expect(builds.host).toBe('ready-failed')
    expect(DevSessionStateModel.buildsReady(builds)).toBe(true)

    const rebuild = DevSessionStateModel.advanceBuild(builds, { generation: 0, face: 'host', kind: 'succeeded' })
    expect(rebuild?.initial).toBe(false)
    expect(DevSessionStateModel.buildsReady(rebuild!.builds)).toBe(true)
  })

  it('maps each phase to one dev state and never exposes a ready build as a startup failure', () => {
    const builds = { generation: 0, host: 'ready-failed', client: 'failed' } as const
    expect(DevSessionStateModel.projectDevState({ lifecycle: 'open', builds, child: DevSessionStateModel.initialChild })).toMatchObject({
      hostBuild: 'error',
      clientBuild: 'error',
      dshProcess: 'stopped',
    })
    expect(
      DevSessionStateModel.projectDevState({
        lifecycle: 'open',
        builds: { generation: 0, host: 'rebuilding', client: 'building' },
        child: DevSessionStateModel.initialChild,
      }),
    ).toMatchObject({
      hostBuild: 'building',
      clientBuild: 'building',
    })
  })
})

describe('dev session child region', () => {
  it('starts only from pending and reaches running through the accepted transitions', async () => {
    const starting = DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'start', completion: (await start()).completion })
    expect(starting.kind).toBe('starting')
    expect(DevSessionStateModel.transitionChild(starting, { kind: 'spawned', child }).kind).toBe('running')
    expect(DevSessionStateModel.transitionChild(starting, { kind: 'start-failed' })).toEqual({ kind: 'failed' })
    expect(DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'spawned', child })).toEqual(DevSessionStateModel.initialChild)
  })

  it('turns an unexpected exit into a failed child that no rebuild restarts', () => {
    const running = DevSessionStateModel.transitionChild(
      DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'start', completion: Promise.resolve() }),
      { kind: 'spawned', child },
    )
    const failed = DevSessionStateModel.transitionChild(running, { kind: 'exited' })
    expect(failed).toEqual({ kind: 'failed' })
    expect(DevSessionStateModel.transitionChild(failed, { kind: 'start', completion: Promise.resolve() })).toEqual({ kind: 'failed' })
  })

  it('keeps a manual Host rebuild as a restart requirement until the child is restarted', () => {
    const running = DevSessionStateModel.transitionChild(
      DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'start', completion: Promise.resolve() }),
      { kind: 'spawned', child },
    )
    const required = DevSessionStateModel.transitionChild(running, { kind: 'restart-required' })
    expect(required.kind).toBe('restart-required')
    expect(DevSessionStateModel.isChildRunning(required)).toBe(true)
    expect(
      DevSessionStateModel.projectDevState({ lifecycle: 'open', builds: DevSessionStateModel.initialBuilds({ host: false, client: false }), child: required })
        .hostRestartRequired,
    ).toBe(true)
    expect(DevSessionStateModel.transitionChild(required, { kind: 'stopped' })).toEqual(DevSessionStateModel.initialChild)
    expect(DevSessionStateModel.transitionChild(required, { kind: 'reset' })).toEqual(DevSessionStateModel.initialChild)
  })

  it('lets a project reload invalidate a start that is still in flight', async () => {
    const starting = DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'start', completion: (await start()).completion })
    expect(starting.kind).toBe('starting')
    expect(DevSessionStateModel.transitionChild(starting, { kind: 'reset' })).toEqual(DevSessionStateModel.initialChild)
    expect(DevSessionStateModel.transitionChild(starting, { kind: 'stopped' }).kind).toBe('starting')
  })

  it('never leaves the terminal child state', () => {
    const ended = DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'ended' })
    for (const event of [
      { kind: 'start', completion: Promise.resolve() },
      { kind: 'spawned', child },
      { kind: 'exited' },
      { kind: 'reset' },
      { kind: 'stopped' },
    ] as const) {
      expect(DevSessionStateModel.transitionChild(ended, event)).toEqual({ kind: 'ended' })
    }
  })
})

describe('dev session reload region', () => {
  it('coalesces changes, keeping the latest file for the next pass', () => {
    const queued = DevSessionStateModel.requestReload(DevSessionStateModel.initialReload, 'a.ts')
    expect(queued).toEqual({ kind: 'queued', changedFile: 'a.ts' })
    expect(DevSessionStateModel.requestReload(queued, 'b.ts')).toEqual({ kind: 'queued', changedFile: 'b.ts' })

    const running = DevSessionStateModel.beginReload(DevSessionStateModel.requestReload(queued, 'c.ts'))
    expect(running?.changedFile).toBe('c.ts')
    const busy = DevSessionStateModel.requestReload(running!.phase, 'd.ts')
    expect(busy).toEqual({ kind: 'running', changedFile: 'c.ts', next: 'd.ts' })
    expect(DevSessionStateModel.finishReload(busy)).toEqual({ kind: 'queued', changedFile: 'd.ts' })
    expect(DevSessionStateModel.finishReload(running!.phase)).toEqual(DevSessionStateModel.initialReload)
    expect(DevSessionStateModel.beginReload(DevSessionStateModel.initialReload)).toBeUndefined()
  })
})

describe('dev session lifecycle', () => {
  it('projects every shutting-down lifecycle as a stopped DSH process', () => {
    const builds = DevSessionStateModel.initialBuilds({ host: false, client: false })
    const running = DevSessionStateModel.transitionChild(
      DevSessionStateModel.transitionChild(DevSessionStateModel.initialChild, { kind: 'start', completion: Promise.resolve() }),
      { kind: 'spawned', child },
    )
    expect(DevSessionStateModel.projectDevState({ lifecycle: 'open', builds, child: running }).dshProcess).toBe('running')
    for (const lifecycle of ['closing', 'closed'] as const) {
      expect(DevSessionStateModel.isClosed(lifecycle)).toBe(true)
      expect(DevSessionStateModel.projectDevState({ lifecycle, builds, child: running })).toMatchObject({ dshProcess: 'stopped', hostRestartRequired: false })
    }
  })
})
