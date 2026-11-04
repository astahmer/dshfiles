import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Clock, Context, Duration, Effect, FiberMap, FileSystem, Layer, Option, Ref, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { CloneJob, CreatedProject } from './project-lifecycle-api.js'

export type ProjectCommand = 'git' | 'jj' | 'gh'

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface RegisteredFolder {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

const CLONE_TIMEOUT = Duration.minutes(30)
const STEP_TIMEOUT = Duration.minutes(2)
const MAX_JOBS = 20
const MAX_STDOUT_CHARACTERS = 64 * 1024
const MAX_STDERR_CHARACTERS = 16 * 1024

export class ParentMissing extends Schema.TaggedError<ParentMissing>()(
  'ParentMissing',
  { parent: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'parent-missing' },
) {
  override get message(): string {
    return `${this.parent} is not an existing folder. Pick an existing parent folder or create it first.`
  }
}

export class DestinationExists extends Schema.TaggedError<DestinationExists>()(
  'DestinationExists',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'destination-exists' },
) {
  override get message(): string {
    return `${this.path} already exists. Choose another folder name, or add the existing folder as a project instead.`
  }
}

export class GitMissing extends Schema.TaggedError<GitMissing>()(
  'GitMissing',
  { hint: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'git-missing' },
) {
  override get message(): string {
    return `git is not installed on this machine. ${this.hint}`
  }
}

export class JjMissing extends Schema.TaggedError<JjMissing>()(
  'JjMissing',
  { hint: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jj-missing' },
) {
  override get message(): string {
    return `jj is not installed on this machine. ${this.hint}`
  }
}

export class GhMissing extends Schema.TaggedError<GhMissing>()(
  'GhMissing',
  { hint: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'gh-missing' },
) {
  override get message(): string {
    return `gh is not installed on this machine. ${this.hint}`
  }
}

export class JobMissing extends Schema.TaggedError<JobMissing>()(
  'JobMissing',
  { jobId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'job-missing' },
) {
  override get message(): string {
    return `No clone job ${this.jobId}. List the jobs with project_clone_jobs.`
  }
}

export class ProjectCreateFailed extends Schema.TaggedError<ProjectCreateFailed>()(
  'ProjectCreateFailed',
  { step: Schema.String, detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'project-create-failed' },
) {
  override get message(): string {
    return `${this.step} failed: ${this.detail}`
  }
}

/** A git, jj or gh command could not be started or did not report an exit code. */
export class ProjectCommandFailed extends Schema.TaggedError<ProjectCommandFailed>()(
  'ProjectCommandFailed',
  { command: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'project-command-failed' },
) {
  override get message(): string {
    return `${this.command} could not run. Check that it is installed and on PATH, then retry.`
  }
}

export class ProjectFolderFailed extends Schema.TaggedError<ProjectFolderFailed>()(
  'ProjectFolderFailed',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'project-folder-failed' },
) {
  override get message(): string {
    return `${this.path} could not be prepared. Check the parent folder's permissions and free disk space, then retry.`
  }
}

export class ProjectRegisterFailed extends Schema.TaggedError<ProjectRegisterFailed>()(
  'ProjectRegisterFailed',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'project-register-failed' },
) {
  override get message(): string {
    return `${this.path} could not be added as a project. Add the folder as a project from the sidebar, or restart DSH and retry.`
  }
}

/** Finds the executables the lifecycle runs, on the Host's PATH. */
export class ExecutableLookup extends Context.Service<
  ExecutableLookup,
  { readonly resolve: (command: ProjectCommand) => Effect.Effect<Option.Option<string>> }
>()('@dshfiles/workspace-folder-picker/ExecutableLookup') {}

/** Adds a folder to the DSH workspace registry as a project. */
export class ProjectRegistry extends Context.Service<
  ProjectRegistry,
  { readonly register: (path: string) => Effect.Effect<RegisteredFolder, ProjectRegisterFailed> }
>()('@dshfiles/workspace-folder-picker/ProjectRegistry') {}

