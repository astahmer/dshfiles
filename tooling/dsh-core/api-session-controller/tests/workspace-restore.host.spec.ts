import { randomUUID } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionWorkspaceRestoreController } from '../src/workspace-restore-controller.ts'
import { WorkspaceRestoreStore } from '../src/workspace-restore-store.ts'

interface RepositoryFixture {
  readonly root: string
  readonly path: string
  readonly storagePath: string
  readonly contentPath: string
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly targetCommitId: string
  readonly currentCommitId: string
}

interface HostContextOptions {
  readonly ownerSessionIds?: readonly SessionId[]
  readonly archivedSessionIds?: readonly SessionId[]
  readonly runningSessionIds?: readonly SessionId[]
  readonly otherWorkspacePaths?: readonly string[]
  readonly jujutsuExecutable?: string
}

const sessionId = (value: string): SessionId => SessionId(value)
const workspaceId = (value: string): WorkspaceId => WorkspaceId(value)

const runJujutsu = (cwd: string, args: readonly string[]): string => execFileSync(
  'jj',
  ['--color=never', '--no-pager', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
).trim()

const findJujutsu = async (): Promise<string> => {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, 'jj')
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  throw new Error('The focused Host test requires jj on PATH.')
}

const testStorageDomain = (root: string) => ({
  open: async () => {
    const filePath = join(root, 'workspace-restore-domain.json')
    let serialized = '[]'
    try {
      serialized = await readFile(filePath, 'utf8')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const rows = new Map<string, unknown>(JSON.parse(serialized))
    const table = {
      get: (key: string) => rows.get(key),
      entries: () => rows.entries(),
      put: async (key: string, value: unknown) => {
        rows.set(key, value)
        await mkdir(root, { recursive: true })
        await writeFile(filePath, JSON.stringify([...rows]))
      },
    }
    return {
      table: (name: string) => {
        if (name !== 'workspaces') throw new Error(`Unexpected restore table: ${name}`)
        return table
      },
      close: async () => {},
    }
  },
})

const testSubprocess = (executable: string) => ({
  resolveExecutable: async (command: string): Promise<string> => {
    if (command !== 'jj') throw new Error(`Unexpected executable request: ${command}`)
    return executable
  },
  spawn: (options: { readonly argv: readonly string[]; readonly cwd: string; readonly signal: AbortSignal }) => {
    const child = spawn(options.argv[0] ?? executable, options.argv.slice(1), {
      cwd: options.cwd,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let exited = false
    let resolveDone: (outcome: { readonly exitCode: number }) => void = () => {}
    const done = new Promise<{ readonly exitCode: number }>(resolveDoneValue => { resolveDone = resolveDoneValue })
    child.stdout?.on('data', (chunk: Buffer) => { stdout = Buffer.concat([stdout, chunk]) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]) })
    child.once('close', code => {
      exited = true
      resolveDone({ exitCode: code ?? -1 })
    })
    const waitForExit = (signal?: AbortSignal): Promise<boolean> => {
      if (exited) return Promise.resolve(true)
      if (signal?.aborted === true) return Promise.resolve(false)
      return new Promise(resolve => {
        const finish = (): void => {
          signal?.removeEventListener('abort', abort)
          resolve(true)
        }
        const abort = (): void => {
          child.removeListener('close', finish)
          resolve(false)
        }
        child.once('close', finish)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted === true) abort()
      })
    }
    const output = (read: () => Buffer) => ({
      readFrom: (offset: number) => ({ text: read().subarray(offset).toString('utf8'), lossy: false }),
    })
    return {
      done,
      terminate: () => { child.kill('SIGTERM') },
      waitForExit,
      collected: { stdout: output(() => stdout), stderr: output(() => stderr) },
    }
  },
})

const createRepository = async (): Promise<RepositoryFixture> => {
  const parent = await realpath(tmpdir())
  const root = await realpath(await mkdtemp(join(parent, 'dsh-workspace-restore-')))
  const path = join(root, 'repo')
  const storagePath = join(root, 'storage')
  const contentPath = join(path, 'state.txt')
  await mkdir(path)
  runJujutsu(path, ['git', 'init', '--colocate'])
  await writeFile(contentPath, 'saved\n')
  runJujutsu(path, ['describe', '-m', 'restore baseline'])
  const targetCommitId = runJujutsu(path, ['log', '--no-graph', '-r', '@', '--template', 'commit_id'])
  runJujutsu(path, ['new', '-m', 'restore current'])
  await writeFile(contentPath, 'current\n')
  const currentCommitId = runJujutsu(path, ['log', '--no-graph', '-r', '@', '--template', 'commit_id'])
  return {
    root,
    path,
    storagePath,
    contentPath,
    sessionId: sessionId(randomUUID()),
    workspaceId: workspaceId(randomUUID()),
    targetCommitId,
    currentCommitId,
  }
}

