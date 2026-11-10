import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { FolderInspector } from './folder-inspection.js'
import { ProjectIdentities } from './project-identities.js'
import { ExecutableLookup, ProjectCommands, ProjectHome } from './project-lifecycle.js'

const toolsAvailable = spawnSync('jj', ['--version']).status === 0 && spawnSync('git', ['--version']).status === 0
Object.assign(process.env, { GIT_TERMINAL_PROMPT: '0' })

const scratchCheckout = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-identities-')))
    const origin = join(root, 'origin.git')
    mkdirSync(origin)
    execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { stdio: 'ignore' })
    const seed = join(root, 'seed')
    mkdirSync(seed)
    execFileSync('git', ['init', '--initial-branch=main', seed], { stdio: 'ignore' })
    writeFileSync(join(seed, 'file.txt'), 'one\n')
    const run = (cwd: string, ...args: readonly string[]) =>
      execFileSync('git', ['-c', 'user.email=identities@example.invalid', '-c', 'user.name=Identities', ...args], { cwd, stdio: 'ignore' })
    run(seed, 'add', '.')
    run(seed, 'commit', '-m', 'one')
    run(seed, 'remote', 'add', 'origin', origin)
    run(seed, 'push', '-u', 'origin', 'main')
    const checkout = join(root, 'checkout')
    execFileSync('git', ['clone', origin, checkout], { stdio: 'ignore' })
    return { root, checkout }
  }),
  scratch => Effect.sync(() => rmSync(scratch.root, { recursive: true, force: true })),
)

/** Counts the git reads the identities issue, so a repeated read shows the cache answering instead of the checkout. */
const identitiesLayer = (root: string, gitReads: { count: number }) =>
  Effect.gen(function* () {
    const real = Context.get(yield* Layer.build(ProjectCommands.layer.pipe(Layer.provide(NodeServices.layer))), ProjectCommands)
    return ProjectIdentities.layer.pipe(
      Layer.provideMerge(FolderInspector.layer),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            ProjectCommands,
            ProjectCommands.of({
              run: input =>
                Effect.tap(real.run(input), () =>
                  Effect.sync(() => {
                    gitReads.count += 1
                  }),
                ),
            }),
          ),
          Layer.succeed(ExecutableLookup, ExecutableLookup.of({ resolve: command => Effect.succeed(Option.some(command)) })),
          NodeServices.layer,
        ),
      ),
      Layer.provide(Layer.succeed(ProjectHome, root)),
    )
  })

describe.skipIf(!toolsAvailable)('project identities', () => {
  it.live('answers a folder from its origin and reuses that inspection for the next read', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scratch = yield* scratchCheckout
        const gitReads = { count: 0 }
        const layer = yield* identitiesLayer(scratch.root, gitReads)
        const services = yield* Layer.build(layer)
        const identities = Context.get(services, ProjectIdentities)

        const first = yield* identities.read([scratch.checkout])
        expect(first).toHaveLength(1)
        expect(first[0]).toMatchObject({ path: scratch.checkout, repositoryRoot: scratch.checkout })
        expect(first[0]?.remoteUrl).toMatch(/origin\.git$/u)
        expect(first[0]?.key).toBe(first[0]?.remoteUrl)
        expect(gitReads.count).toBeGreaterThan(0)

        const readsAfterFirst = gitReads.count
        const second = yield* identities.read([scratch.checkout])
        expect(second).toEqual(first)
        expect(gitReads.count).toBe(readsAfterFirst)
      }),
    ),
  )

  it.live('keeps an unreadable folder as its own identity instead of failing the batch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scratch = yield* scratchCheckout
        const layer = yield* identitiesLayer(scratch.root, { count: 0 })
        const services = yield* Layer.build(layer)
        const identities = Context.get(services, ProjectIdentities)
        const missing = join(scratch.root, 'missing')

        expect(yield* identities.read([scratch.checkout, missing])).toMatchObject([
          { path: scratch.checkout, repositoryRoot: scratch.checkout },
          { path: missing, key: missing, remoteUrl: null, repositoryRoot: null },
        ])
      }),
    ),
  )
})