const excerpt = (text: string, limit = 1_000): string => text.trim().split('\n').slice(-6).join('\n').slice(-limit)

const expandHome = (path: string, home: string): string => (path.startsWith('~/') ? join(home, path.slice(2)) : path)

/** The last git progress line (`Receiving objects:  45% (450/1000)`), split on carriage returns as a terminal would draw it. */
const readProgress = (text: string): { readonly percent: number | null; readonly message: string } | undefined => {
  const line = text
    .split(/[\r\n]/u)
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .at(-1)
  if (line === undefined) return undefined
  const match = /(\d{1,3})%/u.exec(line)
  const percent = match?.[1] === undefined ? null : Math.min(100, Number(match[1]))
  return { percent, message: line.slice(0, 400) }
}

export interface CommandInput {
  readonly argv: readonly [string, ...string[]]
  readonly cwd: string
  /** Receives stderr text as it arrives, so a clone can report progress. */
  readonly onStderr?: ((text: string) => Effect.Effect<void>) | undefined
}

/** Runs git, jj and gh through the Host subprocess service, keeping a bounded stdout and the tail of stderr. */
export class ProjectCommands extends Context.Service<
  ProjectCommands,
  { readonly run: (input: CommandInput) => Effect.Effect<CommandResult, ProjectCommandFailed> }
>()('@dshfiles/workspace-folder-picker/ProjectCommands') {
  static readonly layer = Layer.effect(
    ProjectCommands,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const run = Effect.fn('project command run')(
        function* (input: CommandInput) {
          const [command, ...args] = input.argv
          yield* Effect.annotateCurrentSpan({ 'process.executable.name': basename(command) })
          const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd: input.cwd, stdin: 'ignore', forceKillAfter: Duration.millis(1_500) }))
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              handle.stdout.pipe(
                Stream.decodeText(),
                Stream.runFold(
                  () => '',
                  (text, chunk) => (text.length >= MAX_STDOUT_CHARACTERS ? text : (text + chunk).slice(0, MAX_STDOUT_CHARACTERS)),
                ),
              ),
              handle.stderr.pipe(
                Stream.decodeText(),
                Stream.runFoldEffect(
                  () => '',
                  (text, chunk) => Effect.as(input.onStderr?.(chunk) ?? Effect.void, (text + chunk).slice(-MAX_STDERR_CHARACTERS)),
                ),
              ),
              handle.exitCode,
            ],
            { concurrency: 'unbounded' },
          )
          const result: CommandResult = { exitCode, stdout, stderr }
          return result
        },
        Effect.scoped,
        (effect, input) => Effect.mapError(effect, cause => new ProjectCommandFailed({ command: basename(input.argv[0]), cause })),
      )
      return ProjectCommands.of({ run })
    }),
  )
}

/** The folder a `~/` path expands against; the Host user's home unless a caller provides another. */
export const ProjectHome = Context.Reference<string>('@dshfiles/workspace-folder-picker/ProjectHome', { defaultValue: () => homedir() })

/** Where a new project goes: an existing parent folder and a name that is not taken yet. */
const destinationOf = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  input: { readonly parentPath: string; readonly name: string; readonly home: string },
) {
  const parent = expandHome(input.parentPath, input.home)
  const parentInfo = yield* Effect.option(fs.stat(parent))
  if (Option.isNone(parentInfo) || parentInfo.value.type !== 'Directory') return yield* new ParentMissing({ parent })
  const path = join(parent, input.name)
  if (yield* fs.exists(path).pipe(Effect.mapError(cause => new ProjectFolderFailed({ path, cause })))) return yield* new DestinationExists({ path })
  return path
})

/** Background clones on this Host: a bounded newest-first trail, one job per destination, cancellable until it registers. */
export class CloneJobs extends Context.Service<
  CloneJobs,
  {
    readonly start: (input: {
      readonly repositoryUrl: string
      readonly parentPath: string
      readonly name: string
    }) => Effect.Effect<CloneJob, ParentMissing | DestinationExists | GitMissing | ProjectFolderFailed>
    /** Returns the job as it was when the cancel was asked for, once the clone stopped. */
    readonly cancel: (jobId: string) => Effect.Effect<CloneJob, JobMissing>
    readonly list: Effect.Effect<CloneJob[]>
    readonly get: (jobId: string) => Effect.Effect<Option.Option<CloneJob>>
  }