const createContext = async (fixture: RepositoryFixture, options: HostContextOptions = {}): Promise<Context> => {
  const ctx = new Context()
  ctx.provide('storageDomain', testStorageDomain(fixture.storagePath) as never)
  ctx.provide('subprocess', testSubprocess(options.jujutsuExecutable ?? await findJujutsu()) as never)
  const sessionIds = [fixture.sessionId, ...(options.ownerSessionIds ?? [])]
  const workspace = {
    id: fixture.workspaceId,
    path: fixture.path,
    sessionIds,
  }
  const workspaces = [
    workspace,
    ...(options.otherWorkspacePaths ?? []).map(path => ({ id: workspaceId(randomUUID()), path, sessionIds: [] })),
  ]
  const archivedSessionIds = options.archivedSessionIds ?? []
  const runningSessionIds = options.runningSessionIds ?? []
  ctx.provide('workspaceRegistry', {
    get: (selectedWorkspaceId: WorkspaceId) => workspaces.find(candidate => candidate.id === selectedWorkspaceId),
    list: () => workspaces,
    archivedSessionIds,
  } as never)
  ctx.provide('sessions', {
    get: (selectedSessionId: SessionId) => sessionIds.includes(selectedSessionId)
      ? { header: { cwd: fixture.path } }
      : undefined,
  } as never)
  ctx.provide('agents', {
    get: (selectedSessionId: SessionId) => runningSessionIds.includes(selectedSessionId) ? { status: 'running' } : undefined,
  } as never)
  return ctx
}

let temporaryRoot: string | undefined
let hostContext: Context | undefined

afterEach(async () => {
  try {
    await hostContext?.fiber.dispose()
  } finally {
    hostContext = undefined
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
    temporaryRoot = undefined
  }
})

