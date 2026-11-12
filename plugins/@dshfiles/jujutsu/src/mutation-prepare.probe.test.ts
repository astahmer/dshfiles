import { execFileSync } from 'node:child_process'
import { Jj, JjViewReads } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath, NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { JujutsuServicesLive } from './jujutsu-services.js'
import { Mutations } from './mutations.js'
import { Repositories } from './repositories.js'

/**
 * Drag-preview latency on a real repository: `PREPARE_PROBE_REPO=<workspace> vitest run src/mutation-prepare.probe.test.ts`.
 * It prepares (never confirms) a rebase of `@` onto `@--` and a move of this workspace to `@-`, and prints wall time
 * and the jj processes each one spawned. `status` snapshots that workspace's own working copy; nothing else is written.
 */

const repo = process.env['PREPARE_PROBE_REPO']
const rounds = Number(process.env['PREPARE_PROBE_ROUNDS'] ?? '6')

const commitId = (cwd: string, revision: string): string =>
  execFileSync('jj', ['--ignore-working-copy', 'log', '--no-graph', '-r', revision, '-T', 'commit_id'], { cwd, encoding: 'utf8' }).trim()

const workspaceName = (cwd: string): string =>
  execFileSync('jj', ['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'working_copies'], { cwd, encoding: 'utf8' }).trim().split('@')[0] ?? ''

const countingSpawner = (spawned: string[]) =>
  Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const node = yield* ChildProcessSpawner.ChildProcessSpawner
      return ChildProcessSpawner.make(command => {
        if (command._tag === 'StandardCommand') spawned.push(command.args.map(arg => (typeof arg === 'string' ? arg.slice(0, 60) : '<redacted>')).join(' '))
        return node.spawn(command)
      })
    }),
  ).pipe(Layer.provide(NodeServices.layer))

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0
}

describe.skipIf(repo === undefined)('mutation prepare latency probe', () => {
  it.live(
    'times rebase and workspace-move previews',
    () =>
      Effect.gen(function* () {
        const cwd = repo ?? ''
        const spawned: string[] = []
        const head = commitId(cwd, '@')
        const actions = {
          rebase: { kind: 'rebase', sourceId: head, destinationId: commitId(cwd, '@--') },
          'workspace-edit': { kind: 'workspace-edit', name: workspaceName(cwd), commitId: commitId(cwd, '@-') },
        } as const
        yield* Effect.gen(function* () {
          const { id: repoId } = yield* Repositories.use(repositories => repositories.register(cwd))
          for (const [label, action] of Object.entries(actions)) {
            const timings: number[] = []
            const spawns: number[] = []
            for (let round = 0; round < rounds; round += 1) {
              const mark = spawned.length
              const started = performance.now()
              yield* Mutations.use(mutations => mutations.prepare({ repoId, action }))
              timings.push(performance.now() - started)
              spawns.push(spawned.length - mark)
              if (round === 0 || round === rounds - 1) console.log(label, round === 0 ? 'cold' : 'warm', 'spawned:\n  ' + spawned.slice(mark).join('\n  '))
            }
            const warm = timings.slice(1)
            console.log(
              label,
              JSON.stringify({
                coldMs: Math.round(timings[0] ?? 0),
                coldSpawns: spawns[0],
                warmRounds: warm.length,
                warmP50: Math.round(percentile(warm, 0.5)),
                warmMax: Math.round(Math.max(...warm)),
                warmSpawns: spawns.at(-1),
              }),
            )
          }
        }).pipe(
          Effect.provide(
            JujutsuServicesLive.pipe(
              Layer.provideMerge(JjViewReads.layer),
              Layer.provideMerge(Jj.layer),
              Layer.provideMerge(Layer.mergeAll(countingSpawner(spawned), NodeFileSystem.layer, NodePath.layer)),
            ),
          ),
        )
      }),
    600_000,
  )
})
