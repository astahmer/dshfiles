import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PluginApiError } from '@dshfiles/dshx/api'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { CloneJob, CreatedProject } from './project-lifecycle-api.js'

export type ProjectCommand = 'git' | 'jj' | 'gh'

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs one resolved executable; `onStderr` receives text as it arrives so a clone can report progress. */
export type CommandRunner = (input: {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly signal: AbortSignal
  readonly onStderr?: (text: string) => void
}) => Promise<CommandResult>

export interface RegisteredFolder {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

export interface ProjectLifecycleDeps {
  readonly run: CommandRunner
  /** Absolute executable path, or undefined when the command is not installed. */
  readonly resolve: (command: ProjectCommand) => Promise<string | undefined>
  readonly register: (path: string) => Promise<RegisteredFolder>
  readonly home: () => string
  readonly now?: () => number
}

const CLONE_TIMEOUT_MS = 30 * 60_000
const STEP_TIMEOUT_MS = 2 * 60_000
const MAX_JOBS = 20

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

const destination = (input: { readonly parentPath: string; readonly name: string; readonly home: string }): string => {
  const parent = expandHome(input.parentPath, input.home)
  if (!statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new PluginApiError(`${parent} is not an existing folder. Pick an existing parent folder or create it first.`, { code: 'parent-missing' })
  }
  const path = join(parent, input.name)
  if (existsSync(path)) {
    throw new PluginApiError(`${path} already exists. Choose another folder name, or add the existing folder as a project instead.`, {
      code: 'destination-exists',
    })
  }
  return path
}

const requireCommand = async (deps: ProjectLifecycleDeps, command: ProjectCommand, hint: string): Promise<string> => {
  const executable = await deps.resolve(command)
  if (executable === undefined) throw new PluginApiError(`${command} is not installed on this machine. ${hint}`, { code: `${command}-missing` })
  return executable
}

interface LiveJob {
  view: CloneJob
  readonly controller: AbortController
}

/** Background clones on this Host: a bounded newest-first trail, one job per destination, cancellable until done. */
export const createCloneJobs = (deps: ProjectLifecycleDeps) => {
  const now = deps.now ?? Date.now
  const jobs = new Map<string, LiveJob>()
  let sequence = 0

  const update = (job: LiveJob, patch: Partial<CloneJob>): void => {
    job.view = { ...job.view, ...patch }
  }

  const prune = (): void => {
    const finished = [...jobs.values()].filter(job => job.view.state !== 'running')
    for (const job of finished.slice(0, Math.max(0, jobs.size - MAX_JOBS))) jobs.delete(job.view.id)
  }

  const execute = (job: LiveJob, input: { readonly git: string; readonly jj: string | undefined }): Promise<void> =>
    withSpan('project clone', { attributes: { 'dshx.clone.colocate': input.jj !== undefined } }, async span => {
      const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(CLONE_TIMEOUT_MS)])
      const finish = (patch: Partial<CloneJob>): void => {
        update(job, { ...patch, finishedAt: now() })
        span.setAttributes({ 'dshx.clone.state': job.view.state, 'dshx.clone.phase': job.view.phase })
        if (job.view.state === 'failed') span.setStatus('error', `${job.view.phase} failed`)
      }
      const discardFolder = (): void => rmSync(job.view.path, { recursive: true, force: true })
      try {
        const cloned = await deps.run({
          argv: [input.git, 'clone', '--progress', '--', job.view.repositoryUrl, job.view.path],
          cwd: deps.home(),
          signal,
          onStderr: text => {
            const progress = readProgress(text)
            if (progress !== undefined) update(job, { progress })
          },
        })
        if (job.controller.signal.aborted) {
          discardFolder()
          return finish({ state: 'cancelled', progress: { percent: job.view.progress.percent, message: 'Cancelled' } })
        }
        if (cloned.exitCode !== 0) {
          discardFolder()
          const timedOut = signal.aborted
          return finish({
            state: 'failed',
            error: timedOut ? 'The clone took longer than 30 minutes and was stopped.' : excerpt(cloned.stderr) || 'git clone failed.',
          })
        }
        if (input.jj !== undefined) {
          update(job, { phase: 'colocating', progress: { percent: 100, message: 'Colocating jj' } })
          const colocated = await deps.run({ argv: [input.jj, 'git', 'init', '--colocate'], cwd: job.view.path, signal })
          if (colocated.exitCode !== 0) {
            return finish({
              state: 'failed',
              error: `${excerpt(colocated.stderr) || 'jj git init failed.'} The clone is kept at ${job.view.path}; run \`jj git init --colocate\` there, then add the folder as a project.`,
            })
          }
        }
        update(job, { phase: 'registering', progress: { percent: 100, message: 'Adding the project' } })
        const registered = await deps.register(job.view.path)
        finish({ state: 'succeeded', phase: 'done', workspaceId: registered.workspaceId, progress: { percent: 100, message: 'Cloned' } })
      } catch (error) {
        if (job.controller.signal.aborted) {
          discardFolder()
          return finish({ state: 'cancelled', progress: { percent: job.view.progress.percent, message: 'Cancelled' } })
        }
        finish({
          state: 'failed',
          error: `${error instanceof Error ? error.message : String(error)}`.slice(0, 1_000),
        })
      }
    })

  const start = async (input: { readonly repositoryUrl: string; readonly parentPath: string; readonly name: string }): Promise<CloneJob> => {
    const path = join(expandHome(input.parentPath, deps.home()), input.name)
    const running = [...jobs.values()].find(job => job.view.path === path && job.view.state === 'running')
    if (running !== undefined) return running.view
    const target = destination({ ...input, home: deps.home() })
    const git = await requireCommand(deps, 'git', 'Install git, then clone again.')
    const jj = await deps.resolve('jj')
    sequence += 1
    const job: LiveJob = {
      controller: new AbortController(),
      view: {
        id: `clone-${String(now())}-${String(sequence)}`,
        repositoryUrl: input.repositoryUrl,
        path: target,
        state: 'running',
        phase: 'cloning',
        progress: { percent: null, message: 'Starting' },
        startedAt: now(),
        finishedAt: null,
        workspaceId: null,
        error: null,
      },
    }
    jobs.set(job.view.id, job)
    prune()
    void execute(job, { git, jj })
    return job.view
  }

  const cancel = (jobId: string): CloneJob => {
    const job = jobs.get(jobId)
    if (job === undefined) throw new PluginApiError(`No clone job ${jobId}. List the jobs with project_clone_jobs.`, { code: 'job-missing' })
    if (job.view.state === 'running') job.controller.abort()
    return job.view
  }

  return {
    start,
    cancel,
    list: (): CloneJob[] => [...jobs.values()].map(job => job.view).reverse(),
    get: (jobId: string): CloneJob | undefined => jobs.get(jobId)?.view,
    dispose: (): void => {
      for (const job of jobs.values()) job.controller.abort()
    },
  }
}

