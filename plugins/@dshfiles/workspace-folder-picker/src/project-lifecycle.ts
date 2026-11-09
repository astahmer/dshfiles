import { homedir } from 'node:os'
import { basename, dirname, join, parse } from 'node:path'
import { Clock, Context, Duration, Effect, FiberMap, FileSystem, Layer, Option, Ref, Schema, Semaphore, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { CloneJob, CloneStage, CreatedProject } from './project-lifecycle-api.js'

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

const expandHome = (path: string, home: string): string => (path.startsWith('~/') || path.startsWith('~\\') ? join(home, path.slice(2)) : path)

/** The last git progress line (`Receiving objects:  45% (450/1000)`), split on carriage returns as a terminal would draw it. */
const STAGE_ORDER: readonly CloneStage[] = ['connecting', 'counting', 'receiving', 'resolving', 'checkout']

/** Git prints one stage label per progress line, so the stage comes from the last line rather than a parser per command. */
const stageOf = (line: string): CloneStage | null => {
  if (/^Cloning into\b/u.test(line)) return 'connecting'
  if (/\bCounting objects/u.test(line)) return 'counting'
  if (/\bReceiving objects/u.test(line)) return 'receiving'
  if (/\bResolving deltas/u.test(line)) return 'resolving'
  if (/\b(?:Updating files|Checking out files)/u.test(line)) return 'checkout'
  return null
}

/** The last git progress line (`Receiving objects:  45% (450/1000)`), split on carriage returns as a terminal would draw it. */
const readProgress = (text: string): CloneProgress | undefined => {
  const line = text
    .split(/[\r\n]/u)
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .at(-1)
  if (line === undefined) return undefined
  const match = /(\d{1,3})%/u.exec(line)
  const percent = match?.[1] === undefined ? null : Math.min(100, Number(match[1]))
  return { percent, stage: stageOf(line), message: line.slice(0, 400) }
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

type ClonePhase = CloneJob['phase']
type CloneProgress = CloneJob['progress']

/** What every clone job carries whatever it became; the state says which fields it may hold. */
interface CloneJobTrack {
  readonly id: string
  readonly repositoryUrl: string
  readonly path: string
  readonly startedAt: number
  readonly finishedAt: number | null
}

/** A job that moved past running keeps the phase and progress it reached, so the row it shows never rewinds. */
type CloneJobState =
  | { readonly state: 'running'; readonly phase: ClonePhase; readonly progress: CloneProgress }
  | { readonly state: 'succeeded'; readonly phase: 'done'; readonly progress: CloneProgress; readonly workspaceId: string }
  | { readonly state: 'failed'; readonly phase: ClonePhase; readonly progress: CloneProgress; readonly error: string }
  | { readonly state: 'cancelled'; readonly phase: ClonePhase; readonly progress: CloneProgress }

type TrackedCloneJob = CloneJobTrack & { readonly state: CloneJobState }
type RunningCloneJob = CloneJobTrack & { readonly state: Extract<CloneJobState, { readonly state: 'running' }> }

const isRunning = (job: TrackedCloneJob): job is RunningCloneJob => job.state.state === 'running'

const runningState = (phase: ClonePhase, progress: CloneProgress): Extract<CloneJobState, { readonly state: 'running' }> => ({
  state: 'running',
  phase,
  progress,
})

/** The stage only moves forward and a line without a percent keeps the last one, so a progress row never rewinds. */
const mergeProgress = (current: CloneProgress, next: CloneProgress): CloneProgress => {
  const currentStage = current.stage === null ? -1 : STAGE_ORDER.indexOf(current.stage)
  const nextStage = next.stage === null ? -1 : STAGE_ORDER.indexOf(next.stage)
  return {
    percent: next.percent ?? current.percent,
    stage: nextStage >= currentStage ? next.stage : current.stage,
    message: next.message,
  }
}

/** The wire job the API and its tools answer with, projected from the tracked state. */
const cloneJobOf = (job: TrackedCloneJob): CloneJob => ({
  id: job.id,
  repositoryUrl: job.repositoryUrl,
  path: job.path,
  state: job.state.state,
  phase: job.state.phase,
  progress: job.state.progress,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  workspaceId: job.state.state === 'succeeded' ? job.state.workspaceId : null,
  error: job.state.state === 'failed' ? job.state.error : null,
})

export class CloneNotRetryable extends Schema.TaggedError<CloneNotRetryable>()(
  'CloneNotRetryable',
  { jobId: Schema.String, state: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'clone-not-retryable' },
) {
  override get message(): string {
    return `Clone ${this.jobId} is ${this.state}; only a failed or cancelled clone can be retried.`
  }
}

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
    /** Starts a fresh job for a failed or cancelled clone's repository and destination. */
    readonly retry: (
      jobId: string,
    ) => Effect.Effect<CloneJob, JobMissing | CloneNotRetryable | ParentMissing | DestinationExists | GitMissing | ProjectFolderFailed>
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
      const jobs = yield* Ref.make<ReadonlyMap<string, TrackedCloneJob>>(new Map())
      const sequence = yield* Ref.make(0)
      const running = yield* FiberMap.make<string>()
      const home = yield* ProjectHome
      // One admission at a time: two starts for the same destination cannot both pass the running check.
      const admission = yield* Semaphore.make(1)

      /** Moves a job that is still running; a job that reached a terminal state never moves again. */
      const transition = (id: string, change: (job: RunningCloneJob) => TrackedCloneJob) =>
        Ref.update(jobs, current => {
          const job = current.get(id)
          if (job === undefined || !isRunning(job)) return current
          return new Map(current).set(id, change(job))
        })

      const viewOf = (id: string) => Effect.map(Ref.get(jobs), current => Option.map(Option.fromUndefinedOr(current.get(id)), cloneJobOf))

      const prune = Ref.update(jobs, current => {
        const finished = [...current.values()].filter(job => job.state.state !== 'running')
        const dropped = new Set(finished.slice(0, Math.max(0, current.size - MAX_JOBS)).map(job => job.id))
        return dropped.size === 0 ? current : new Map([...current].filter(([id]) => !dropped.has(id)))
      })

      const execute = (job: RunningCloneJob, input: { readonly git: string; readonly jj: Option.Option<string> }) => {
        const finish = (change: (current: RunningCloneJob, at: number) => TrackedCloneJob) =>
          Effect.gen(function* () {
            const at = yield* Clock.currentTimeMillis
            yield* transition(job.id, current => change(current, at))
            const finished = yield* Ref.get(jobs)
            const stored = finished.get(job.id)
            if (stored !== undefined) yield* Effect.annotateCurrentSpan({ 'dshx.clone.state': stored.state.state, 'dshx.clone.phase': stored.state.phase })
          })
        const discardFolder = fs.remove(job.path, { recursive: true, force: true }).pipe(Effect.ignore)
        const cancelled = Effect.gen(function* () {
          yield* discardFolder
          yield* finish((current, at) => ({
            ...current,
            finishedAt: at,
            state: { state: 'cancelled', phase: current.state.phase, progress: { ...current.state.progress, message: 'Cancelled' } },
          }))
        })
        // Git's checkout stage is the point where the destination holds a real (if incomplete) tree: keep it so the
        // user can look at what landed, and let retry clear and reuse the same destination.
        const failClone = (error: string) =>
          Effect.gen(function* () {
            const stored = (yield* Ref.get(jobs)).get(job.id)
            const keptPartial = stored?.state.progress.stage === 'checkout'
            if (!keptPartial) yield* discardFolder
            yield* finish((current, at) => ({
              ...current,
              finishedAt: at,
              state: {
                ...current.state,
                state: 'failed',
                error: keptPartial ? `${error} The partial checkout is kept at ${current.path}; retrying this clone clears it and starts again.` : error,
              },
            }))
          })

        return Effect.gen(function* () {
          const cloned = yield* commands
            .run({
              argv: [input.git, 'clone', '--progress', '--', job.repositoryUrl, job.path],
              cwd: home,
              onStderr: text => {
                const progress = readProgress(text)
                return progress === undefined
                  ? Effect.void
                  : transition(job.id, current => ({ ...current, state: { ...current.state, progress: mergeProgress(current.state.progress, progress) } }))
              },
            })
            .pipe(Effect.timeoutOption(CLONE_TIMEOUT))
          if (Option.isNone(cloned)) return yield* failClone('The clone took longer than 30 minutes and was stopped.')
          if (cloned.value.exitCode !== 0) return yield* failClone(excerpt(cloned.value.stderr) || 'git clone failed.')
          if (Option.isSome(input.jj)) {
            yield* transition(job.id, current => ({
              ...current,
              state: { state: 'running', phase: 'colocating', progress: { percent: 100, stage: current.state.progress.stage, message: 'Colocating jj' } },
            }))
            const colocated = yield* commands.run({ argv: [input.jj.value, 'git', 'init', '--colocate'], cwd: job.path })
            if (colocated.exitCode !== 0) {
              return yield* finish((current, at) => ({
                ...current,
                finishedAt: at,
                state: {
                  ...current.state,
                  state: 'failed',
                  error: `${excerpt(colocated.stderr) || 'jj git init failed.'} The clone is kept at ${job.path}; run \`jj git init --colocate\` there, then add the folder as a project.`,
                },
              }))
            }
          }
          yield* transition(job.id, current => ({
            ...current,
            state: { state: 'running', phase: 'registering', progress: { percent: 100, stage: current.state.progress.stage, message: 'Adding the project' } },
          }))
          const registered = yield* registry.register(job.path)
          yield* finish((current, at) => ({
            ...current,
            finishedAt: at,
            state: {
              state: 'succeeded',
              phase: 'done',
              workspaceId: registered.workspaceId,
              progress: { percent: 100, stage: current.state.progress.stage, message: 'Cloned' },
            },
          }))
        }).pipe(
          Effect.catchTags({
            ProjectCommandFailed: error =>
              finish((current, at) => ({ ...current, finishedAt: at, state: { ...current.state, state: 'failed', error: error.message.slice(0, 1_000) } })),
            ProjectRegisterFailed: error =>
              finish((current, at) => ({ ...current, finishedAt: at, state: { ...current.state, state: 'failed', error: error.message.slice(0, 1_000) } })),
          }),
          Effect.onInterrupt(() => cancelled),
          Effect.withSpan('project clone', { attributes: { 'dshx.clone.colocate': Option.isSome(input.jj) } }),
        )
      }

      const start = Effect.fn('project clone start')(function* (input: { readonly repositoryUrl: string; readonly parentPath: string; readonly name: string }) {
        return yield* admission.withPermit(
          Effect.gen(function* () {
            const path = join(expandHome(input.parentPath, home), input.name)
            const existing = [...(yield* Ref.get(jobs)).values()].find(job => job.path === path && job.state.state === 'running')
            if (existing !== undefined) return cloneJobOf(existing)
            const target = yield* destinationOf(fs, { ...input, home })
            const git = yield* lookup.resolve('git')
            if (Option.isNone(git)) return yield* new GitMissing({ hint: 'Install git, then clone again.' })
            const jj = yield* lookup.resolve('jj')
            const now = yield* Clock.currentTimeMillis
            const count = yield* Ref.updateAndGet(sequence, value => value + 1)
            const job: RunningCloneJob = {
              id: `clone-${String(now)}-${String(count)}`,
              repositoryUrl: input.repositoryUrl,
              path: target,
              startedAt: now,
              finishedAt: null,
              state: runningState('cloning', { percent: null, stage: null, message: 'Starting' }),
            }
            yield* Ref.update(jobs, current => new Map(current).set(job.id, job))
            yield* prune
            yield* FiberMap.run(running, job.id, execute(job, { git: git.value, jj }))
            return cloneJobOf(job)
          }),
        )
      })

      const cancel = Effect.fn('project clone cancel')(function* (jobId: string) {
        const found = yield* Effect.map(Ref.get(jobs), current => current.get(jobId))
        if (found === undefined) return yield* new JobMissing({ jobId })
        // Registration is not cancellable: the folder is already a project by the time it could be interrupted.
        if (found.state.state === 'running' && found.state.phase !== 'registering') yield* FiberMap.remove(running, jobId)
        return cloneJobOf(found)
      })

      /** A failed or cancelled job keeps its repository and destination, so a retry only needs the folder it named. */
      const retry = Effect.fn('project clone retry')(function* (jobId: string) {
        const found = yield* Effect.map(Ref.get(jobs), current => current.get(jobId))
        if (found === undefined) return yield* new JobMissing({ jobId })
        if (found.state.state === 'running' || found.state.state === 'succeeded') {
          return yield* new CloneNotRetryable({ jobId, state: found.state.state })
        }
        // A failure after checkout kept git's incomplete tree; it is this job's own destination, so a retry clears it.
        if (found.state.progress.stage === 'checkout') yield* fs.remove(found.path, { recursive: true, force: true }).pipe(Effect.ignore)
        return yield* start({ repositoryUrl: found.repositoryUrl, parentPath: dirname(found.path), name: basename(found.path) })
      })

      return CloneJobs.of({
        start,
        cancel,
        retry,
        list: Effect.map(Ref.get(jobs), current => [...current.values()].reverse().map(cloneJobOf)),
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

/** A repository marker found at or above a folder: the nearest one wins, `jj` before `git` in the same folder. */
export interface RepositoryMarker {
  readonly kind: 'git' | 'jujutsu'
  readonly root: string
  readonly broken: boolean
}

const markerIn = (fs: FileSystem.FileSystem, dir: string) =>
  Effect.gen(function* () {
    const jj = join(dir, '.jj')
    const jjInfo = yield* fs.stat(jj).pipe(Effect.option)
    if (Option.isSome(jjInfo)) {
      const broken =
        jjInfo.value.type === 'File' &&
        (yield* fs.readFileString(jj).pipe(
          Effect.map(text => text.trim().length === 0),
          Effect.orElseSucceed(() => true),
        ))
      return Option.some<RepositoryMarker>({ kind: 'jujutsu', root: dir, broken })
    }
    if (yield* fs.exists(join(dir, '.git')).pipe(Effect.orElseSucceed(() => false)))
      return Option.some<RepositoryMarker>({ kind: 'git', root: dir, broken: false })
    return Option.none<RepositoryMarker>()
  })

/** Walks up from a folder to the filesystem root; the root marker is the checkout a nested folder belongs to. */
export const nearestRepositoryMarker = (fs: FileSystem.FileSystem, path: string) =>
  Effect.gen(function* () {
    let dir = path
    const filesystemRoot = parse(dir).root
    for (;;) {
      const marker = yield* markerIn(fs, dir)
      if (Option.isSome(marker)) return marker
      if (dir === filesystemRoot) return Option.none<RepositoryMarker>()
      const parent = dirname(dir)
      if (parent === dir) return Option.none<RepositoryMarker>()
      dir = parent
    }
  })

export class NotARepository extends Schema.TaggedError<NotARepository>()(
  'NotARepository',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-repository' },
) {
  override get message(): string {
    return `${this.path} is not a Git or Jujutsu repository. Initialize one there first, then publish it.`
  }
}

/** The repository already has an origin, so publishing would replace the remote it pushes to. */
export class RemoteExists extends Schema.TaggedError<RemoteExists>()(
  'RemoteExists',
  { path: Schema.String, remoteUrl: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'remote-exists' },
) {
  override get message(): string {
    return `${this.path} already pushes to ${this.remoteUrl}. Publish a repository without an origin, or push this one with jj git push.`
  }
}

/** The folder is already part of (or is) a repository, so initializing one in place would nest or replace it. */
export class AlreadyARepository extends Schema.TaggedError<AlreadyARepository>()(
  'AlreadyARepository',
  { path: Schema.String, root: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'already-a-repository' },
) {
  override get message(): string {
    return this.path === this.root
      ? `${this.path} is already a repository. Add it as a project instead.`
      : `${this.path} sits inside the repository at ${this.root}. Add it as a project, or enable Jujutsu for that checkout instead.`
  }
}

const runWithTimeout = (commands: ProjectCommands['Service'], argv: readonly [string, ...string[]], cwd: string) =>
  commands.run({ argv, cwd }).pipe(
    Effect.timeoutOrElse({
      duration: STEP_TIMEOUT,
      orElse: () => Effect.succeed<CommandResult>({ exitCode: 1, stdout: '', stderr: 'timed out after 2 minutes' }),
    }),
  )

const requireStep = (commands: ProjectCommands['Service'], name: string, argv: readonly [string, ...string[]], cwd: string) =>
  Effect.flatMap(runWithTimeout(commands, argv, cwd), result =>
    result.exitCode === 0
      ? Effect.succeed(result)
      : Effect.fail(new ProjectCreateFailed({ step: name, detail: excerpt(result.stderr) || `exit ${String(result.exitCode)}` })),
  )

/** The repository steps shared by a new folder and an existing one: colocated jj, README when missing, first commit, `main`. */
const initializeJujutsu = (input: {
  readonly commands: ProjectCommands['Service']
  readonly fs: FileSystem.FileSystem
  readonly jj: string
  readonly path: string
  readonly name: string
}) =>
  Effect.gen(function* () {
    const { commands, fs, jj, path, name } = input
    yield* requireStep(commands, 'jj git init', [jj, 'git', 'init', '--colocate', '.'], path)
    if (!(yield* fs.exists(join(path, 'README.md')).pipe(Effect.orElseSucceed(() => true)))) {
      yield* fs.writeFileString(join(path, 'README.md'), `# ${name}\n`).pipe(Effect.mapError(cause => new ProjectFolderFailed({ path, cause })))
    }
    yield* requireStep(commands, 'jj commit', [jj, 'commit', '-m', `chore: initialize ${name}`], path)
    yield* requireStep(commands, 'jj bookmark create', [jj, 'bookmark', 'create', 'main', '-r', '@-'], path)
  })

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
export type PublishProjectFailure = NotARepository | RemoteExists | GhMissing | JjMissing | ProjectCreateFailed | ProjectCommandFailed | ProjectFolderFailed

export type InitializeProjectFailure = AlreadyARepository | JjMissing | ProjectCreateFailed | ProjectCommandFailed | ProjectFolderFailed | ProjectRegisterFailed

/**
 * Creates a jj project: folder, colocated repository, README, a described first commit on `main`, registration, and
 * optionally a private GitHub repository. A failure before registration removes the folder it created, so the same
 * request can simply be retried; GitHub problems after registration only add a warning. The same repository steps also
 * turn an existing folder into a project in place, keeping the files it already had.
 */
export class ProjectCreator extends Context.Service<
  ProjectCreator,
  {
    readonly create: (input: {
      readonly parentPath: string
      readonly name: string
      readonly createGitHubRepository: boolean
    }) => Effect.Effect<CreatedProject, CreateProjectFailure>
    readonly initialize: (input: {
      readonly path: string
    }) => Effect.Effect<{ readonly path: string; readonly workspaceId: string; readonly title: string }, InitializeProjectFailure>
    /** Creates a GitHub repository for a local checkout that has no origin, then pushes its bookmark. */
    readonly publish: (input: {
      readonly path: string
      readonly visibility: 'private' | 'public'
      readonly bookmark?: string | undefined
    }) => Effect.Effect<
      { readonly path: string; readonly repository: string; readonly pushed: boolean; readonly warning: string | null },
      PublishProjectFailure
    >
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
        const folderFailed = (cause: unknown) => new ProjectFolderFailed({ path, cause })

        yield* fs.makeDirectory(path).pipe(Effect.mapError(folderFailed))
        const registered = yield* Effect.gen(function* () {
          yield* initializeJujutsu({ commands, fs, jj, path, name: input.name })
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

      /** Turns a folder that is not part of any repository into a project, keeping the files it already holds. */
      const initialize = Effect.fn('project initialize')(function* (input: { readonly path: string }) {
        const path = expandHome(input.path, home)
        const info = yield* fs.stat(path).pipe(Effect.mapError(cause => new ProjectFolderFailed({ path, cause })))
        if (info.type !== 'Directory') return yield* new ProjectFolderFailed({ path })
        const marker = yield* nearestRepositoryMarker(fs, path)
        if (Option.isSome(marker)) return yield* new AlreadyARepository({ path, root: marker.value.root })
        const jj = yield* requireJj(lookup)
        yield* Effect.annotateCurrentSpan({ 'dshx.project.initialize': path })
        yield* initializeJujutsu({ commands, fs, jj, path, name: basename(path) })
        const registered = yield* registry.register(path)
        return { path, workspaceId: registered.workspaceId, title: registered.title }
      })

      /** One remote creation path, shared by publishing an existing checkout and the optional step in project create. */
      const publish = Effect.fn('project publish')(function* (input: {
        readonly path: string
        readonly visibility: 'private' | 'public'
        readonly bookmark?: string | undefined
      }) {
        const path = expandHome(input.path, home)
        const info = yield* fs.stat(path).pipe(Effect.mapError(cause => new ProjectFolderFailed({ path, cause })))
        if (info.type !== 'Directory') return yield* new ProjectFolderFailed({ path })
        const marker = yield* nearestRepositoryMarker(fs, path)
        if (Option.isNone(marker) || marker.value.root !== path) return yield* new NotARepository({ path })
        yield* Effect.annotateCurrentSpan({ 'dshx.project.visibility': input.visibility })
        const origin = yield* runWithTimeout(commands, ['git', '-C', path, 'config', '--get', 'remote.origin.url'], path)
        const existingRemote = origin.exitCode === 0 ? origin.stdout.trim() : ''
        if (existingRemote.length > 0) return yield* new RemoteExists({ path, remoteUrl: existingRemote })
        const head = yield* runWithTimeout(commands, ['git', '-C', path, 'rev-parse', '--verify', 'HEAD'], path)
        if (head.exitCode !== 0) {
          return yield* new ProjectCreateFailed({
            step: 'check for commits',
            detail: `No commits yet in ${path}. Commit first (jj commit -m "chore: initialize"), then publish.`,
          })
        }
        const gh = yield* requireGh(lookup)
        const jujutsu = marker.value.kind === 'jujutsu'
        const jj = jujutsu ? Option.some(yield* requireJj(lookup)) : Option.none<string>()
        const name = basename(path)
        const created = yield* runWithTimeout(
          commands,
          [gh, 'repo', 'create', name, input.visibility === 'private' ? '--private' : '--public', '--source', '.', '--remote', 'origin'],
          path,
        )
        if (created.exitCode !== 0) {
          return yield* new ProjectCreateFailed({ step: 'gh repo create', detail: excerpt(created.stderr) || `exit ${String(created.exitCode)}` })
        }
        const repository = excerpt(created.stdout, 400).split('\n').at(-1) ?? name
        const bookmark = input.bookmark ?? 'main'
        if (Option.isSome(jj)) {
          yield* runWithTimeout(commands, [jj.value, 'git', 'import'], path)
          const pushed = yield* runWithTimeout(commands, [jj.value, 'git', 'push', '--bookmark', bookmark, '--remote', 'origin'], path)
          if (pushed.exitCode !== 0) {
            return {
              path,
              repository,
              pushed: false,
              warning: `The GitHub repository exists but ${bookmark} was not pushed: ${excerpt(pushed.stderr, 400)} Run \`jj git push --bookmark ${bookmark} --remote origin\` in ${path}.`,
            }
          }
          return { path, repository, pushed: true, warning: null }
        }
        const git = yield* lookup.resolve('git')
        if (Option.isNone(git)) return yield* new GhMissing({ hint: 'Install git, then push the repository yourself.' })
        const pushed = yield* runWithTimeout(commands, [git.value, 'push', '--set-upstream', 'origin', 'HEAD'], path)
        if (pushed.exitCode !== 0) {
          return {
            path,
            repository,
            pushed: false,
            warning: `The GitHub repository exists but HEAD was not pushed: ${excerpt(pushed.stderr, 400)} Run \`git push --set-upstream origin HEAD\` in ${path}.`,
          }
        }
        return { path, repository, pushed: true, warning: null }
      })

      return ProjectCreator.of({ create, initialize, publish })
    }),
  )
}

export class ProjectLifecycleModel {
  static readonly readProgress = readProgress
  static readonly expandHome = expandHome
}
