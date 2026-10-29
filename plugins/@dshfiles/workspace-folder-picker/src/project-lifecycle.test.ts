import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginApiError } from '@dshfiles/dshx/api'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localCloneUrlSchema, projectFolderNameSchema } from './project-lifecycle-api.js'
import { createCloneJobs, createProject, ProjectLifecycleModel, type CommandRunner, type ProjectLifecycleDeps } from './project-lifecycle.js'

const toolsAvailable = spawnSync('jj', ['--version']).status === 0 && spawnSync('git', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '', JJ_USER: 'Test', JJ_EMAIL: 'test@example.com', GIT_TERMINAL_PROMPT: '0' }

const nodeRunner: CommandRunner = input =>
  new Promise(resolve => {
    const [command, ...args] = input.argv
    const child = spawn(command ?? '', args, { cwd: input.cwd, env, signal: input.signal })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (text: string) => (stdout += text))
    child.stderr.setEncoding('utf8').on('data', (text: string) => {
      stderr += text
      input.onStderr?.(text)
    })
    child.on('error', () => undefined)
    child.on('close', code => resolve({ exitCode: code ?? 1, stdout, stderr }))
  })

const waitFor = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 25))
  expect(check()).toBe(true)
}

describe('project lifecycle inputs', () => {
  it('accepts https, ssh, git@ and file:/// URLs and rejects option-like or relative ones', () => {
    for (const url of ['https://github.com/a/b.git', 'ssh://git@host/a/b', 'git@github.com:a/b.git', 'file:///tmp/repo'])
      expect(localCloneUrlSchema.safeParse(url).success).toBe(true)
    for (const url of ['--upload-pack=x', '../repo', 'file://host/repo', 'http://plain.example/repo'])
      expect(localCloneUrlSchema.safeParse(url).success).toBe(false)
  })

  it('accepts one folder name and rejects separators, dot-dot and leading dashes', () => {
    expect(projectFolderNameSchema.safeParse('my-project_2').success).toBe(true)
    for (const name of ['a/b', '..', '-rf', '.hidden', '']) expect(projectFolderNameSchema.safeParse(name).success).toBe(false)
  })

  it('reads the last git progress line', () => {
    expect(ProjectLifecycleModel.readProgress('Receiving objects:  33% (1/3)\rReceiving objects:  66% (2/3)\r')).toEqual({
      percent: 66,
      message: 'Receiving objects:  66% (2/3)',
    })
    expect(ProjectLifecycleModel.readProgress('Cloning into x...\n')).toEqual({ percent: null, message: 'Cloning into x...' })
    expect(ProjectLifecycleModel.readProgress('\r\n')).toBeUndefined()
  })
})

