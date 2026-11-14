import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

// The worker is a second bundle entry, so the Host half is exercised as it ships: `pnpm test` runs after the build.
const builtHost = new URL('../dist/index.js', import.meta.url)

/** The stock subprocess service, recording every spawn request it serves. */
const spawned: SubprocessSpawnSpec[] = []
class RecordingSubprocess extends LocalSubprocessRuntime {
  override spawn(spec: SubprocessSpawnSpec) {
    spawned.push(spec)
    return super.spawn(spec)
  }
}

/** A real Host with one Agent rooted in a temporary workspace, the built plugin mounted, and DSH_HOME isolated. */
const mountedSearch = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), 'fff-search-host-')))),
    directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )
  const previousHome = process.env.DSH_HOME
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.DSH_HOME = join(root, 'home')
    }),
    () =>
      Effect.sync(() => {
        if (previousHome === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = previousHome
      }),
  )
  const workspace = join(root, 'workspace')
  yield* Effect.promise(async () => {
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'rules.ts'), 'export class LifecycleRules {}\n')
    await writeFile(join(workspace, 'notes.md'), 'nothing here\n')
  })
  const host = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const created = await createTestHost()
      await created.ctx.plugin(SessionStore)
      await created.ctx.plugin(SessionProjectionRegistry)
      await created.ctx.plugin(RecordingSubprocess)
      await created.ctx.plugin(LocalFileSystem, { cwd: root })
      await created.ctx.plugin(WorkingDirectoryService)
      await created.ctx.plugin(LlmRuntime)
      await created.ctx.plugin(AgentRegistry)
      await created.ctx.plugin(AgentLoop)
      await created.mount(await import(builtHost.href), { packageId: '@dshfiles/fff-search', native: true })
      return created
    }),
    created => Effect.promise(() => created.dispose()),
  )
  const handle = yield* Effect.acquireRelease(
    Effect.promise(() => host.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: workspace } })),
    created => Effect.promise(() => created.dispose()),
  )
  const run = (name: 'grep' | 'glob', args: { readonly pattern: string; readonly path?: string }) =>
    Effect.promise(() => host.runTool({ name, arguments: args, signal: AbortSignal.timeout(60_000), agent: handle.agent }))
  return { run, workspace, root }
})

/** The fff index processes serving this test's isolated home; DSH's runner, not this process, is their parent. */
const indexProcesses = (root: string): readonly string[] =>
  execFileSync('ps', ['-e', '-ww', '-o', 'args='], { encoding: 'utf8' })
    .split('\n')
    .filter(line => line.includes('fff-worker.js') && line.includes(root))

const textOf = (content: readonly { readonly type: string; readonly text?: string }[]) => content.map(block => block.text ?? '').join('\n')

/**
 * This suite mounts a real Host and executes grep/glob, which forks the native index process. It used to be skipped on
 * CI, where the test runner's child exited mid-run ("Worker exited unexpectedly"): that was the index worker thread's
 * teardown segfaulting the whole process, which the index process now avoids.
 */
describe.skipIf(!existsSync(builtHost))('fff-search Host', () => {
  it.effect('serves grep and glob as Agent-scoped tools over the resident index', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const search = yield* mountedSearch
        const grep = yield* search.run('grep', { pattern: 'LifecycleRules' })
        expect(grep.isError).toBe(false)
        expect(textOf(grep.content)).toBe('Found 1 matches\n\nsrc/rules.ts:\n  Line 1: export class LifecycleRules {}')

        const glob = yield* search.run('glob', { pattern: '*.md' })
        expect(textOf(glob.content)).toBe('Found 1 files\nnotes.md')
      }),
    ),
  )

  // Tearing down a worker thread that held fff's native library segfaulted the whole process on every Host restart.
  it.live.skipIf(process.platform !== 'linux')('closing the Host stops the index process and leaves the Host running', () =>
    Effect.gen(function* () {
      let root = ''
      yield* Effect.scoped(
        Effect.gen(function* () {
          const search = yield* mountedSearch
          root = search.root
          expect((yield* search.run('glob', { pattern: '*.md' })).isError).toBe(false)
          expect(indexProcesses(root)).toHaveLength(1)
        }),
      )
      expect(indexProcesses(root)).toEqual([])
    }),
  )

  it.effect('starts the index process through the subprocess service with a control pipe', () =>
    Effect.scoped(
      Effect.gen(function* () {
        spawned.length = 0
        const search = yield* mountedSearch
        expect((yield* search.run('glob', { pattern: '*.md' })).isError).toBe(false)
        const index = spawned.filter(spec => spec.argv.some(argument => argument.endsWith('fff-worker.js')))
        expect(index).toHaveLength(1)
        expect(index[0]?.stdio.control).toBe('pipe')
      }),
    ),
  )

  it.effect('tells the Agent about a path that does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const search = yield* mountedSearch
        const missing = yield* search.run('grep', { pattern: 'x', path: 'missing-dir' })
        expect(missing.isError).toBe(true)
        expect(textOf(missing.content)).toContain('path does not exist: missing-dir')
      }),
    ),
  )
})
