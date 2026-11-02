import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

// The worker is a second bundle entry, so the Host half is exercised as it ships: `pnpm test` runs after the build.
const builtHost = new URL('../dist/index.js', import.meta.url)

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
    Effect.promise(() =>
      handle.agent.ctx.tools.execute({ callId: ToolCallId(randomUUID()), name, arguments: args, signal: AbortSignal.timeout(60_000), agent: handle.agent }),
    )
  return { run, workspace }
})

const textOf = (content: readonly { readonly type: string; readonly text?: string }[]) => content.map(block => block.text ?? '').join('\n')

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
