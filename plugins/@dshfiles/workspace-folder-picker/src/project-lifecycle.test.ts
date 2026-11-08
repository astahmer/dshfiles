import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Option, Schedule, Schema, Tracer } from 'effect'
import { localCloneUrlSchema, projectFolderNameSchema } from './project-lifecycle-api.js'
import {
  CloneJobs,
  ExecutableLookup,
  ProjectCommands,
  ProjectCreator,
  ProjectHome,
  ProjectLifecycleModel,
  ProjectRegistry,
  type CommandInput,
  type ProjectCommand,
} from './project-lifecycle.js'

const accepts = (schema: Schema.ConstraintDecoder<string>, value: string): boolean => Schema.decodeUnknownResult(schema)(value)._tag === 'Success'

const toolsAvailable = spawnSync('jj', ['--version']).status === 0 && spawnSync('git', ['--version']).status === 0
const testEnvironment = { JJ_CONFIG: '', JJ_USER: 'Test', JJ_EMAIL: 'test@example.com', GIT_TERMINAL_PROMPT: '0' }
Object.assign(process.env, testEnvironment)

describe('project lifecycle inputs', () => {
  it.effect('accepts https, ssh, git@ and file:/// URLs and rejects option-like or relative ones', () =>
    Effect.sync(() => {
      for (const url of ['https://github.com/a/b.git', 'ssh://git@host/a/b', 'git@github.com:a/b.git', 'file:///tmp/repo'])
        expect(accepts(localCloneUrlSchema, url)).toBe(true)
      for (const url of ['--upload-pack=x', '../repo', 'file://host/repo', 'http://plain.example/repo']) expect(accepts(localCloneUrlSchema, url)).toBe(false)
    }),
  )

  it.effect('accepts one folder name and rejects separators, dot-dot and leading dashes', () =>
    Effect.sync(() => {
      expect(accepts(projectFolderNameSchema, 'my-project_2')).toBe(true)
      for (const name of ['a/b', '..', '-rf', '.hidden', '']) expect(accepts(projectFolderNameSchema, name)).toBe(false)
    }),
  )

  it.effect('reads the last git progress line, its stage and its percent', () =>
    Effect.sync(() => {
      expect(ProjectLifecycleModel.readProgress('Cloning into x...\rReceiving objects:  33% (1/3)\rReceiving objects:  66% (2/3)\r')).toEqual({
        percent: 66,
        stage: 'receiving',
        message: 'Receiving objects:  66% (2/3)',
      })
      expect(ProjectLifecycleModel.readProgress('Cloning into x...\n')?.stage).toBe('connecting')
      expect(ProjectLifecycleModel.readProgress('Resolving deltas: 100% (3/3), done.\n')?.stage).toBe('resolving')
      expect(ProjectLifecycleModel.readProgress('Checking out files: 100% (3/3)\n')?.stage).toBe('checkout')
      expect(ProjectLifecycleModel.readProgress('Cloning into x...\n')).toEqual({ percent: null, stage: 'connecting', message: 'Cloning into x...' })
      expect(ProjectLifecycleModel.readProgress('\r\n')).toBeUndefined()
    }),
  )
})

/** A scratch home with a jj-colocated origin repository; removed with the test scope. */
const scratchHome = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-lifecycle-')))
    const origin = join(root, 'origin')
    execFileSync('jj', ['git', 'init', '--colocate', origin], { stdio: 'ignore' })
    writeFileSync(join(origin, 'file.txt'), 'one\n')
    execFileSync('jj', ['commit', '-m', 'one'], { cwd: origin, stdio: 'ignore' })
    execFileSync('jj', ['bookmark', 'create', 'main', '-r', '@-'], { cwd: origin, stdio: 'ignore' })
    return { root, origin }
  }),
  scratch => Effect.sync(() => rmSync(scratch.root, { recursive: true, force: true })),
)

/**
 * The real lifecycle over real git, jj and the Node spawner. GitHub and the DSH workspace registry are external: `gh`
 * is answered by `fakeCommand` when given, and registration is recorded.
 */