describe('SessionWorkspaceRestoreController', () => {
  it('previews exact JJ paths, restores once, and returns a durable receipt', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready
    const preview = await controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)

    expect(preview.changedPaths).toEqual([{ path: 'state.txt', status: 'modified' }])
    expect(preview.currentCommitId).toBe(fixture.currentCommitId)
    const receipt = await controller.confirm({ previewId: preview.previewId }, new AbortController().signal)
    expect(receipt.state).toBe('complete')
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('saved\n')
    expect((await controller.status({ sessionId: fixture.sessionId }, new AbortController().signal))?.operationId)
      .toBe(receipt.operationId)
    await expect(controller.confirm({ previewId: preview.previewId }, new AbortController().signal))
      .rejects.toThrow(/expired/)
  })

  it('refuses to apply a restore when the bounded path preview is truncated', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    for (let index = 0; index < 201; index += 1) {
      await writeFile(join(fixture.path, `added-${index}.txt`), 'new file\n')
    }
    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready

    const preview = await controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)
    expect(preview.changedPaths).toHaveLength(200)
    expect(preview.changedPathsTruncated).toBe(true)
    await expect(controller.confirm({ previewId: preview.previewId }, new AbortController().signal))
      .rejects.toThrow('This restore preview omits paths, so it cannot be confirmed.')

    expect(await readFile(fixture.contentPath, 'utf8')).toBe('current\n')
    expect(await readFile(join(fixture.path, 'added-200.txt'), 'utf8')).toBe('new file\n')
  })

  it('rejects stale previews without replacing an edit made after preview', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready
    const preview = await controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)
    await writeFile(fixture.contentPath, 'external edit\n')

    await expect(controller.confirm({ previewId: preview.previewId }, new AbortController().signal))
      .rejects.toThrow(/changed after the restore preview/)
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('external edit\n')
  })

  it('does not start a restore while a workspace operation has an admission lease', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready
    const preview = await controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)
    const release = controller.beginWorkspaceAccess(fixture.workspaceId, fixture.path)
    try {
      await expect(controller.confirm({ previewId: preview.previewId }, new AbortController().signal))
        .rejects.toThrow(/Finish the current Session or workspace operation/)
    } finally {
      release()
    }
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('current\n')
  })

  it('rejects a workspace with an archived Session whose Agent is still running', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    const archivedOwner = sessionId(randomUUID())
    hostContext = await createContext(fixture, {
      ownerSessionIds: [archivedOwner],
      archivedSessionIds: [archivedOwner],
      runningSessionIds: [archivedOwner],
    })
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready

    await expect(controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)).rejects.toThrow(/another Session owns this workspace/)
  })

  it('rejects overlapping registered workspaces before creating a preview', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    const nestedWorkspace = join(fixture.path, 'nested-workspace')
    await mkdir(nestedWorkspace)
    hostContext = await createContext(fixture, { otherWorkspacePaths: [nestedWorkspace] })
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready

    await expect(controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)).rejects.toThrow(/another workspace overlaps this path/)
  })

  it('rejects a changed path that is a symbolic link in the workspace', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    const outside = join(fixture.root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(fixture.path, 'linked'))
    runJujutsu(fixture.path, ['status'])
    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready

    await expect(controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)).rejects.toThrow(/symbolic-link path/)
  })

  it('records a partial command failure and recovers through an explicit rollback', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    const executable = await findJujutsu()
    const markerPath = join(fixture.root, 'restore-failed-once')
    const wrapperPath = join(fixture.root, 'jj-partial-failure.mjs')
    const wrapper = [
      '#!/usr/bin/env node',
      "import { spawnSync } from 'node:child_process'",
      "import { existsSync, writeFileSync } from 'node:fs'",
      `const executable = ${JSON.stringify(executable)}`,
      `const contentPath = ${JSON.stringify(fixture.contentPath)}`,
      `const markerPath = ${JSON.stringify(markerPath)}`,
      'const args = process.argv.slice(2)',
      "if (args.includes('restore') && !existsSync(markerPath)) {",
      "  writeFileSync(markerPath, 'failed once')",
      "  writeFileSync(contentPath, 'partial\\n')",
      '  process.exit(23)',
      '}',
      "const result = spawnSync(executable, args, { stdio: 'inherit' })",
      'process.exit(result.status ?? 1)',
      '',
    ].join('\n')
    await writeFile(wrapperPath, wrapper)
    await chmod(wrapperPath, 0o755)
    hostContext = await createContext(fixture, { jujutsuExecutable: wrapperPath })
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready

    const preview = await controller.prepare({
      sessionId: fixture.sessionId,
      action: 'restore',
      targetCommitId: fixture.targetCommitId,
    }, new AbortController().signal)
    const partial = await controller.confirm({ previewId: preview.previewId }, new AbortController().signal)

    expect(partial.state).toBe('partial')
    expect(partial.failure).toBe('command-failed')
    expect(partial.canRollback).toBe(true)
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('partial\n')

    const rollbackPreview = await controller.prepare({ sessionId: fixture.sessionId, action: 'rollback' }, new AbortController().signal)
    const rolledBack = await controller.confirm({ previewId: rollbackPreview.previewId }, new AbortController().signal)

    expect(rolledBack.state).toBe('rolled-back')
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('current\n')
    await controller.dispose()
  })

  it('reconciles a durable applying receipt against the real workspace after Host restart', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    hostContext = await createContext(fixture)
    const details = await stat(fixture.path, { bigint: true })
    const store = new WorkspaceRestoreStore()
    await store.open(hostContext.storageDomain)
    await store.put({
      operationId: randomUUID(),
      action: 'restore',
      sessionId: fixture.sessionId,
      workspaceId: fixture.workspaceId,
      workspacePath: fixture.path,
      directoryIdentity: `${details.dev}:${details.ino}`,
      savedCommitId: fixture.currentCommitId,
      targetCommitId: fixture.targetCommitId,
      attemptBeforeCommitId: fixture.currentCommitId,
      attemptTargetCommitId: fixture.targetCommitId,
      state: 'applying',
      currentCommitId: fixture.currentCommitId,
      updatedAt: Date.now(),
    })
    await store.close()
    await hostContext.fiber.dispose()
    hostContext = undefined
    runJujutsu(fixture.path, ['restore', '--from', fixture.targetCommitId, '--into', '@'])

    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready
    const receipt = await controller.status({ sessionId: fixture.sessionId }, new AbortController().signal)
    expect(receipt?.state).toBe('complete')
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('saved\n')
  })

  it('restores the saved tree through an explicit rollback after a partial receipt', async () => {
    const fixture = await createRepository()
    temporaryRoot = fixture.root
    await writeFile(fixture.contentPath, 'partially changed\n')
    runJujutsu(fixture.path, ['status'])
    const partialCommitId = runJujutsu(fixture.path, ['log', '--no-graph', '-r', '@', '--template', 'commit_id'])
    const details = await stat(fixture.path, { bigint: true })
    hostContext = await createContext(fixture)
    const store = new WorkspaceRestoreStore()
    await store.open(hostContext.storageDomain)
    await store.put({
      operationId: randomUUID(),
      action: 'restore',
      sessionId: fixture.sessionId,
      workspaceId: fixture.workspaceId,
      workspacePath: fixture.path,
      directoryIdentity: `${details.dev}:${details.ino}`,
      savedCommitId: fixture.currentCommitId,
      targetCommitId: fixture.targetCommitId,
      attemptBeforeCommitId: fixture.currentCommitId,
      attemptTargetCommitId: fixture.targetCommitId,
      state: 'partial',
      currentCommitId: partialCommitId,
      updatedAt: Date.now(),
    })
    await store.close()
    await hostContext.fiber.dispose()
    hostContext = await createContext(fixture)
    const controller = new SessionWorkspaceRestoreController(hostContext)
    await controller.ready

    const preview = await controller.prepare({ sessionId: fixture.sessionId, action: 'rollback' }, new AbortController().signal)
    expect(preview.targetCommitId).toBe(fixture.currentCommitId)
    const receipt = await controller.confirm({ previewId: preview.previewId }, new AbortController().signal)

    expect(receipt.state).toBe('rolled-back')
    expect(await readFile(fixture.contentPath, 'utf8')).toBe('current\n')
  })
})