>()('@dshfiles/workspace-folder-picker/CloneJobs') {
  static readonly layer = Layer.effect(
    CloneJobs,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const commands = yield* ProjectCommands
      const lookup = yield* ExecutableLookup
      const registry = yield* ProjectRegistry
      const jobs = yield* Ref.make<ReadonlyMap<string, CloneJob>>(new Map())
      const sequence = yield* Ref.make(0)
      const running = yield* FiberMap.make<string>()
      const home = yield* ProjectHome

      const update = (id: string, patch: Partial<CloneJob>) =>
        Ref.update(jobs, current => {
          const job = current.get(id)
          return job === undefined ? current : new Map(current).set(id, { ...job, ...patch })
        })
      const viewOf = (id: string) => Effect.map(Ref.get(jobs), current => Option.fromUndefinedOr(current.get(id)))

      const prune = Ref.update(jobs, current => {
        const finished = [...current.values()].filter(job => job.state !== 'running')
        const dropped = new Set(finished.slice(0, Math.max(0, current.size - MAX_JOBS)).map(job => job.id))
        return dropped.size === 0 ? current : new Map([...current].filter(([id]) => !dropped.has(id)))
      })

      const execute = (job: CloneJob, input: { readonly git: string; readonly jj: Option.Option<string> }) => {
        const finish = (patch: Partial<CloneJob>) =>
          Effect.gen(function* () {
            yield* update(job.id, { ...patch, finishedAt: yield* Clock.currentTimeMillis })
            const finished = yield* viewOf(job.id)
            if (Option.isSome(finished))
              yield* Effect.annotateCurrentSpan({ 'dshx.clone.state': finished.value.state, 'dshx.clone.phase': finished.value.phase })
          })
        const discardFolder = fs.remove(job.path, { recursive: true, force: true }).pipe(Effect.ignore)
        const cancelled = Effect.gen(function* () {
          yield* discardFolder
          const current = yield* viewOf(job.id)
          yield* finish({
            state: 'cancelled',
            progress: { percent: Option.match(current, { onNone: () => null, onSome: view => view.progress.percent }), message: 'Cancelled' },
          })
        })

        return Effect.gen(function* () {
          const cloned = yield* commands
            .run({
              argv: [input.git, 'clone', '--progress', '--', job.repositoryUrl, job.path],
              cwd: home,
              onStderr: text => {
                const progress = readProgress(text)
                return progress === undefined ? Effect.void : update(job.id, { progress })
              },
            })
            .pipe(Effect.timeoutOption(CLONE_TIMEOUT))
          if (Option.isNone(cloned)) {
            yield* discardFolder
            return yield* finish({ state: 'failed', error: 'The clone took longer than 30 minutes and was stopped.' })
          }
          if (cloned.value.exitCode !== 0) {
            yield* discardFolder
            return yield* finish({ state: 'failed', error: excerpt(cloned.value.stderr) || 'git clone failed.' })
          }
          if (Option.isSome(input.jj)) {
            yield* update(job.id, { phase: 'colocating', progress: { percent: 100, message: 'Colocating jj' } })
            const colocated = yield* commands.run({ argv: [input.jj.value, 'git', 'init', '--colocate'], cwd: job.path })
            if (colocated.exitCode !== 0) {
              return yield* finish({
                state: 'failed',
                error: `${excerpt(colocated.stderr) || 'jj git init failed.'} The clone is kept at ${job.path}; run \`jj git init --colocate\` there, then add the folder as a project.`,
              })
            }
          }
          yield* update(job.id, { phase: 'registering', progress: { percent: 100, message: 'Adding the project' } })
          const registered = yield* registry.register(job.path)
          yield* finish({ state: 'succeeded', phase: 'done', workspaceId: registered.workspaceId, progress: { percent: 100, message: 'Cloned' } })
        }).pipe(
          Effect.catchTags({
            ProjectCommandFailed: error => finish({ state: 'failed', error: error.message.slice(0, 1_000) }),
            ProjectRegisterFailed: error => finish({ state: 'failed', error: error.message.slice(0, 1_000) }),
          }),
          Effect.onInterrupt(() => cancelled),
          Effect.withSpan('project clone', { attributes: { 'dshx.clone.colocate': Option.isSome(input.jj) } }),
        )
      }

      const start = Effect.fn('project clone start')(function* (input: { readonly repositoryUrl: string; readonly parentPath: string; readonly name: string }) {
        const path = join(expandHome(input.parentPath, home), input.name)
        const existing = [...(yield* Ref.get(jobs)).values()].find(job => job.path === path && job.state === 'running')
        if (existing !== undefined) return existing
        const target = yield* destinationOf(fs, { ...input, home })
        const git = yield* lookup.resolve('git')
        if (Option.isNone(git)) return yield* new GitMissing({ hint: 'Install git, then clone again.' })
        const jj = yield* lookup.resolve('jj')
        const now = yield* Clock.currentTimeMillis
        const count = yield* Ref.updateAndGet(sequence, value => value + 1)
        const job: CloneJob = {
          id: `clone-${String(now)}-${String(count)}`,
          repositoryUrl: input.repositoryUrl,
          path: target,
          state: 'running',
          phase: 'cloning',
          progress: { percent: null, message: 'Starting' },
          startedAt: now,
          finishedAt: null,
          workspaceId: null,
          error: null,
        }
        yield* Ref.update(jobs, current => new Map(current).set(job.id, job))
        yield* prune
        yield* FiberMap.run(running, job.id, execute(job, { git: git.value, jj }))
        return job
      })

      const cancel = Effect.fn('project clone cancel')(function* (jobId: string) {
        const job = yield* viewOf(jobId)
        if (Option.isNone(job)) return yield* new JobMissing({ jobId })
        // Registration is not cancellable: the folder is already a project by the time it could be interrupted.
        if (job.value.state === 'running' && job.value.phase !== 'registering') yield* FiberMap.remove(running, jobId)
        return job.value
      })

      return CloneJobs.of({
        start,
        cancel,
        list: Effect.map(Ref.get(jobs), current => [...current.values()].reverse()),
        get: viewOf,
      })
    }),
  )
}

