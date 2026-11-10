import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { FolderInspector } from './folder-inspection.js'
import { ExecutableLookup, ProjectCommands, ProjectHome, type ProjectCommand } from './project-lifecycle.js'

const toolsAvailable = spawnSync('jj', ['--version']).status === 0 && spawnSync('git', ['--version']).status === 0
Object.assign(process.env, { JJ_CONFIG: '', JJ_USER: 'Test', JJ_EMAIL: 'test@example.com', GIT_TERMINAL_PROMPT: '0' })

const git = (cwd: string, ...args: readonly string[]) =>
  execFileSync('git', ['-c', 'user.email=inspect@example.invalid', '-c', 'user.name=Inspect', ...args], { cwd, stdio: 'ignore' })

/** A scratch tree removed with the test scope: a plain folder, a Git checkout with an origin, a jj repo and a nested folder. */
const scratchTree = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'folder-inspection-')))
    const plain = join(root, 'plain')
    mkdirSync(plain)

    const origin = join(root, 'origin.git')
    mkdirSync(origin)
    git(origin, 'init', '--bare', '--initial-branch=main')
    const seed = join(root, 'seed')
    mkdirSync(seed)
    git(seed, 'init', '--initial-branch=main')
    writeFileSync(join(seed, 'file.txt'), 'one\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'one')
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-u', 'origin', 'main')
    const checkout = join(root, 'checkout')
    execFileSync('git', ['clone', origin, checkout], { stdio: 'ignore' })
    const nested = join(checkout, 'packages', 'app')
    mkdirSync(nested, { recursive: true })

    const jujutsu = join(root, 'jujutsu')
    execFileSync('jj', ['git', 'init', '--colocate', jujutsu], { stdio: 'ignore' })

    const broken = join(root, 'broken')
    mkdirSync(join(broken, '.jj'), { recursive: true })
    writeFileSync(join(broken, '.jj', 'file'), '')

    return { root, plain, checkout, nested, jujutsu, broken }
  }),
  scratch => Effect.sync(() => rmSync(scratch.root, { recursive: true, force: true })),
)

const inspector = (installed: ReadonlyArray<ProjectCommand>) =>
  Effect.gen(function* () {
    const scratch = yield* scratchTree
    const commands = Context.get(yield* Layer.build(ProjectCommands.layer.pipe(Layer.provide(NodeServices.layer))), ProjectCommands)
    const services = yield* Layer.build(
      FolderInspector.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProjectCommands, ProjectCommands.of({ run: commands.run })),
            Layer.succeed(
              ExecutableLookup,
              ExecutableLookup.of({ resolve: command => Effect.succeed(installed.includes(command) ? Option.some(command) : Option.none()) }),
            ),
            NodeServices.layer,
          ),
        ),
        Layer.provide(Layer.succeed(ProjectHome, scratch.root)),
      ),
    )
    return { ...scratch, inspect: Context.get(services, FolderInspector) }
  })

describe.skipIf(!toolsAvailable)('folder inspection', () => {
  it.live('reads a plain folder as no repository and never offers Jujutsu', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { plain, inspect } = yield* inspector(['git', 'jj'])
        expect(yield* inspect.inspect(plain)).toMatchObject({
          kind: 'none',
          repositoryRoot: null,
          gitAbove: false,
          canEnableJujutsu: false,
        })
      }),
    ),
  )

  it.live('reads a Git checkout with its root, origin and default branch, and offers Jujutsu', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, inspect } = yield* inspector(['git', 'jj'])
        expect(yield* inspect.inspect(checkout)).toMatchObject({
          kind: 'git',
          repositoryRoot: checkout,
          defaultBranch: 'main',
          canEnableJujutsu: true,
          reason: null,
        })
      }),
    ),
  )

  it.live('reports a nested folder as part of the checkout above it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { nested, checkout, inspect } = yield* inspector(['git', 'jj'])
        expect(yield* inspect.inspect(nested)).toMatchObject({ kind: 'git', repositoryRoot: checkout, gitAbove: true })
      }),
    ),
  )

  it.live('reads a colocated jj repository as Jujutsu with nothing left to enable', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { jujutsu, inspect } = yield* inspector(['git', 'jj'])
        expect(yield* inspect.inspect(jujutsu)).toMatchObject({ kind: 'jujutsu', repositoryRoot: jujutsu, canEnableJujutsu: false, reason: null })
      }),
    ),
  )

  it.live('does not offer Jujutsu on a Git checkout when jj is missing', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, inspect } = yield* inspector(['git'])
        const found = yield* inspect.inspect(checkout)
        expect(found).toMatchObject({ kind: 'git', canEnableJujutsu: false })
        expect(found.reason).toMatch(/Install jj/u)
      }),
    ),
  )

  it.live('refuses a folder it cannot read and names it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, inspect } = yield* inspector(['git', 'jj'])
        const failure = yield* Effect.flip(inspect.inspect(join(root, 'missing')))
        expect(failure._tag).toBe('FolderUnreadable')
        expect(failure.message).toMatch(/missing/u)
      }),
    ),
  )
})