describe.skipIf(!toolsAvailable)('project lifecycle against real git and jj', () => {
  let root: string
  let origin: string
  let registered: string[]
  let installed: Set<string>

  const deps = (run: CommandRunner = nodeRunner): ProjectLifecycleDeps => ({
    run,
    resolve: async command => (installed.has(command) ? command : undefined),
    register: async path => {
      registered.push(path)
      return { workspaceId: `ws-${String(registered.length)}`, title: path.split('/').at(-1) ?? path, path }
    },
    home: () => root,
  })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'project-lifecycle-')))
    origin = join(root, 'origin')
    registered = []
    installed = new Set(['git', 'jj'])
    execFileSync('jj', ['git', 'init', '--colocate', origin], { stdio: 'ignore', env })
    writeFileSync(join(origin, 'file.txt'), 'one\n')
    execFileSync('jj', ['commit', '-m', 'one'], { cwd: origin, stdio: 'ignore', env })
    execFileSync('jj', ['bookmark', 'create', 'main', '-r', '@-'], { cwd: origin, stdio: 'ignore', env })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('clones a file:// repository in the background, colocates jj and registers it', async () => {
    using recorder = recordSpans()
    const jobs = createCloneJobs(deps())
    const job = await jobs.start({ repositoryUrl: `file://${origin}`, parentPath: '~/', name: 'clone' })
    expect(job).toMatchObject({ state: 'running', phase: 'cloning', path: join(root, 'clone') })
    await waitFor(() => jobs.get(job.id)?.state !== 'running')
    expect(jobs.get(job.id)).toMatchObject({ state: 'succeeded', phase: 'done', workspaceId: 'ws-1', error: null })
    expect(existsSync(join(root, 'clone', '.jj'))).toBe(true)
    expect(readFileSync(join(root, 'clone', 'file.txt'), 'utf8')).toBe('one\n')
    expect(registered).toEqual([join(root, 'clone')])
    expect(recorder.span('project clone').attributes['dshx.clone.state']).toBe('succeeded')
  })

  it('returns the running job for the same destination and refuses an existing folder', async () => {
    const jobs = createCloneJobs(deps())
    const first = await jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })
    expect((await jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })).id).toBe(first.id)
    await waitFor(() => jobs.get(first.id)?.state !== 'running')
    await expect(jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })).rejects.toMatchObject({ code: 'destination-exists' })
    expect(jobs.list().map(job => job.id)).toEqual([first.id])
  })

  it('fails a clone of a missing repository and leaves no folder behind', async () => {
    const jobs = createCloneJobs(deps())
    const job = await jobs.start({ repositoryUrl: `file://${join(root, 'missing')}`, parentPath: root, name: 'clone' })
    await waitFor(() => jobs.get(job.id)?.state !== 'running')
    expect(jobs.get(job.id)?.state).toBe('failed')
    expect(jobs.get(job.id)?.error).toMatch(/does not exist|not appear to be a git repository/u)
    expect(existsSync(join(root, 'clone'))).toBe(false)
    expect(registered).toEqual([])
  })

  it('cancels a running clone, deletes its partial folder and never registers it', async () => {
    const slowClone: CommandRunner = input =>
      new Promise(resolve => {
        const destination = input.argv.at(-1) ?? ''
        mkdirSync(destination)
        input.onStderr?.('Receiving objects:  10% (1/10)\r')
        input.signal.addEventListener('abort', () => resolve({ exitCode: 1, stdout: '', stderr: 'killed' }))
      })
    const jobs = createCloneJobs(deps(slowClone))
    const job = await jobs.start({ repositoryUrl: `file://${origin}`, parentPath: root, name: 'clone' })
    await waitFor(() => jobs.get(job.id)?.progress.percent === 10)
    expect(jobs.cancel(job.id).state).toBe('running')
    await waitFor(() => jobs.get(job.id)?.state !== 'running')
    expect(jobs.get(job.id)?.state).toBe('cancelled')
    expect(existsSync(join(root, 'clone'))).toBe(false)
    expect(registered).toEqual([])
    expect(() => jobs.cancel('clone-unknown')).toThrow(PluginApiError)
  })

  it('creates a colocated jj project with a README, a described first commit on main, and registers it', async () => {
    using recorder = recordSpans()
    const created = await createProject(deps(), { parentPath: '~/', name: 'fresh', createGitHubRepository: false })
    const path = join(root, 'fresh')
    expect(created).toEqual({ path, workspaceId: 'ws-1', title: 'fresh', gitHubRepository: null, warning: null })
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('# fresh\n')
    expect(existsSync(join(path, '.git'))).toBe(true)
    const log = execFileSync('jj', ['log', '--no-graph', '-r', 'main', '-T', 'description'], { cwd: path, encoding: 'utf8', env })
    expect(log.trim()).toBe('chore: initialize fresh')
    expect(recorder.span('project create').attributes['dshx.project.github']).toBe(false)
  })

  it('refuses GitHub creation without gh before touching the disk', async () => {
    await expect(createProject(deps(), { parentPath: root, name: 'fresh', createGitHubRepository: true })).rejects.toMatchObject({ code: 'gh-missing' })
    expect(existsSync(join(root, 'fresh'))).toBe(false)
  })

  it('creates a private GitHub repository through gh and pushes main when opted in', async () => {
    installed.add('gh')
    const bare = join(root, 'remote.git')
    execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore', env })
    const ghCalls: (readonly string[])[] = []
    const withFakeGh: CommandRunner = input => {
      if (input.argv[0] !== 'gh') return nodeRunner(input)
      ghCalls.push(input.argv)
      execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: input.cwd, env })
      return Promise.resolve({ exitCode: 0, stdout: 'https://github.com/test/fresh\n', stderr: '' })
    }
    const created = await createProject(deps(withFakeGh), { parentPath: root, name: 'fresh', createGitHubRepository: true })
    expect(ghCalls).toEqual([['gh', 'repo', 'create', 'fresh', '--private', '--source', '.', '--remote', 'origin']])
    expect(created).toMatchObject({ gitHubRepository: 'https://github.com/test/fresh', warning: null })
    expect(execFileSync('git', ['--git-dir', bare, 'log', '--format=%s', 'main'], { encoding: 'utf8', env }).trim()).toBe('chore: initialize fresh')
  })

  it('keeps the project and warns with the next command when gh fails', async () => {
    installed.add('gh')
    const failingGh: CommandRunner = input =>
      input.argv[0] === 'gh' ? Promise.resolve({ exitCode: 1, stdout: '', stderr: 'not logged in' }) : nodeRunner(input)
    const created = await createProject(deps(failingGh), { parentPath: root, name: 'fresh', createGitHubRepository: true })
    expect(created.gitHubRepository).toBeNull()
    expect(created.warning).toContain('gh auth status')
    expect(registered).toEqual([join(root, 'fresh')])
  })
})