const lifecycle = (input: {
  readonly installed: ReadonlyArray<ProjectCommand>
  readonly fakeCommand?: (
    command: CommandInput,
  ) => Option.Option<Effect.Effect<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>>
}) =>
  Effect.gen(function* () {
    const scratch = yield* scratchHome
    const registered: string[] = []
    const real = Context.get(yield* Layer.build(ProjectCommands.layer.pipe(Layer.provide(NodeServices.layer))), ProjectCommands)
    const commands = Layer.succeed(
      ProjectCommands,
      ProjectCommands.of({
        run: command =>
          Option.match(input.fakeCommand?.(command) ?? Option.none(), {
            onNone: () => real.run(command),
            onSome: answer => answer,
          }),
      }),
    )
    const fakes = Layer.mergeAll(
      commands,
      Layer.succeed(
        ExecutableLookup,
        ExecutableLookup.of({ resolve: command => Effect.succeed(input.installed.includes(command) ? Option.some(command) : Option.none()) }),
      ),
      Layer.succeed(
        ProjectRegistry,
        ProjectRegistry.of({
          register: path =>
            Effect.sync(() => {
              registered.push(path)
              return { workspaceId: `ws-${String(registered.length)}`, title: path.split('/').at(-1) ?? path, path }
            }),
        }),
      ),
      NodeServices.layer,
    )
    const services = yield* Layer.build(
      Layer.mergeAll(CloneJobs.layer, ProjectCreator.layer).pipe(Layer.provideMerge(fakes), Layer.provide(Layer.succeed(ProjectHome, scratch.root))),
    )
    return {
      ...scratch,
      registered,
      jobs: Context.get(services, CloneJobs),
      creator: Context.get(services, ProjectCreator),
      fs: Context.get(services, FileSystem.FileSystem),
    }
  })

const settled = (jobs: CloneJobs['Service'], jobId: string) =>
  jobs
    .get(jobId)
    .pipe(
      Effect.repeat({ schedule: Schedule.spaced('25 millis'), until: job => Option.isSome(job) && job.value.state !== 'running' }),
      Effect.map(Option.getOrThrow),
      Effect.timeout('10 seconds'),
    )

const recordSpans = () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span: options => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  return { attribute: (name: string, key: string) => spans.find(span => span.name === name)?.attributes.get(key), tracer }
}