const requireJj = (lookup: ExecutableLookup['Service']) =>
  Effect.flatMap(lookup.resolve('jj'), found =>
    Option.match(found, {
      onNone: () => Effect.fail(new JjMissing({ hint: 'Install jj (https://jj-vcs.github.io), or create the folder and add it as a project instead.' })),
      onSome: Effect.succeed,
    }),
  )

const requireGh = (lookup: ExecutableLookup['Service']) =>
  Effect.flatMap(lookup.resolve('gh'), found =>
    Option.match(found, {
      onNone: () =>
        Effect.fail(
          new GhMissing({
            hint: 'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, or create the project without a GitHub repository.',
          }),
        ),
      onSome: Effect.succeed,
    }),
  )

export type CreateProjectFailure =
  | ParentMissing
  | DestinationExists
  | JjMissing
  | GhMissing
  | ProjectCreateFailed
  | ProjectCommandFailed
  | ProjectFolderFailed
  | ProjectRegisterFailed

/**
 * Creates a jj project: folder, colocated repository, README, a described first commit on `main`, registration, and
 * optionally a private GitHub repository. A failure before registration removes the folder it created, so the same
 * request can simply be retried; GitHub problems after registration only add a warning.
 */
export class ProjectCreator extends Context.Service<
  ProjectCreator,
  {
    readonly create: (input: {
      readonly parentPath: string
      readonly name: string
      readonly createGitHubRepository: boolean
    }) => Effect.Effect<CreatedProject, CreateProjectFailure>
  }