const failStep = (step: string, result: CommandResult): never => {
  throw new PluginApiError(`${step} failed: ${excerpt(result.stderr) || `exit ${String(result.exitCode)}`}`, { code: 'project-create-failed' })
}

/**
 * Creates a jj project: folder, colocated repository, README, a described first commit on `main`, registration, and
 * optionally a private GitHub repository. A failure before registration removes the folder it created, so the same
 * request can simply be retried; GitHub problems after registration only add a warning.
 */
export const createProject = (
  deps: ProjectLifecycleDeps,
  input: { readonly parentPath: string; readonly name: string; readonly createGitHubRepository: boolean },
): Promise<CreatedProject> =>
  withSpan('project create', { attributes: { 'dshx.project.github': input.createGitHubRepository } }, async span => {
    const path = destination({ ...input, home: deps.home() })
    const jj = await requireCommand(deps, 'jj', 'Install jj (https://jj-vcs.github.io), or create the folder and add it as a project instead.')
    const gh = input.createGitHubRepository
      ? await requireCommand(
          deps,
          'gh',
          'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, or create the project without a GitHub repository.',
        )
      : undefined
    const signal = AbortSignal.timeout(STEP_TIMEOUT_MS)
    const run = async (step: string, argv: readonly string[]): Promise<CommandResult> => {
      const result = await deps.run({ argv, cwd: path, signal })
      return result.exitCode === 0 ? result : failStep(step, result)
    }
    mkdirSync(path)
    let registered: RegisteredFolder
    try {
      await run('jj git init', [jj, 'git', 'init', '--colocate', '.'])
      writeFileSync(join(path, 'README.md'), `# ${input.name}\n`)
      await run('jj commit', [jj, 'commit', '-m', `chore: initialize ${input.name}`])
      await run('jj bookmark create', [jj, 'bookmark', 'create', 'main', '-r', '@-'])
      registered = await deps.register(path)
    } catch (error) {
      rmSync(path, { recursive: true, force: true })
      span.setStatus('error', 'create failed')
      throw error
    }
    if (gh === undefined) return { path, workspaceId: registered.workspaceId, title: registered.title, gitHubRepository: null, warning: null }
    const created = await deps.run({ argv: [gh, 'repo', 'create', input.name, '--private', '--source', '.', '--remote', 'origin'], cwd: path, signal })
    if (created.exitCode !== 0) {
      span.setAttributes({ 'dshx.project.github_failed': 'create' })
      return {
        path,
        workspaceId: registered.workspaceId,
        title: registered.title,
        gitHubRepository: null,
        warning: `The project was created, but the GitHub repository was not: ${excerpt(created.stderr, 400)} Run \`gh auth status\`, then \`gh repo create ${input.name} --private --source . --remote origin\` in ${path}.`,
      }
    }
    const repository = excerpt(created.stdout, 400).split('\n').at(-1) ?? input.name
    const git = await deps.resolve('git')
    const pushed = git === undefined ? undefined : await deps.run({ argv: [git, 'push', '--set-upstream', 'origin', 'main'], cwd: path, signal })
    if (pushed === undefined || pushed.exitCode !== 0) {
      span.setAttributes({ 'dshx.project.github_failed': 'push' })
      return {
        path,
        workspaceId: registered.workspaceId,
        title: registered.title,
        gitHubRepository: repository,
        warning: `The GitHub repository exists but main was not pushed. Run \`jj git push --bookmark main --remote origin\` in ${path}.`,
      }
    }
    await deps.run({ argv: [jj, 'git', 'import'], cwd: path, signal })
    return { path, workspaceId: registered.workspaceId, title: registered.title, gitHubRepository: repository, warning: null }
  })

export class ProjectLifecycleModel {
  static readonly readProgress = readProgress
  static readonly expandHome = expandHome
}