describe.skipIf(!toolsAvailable)('project lifecycle against real git and jj', () => {
  it.live('clones a file:// repository in the background, colocates jj and registers it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = recordSpans()
        const { root, origin, registered, jobs, fs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const job = yield* Effect.withTracer(jobs.start({ repositoryUrl: `file://${origin}`, parentPath: '~/', name: 'clone' }), recorder.tracer)
        expect(job).toMatchObject({ state: 'running', phase: 'cloning', path: join(root, 'clone') })
        expect(yield* settled(jobs, job.id)).toMatchObject({ state: 'succeeded', phase: 'done', workspaceId: 'ws-1', error: null })
        expect(yield* fs.exists(join(root, 'clone', '.jj'))).toBe(true)
        expect(yield* fs.readFileString(join(root, 'clone', 'file.txt'))).toBe('one\n')
        expect(registered).toEqual([join(root, 'clone')])
        expect(recorder.attribute('project clone', 'dshx.clone.state')).toBe('succeeded')
      }),
    ),
  )

  it.live('returns the running job for the same destination and refuses an existing folder', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, origin, jobs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const first = yield* jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })
        expect((yield* jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })).id).toBe(first.id)
        yield* settled(jobs, first.id)
        const refused = yield* Effect.flip(jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' }))
        expect(refused._tag).toBe('DestinationExists')
        expect((yield* jobs.list).map(job => job.id)).toEqual([first.id])
      }),
    ),
  )

  it.live('admits one clone for a destination when two starts race for it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, origin, jobs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const started = yield* Effect.all(
          [
            jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' }),
            jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' }),
          ],
          { concurrency: 'unbounded' },
        )
        expect(new Set(started.map(job => job.id)).size).toBe(1)
        expect(yield* settled(jobs, started[0]?.id ?? '')).toMatchObject({ state: 'succeeded' })
        expect((yield* jobs.list).length).toBe(1)
      }),
    ),
  )

  it.live('fails a clone of a missing repository and leaves no folder behind', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, registered, jobs, fs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const job = yield* jobs.start({ repositoryUrl: `file://${join(root, 'missing')}`, parentPath: root, name: 'clone' })
        const failed = yield* settled(jobs, job.id)
        expect(failed.state).toBe('failed')
        expect(failed.error).toMatch(/does not exist|not appear to be a git repository/u)
        expect(yield* fs.exists(join(root, 'clone'))).toBe(false)
        expect(registered).toEqual([])
      }),
    ),
  )

  it.live('keeps a checkout that failed after it started, then retries clean into the same folder', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0
        const failAfterCheckout = (command: CommandInput) => {
          if (command.argv[1] !== 'clone') return Option.none()
          attempts += 1
          if (attempts > 1) return Option.none()
          return Option.some(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem
              const destination = command.argv.at(-1) ?? ''
              yield* fs.makeDirectory(destination).pipe(Effect.orDie)
              yield* fs.writeFileString(join(destination, 'half.txt'), 'partial').pipe(Effect.orDie)
              yield* command.onStderr?.('Checking out files:  50% (1/2)\r') ?? Effect.void
              return { exitCode: 1, stdout: '', stderr: 'fatal: the remote end hung up unexpectedly' }
            }).pipe(Effect.provide(NodeServices.layer)),
          )
        }
        const { root, origin, registered, jobs, fs } = yield* lifecycle({ installed: ['git', 'jj'], fakeCommand: failAfterCheckout })
        const failed = yield* settled(jobs, (yield* jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'kept' })).id)
        expect(failed.state).toBe('failed')
        expect(failed.error).toMatch(/partial checkout is kept/u)
        expect(yield* fs.exists(join(root, 'kept', 'half.txt'))).toBe(true)
        expect(registered).toEqual([])
        const retried = yield* jobs.retry(failed.id)
        const succeeded = yield* settled(jobs, retried.id)
        expect(succeeded.state).toBe('succeeded')
        expect(yield* fs.exists(join(root, 'kept', 'half.txt'))).toBe(false)
        expect(registered).toEqual([join(root, 'kept')])
      }),
    ),
  )

  it.live('cancels a running clone, deletes its partial folder and never registers it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const slowClone = (command: CommandInput) =>
          command.argv[1] === 'clone'
            ? Option.some(
                Effect.gen(function* () {
                  const fs = yield* FileSystem.FileSystem
                  yield* fs.makeDirectory(command.argv.at(-1) ?? '').pipe(Effect.orDie)
                  yield* command.onStderr?.('Receiving objects:  10% (1/10)\r') ?? Effect.void
                  return yield* Effect.never
                }).pipe(Effect.provide(NodeServices.layer)),
              )
            : Option.none()
        const { root, origin, registered, jobs, fs } = yield* lifecycle({ installed: ['git', 'jj'], fakeCommand: slowClone })
        const job = yield* jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })
        yield* jobs
          .get(job.id)
          .pipe(Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: current => Option.isSome(current) && current.value.progress.percent === 10 }))
        expect((yield* jobs.cancel(job.id)).state).toBe('running')
        expect((yield* settled(jobs, job.id)).state).toBe('cancelled')
        expect(yield* fs.exists(join(root, 'clone'))).toBe(false)
        expect(registered).toEqual([])
        expect((yield* Effect.flip(jobs.cancel('clone-unknown')))._tag).toBe('JobMissing')
      }),
    ),
  )

  it.live('creates a colocated jj project with a README, a described first commit on main, and registers it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = recordSpans()
        const { root, creator, fs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const created = yield* Effect.withTracer(creator.create({ parentPath: '~/', name: 'fresh', createGitHubRepository: false }), recorder.tracer)
        const path = join(root, 'fresh')
        expect(created).toEqual({ path, workspaceId: 'ws-1', title: 'fresh', gitHubRepository: null, warning: null })
        expect(yield* fs.readFileString(join(path, 'README.md'))).toBe('# fresh\n')
        expect(yield* fs.exists(join(path, '.git'))).toBe(true)
        const log = execFileSync('jj', ['log', '--no-graph', '-r', 'main', '-T', 'description'], { cwd: path, encoding: 'utf8' })
        expect(log.trim()).toBe('chore: initialize fresh')
        expect(recorder.attribute('project create', 'dshx.project.github')).toBe(false)
      }),
    ),
  )

  it.live('refuses GitHub creation without gh before touching the disk', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, creator, fs } = yield* lifecycle({ installed: ['git', 'jj'] })
        expect((yield* Effect.flip(creator.create({ parentPath: root, name: 'fresh', createGitHubRepository: true })))._tag).toBe('GhMissing')
        expect(yield* fs.exists(join(root, 'fresh'))).toBe(false)
      }),
    ),
  )

  it.live('creates a private GitHub repository through gh and pushes main when opted in', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ghCalls: (readonly string[])[] = []
        const bareRepository = { path: '' }
        const fakeGh = (command: CommandInput) =>
          command.argv[0] === 'gh'
            ? Option.some(
                Effect.sync(() => {
                  ghCalls.push(command.argv)
                  execFileSync('git', ['remote', 'add', 'origin', bareRepository.path], { cwd: command.cwd })
                  return { exitCode: 0, stdout: 'https://github.com/test/fresh\n', stderr: '' }
                }),
              )
            : Option.none()
        const { root, creator } = yield* lifecycle({ installed: ['git', 'jj', 'gh'], fakeCommand: fakeGh })
        bareRepository.path = join(root, 'remote.git')
        execFileSync('git', ['init', '--bare', bareRepository.path], { stdio: 'ignore' })
        const created = yield* creator.create({ parentPath: root, name: 'fresh', createGitHubRepository: true })
        expect(ghCalls).toEqual([['gh', 'repo', 'create', 'fresh', '--private', '--source', '.', '--remote', 'origin']])
        expect(created).toMatchObject({ gitHubRepository: 'https://github.com/test/fresh', warning: null })
        expect(execFileSync('git', ['--git-dir', bareRepository.path, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim()).toBe(
          'chore: initialize fresh',
        )
      }),
    ),
  )

  it.live('keeps the project and warns with the next command when gh fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failingGh = (command: CommandInput) =>
          command.argv[0] === 'gh' ? Option.some(Effect.succeed({ exitCode: 1, stdout: '', stderr: 'not logged in' })) : Option.none()
        const { root, registered, creator } = yield* lifecycle({ installed: ['git', 'jj', 'gh'], fakeCommand: failingGh })
        const created = yield* creator.create({ parentPath: root, name: 'fresh', createGitHubRepository: true })
        expect(created.gitHubRepository).toBeNull()
        expect(created.warning).toContain('gh auth status')
        expect(registered).toEqual([join(root, 'fresh')])
      }),
    ),
  )

  it.live('turns an existing folder into a project in place and keeps its files', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, registered, creator, fs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const folder = join(root, 'existing')
        yield* fs.makeDirectory(folder)
        yield* fs.writeFileString(join(folder, 'notes.md'), 'kept\n')
        const project = yield* creator.initialize({ path: folder })
        expect(project).toMatchObject({ path: folder, workspaceId: 'ws-1' })
        expect(registered).toEqual([folder])
        expect(yield* fs.exists(join(folder, '.jj'))).toBe(true)
        expect(yield* fs.readFileString(join(folder, 'notes.md'))).toBe('kept\n')
        expect(yield* fs.readFileString(join(folder, 'README.md'))).toBe('# existing\n')
        const log = execFileSync('jj', ['log', '--no-graph', '-T', 'description.first_line() ++ "\\n"', '-r', '@-'], { cwd: folder, encoding: 'utf8' })
        expect(log.trim()).toBe('chore: initialize existing')
        const bookmarks = execFileSync('jj', ['bookmark', 'list', '--template', 'self.name()'], { cwd: folder, encoding: 'utf8' })
        expect(bookmarks.trim()).toBe('main')
      }),
    ),
  )

  it.live('retries a failed clone into the same destination as a new job and refuses other states', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, origin, jobs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const failed = yield* settled(jobs, (yield* jobs.start({ repositoryUrl: `file://${join(root, 'missing')}`, parentPath: root, name: 'retried' })).id)
        expect(failed.state).toBe('failed')
        expect((yield* Effect.flip(jobs.retry('clone-unknown')))._tag).toBe('JobMissing')
        const retried = yield* jobs.retry(failed.id)
        expect(retried).toMatchObject({ path: failed.path, state: 'running' })
        expect(retried.id).not.toBe(failed.id)
        expect((yield* settled(jobs, retried.id)).state).toBe('failed')
        const succeeded = yield* settled(jobs, (yield* jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'succeeded' })).id)
        expect(succeeded.state).toBe('succeeded')
        expect((yield* Effect.flip(jobs.retry(succeeded.id)))._tag).toBe('CloneNotRetryable')
      }),
    ),
  )

  it.live('publishes a local jj checkout that has no origin and pushes its bookmark', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bareRepository = { path: '' }
        const fakeGh = (command: CommandInput) =>
          command.argv[0] === 'gh'
            ? Option.some(
                Effect.sync(() => {
                  execFileSync('git', ['remote', 'add', 'origin', bareRepository.path], { cwd: command.cwd })
                  return { exitCode: 0, stdout: 'https://github.com/test/published\n', stderr: '' }
                }),
              )
            : Option.none()
        const { root, creator, fs } = yield* lifecycle({ installed: ['git', 'jj', 'gh'], fakeCommand: fakeGh })
        const path = join(root, 'to-publish')
        bareRepository.path = join(root, 'remote.git')
        execFileSync('git', ['init', '--bare', bareRepository.path], { stdio: 'ignore' })
        yield* fs.makeDirectory(path)
        yield* creator.initialize({ path })
        const published = yield* creator.publish({ path, visibility: 'private' })
        expect(published).toMatchObject({ repository: 'https://github.com/test/published', pushed: true, warning: null })
        expect(execFileSync('git', ['--git-dir', bareRepository.path, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim()).toBe(
          'chore: initialize to-publish',
        )
      }),
    ),
  )

  it.live('refuses to publish a folder without a repository, a repository with an origin, and one without commits', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, creator, fs } = yield* lifecycle({ installed: ['git', 'jj', 'gh'] })
        const plain = join(root, 'plain-publish')
        yield* fs.makeDirectory(plain)
        expect((yield* Effect.flip(creator.publish({ path: plain, visibility: 'private' })))._tag).toBe('NotARepository')

        const initialized = join(root, 'with-origin')
        yield* fs.makeDirectory(initialized)
        yield* creator.initialize({ path: initialized })
        execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/owner/repo.git'], { cwd: initialized })
        const withOrigin = yield* Effect.flip(creator.publish({ path: initialized, visibility: 'private' }))
        expect(withOrigin._tag).toBe('RemoteExists')
        expect(withOrigin.message).toContain('https://example.invalid/owner/repo.git')

        const empty = join(root, 'no-commits')
        yield* fs.makeDirectory(empty)
        execFileSync('git', ['init', '--initial-branch=main'], { cwd: empty, stdio: 'ignore' })
        const noCommits = yield* Effect.flip(creator.publish({ path: empty, visibility: 'private' }))
        expect(noCommits._tag).toBe('ProjectCreateFailed')
        expect(noCommits.message).toContain('No commits yet')
      }),
    ),
  )

  it.live('refuses to initialize a folder that is already a repository or sits inside one', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, creator, fs } = yield* lifecycle({ installed: ['git', 'jj'] })
        const inside = join(root, 'existing', 'nested')
        const existing = join(root, 'existing')
        yield* fs.makeDirectory(existing)
        yield* creator.initialize({ path: existing })
        yield* fs.makeDirectory(inside)
        const failure = yield* Effect.flip(creator.initialize({ path: inside }))
        expect(failure._tag).toBe('AlreadyARepository')
        expect(failure.message).toMatch(/inside the repository/u)
      }),
    ),
  )
})