>()('@dshfiles/workspace-folder-picker/ProjectCreator') {
  static readonly layer = Layer.effect(
    ProjectCreator,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const commands = yield* ProjectCommands
      const lookup = yield* ExecutableLookup
      const registry = yield* ProjectRegistry
      const home = yield* ProjectHome

      const create = Effect.fn('project create')(function* (input: {
        readonly parentPath: string
        readonly name: string
        readonly createGitHubRepository: boolean
      }) {
        yield* Effect.annotateCurrentSpan({ 'dshx.project.github': input.createGitHubRepository })
        const path = yield* destinationOf(fs, { ...input, home })
        const jj = yield* requireJj(lookup)
        const gh = input.createGitHubRepository ? Option.some(yield* requireGh(lookup)) : Option.none<string>()
        const run = (argv: readonly [string, ...string[]]) =>
          commands.run({ argv, cwd: path }).pipe(
            Effect.timeoutOrElse({
              duration: STEP_TIMEOUT,
              orElse: () => Effect.succeed<CommandResult>({ exitCode: 1, stdout: '', stderr: 'timed out after 2 minutes' }),
            }),
          )
        const step = (name: string, argv: readonly [string, ...string[]]) =>
          Effect.flatMap(run(argv), result =>
            result.exitCode === 0
              ? Effect.succeed(result)
              : Effect.fail(new ProjectCreateFailed({ step: name, detail: excerpt(result.stderr) || `exit ${String(result.exitCode)}` })),
          )
        const folderFailed = (cause: unknown) => new ProjectFolderFailed({ path, cause })

        yield* fs.makeDirectory(path).pipe(Effect.mapError(folderFailed))
        const registered = yield* Effect.gen(function* () {
          yield* step('jj git init', [jj, 'git', 'init', '--colocate', '.'])
          yield* fs.writeFileString(join(path, 'README.md'), `# ${input.name}\n`).pipe(Effect.mapError(folderFailed))
          yield* step('jj commit', [jj, 'commit', '-m', `chore: initialize ${input.name}`])
          yield* step('jj bookmark create', [jj, 'bookmark', 'create', 'main', '-r', '@-'])
          return yield* registry.register(path)
        }).pipe(Effect.onError(() => fs.remove(path, { recursive: true, force: true }).pipe(Effect.ignore)))

        const created = { path, workspaceId: registered.workspaceId, title: registered.title }
        if (Option.isNone(gh)) return { ...created, gitHubRepository: null, warning: null }
        const repositoryCreated = yield* run([gh.value, 'repo', 'create', input.name, '--private', '--source', '.', '--remote', 'origin'])
        if (repositoryCreated.exitCode !== 0) {
          yield* Effect.annotateCurrentSpan({ 'dshx.project.github_failed': 'create' })
          return {
            ...created,
            gitHubRepository: null,
            warning: `The project was created, but the GitHub repository was not: ${excerpt(repositoryCreated.stderr, 400)} Run \`gh auth status\`, then \`gh repo create ${input.name} --private --source . --remote origin\` in ${path}.`,
          }
        }
        const repository = excerpt(repositoryCreated.stdout, 400).split('\n').at(-1) ?? input.name
        const git = yield* lookup.resolve('git')
        const pushed = Option.isNone(git) ? Option.none() : Option.some(yield* run([git.value, 'push', '--set-upstream', 'origin', 'main']))
        if (Option.isNone(pushed) || pushed.value.exitCode !== 0) {
          yield* Effect.annotateCurrentSpan({ 'dshx.project.github_failed': 'push' })
          return {
            ...created,
            gitHubRepository: repository,
            warning: `The GitHub repository exists but main was not pushed. Run \`jj git push --bookmark main --remote origin\` in ${path}.`,
          }
        }
        yield* run([jj, 'git', 'import'])
        return { ...created, gitHubRepository: repository, warning: null }
      })

      return ProjectCreator.of({ create })
    }),
  )
}

export class ProjectLifecycleModel {
  static readonly readProgress = readProgress
  static readonly expandHome = expandHome
}
